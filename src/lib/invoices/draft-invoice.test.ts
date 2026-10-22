import "dotenv/config";

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "../prisma";
import {
  createDraftInvoice,
  DraftInvoiceError,
  replaceDraftInvoiceItems,
  updateDraftInvoice,
  type DraftInvoiceItemInput,
} from "./draft-invoice";
import { issueInvoice } from "./issue-invoice";

const prisma = getPrismaClient();
const config = {
  companyName: "Hiiiive", headingFontName: "DejaVu Serif", bodyFontName: "DM Sans", primaryColor: "#255B83",
};
const line = (quantity = "1", unitPrice = "10", extras: Partial<DraftInvoiceItemInput> = {}): DraftInvoiceItemInput => ({
  description: "Service line", quantity, unitPrice, ...extras,
});

after(async () => { await prisma.$disconnect(); });

describe("draft invoice service (PostgreSQL integration)", () => {
  it("creates a draft with defaults, no number, and server-derived amounts", async () => withFixture(async ({ organizationId, clientId }) => {
    const created = await createDraftInvoice(organizationId, {
      clientId,
      items: [{ ...line("1.3333", "10.5555"), lineTotal: "999999" } as DraftInvoiceItemInput],
    });
    const item = await prisma.invoiceItem.findFirstOrThrow({ where: { organizationId, invoiceId: created.id } });
    assert.equal(created.lifecycleStatus, "DRAFT");
    assert.equal(created.paymentStatus, "UNPAID");
    assert.equal(created.currencyCode, "LKR");
    assert.equal(created.invoiceNumber, null);
    assert.equal(created.issuedAt, null);
    assert.equal(created.templateVersionId, null);
    assert.equal(created.subtotal.toString(), "14.0736");
    assert.equal(created.grandTotal.toString(), "14.0736");
    assert.equal(item.lineTotal.toString(), "14.0736");
    assert.equal(item.position, 0);
    await assertNoSequence(organizationId);
  }));

  it("normalizes lowercase currency and rejects malformed currency", async () => withFixture(async ({ organizationId, clientId }) => {
    const invoice = await createDraftInvoice(organizationId, { clientId, currencyCode: "usd", items: [line()] });
    assert.equal(invoice.currencyCode, "USD");
    await assert.rejects(createDraftInvoice(organizationId, { clientId, currencyCode: "U$D", items: [line()] }), DraftInvoiceError);
    await assertNoSequence(organizationId);
  }));

  it("requires an active same-organization client", async () => withFixture(async ({ organizationId, clientId, otherOrganizationId, otherClientId }) => {
    await assert.rejects(createDraftInvoice(organizationId, { clientId: otherClientId, items: [line()] }), DraftInvoiceError);
    await prisma.client.update({ where: { id: clientId }, data: { active: false } });
    await assert.rejects(createDraftInvoice(organizationId, { clientId, items: [line()] }), DraftInvoiceError);
    await assertNoSequence(otherOrganizationId);
  }));

  it("supports free-text items and active same-tenant services", async () => withFixture(async ({ organizationId, clientId }) => {
    const service = await prisma.service.create({ data: { organizationId, name: "Consulting", defaultUnitPrice: new Prisma.Decimal("25") } });
    const invoice = await createDraftInvoice(organizationId, {
      clientId,
      items: [line("2", "12", { serviceId: service.id }), line("1", "3", { description: "Free text" })],
    });
    const items = await prisma.invoiceItem.findMany({ where: { organizationId, invoiceId: invoice.id }, orderBy: { position: "asc" } });
    assert.deepEqual(items.map((item) => item.serviceId), [service.id, null]);
    assert.deepEqual(items.map((item) => item.position), [0, 1]);
    assert.equal(invoice.subtotal.toString(), "27");
  }));

  it("rejects cross-tenant and inactive services", async () => withFixture(async ({ organizationId, clientId, otherOrganizationId }) => {
    const foreign = await prisma.service.create({ data: { organizationId: otherOrganizationId, name: "Foreign" } });
    await assert.rejects(createDraftInvoice(organizationId, { clientId, items: [line("1", "4", { serviceId: foreign.id })] }), DraftInvoiceError);
    const inactive = await prisma.service.create({ data: { organizationId, name: "Inactive", active: false } });
    await assert.rejects(createDraftInvoice(organizationId, { clientId, items: [line("1", "4", { serviceId: inactive.id })] }), DraftInvoiceError);
    await assertNoSequence(organizationId);
  }));

  it("uses service defaults only by request and enforces currency matching", async () => withFixture(async ({ organizationId, clientId }) => {
    const service = await prisma.service.create({ data: { organizationId, name: "USD service", defaultUnitPrice: new Prisma.Decimal("8.50"), currencyCode: "USD" } });
    await assert.rejects(createDraftInvoice(organizationId, { clientId, currencyCode: "USD", items: [{ description: "Service", quantity: "2", serviceId: service.id }] }), DraftInvoiceError);
    const defaulted = await createDraftInvoice(organizationId, { clientId, currencyCode: "usd", items: [{ description: "Default", quantity: "2", serviceId: service.id, useServiceDefaultPrice: true }] });
    assert.equal(defaulted.subtotal.toString(), "17");
    await assert.rejects(createDraftInvoice(organizationId, { clientId, items: [{ description: "Missing", quantity: "1", serviceId: service.id, useServiceDefaultPrice: true }] }), /differs from the invoice/);
    const explicit = await createDraftInvoice(organizationId, { clientId, items: [line("1", "3.25", { serviceId: service.id, useServiceDefaultPrice: true })] });
    assert.equal(explicit.subtotal.toString(), "3.25");
  }));

  it("rejects invalid item amounts and discounts", async () => withFixture(async ({ organizationId, clientId }) => {
    for (const quantity of ["0", "-1"]) {
      await assert.rejects(createDraftInvoice(organizationId, { clientId, items: [line(quantity)] }), DraftInvoiceError);
    }
    await assert.rejects(createDraftInvoice(organizationId, { clientId, items: [line("1", "-1")] }), DraftInvoiceError);
    await assert.rejects(createDraftInvoice(organizationId, { clientId, discountAmount: "11", items: [line()] }), DraftInvoiceError);
    await assertNoSequence(organizationId);
  }));

  it("updates draft header fields and recalculates persisted line totals", async () => withFixture(async ({ organizationId, clientId }) => {
    const invoice = await createDraftInvoice(organizationId, { clientId, items: [line("1.2345", "2.1111")] });
    await prisma.invoiceItem.updateMany({ where: { organizationId, invoiceId: invoice.id }, data: { lineTotal: new Prisma.Decimal("999") } });
    const updated = await updateDraftInvoice(organizationId, invoice.id, { currencyCode: "cad", discountAmount: "1", notes: "Updated" });
    const item = await prisma.invoiceItem.findFirstOrThrow({ where: { organizationId, invoiceId: invoice.id } });
    assert.equal(updated.currencyCode, "CAD");
    assert.equal(updated.subtotal.toString(), "2.6062");
    assert.equal(updated.grandTotal.toString(), "1.6062");
    assert.equal(item.lineTotal.toString(), "2.6062");
    assert.equal(updated.notes, "Updated");
  }));

  it("atomically replaces items and recalculates totals; invalid replacement preserves prior rows", async () => withFixture(async ({ organizationId, clientId }) => {
    const invoice = await createDraftInvoice(organizationId, { clientId, discountAmount: "2", items: [line("2", "10")] });
    const result = await replaceDraftInvoiceItems(organizationId, invoice.id, [line("3", "5"), line("1", "4")]);
    assert.equal(result.subtotal.toString(), "19");
    assert.equal(result.grandTotal.toString(), "17");
    const before = await prisma.invoiceItem.findMany({ where: { organizationId, invoiceId: invoice.id }, orderBy: { position: "asc" } });
    await assert.rejects(replaceDraftInvoiceItems(organizationId, invoice.id, [line("1", "99", { serviceId: "00000000-0000-0000-0000-000000000000" })]), DraftInvoiceError);
    const afterRows = await prisma.invoiceItem.findMany({ where: { organizationId, invoiceId: invoice.id }, orderBy: { position: "asc" } });
    assert.deepEqual(afterRows.map((row) => row.id), before.map((row) => row.id));
    assert.equal((await prisma.invoice.findFirstOrThrow({ where: { id: invoice.id } })).grandTotal.toString(), "17");
    await assertNoSequence(organizationId);
  }));

  it("rejects cross-organization and issued invoice edits", async () => withFixture(async ({ organizationId, clientId, otherOrganizationId, otherClientId }) => {
    const invoice = await createDraftInvoice(organizationId, { clientId, items: [line()] });
    await assert.rejects(updateDraftInvoice(otherOrganizationId, invoice.id, { notes: "wrong tenant" }), DraftInvoiceError);
    await assert.rejects(updateDraftInvoice(organizationId, invoice.id, { clientId: otherClientId }), DraftInvoiceError);
    await issueInvoice(organizationId, invoice.id);
    await assert.rejects(updateDraftInvoice(organizationId, invoice.id, { notes: "after issue" }), DraftInvoiceError);
    await assert.rejects(replaceDraftInvoiceItems(organizationId, invoice.id, [line()]), DraftInvoiceError);
  }));

  it("issueInvoice independently recalculates draft service totals", async () => withFixture(async ({ organizationId, clientId }) => {
    const invoice = await createDraftInvoice(organizationId, { clientId, discountAmount: "1", items: [line("1.5", "2.2222")] });
    await prisma.invoiceItem.updateMany({ where: { organizationId, invoiceId: invoice.id }, data: { lineTotal: new Prisma.Decimal("999") } });
    await prisma.invoice.update({ where: { id: invoice.id }, data: { subtotal: new Prisma.Decimal("999"), grandTotal: new Prisma.Decimal("998") } });
    const issued = await issueInvoice(organizationId, invoice.id);
    const item = await prisma.invoiceItem.findFirstOrThrow({ where: { organizationId, invoiceId: invoice.id } });
    assert.equal(issued.lifecycleStatus, "ISSUED");
    assert.equal(issued.subtotal.toString(), "3.3333");
    assert.equal(issued.grandTotal.toString(), "2.3333");
    assert.equal(item.lineTotal.toString(), "3.3333");
  }));
});

