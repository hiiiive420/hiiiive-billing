import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { Prisma } from "@/generated/prisma/client";
import { generateIssuedInvoicePdf } from "./generate-issued-invoice-pdf";
import { loadIssuedInvoiceDocument } from "./issued-invoice-document";
import { getPrismaClient } from "../prisma";
import { issueInvoice } from "./issue-invoice";
import { renderInvoiceHtml } from "../invoice-templates/registry";

const prisma = getPrismaClient();
const validConfig = {
  companyName: "Hiiiive",
  headingFontName: "DejaVu Serif",
  bodyFontName: "DM Sans",
  primaryColor: "#255B83",
  footerNote: "Original frozen footer",
};

after(async () => {
  await prisma.$disconnect();
});

describe("issued invoice document service (PostgreSQL integration)", () => {
  it("loads an issued invoice with its trusted stored renderer data", async () => {
    await withIssuedFixture(async ({ organizationId, invoiceId, templateVersionId }) => {
      await issueInvoice(organizationId, invoiceId);
      const document = await loadIssuedInvoiceDocument(organizationId, invoiceId);
      const savedVersion = await prisma.invoiceTemplateVersion.findUniqueOrThrow({ where: { id: templateVersionId } });
      assert.equal(document.rendererKey, "hiiiive-default");
      assert.equal(document.invoice.invoiceNumber, "I202610091");
      assert.equal(document.invoice.currencyCode, "LKR");
      assert.deepEqual(document.config, savedVersion.config);
      assert.equal(document.invoice.grandTotal, "20");
      assert.equal(templateVersionId.length > 0, true);
    });
  });

  it("uses the exact frozen version when newer versions and defaults exist", async () => {
    await withIssuedFixture(async ({ organizationId, invoiceId, templateId, templateVersionId }) => {
      await issueInvoice(organizationId, invoiceId);
      const original = await prisma.invoiceTemplateVersion.findUniqueOrThrow({
        where: { id: templateVersionId },
      });
      const newerVersion = await ensureVersion(
        organizationId,
        templateId,
        original.version + 1,
        { ...validConfig, footerNote: `New version ${original.version + 1}` },
      );
      const otherTemplate = await ensureTemplate(organizationId, "later-default", "Later Default");
      await ensureVersion(organizationId, otherTemplate.id, 1, {
        ...validConfig,
        footerNote: "New default must not be used",
      });
      await setDefault(organizationId, otherTemplate.id);

      const document = await loadIssuedInvoiceDocument(organizationId, invoiceId);
      assert.deepEqual(document.config, original.config);
      assert.equal(document.invoice.invoiceNumber, "I202610091");
      assert.notEqual(newerVersion.id, templateVersionId);
    });
  });

  it("uses issued client snapshots after the current Client changes", async () => {
    await withIssuedFixture(async ({ organizationId, clientId, invoiceId }) => {
      await issueInvoice(organizationId, invoiceId);
      const beforeChange = await loadIssuedInvoiceDocument(organizationId, invoiceId);
      const originalHtml = renderInvoiceHtml(beforeChange.rendererKey, {
        config: beforeChange.config,
        invoice: beforeChange.invoice,
      });
      await prisma.client.update({
        where: { id: clientId },
        data: { name: "Renamed Client", billingAddress: "Changed Address" },
      });
      const document = await loadIssuedInvoiceDocument(organizationId, invoiceId);
      const html = renderInvoiceHtml(document.rendererKey, { config: document.config, invoice: document.invoice });
      assert.equal(document.invoice.clientName, "Snapshot Client");
      assert.equal(document.invoice.clientBillingAddress, "10 Test Road");
      assert.equal(html, originalHtml);
    });
  });

  it("orders items by position and then stable item id", async () => {
    await withIssuedFixture(async ({ organizationId, invoiceId }) => {
      await prisma.invoiceItem.deleteMany({ where: { organizationId, invoiceId } });
      await prisma.invoiceItem.createMany({
        data: [
          { id: "00000000-0000-4000-8000-000000000003", organizationId, invoiceId, description: "Later", quantity: "1", unitPrice: "3", lineTotal: "0", position: 2 },
          { id: "00000000-0000-4000-8000-000000000002", organizationId, invoiceId, description: "Second tie", quantity: "1", unitPrice: "2", lineTotal: "0", position: 0 },
          { id: "00000000-0000-4000-8000-000000000001", organizationId, invoiceId, description: "First tie", quantity: "1", unitPrice: "1", lineTotal: "0", position: 0 },
        ],
      });
      await issueInvoice(organizationId, invoiceId);
      const document = await loadIssuedInvoiceDocument(organizationId, invoiceId);
      assert.deepEqual(document.invoice.items.map(({ description }) => description), ["First tie", "Second tie", "Later"]);
    });
  });

  it("preserves exact Decimal values as strings without floating point conversion", async () => {
    await withIssuedFixture(async ({ organizationId, invoiceId }) => {
      await prisma.invoiceItem.updateMany({
        where: { organizationId, invoiceId },
        data: { quantity: new Prisma.Decimal("1.3333"), unitPrice: new Prisma.Decimal("10.5555") },
      });
      await issueInvoice(organizationId, invoiceId);
      const document = await loadIssuedInvoiceDocument(organizationId, invoiceId);
      assert.equal(document.invoice.items[0]?.quantity, "1.3333");
      assert.equal(document.invoice.items[0]?.unitPrice, "10.5555");
      assert.equal(document.invoice.items[0]?.lineTotal, "14.0736");
      assert.equal(document.invoice.subtotal, "14.0736");
      assert.equal(document.invoice.grandTotal, "14.0736");
    });
  });

  it("rejects a draft invoice", async () => {
    await withIssuedFixture(async ({ organizationId, invoiceId }) => {
      await assert.rejects(loadIssuedInvoiceDocument(organizationId, invoiceId), /Only issued or closed invoices/);
    });
  });

  it("allows rendering for issued and closed lifecycle states", async () => {
    await withIssuedFixture(async ({ organizationId, invoiceId }) => {
      await issueInvoice(organizationId, invoiceId);
      for (const lifecycleStatus of ["ISSUED", "SUPERSEDED", "VOID", "WRITTEN_OFF"] as const) {
        await prisma.invoice.update({ where: { id: invoiceId }, data: { lifecycleStatus } });
        const document = await loadIssuedInvoiceDocument(organizationId, invoiceId);
        assert.equal(document.invoice.invoiceNumber, "I202610091");
      }
    });
  });

  it("rejects cross-organization invoice access", async () => {
    await withIssuedFixture(async (first) => {
      await withIssuedFixture(async (second) => {
        await issueInvoice(second.organizationId, second.invoiceId);
        await assert.rejects(
          loadIssuedInvoiceDocument(first.organizationId, second.invoiceId),
          /not found in this organization/,
        );
      }, "secondary");
    });
  });

  it("fails clearly for an issued historical invoice without a frozen template", async () => {
    await withIssuedFixture(async ({ organizationId, clientId }) => {
      const invoiceId = await createLegacyIssuedInvoice(organizationId, clientId, null);
      await assert.rejects(
        loadIssuedInvoiceDocument(organizationId, invoiceId),
        /no frozen template version; explicit historical handling is required/,
      );
    });
  });

  it("rejects an unknown renderer stored on the frozen version", async () => {
    await withIssuedFixture(async ({ organizationId, clientId }) => {
      const template = await ensureTemplate(organizationId, "unknown-renderer", "Unknown Renderer");
      const version = await ensureVersion(organizationId, template.id, 1, validConfig, "user-code-renderer");
      const invoiceId = await createLegacyIssuedInvoice(organizationId, clientId, version.id);
      await assert.rejects(loadIssuedInvoiceDocument(organizationId, invoiceId), /renderer or configuration is invalid/);
    });
  });

  it("rejects malformed configuration stored on the frozen version", async () => {
    await withIssuedFixture(async ({ organizationId, clientId }) => {
      const template = await ensureTemplate(organizationId, "malformed-config", "Malformed Config");
      const version = await ensureVersion(organizationId, template.id, 1, { companyName: "<script>" });
      const invoiceId = await createLegacyIssuedInvoice(organizationId, clientId, version.id);
      await assert.rejects(loadIssuedInvoiceDocument(organizationId, invoiceId), /renderer or configuration is invalid/);
    });
  });

  it("generates a one-page PDF with the persisted invoice number and does not mutate stored data", async () => {
    await withIssuedFixture(async ({ organizationId, invoiceId }) => {
      await issueInvoice(organizationId, invoiceId);
      const invoiceBefore = await prisma.invoice.findFirstOrThrow({ where: { organizationId, id: invoiceId } });
      const itemsBefore = await prisma.invoiceItem.findMany({ where: { organizationId, invoiceId }, orderBy: { id: "asc" } });
      const sequenceBefore = await prisma.invoiceSequence.findUniqueOrThrow({
        where: { organizationId_key: { organizationId, key: "DEFAULT" } },
      });

      const result = await generateIssuedInvoicePdf(organizationId, invoiceId);
      const pdfText = Buffer.from(result.bytes).toString("latin1");

      assert.equal(result.filename, `Invoice-${invoiceBefore.invoiceNumber}.pdf`);
      assert.equal(Buffer.from(result.bytes.subarray(0, 5)).toString("ascii"), "%PDF-");
      assert.equal((pdfText.match(/\/Type\s*\/Page\b/g) ?? []).length, 1);
      const invoiceAfter = await prisma.invoice.findFirstOrThrow({ where: { organizationId, id: invoiceId } });
      const itemsAfter = await prisma.invoiceItem.findMany({ where: { organizationId, invoiceId }, orderBy: { id: "asc" } });
      const sequenceAfter = await prisma.invoiceSequence.findUniqueOrThrow({
        where: { organizationId_key: { organizationId, key: "DEFAULT" } },
      });
      assert.deepEqual(invoiceAfter, invoiceBefore);
      assert.deepEqual(itemsAfter, itemsBefore);
      assert.equal(sequenceAfter.nextValue, sequenceBefore.nextValue);
    });
  });
});

