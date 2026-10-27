import "dotenv/config";

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "../prisma";
import {
  createDraftInvoice,
  DraftInvoiceError,
  replaceDraftInvoiceItems,
  updateFullDraftInvoice,
  updateDraftInvoice,
  type DraftInvoiceItemInput,
  type UpdateFullDraftInvoiceInput,
} from "./draft-invoice";
import { issueInvoice } from "./issue-invoice";
import { updateClient, updateService } from "@/lib/master-data/mutations";

const prisma = getPrismaClient();
const config = {
  companyName: "Hiiiive", headingFontName: "DejaVu Serif", bodyFontName: "DM Sans", primaryColor: "#255B83",
};
const line = (quantity = "1", unitPrice = "10", extras: { serviceId?: string | null; description?: string; useServiceDefaultPrice?: boolean; position?: number } = {}): DraftInvoiceItemInput => ({
  description: "Service line", quantity, unitPrice, ...extras,
});
const fullDraftInput = (
  clientId: string,
  overrides: Partial<UpdateFullDraftInvoiceInput> = {},
): UpdateFullDraftInvoiceInput => ({
  clientId,
  projectTitle: null,
  invoiceDate: null,
  dueDate: null,
  currencyCode: "LKR",
  discountLabel: null,
  discountAmount: "0",
  notes: null,
  paymentTerms: null,
  items: [line()],
  ...overrides,
});

after(async () => { await prisma.$disconnect(); });

