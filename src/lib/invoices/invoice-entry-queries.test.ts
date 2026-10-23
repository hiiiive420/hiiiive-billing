import "dotenv/config";

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "../prisma";
import { createDraftInvoice } from "./draft-invoice";
import {
  InvoiceEntryQueryError,
  loadDraftInvoiceForEditing,
  searchInvoiceClients,
  searchInvoiceServices,
} from "./invoice-entry-queries";
import { issueInvoice } from "./issue-invoice";

const prisma = getPrismaClient();
const templateConfig = {
  companyName: "Hiiiive", headingFontName: "DejaVu Serif", bodyFontName: "DM Sans", primaryColor: "#255B83",
};

after(async () => { await prisma.$disconnect(); });

describe("invoice entry read queries (PostgreSQL integration)", () => {
  it("searches active same-organization clients case-insensitively in stable order", async () => withFixture(async ({ organizationId, otherOrganizationId }) => {
    await prisma.client.createMany({ data: [
      { organizationId, name: "Alpha Consulting", email: "billing@alpha.test" },
      { organizationId, name: "alpha systems" },
      { organizationId, name: "Inactive Alpha", active: false },
      { organizationId: otherOrganizationId, name: "Alpha Foreign" },
    ] });
    const rows = await searchInvoiceClients(organizationId, "  ALPHA  ");
    assert.deepEqual(rows.map((row) => row.name), ["Alpha Consulting", "alpha systems"]);
    assert.deepEqual(Object.keys(rows[0]!).sort(), ["billingAddress", "email", "id", "name", "phone"]);
    assert.equal(rows.some((row) => row.name.includes("Foreign") || row.name.includes("Inactive")), false);
  }));

  it("trims empty client searches, orders deterministically, and caps result limits", async () => withFixture(async ({ organizationId }) => {
    await prisma.client.createMany({ data: Array.from({ length: 52 }, (_, index) => ({
      organizationId,
      name: `Limit ${index.toString().padStart(2, "0")}`,
    })) });
    const capped = await searchInvoiceClients(organizationId, "Limit", { limit: 500 });
    assert.equal(capped.length, 50);
    assert.equal(capped[0]?.name, "Limit 00");
    assert.deepEqual(capped.map((row) => row.name), [...capped.map((row) => row.name)].sort());
    assert.equal((await searchInvoiceClients(organizationId, "   ", { limit: 2 })).length, 2);
  }));

  it("rejects malformed limits and oversized queries, and treats wildcard characters literally", async () => withFixture(async ({ organizationId }) => {
    await prisma.client.createMany({ data: [
      { organizationId, name: "100% Realty" },
      { organizationId, name: "Anything Else" },
    ] });
    assert.equal((await searchInvoiceClients(organizationId, "%")).length, 1);
    await assert.rejects(searchInvoiceClients(organizationId, "x", { limit: 0 }), InvoiceEntryQueryError);
    await assert.rejects(searchInvoiceClients(organizationId, "x", { limit: 1.5 }), InvoiceEntryQueryError);
    await assert.rejects(searchInvoiceClients(organizationId, "x".repeat(101)), InvoiceEntryQueryError);
  }));

  it("searches active same-organization services and returns exact price strings and normalized currency", async () => withFixture(async ({ organizationId, otherOrganizationId }) => {
    await prisma.service.createMany({ data: [
      { organizationId, name: "Alpha Design", description: "Brand systems", defaultUnitPrice: new Prisma.Decimal("123456789.0123"), currencyCode: "usd" },
      { organizationId, name: "alpha support", defaultUnitPrice: null, currencyCode: "LKR" },
      { organizationId, name: "Inactive Alpha", active: false },
      { organizationId: otherOrganizationId, name: "Alpha Foreign" },
    ] });
    const rows = await searchInvoiceServices(organizationId, " ALPHA ");
    assert.deepEqual(rows.map((row) => row.name), ["Alpha Design", "alpha support"]);
    assert.equal(rows[0]?.defaultUnitPrice, "123456789.0123");
    assert.equal(rows[0]?.currencyCode, "USD");
    assert.equal(rows[1]?.defaultUnitPrice, null);
    assert.equal(rows[1]?.currencyCode, "LKR");
    assert.equal("organizationId" in rows[0]!, false);
  }));

  it("enforces service limits and literal text search", async () => withFixture(async ({ organizationId }) => {
    await prisma.service.createMany({ data: Array.from({ length: 5 }, (_, index) => ({
      organizationId,
      name: `Limit Service ${index}`,
      description: index === 0 ? "100% uptime" : "Standard support",
    })) });
    assert.equal((await searchInvoiceServices(organizationId, "Limit Service", { limit: 2 })).length, 2);
    assert.equal((await searchInvoiceServices(organizationId, "% uptime")).length, 1);
  }));

  it("loads draft fields, exact decimals, and items ordered by position then id without writes", async () => withFixture(async ({ organizationId, clientId, templateId }) => {
    const invoice = await createDraftInvoice(organizationId, {
      clientId,
      projectTitle: "Read model project",
      invoiceDate: new Date("2026-10-10T00:00:00.000Z"),
      dueDate: new Date("2026-11-10T00:00:00.000Z"),
      currencyCode: "usd",
      discountLabel: "Adjustment",
      discountAmount: "0.1250",
      notes: "Internal note",
      paymentTerms: "Due on receipt",
      items: [
        { description: "First", quantity: "1.3333", unitPrice: "2.2222", position: 4 },
        { description: "Second", quantity: "0.1250", unitPrice: "4.0001", position: 4 },
      ],
    });
    await prisma.invoiceItem.updateMany({ where: { organizationId, invoiceId: invoice.id }, data: { position: 7 } });
    const beforeInvoice = await prisma.invoice.findFirstOrThrow({ where: { id: invoice.id, organizationId } });
    const beforeItems = await prisma.invoiceItem.findMany({ where: { organizationId, invoiceId: invoice.id }, orderBy: { id: "asc" } });
    const beforeSequence = await prisma.invoiceSequence.findFirst({ where: { organizationId } });
    const beforeTemplateCount = await prisma.invoiceTemplate.count({ where: { organizationId } });

    const model = await loadDraftInvoiceForEditing(organizationId, invoice.id);
    assert.equal(model.client.id, clientId);
    assert.equal(model.client.name, "Fixture Client");
    assert.equal(model.client.active, true);
    assert.equal(model.clientId, clientId);
    assert.equal(model.projectTitle, "Read model project");
    assert.equal(model.invoiceDate, "2026-10-10");
    assert.equal(model.dueDate, "2026-11-10");
    assert.equal(model.currencyCode, "USD");
    assert.equal(model.discountLabel, "Adjustment");
    assert.equal(model.discountAmount, "0.125");
    assert.equal(model.notes, "Internal note");
    assert.equal(model.paymentTerms, "Due on receipt");
    assert.equal(model.subtotal, invoice.subtotal.toString());
    assert.equal(model.grandTotal, invoice.grandTotal.toString());
    assert.deepEqual(model.items.map((item) => item.id), beforeItems.map((item) => item.id));
    assert.deepEqual(model.items.map((item) => item.position), [7, 7]);
    assert.equal(model.items[0]?.quantity, beforeItems[0]?.quantity.toString());
    assert.equal(model.items[0]?.unitPrice, beforeItems[0]?.unitPrice.toString());
    assert.equal(model.items[0]?.lineTotal, beforeItems[0]?.lineTotal.toString());
    assert.equal(model.items[0]?.billingMode, "QUANTITY");
    assert.equal(model.items[0]?.amount, null);

    const afterInvoice = await prisma.invoice.findFirstOrThrow({ where: { id: invoice.id, organizationId } });
    const afterItems = await prisma.invoiceItem.findMany({ where: { organizationId, invoiceId: invoice.id }, orderBy: { id: "asc" } });
    assert.equal(afterInvoice.updatedAt.toISOString(), beforeInvoice.updatedAt.toISOString());
    assert.deepEqual(afterItems.map((item) => item.updatedAt.toISOString()), beforeItems.map((item) => item.updatedAt.toISOString()));
    assert.deepEqual(await prisma.invoiceSequence.findFirst({ where: { organizationId } }), beforeSequence);
    assert.equal(await prisma.invoiceTemplate.count({ where: { organizationId } }), beforeTemplateCount);
    assert.ok(templateId);
  }));

  it("returns flat-fee editor amounts without requiring quantity entry", async () => withFixture(async ({ organizationId, clientId }) => {
    const invoice = await createDraftInvoice(organizationId, {
      clientId,
      items: [{ billingMode: "FLAT_FEE", description: "Monthly service", amount: "55000" }],
    });
    const model = await loadDraftInvoiceForEditing(organizationId, invoice.id);
    assert.equal(model.items[0]?.billingMode, "FLAT_FEE");
    assert.equal(model.items[0]?.amount, "55000");
  }));

  it("returns saved service details without replacing the draft's explicit item price", async () => withFixture(async ({ organizationId, clientId }) => {
    const service = await prisma.service.create({
      data: { organizationId, name: "Current service", description: "Current description", defaultUnitPrice: new Prisma.Decimal("999999.1234"), currencyCode: "CAD" },
    });
    const invoice = await createDraftInvoice(organizationId, {
      clientId, currencyCode: "USD",
      items: [{ serviceId: service.id, description: "Saved description", quantity: "2", unitPrice: "25000" }],
    });
    const model = await loadDraftInvoiceForEditing(organizationId, invoice.id);
    assert.deepEqual(model.items[0]?.service, {
      id: service.id,
      name: "Current service",
      description: "Current description",
      defaultUnitPrice: "999999.1234",
      currencyCode: "CAD",
    });
    assert.equal(model.items[0]?.unitPrice, "25000");
    assert.equal(model.items[0]?.description, "Saved description");
  }));

  it("rejects cross-organization and issued invoices from the draft editor read model", async () => withFixture(async ({ organizationId, otherOrganizationId, clientId }) => {
    const invoice = await createDraftInvoice(organizationId, { clientId, items: [{ description: "Service", quantity: "1", unitPrice: "10" }] });
    await assert.rejects(loadDraftInvoiceForEditing(otherOrganizationId, invoice.id), InvoiceEntryQueryError);
    await issueInvoice(organizationId, invoice.id);
    await assert.rejects(loadDraftInvoiceForEditing(organizationId, invoice.id), InvoiceEntryQueryError);
  }));
});