type Fixture = {
  organizationId: string;
  clientId: string;
  invoiceId: string;
  templateId: string;
  templateVersionId: string;
};

async function withIssuedFixture(run: (fixture: Fixture) => Promise<void>, tenant = "primary"): Promise<void> {
  const organizationId = await ensureOrganization(tenant);
  const template = await ensureTemplate(organizationId, "hiiiive-document-default", "Hiiiive Document Default");
  await ensureVersion(organizationId, template.id, 1, validConfig);
  const defaultVersion = await prisma.invoiceTemplateVersion.findFirstOrThrow({
    where: { organizationId, templateId: template.id },
    orderBy: { version: "desc" },
  });
  await cleanup(organizationId);
  await setDefault(organizationId, template.id);
  try {
    const client = await prisma.client.create({
      data: {
        organizationId,
        name: "Snapshot Client",
        billingAddress: "10 Test Road",
        email: "original@example.test",
      },
    });
    const invoiceId = await createDraftInvoice(organizationId, client.id);
    await run({ organizationId, clientId: client.id, invoiceId, templateId: template.id, templateVersionId: defaultVersion.id });
  } finally {
    await cleanup(organizationId);
    await setDefault(organizationId, template.id);
  }
}

async function ensureOrganization(tenant: string): Promise<string> {
  const slug = `issued-document-integration-${tenant}`;
  const existing = await prisma.organization.findUnique({ where: { slug } });
  if (existing) return existing.id;
  const organization = await prisma.organization.create({ data: { name: "Issued Document Integration", slug } });
  return organization.id;
}