async function withFixture(run: (fixture: { organizationId: string; clientId: string; otherOrganizationId: string; otherClientId: string }) => Promise<void>): Promise<void> {
  const organizationId = await ensureOrganization("primary");
  const otherOrganizationId = await ensureOrganization("other");
  const template = await ensureDefaultTemplate(organizationId);
  await cleanup(organizationId);
  await cleanup(otherOrganizationId);
  await setDefault(organizationId, template.id);
  const client = await prisma.client.create({ data: { organizationId, name: "Draft client" } });
  const otherClient = await prisma.client.create({ data: { organizationId: otherOrganizationId, name: "Other client" } });
  try {
    await run({ organizationId, clientId: client.id, otherOrganizationId, otherClientId: otherClient.id });
  } finally {
    await cleanup(organizationId);
    await cleanup(otherOrganizationId);
    await setDefault(organizationId, template.id);
  }
}

async function ensureOrganization(tenant: string): Promise<string> {
  const slug = `draft-invoice-integration-${tenant}`;
  const existing = await prisma.organization.findUnique({ where: { slug } });
  return existing?.id ?? (await prisma.organization.create({ data: { name: "Draft Invoice Integration", slug } })).id;
}

async function ensureDefaultTemplate(organizationId: string) {
  const template = await prisma.invoiceTemplate.upsert({
    where: { organizationId_key: { organizationId, key: "draft-invoice-default" } },
    create: { organizationId, key: "draft-invoice-default", name: "Draft invoice default", active: true },
    update: { active: true },
  });
  const existingVersion = await prisma.invoiceTemplateVersion.findFirst({ where: { organizationId, templateId: template.id } });
  if (!existingVersion) await prisma.invoiceTemplateVersion.create({
    data: { organizationId, templateId: template.id, version: 1, rendererKey: "hiiiive-default", config },
  });
  return template;
}

async function setDefault(organizationId: string, templateId: string) {
  await prisma.invoiceTemplate.updateMany({ where: { organizationId }, data: { isDefault: false } });
  await prisma.invoiceTemplate.update({ where: { id: templateId }, data: { active: true, isDefault: true } });
}

async function cleanup(organizationId: string) {
  await prisma.invoiceRelation.deleteMany({ where: { organizationId } });
  await prisma.payment.deleteMany({ where: { organizationId } });
  await prisma.invoiceItem.deleteMany({ where: { organizationId } });
  await prisma.invoice.deleteMany({ where: { organizationId } });
  await prisma.invoiceSequence.deleteMany({ where: { organizationId } });
  await prisma.service.deleteMany({ where: { organizationId } });
  await prisma.client.deleteMany({ where: { organizationId } });
}

async function assertNoSequence(organizationId: string) {
  const sequence = await prisma.invoiceSequence.findUnique({ where: { organizationId_key: { organizationId, key: "DEFAULT" } } });
  assert.equal(sequence, null);
}