async function withFixture(
  run: (fixture: { organizationId: string; otherOrganizationId: string; clientId: string; templateId: string }) => Promise<void>,
): Promise<void> {
  const organizationId = await ensureOrganization("primary");
  const otherOrganizationId = await ensureOrganization("other");
  const template = await ensureDefaultTemplate(organizationId);
  await cleanup(organizationId);
  await cleanup(otherOrganizationId);
  await setDefault(organizationId, template.id);
  const client = await prisma.client.create({ data: { organizationId, name: "Fixture Client" } });
  try {
    await run({ organizationId, otherOrganizationId, clientId: client.id, templateId: template.id });
  } finally {
    await cleanup(organizationId);
    await cleanup(otherOrganizationId);
    await setDefault(organizationId, template.id);
  }
}

async function ensureOrganization(tenant: string): Promise<string> {
  const slug = `invoice-entry-query-integration-${tenant}`;
  const existing = await prisma.organization.findUnique({ where: { slug } });
  return existing?.id ?? (await prisma.organization.create({ data: { name: "Invoice Entry Query Integration", slug } })).id;
}

async function ensureDefaultTemplate(organizationId: string) {
  const template = await prisma.invoiceTemplate.upsert({
    where: { organizationId_key: { organizationId, key: "invoice-entry-query-default" } },
    create: { organizationId, key: "invoice-entry-query-default", name: "Invoice Entry Query Default", active: true },
    update: { active: true },
  });
  const version = await prisma.invoiceTemplateVersion.findFirst({ where: { organizationId, templateId: template.id } });
  if (!version) await prisma.invoiceTemplateVersion.create({
    data: { organizationId, templateId: template.id, version: 1, rendererKey: "hiiiive-default", config: templateConfig },
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