describe("draft invoice service (PostgreSQL integration)", () => {
  it("creates a draft with defaults, no number, and server-derived amounts", async () => withFixture(async ({ organizationId, clientId }) => {
    const created = await createDraftInvoice(organizationId, {
      clientId,
      items: [{ ...line("1.3333", "10.5555"), lineTotal: "999999" } as unknown as DraftInvoiceItemInput],
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
    assert.equal(item.billingMode, "QUANTITY");
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

  it("stores flat fees with canonical quantity, amount, and recalculated total", async () => withFixture(async ({ organizationId, clientId }) => {
    const invoice = await createDraftInvoice(organizationId, {
      clientId,
      items: [{ billingMode: "FLAT_FEE", description: "Social Media Management — October 2026", amount: "55000.1250" }],
    });
    const item = await prisma.invoiceItem.findFirstOrThrow({ where: { organizationId, invoiceId: invoice.id } });
    assert.equal(item.billingMode, "FLAT_FEE");
    assert.equal(item.quantity.toString(), "1");
    assert.equal(item.unitPrice.toString(), "55000.125");
    assert.equal(item.lineTotal.toString(), "55000.125");
    assert.equal(invoice.subtotal.toString(), "55000.125");
    await assertNoSequence(organizationId);
  }));

  it("validates flat amounts and uses service defaults only when explicitly requested", async () => withFixture(async ({ organizationId, clientId }) => {
    const service = await prisma.service.create({ data: { organizationId, name: "Monthly management", defaultUnitPrice: new Prisma.Decimal("55000"), currencyCode: "LKR" } });
    await assert.rejects(createDraftInvoice(organizationId, { clientId, items: [{ billingMode: "FLAT_FEE", description: "Missing amount", serviceId: service.id }] }), /Flat-fee amount is required/);
    await assert.rejects(createDraftInvoice(organizationId, { clientId, items: [{ billingMode: "FLAT_FEE", description: "Negative amount", amount: "-1" }] }), /cannot be negative/);
    const defaulted = await createDraftInvoice(organizationId, { clientId, items: [{ billingMode: "FLAT_FEE", description: "Defaulted", serviceId: service.id, useServiceDefaultPrice: true }] });
    const defaultItem = await prisma.invoiceItem.findFirstOrThrow({ where: { organizationId, invoiceId: defaulted.id } });
    assert.equal(defaultItem.unitPrice.toString(), "55000");
    assert.equal(defaultItem.quantity.toString(), "1");
    await assert.rejects(createDraftInvoice(organizationId, { clientId, currencyCode: "USD", items: [{ billingMode: "FLAT_FEE", description: "Wrong currency", serviceId: service.id, useServiceDefaultPrice: true }] }), /differs from the invoice/);
    const explicit = await createDraftInvoice(organizationId, { clientId, items: [{ billingMode: "FLAT_FEE", description: "Explicit wins", serviceId: service.id, amount: "50000", useServiceDefaultPrice: true }] });
    const explicitItem = await prisma.invoiceItem.findFirstOrThrow({ where: { organizationId, invoiceId: explicit.id } });
    assert.equal(explicitItem.unitPrice.toString(), "50000");
  }));

  it("replaces flat-fee and quantity items while preserving their billing modes", async () => withFixture(async ({ organizationId, clientId }) => {
    const invoice = await createDraftInvoice(organizationId, { clientId, items: [line()] });
    await replaceDraftInvoiceItems(organizationId, invoice.id, [
      { billingMode: "FLAT_FEE", description: "Monthly support", amount: "1200" },
      { description: "Hourly consulting", quantity: "2", unitPrice: "300" },
    ]);
    const rows = await prisma.invoiceItem.findMany({ where: { organizationId, invoiceId: invoice.id }, orderBy: { position: "asc" } });
    assert.deepEqual(rows.map(({ billingMode, quantity, unitPrice, lineTotal }) => [billingMode, quantity.toString(), unitPrice.toString(), lineTotal.toString()]), [
      ["FLAT_FEE", "1", "1200", "1200"], ["QUANTITY", "2", "300", "600"],
    ]);
  }));

  it("issues canonical flat fees", async () => withFixture(async ({ organizationId, clientId }) => {
    const invoice = await createDraftInvoice(organizationId, { clientId, items: [{ billingMode: "FLAT_FEE", description: "Monthly support", amount: "1200" }] });
    const issued = await issueInvoice(organizationId, invoice.id);
    const issuedItem = await prisma.invoiceItem.findFirstOrThrow({ where: { organizationId, invoiceId: invoice.id } });
    assert.equal(issued.lifecycleStatus, "ISSUED");
    assert.equal(issued.subtotal.toString(), "1200");
    assert.equal(issuedItem.lineTotal.toString(), "1200");
  }));

  it("rejects corrupted flat financial state before reserving a number", async () => withFixture(async ({ organizationId, clientId }) => {
    const corrupted = await createDraftInvoice(organizationId, { clientId, items: [{ billingMode: "FLAT_FEE", description: "Corrupt me", amount: "800" }] });
    await prisma.invoiceItem.updateMany({ where: { organizationId, invoiceId: corrupted.id }, data: { lineTotal: new Prisma.Decimal("801") } });
    await assert.rejects(issueInvoice(organizationId, corrupted.id), /Flat-fee item total must equal its stored amount/);
    const wrongQuantity = await createDraftInvoice(organizationId, { clientId, items: [{ billingMode: "FLAT_FEE", description: "Wrong quantity", amount: "900" }] });
    await prisma.invoiceItem.updateMany({ where: { organizationId, invoiceId: wrongQuantity.id }, data: { quantity: new Prisma.Decimal("2") } });
    await assert.rejects(issueInvoice(organizationId, wrongQuantity.id), /canonical quantity of 1/);
    await assertNoSequence(organizationId);
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

  it("updates the full draft header and replaces quantity, flat-fee, free-text, and service-backed items atomically", async () => withFixture(async ({ organizationId, clientId }) => {
    const invoice = await createDraftInvoice(organizationId, { clientId, items: [line("1", "10")] });
    const replacementClient = await prisma.client.create({ data: { organizationId, name: "Replacement client" } });
    const service = await prisma.service.create({
      data: { organizationId, name: "Managed service", currencyCode: "CAD", defaultUnitPrice: new Prisma.Decimal("22") },
    });
    const matchingService = await prisma.service.create({
      data: { organizationId, name: "USD service", currencyCode: "USD", defaultUnitPrice: new Prisma.Decimal("22") },
    });
    const updated = await updateFullDraftInvoice(organizationId, invoice.id, fullDraftInput(replacementClient.id, {
      projectTitle: "October campaign",
      invoiceDate: new Date("2026-10-01T00:00:00.000Z"),
      dueDate: new Date("2026-10-15T00:00:00.000Z"),
      currencyCode: "usd",
      discountLabel: "Launch credit",
      discountAmount: "1",
      notes: "Updated note",
      paymentTerms: "Due in 14 days",
      items: [
        { billingMode: "QUANTITY", serviceId: service.id, description: "Explicit service price", quantity: "1.3333", unitPrice: "10.5555", useServiceDefaultPrice: true },
        { billingMode: "QUANTITY", serviceId: matchingService.id, description: "Requested service default", quantity: "2", useServiceDefaultPrice: true },
        { billingMode: "FLAT_FEE", serviceId: null, description: "Free-text flat fee", amount: "55000" },
      ],
    }));
    const items = await prisma.invoiceItem.findMany({ where: { organizationId, invoiceId: invoice.id }, orderBy: { position: "asc" } });
    assert.equal(updated.clientId, replacementClient.id);
    assert.equal(updated.projectTitle, "October campaign");
    assert.equal(updated.invoiceDate?.toISOString(), "2026-10-01T00:00:00.000Z");
    assert.equal(updated.dueDate?.toISOString(), "2026-10-15T00:00:00.000Z");
    assert.equal(updated.currencyCode, "USD");
    assert.equal(updated.discountLabel, "Launch credit");
    assert.equal(updated.discountAmount.toString(), "1");
    assert.equal(updated.notes, "Updated note");
    assert.equal(updated.paymentTerms, "Due in 14 days");
    assert.deepEqual(items.map((item) => item.billingMode), ["QUANTITY", "QUANTITY", "FLAT_FEE"]);
    assert.deepEqual(items.map((item) => item.serviceId), [service.id, matchingService.id, null]);
    assert.equal(items[0]!.unitPrice.toString(), "10.5555", "explicit price wins even when the service default currency differs");
    assert.equal(items[0]!.lineTotal.toString(), "14.0736");
    assert.equal(items[1]!.unitPrice.toString(), "22");
    assert.equal(items[1]!.lineTotal.toString(), "44");
    assert.equal(items[2]!.quantity.toString(), "1");
    assert.equal(items[2]!.unitPrice.toString(), "55000");
    assert.equal(items[2]!.lineTotal.toString(), "55000");
    assert.equal(updated.subtotal.toString(), "55058.0736");
    assert.equal(updated.grandTotal.toString(), "55057.0736");
    await assertNoSequence(organizationId);
  }));

  it("uses matching service defaults and rejects a mismatched default without changing the draft", async () => withFixture(async ({ organizationId, clientId }) => {
    const invoice = await createDraftInvoice(organizationId, { clientId, projectTitle: "Before", items: [line("2", "3")] });
    const service = await prisma.service.create({
      data: { organizationId, name: "USD service", currencyCode: "USD", defaultUnitPrice: new Prisma.Decimal("25") },
    });
    const updated = await updateFullDraftInvoice(organizationId, invoice.id, fullDraftInput(clientId, {
      currencyCode: "usd",
      items: [{ serviceId: service.id, description: "Defaulted", quantity: "2", useServiceDefaultPrice: true }],
    }));
    assert.equal(updated.currencyCode, "USD");
    assert.equal(updated.subtotal.toString(), "50");
    const beforeMismatch = await readDraftSnapshot(organizationId, invoice.id);
    await assert.rejects(updateFullDraftInvoice(organizationId, invoice.id, fullDraftInput(clientId, {
      projectTitle: "Must roll back",
      currencyCode: "CAD",
      items: [{ serviceId: service.id, description: "Wrong currency default", quantity: "1", useServiceDefaultPrice: true }],
    })), DraftInvoiceError);
    assert.deepEqual(await readDraftSnapshot(organizationId, invoice.id), beforeMismatch);
    await assertNoSequence(organizationId);
  }));

  it("rolls back all header, item, and total changes for invalid items and discounts", async () => withFixture(async ({ organizationId, clientId }) => {
    const invoice = await createDraftInvoice(organizationId, {
      clientId, projectTitle: "Original", currencyCode: "LKR", discountLabel: "Original discount", discountAmount: "1",
      notes: "Original note", paymentTerms: "Original terms", items: [line("2", "10")],
    });
    const before = await readDraftSnapshot(organizationId, invoice.id);
    const changedHeader = { projectTitle: "Changed", currencyCode: "USD", notes: "Changed note" };
    await assert.rejects(updateFullDraftInvoice(organizationId, invoice.id, fullDraftInput(clientId, {
      ...changedHeader,
      items: [line("3", "100"), line("-1", "2")],
    })), DraftInvoiceError);
    assert.deepEqual(await readDraftSnapshot(organizationId, invoice.id), before);
    await assert.rejects(updateFullDraftInvoice(organizationId, invoice.id, fullDraftInput(clientId, {
      ...changedHeader,
      discountAmount: "999",
      items: [line("3", "100")],
    })), DraftInvoiceError);
    assert.deepEqual(await readDraftSnapshot(organizationId, invoice.id), before);
    await assertNoSequence(organizationId);
  }));

  it("rejects cross-tenant and inactive clients or services atomically", async () => withFixture(async ({ organizationId, clientId, otherOrganizationId, otherClientId }) => {
    const invoice = await createDraftInvoice(organizationId, { clientId, projectTitle: "Original", items: [line()] });
    const service = await prisma.service.create({ data: { organizationId, name: "Local service", defaultUnitPrice: new Prisma.Decimal("5") } });
    const foreignService = await prisma.service.create({ data: { organizationId: otherOrganizationId, name: "Foreign service", defaultUnitPrice: new Prisma.Decimal("5") } });
    const before = await readDraftSnapshot(organizationId, invoice.id);
    const replacementItems: DraftInvoiceItemInput[] = [{ serviceId: service.id, description: "New service item", quantity: "1", unitPrice: "5" }];
    const invalidInputs = [
      fullDraftInput(otherClientId, { projectTitle: "Changed", items: replacementItems }),
      fullDraftInput(clientId, { projectTitle: "Changed", items: [{ serviceId: foreignService.id, description: "Foreign", quantity: "1", unitPrice: "5" }] }),
    ];
    for (const invalid of invalidInputs) {
      await assert.rejects(updateFullDraftInvoice(organizationId, invoice.id, invalid), DraftInvoiceError);
      assert.deepEqual(await readDraftSnapshot(organizationId, invoice.id), before);
    }
    await prisma.client.update({ where: { id: clientId }, data: { active: false } });
    await assert.rejects(updateFullDraftInvoice(organizationId, invoice.id, fullDraftInput(clientId, { projectTitle: "Inactive" })), DraftInvoiceError);
    await prisma.client.update({ where: { id: clientId }, data: { active: true } });
    await prisma.service.update({ where: { id: service.id }, data: { active: false } });
    await assert.rejects(updateFullDraftInvoice(organizationId, invoice.id, fullDraftInput(clientId, {
      projectTitle: "Inactive service", items: replacementItems,
    })), DraftInvoiceError);
    assert.deepEqual(await readDraftSnapshot(organizationId, invoice.id), before);
    await assert.rejects(updateFullDraftInvoice(otherOrganizationId, invoice.id, fullDraftInput(clientId)), DraftInvoiceError);
    assert.deepEqual(await readDraftSnapshot(organizationId, invoice.id), before);
    await assertNoSequence(organizationId);
  }));

  it("serializes a full draft update against issuance", async () => withFixture(async ({ organizationId, clientId }) => {
    const invoice = await createDraftInvoice(organizationId, { clientId, projectTitle: "Before", items: [line("1", "10")] });
    const [editResult, issueResult] = await Promise.allSettled([
      updateFullDraftInvoice(organizationId, invoice.id, fullDraftInput(clientId, {
        projectTitle: "After",
        items: [line("2", "15", { description: "Updated line" })],
      })),
      issueInvoice(organizationId, invoice.id),
    ]);
    assert.equal(issueResult.status, "fulfilled");
    const issued = await prisma.invoice.findFirstOrThrow({ where: { organizationId, id: invoice.id } });
    const items = await prisma.invoiceItem.findMany({ where: { organizationId, invoiceId: invoice.id } });
    assert.equal(issued.lifecycleStatus, "ISSUED");
    assert.ok(issued.invoiceNumber);
    assert.equal(items.length, 1);
    if (editResult.status === "fulfilled") {
      assert.equal(issued.projectTitle, "After");
      assert.equal(items[0]!.description, "Updated line");
      assert.equal(issued.subtotal.toString(), "30");
      assert.equal(items[0]!.lineTotal.toString(), "30");
    } else {
      assert.ok(editResult.reason instanceof DraftInvoiceError);
      assert.equal(issued.projectTitle, "Before");
      assert.equal(items[0]!.description, "Service line");
      assert.equal(issued.subtotal.toString(), "10");
      assert.equal(items[0]!.lineTotal.toString(), "10");
    }
  }));

  it("rejects cross-organization and issued invoice edits", async () => withFixture(async ({ organizationId, clientId, otherOrganizationId, otherClientId }) => {
    const invoice = await createDraftInvoice(organizationId, { clientId, items: [line()] });
    await assert.rejects(updateDraftInvoice(otherOrganizationId, invoice.id, { notes: "wrong tenant" }), DraftInvoiceError);
    await assert.rejects(updateDraftInvoice(organizationId, invoice.id, { clientId: otherClientId }), DraftInvoiceError);
    await issueInvoice(organizationId, invoice.id);
    await assert.rejects(updateDraftInvoice(organizationId, invoice.id, { notes: "after issue" }), DraftInvoiceError);
    await assert.rejects(replaceDraftInvoiceItems(organizationId, invoice.id, [line()]), DraftInvoiceError);
    await assert.rejects(updateFullDraftInvoice(organizationId, invoice.id, fullDraftInput(clientId, { notes: "after issue" })), DraftInvoiceError);
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

  it("keeps issued client and service snapshots unchanged after master-data edits", async () => withFixture(async ({ organizationId, clientId }) => {
    const service = await prisma.service.create({ data: { organizationId, name: "Website Development", defaultUnitPrice: new Prisma.Decimal("50000"), currencyCode: "LKR" } });
    const invoice = await createDraftInvoice(organizationId, { clientId, items: [{ description: "Website Development", quantity: "1", serviceId: service.id, useServiceDefaultPrice: true }] });
    const issued = await issueInvoice(organizationId, invoice.id);
    const before = await prisma.invoice.findFirstOrThrow({ where: { organizationId, id: invoice.id } });
    const historicalItem = await prisma.invoiceItem.findFirstOrThrow({ where: { organizationId, invoiceId: invoice.id } });

    await updateClient(organizationId, clientId, { name: "Draft client Updated", email: "updated@example.test", active: true });
    await updateService(organizationId, service.id, { name: "Website Development", description: null, defaultUnitPrice: "50000", currencyCode: "LKR", active: false });

    const storedInvoice = await prisma.invoice.findFirstOrThrow({ where: { organizationId, id: invoice.id } });
    const storedItem = await prisma.invoiceItem.findFirstOrThrow({ where: { organizationId, invoiceId: invoice.id } });
    assert.equal(storedInvoice.clientNameSnapshot, "Draft client");
    assert.equal(issued.clientNameSnapshot, "Draft client");
    assert.equal(storedInvoice.lifecycleStatus, before.lifecycleStatus);
    assert.equal(storedInvoice.invoiceNumber, before.invoiceNumber);
    assert.equal(storedInvoice.issuedAt?.toISOString(), before.issuedAt?.toISOString());
    assert.equal(storedInvoice.paymentStatus, before.paymentStatus);
    assert.equal(storedInvoice.subtotal.toString(), before.subtotal.toString());
    assert.equal(storedInvoice.grandTotal.toString(), before.grandTotal.toString());
    assert.equal(storedItem.description, historicalItem.description);
    assert.equal(storedItem.quantity.toString(), historicalItem.quantity.toString());
    assert.equal(storedItem.unitPrice.toString(), "50000");
    assert.equal(storedItem.lineTotal.toString(), "50000");

    await updateService(organizationId, service.id, { name: "Website Development Updated", description: null, defaultUnitPrice: "60000", currencyCode: "LKR", active: true });
    const futureDraft = await createDraftInvoice(organizationId, { clientId, items: [{ description: "Website Development Updated", quantity: "1", serviceId: service.id, useServiceDefaultPrice: true }] });
    const futureItem = await prisma.invoiceItem.findFirstOrThrow({ where: { organizationId, invoiceId: futureDraft.id } });
    assert.equal(futureItem.unitPrice.toString(), "60000");
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

async function readDraftSnapshot(organizationId: string, invoiceId: string) {
  const invoice = await prisma.invoice.findFirstOrThrow({ where: { organizationId, id: invoiceId } });
  const items = await prisma.invoiceItem.findMany({
    where: { organizationId, invoiceId },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  });
  return {
    clientId: invoice.clientId,
    projectTitle: invoice.projectTitle,
    invoiceDate: invoice.invoiceDate?.toISOString() ?? null,
    dueDate: invoice.dueDate?.toISOString() ?? null,
    currencyCode: invoice.currencyCode,
    discountLabel: invoice.discountLabel,
    discountAmount: invoice.discountAmount.toString(),
    subtotal: invoice.subtotal.toString(),
    grandTotal: invoice.grandTotal.toString(),
    notes: invoice.notes,
    paymentTerms: invoice.paymentTerms,
    items: items.map((item) => ({
      id: item.id,
      billingMode: item.billingMode,
      serviceId: item.serviceId,
      description: item.description,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
      lineTotal: item.lineTotal.toString(),
      position: item.position,
    })),
  };
}