async function ensureTemplate(organizationId: string, key: string, name: string) {
  return prisma.invoiceTemplate.upsert({
    where: { organizationId_key: { organizationId, key } },
    create: { organizationId, key, name, active: true },
    update: { active: true },
  });
}

async function ensureVersion(
  organizationId: string,
  templateId: string,
  version: number,
  config: unknown,
  rendererKey = "hiiiive-default",
) {
  const existing = await prisma.invoiceTemplateVersion.findUnique({
    where: { organizationId_templateId_version: { organizationId, templateId, version } },
  });
  if (existing) return existing;
  return prisma.invoiceTemplateVersion.create({
    data: { organizationId, templateId, version, config: config as Prisma.InputJsonValue, rendererKey },
  });
}

async function setDefault(organizationId: string, templateId: string): Promise<void> {
  await prisma.invoiceTemplate.updateMany({ where: { organizationId }, data: { isDefault: false } });
  await prisma.invoiceTemplate.update({ where: { id: templateId }, data: { active: true, isDefault: true } });
}

async function createDraftInvoice(organizationId: string, clientId: string): Promise<string> {
  const invoice = await prisma.invoice.create({
    data: {
      organizationId,
      clientId,
      invoiceDate: new Date("2026-10-09T00:00:00.000Z"),
      discountLabel: "Test discount",
      notes: "Persisted notes",
    },
  });
  await prisma.invoiceItem.create({
    data: {
      organizationId,
      invoiceId: invoice.id,
      description: "Service line",
      quantity: new Prisma.Decimal("2"),
      unitPrice: new Prisma.Decimal("10"),
      lineTotal: new Prisma.Decimal("0"),
      position: 0,
    },
  });
  return invoice.id;
}

async function createLegacyIssuedInvoice(
  organizationId: string,
  clientId: string,
  templateVersionId: string | null,
): Promise<string> {
  const invoice = await prisma.invoice.create({
    data: {
      organizationId,
      clientId,
      lifecycleStatus: "ISSUED",
      templateVersionId,
      invoiceNumber: `I20261022${randomUUID().replaceAll("-", "").slice(0, 8)}`,
      invoiceDate: new Date("2026-10-22T00:00:00.000Z"),
      clientNameSnapshot: "Legacy Snapshot",
      subtotal: new Prisma.Decimal("0"),
      discountAmount: new Prisma.Decimal("0"),
      grandTotal: new Prisma.Decimal("0"),
    },
  });
  return invoice.id;
}

async function cleanup(organizationId: string): Promise<void> {
  await prisma.invoiceRelation.deleteMany({ where: { organizationId } });
  await prisma.payment.deleteMany({ where: { organizationId } });
  await prisma.invoiceItem.deleteMany({ where: { organizationId } });
  await prisma.invoice.deleteMany({ where: { organizationId } });
  await prisma.invoiceSequence.deleteMany({ where: { organizationId } });
  await prisma.client.deleteMany({ where: { organizationId } });
}
