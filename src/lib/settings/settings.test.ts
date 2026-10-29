import "dotenv/config";

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { Prisma } from "@/generated/prisma/client";
import { hasPermission } from "@/lib/auth/authorization";
import { renderInvoiceHtml } from "@/lib/invoice-templates/registry";
import { getPrismaClient } from "@/lib/prisma";
import { loadSettingsWorkspace } from "./workspace";
import { parseInvoiceDisplaySettings, parseOrganizationSettings, SettingsValidationError, updateInvoiceDisplaySettings, updateOrganizationSettings } from "./mutations";
import { issueInvoice } from "@/lib/invoices/issue-invoice";
import { loadIssuedInvoiceDocument } from "@/lib/invoices/issued-invoice-document";
import { saveOrganizationSettingsAction } from "@/app/app/[organizationSlug]/settings/actions";
import { OrganizationRole } from "@/generated/prisma/enums";
import { randomUUID } from "node:crypto";

const prisma = getPrismaClient();
after(async () => { await prisma.$disconnect(); });

describe("settings validation and prospective template versions", () => {
  it("parses only supported values and preserves account numbers as strings", () => {
    assert.deepEqual(parseOrganizationSettings({ name: "  Hiiiive Billing  ", slug: "attacker-slug", organizationId: "other" }), { name: "Hiiiive Billing" });
    assert.deepEqual(parseInvoiceDisplaySettings({
      companyName: " Company ", bankName: " Bank ", accountName: " Account ", accountNumber: " 00123456789 ", primaryColor: "#255B83",
      organizationId: "other", rendererKey: "attacker", templateId: "other", version: 500,
    }), { companyName: "Company", bankName: "Bank", accountName: "Account", accountNumber: "00123456789", primaryColor: "#255B83" });
    assert.deepEqual(parseInvoiceDisplaySettings({ companyName: "C", bankName: " ", accountName: "", accountNumber: "", primaryColor: "#abcdef" }).bankName, "");
    assert.throws(() => parseInvoiceDisplaySettings({ companyName: "x", bankName: "x".repeat(121), accountName: "", accountNumber: "", primaryColor: "#ffffff" }), SettingsValidationError);
    assert.throws(() => parseInvoiceDisplaySettings({ companyName: "x", bankName: "", accountName: "", accountNumber: "", primaryColor: "red" }), SettingsValidationError);
    assert.throws(() => parseOrganizationSettings({ name: " " }), SettingsValidationError);
  });

  it("keeps settings permission centralized and limits it to the existing role grant", () => {
    assert.equal(hasPermission("ADMIN", "ORGANIZATION_SETTINGS"), true);
    assert.equal(hasPermission("BILLING", "ORGANIZATION_SETTINGS"), false);
    assert.equal(hasPermission("VIEWER", "ORGANIZATION_SETTINGS"), false);
  });

  it("versions payment settings prospectively and leaves issued documents and financial rows frozen", async () => {
    const organization = await ensureOrganization();
    await ensureDefaultTemplate(organization.id);
    await cleanup(organization.id);
    const email = `settings-${randomUUID()}@example.test`;
    const user = await prisma.user.create({ data: { email } });
    const previousDevEmail = process.env.DEV_AUTH_EMAIL;
    let foreignOrganizationId: string | undefined;
    try {
      await prisma.organizationMembership.create({ data: { organizationId: organization.id, userId: user.id, role: OrganizationRole.VIEWER } });
      process.env.DEV_AUTH_EMAIL = email;
      const denied = await saveOrganizationSettingsAction(organization.slug, {}, formData({ name: "Viewer forged name" }));
      assert.match(denied.error ?? "", /permission/i);
      assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: organization.id }, select: { name: true } })).name, "Settings Integration");
      const foreignSlug = await prisma.organization.create({ data: { name: "Foreign Settings", slug: `settings-foreign-${randomUUID()}` } });
      foreignOrganizationId = foreignSlug.id;
      const foreignResult = await saveOrganizationSettingsAction(foreignSlug.slug, {}, formData({ name: "Foreign update" }));
      assert.match(foreignResult.error ?? "", /permission/i);
      await prisma.organizationMembership.updateMany({ where: { organizationId: organization.id, userId: user.id }, data: { role: OrganizationRole.ADMIN } });
      const accepted = await saveOrganizationSettingsAction(organization.slug, {}, formData({ name: "Admin saved name", slug: "forged" }));
      assert.equal(accepted.success, "Organization settings saved.");
      const savedOrganization = await prisma.organization.findUniqueOrThrow({ where: { id: organization.id }, select: { name: true, slug: true } });
      assert.equal(savedOrganization.name, "Admin saved name");
      assert.equal(savedOrganization.slug, "settings-integration");
      await updateOrganizationSettings(organization.id, { name: "Settings Test Organization", slug: "forged" });
      const beforeSlug = (await prisma.organization.findUniqueOrThrow({ where: { id: organization.id }, select: { slug: true } })).slug;
      assert.equal(beforeSlug, "settings-integration");

      const client = await prisma.client.create({ data: { organizationId: organization.id, name: "Settings Snapshot Client" } });
      await updateInvoiceDisplaySettings(organization.id, { companyName: "Invoice A", bankName: "Bank A", accountName: "Account A", accountNumber: "00111", primaryColor: "#255B83" });
      const invoiceAId = await createDraft(organization.id, client.id);
      const issuedA = await issueInvoice(organization.id, invoiceAId);
      const before = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceAId }, include: { items: true } });
      const paymentsBefore = await prisma.payment.count({ where: { organizationId: organization.id, invoiceId: invoiceAId } });
      const attemptsBefore = await prisma.invoiceEmailAttempt.count({ where: { organizationId: organization.id, invoiceId: invoiceAId } });

      await updateInvoiceDisplaySettings(organization.id, { companyName: "Invoice B", bankName: "Bank B", accountName: "Account B", accountNumber: "00222", primaryColor: "#255B83" });
      const afterSettings = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceAId }, include: { items: true } });
      assert.deepEqual(invoiceFinancials(afterSettings), invoiceFinancials(before));
      assert.equal(await prisma.payment.count({ where: { organizationId: organization.id, invoiceId: invoiceAId } }), paymentsBefore);
      assert.equal(await prisma.invoiceEmailAttempt.count({ where: { organizationId: organization.id, invoiceId: invoiceAId } }), attemptsBefore);

      const invoiceBId = await createDraft(organization.id, client.id);
      const issuedB = await issueInvoice(organization.id, invoiceBId);
      const documentA = await loadIssuedInvoiceDocument(organization.id, invoiceAId);
      const documentB = await loadIssuedInvoiceDocument(organization.id, invoiceBId);
      const htmlA = renderInvoiceHtml(documentA.rendererKey, { config: documentA.config, invoice: documentA.invoice });
      const htmlB = renderInvoiceHtml(documentB.rendererKey, { config: documentB.config, invoice: documentB.invoice });
      assert.match(htmlA, /Bank: Bank A[\s\S]*Name: Account A[\s\S]*Account: 00111/);
      assert.match(htmlB, /Bank: Bank B[\s\S]*Name: Account B[\s\S]*Account: 00222/);
      assert.notEqual(issuedA.templateVersionId, issuedB.templateVersionId);
      const reloaded = await loadSettingsWorkspace(organization.id);
      assert.equal(reloaded.template?.accountNumber, "00222");
    } finally {
      if (previousDevEmail === undefined) delete process.env.DEV_AUTH_EMAIL;
      else process.env.DEV_AUTH_EMAIL = previousDevEmail;
      await cleanup(organization.id);
      await prisma.organizationMembership.deleteMany({ where: { organizationId: organization.id, userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
      if (foreignOrganizationId) await prisma.organization.delete({ where: { id: foreignOrganizationId } });
    }
  });
});

function formData(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function invoiceFinancials(invoice: { invoiceNumber: string | null; invoiceDate: Date | null; subtotal: Prisma.Decimal; discountAmount: Prisma.Decimal; grandTotal: Prisma.Decimal; paymentStatus: string; lifecycleStatus: string; issuedAt: Date | null; items: Array<{ id: string; description: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal }> }) {
  return {
    invoiceNumber: invoice.invoiceNumber, invoiceDate: invoice.invoiceDate?.toISOString() ?? null, subtotal: invoice.subtotal.toString(),
    discountAmount: invoice.discountAmount.toString(), grandTotal: invoice.grandTotal.toString(), paymentStatus: invoice.paymentStatus,
    lifecycleStatus: invoice.lifecycleStatus, issuedAt: invoice.issuedAt?.toISOString() ?? null,
    items: invoice.items.map((item) => [item.id, item.description, item.quantity.toString(), item.unitPrice.toString(), item.lineTotal.toString()]),
  };
}

async function ensureOrganization() {
  return prisma.organization.upsert({ where: { slug: "settings-integration" }, create: { name: "Settings Integration", slug: "settings-integration" }, update: { name: "Settings Integration" } });
}
async function ensureDefaultTemplate(organizationId: string) {
  const template = await prisma.invoiceTemplate.upsert({
    where: { organizationId_key: { organizationId, key: "hiiiive-default" } },
    create: { organizationId, key: "hiiiive-default", name: "Hiiiive Default", active: true, isDefault: true },
    update: { active: true, isDefault: true },
  });
  const existing = await prisma.invoiceTemplateVersion.findFirst({ where: { organizationId, templateId: template.id }, orderBy: { version: "desc" } });
  if (!existing) await prisma.invoiceTemplateVersion.create({ data: { organizationId, templateId: template.id, version: 1, rendererKey: "hiiiive-default", config: { companyName: "Hiiiive", headingFontName: "DejaVu Serif", bodyFontName: "DM Sans", primaryColor: "#255B83" } } });
  await prisma.invoiceTemplate.updateMany({ where: { organizationId, id: { not: template.id } }, data: { isDefault: false } });
  return template;
}
async function createDraft(organizationId: string, clientId: string) {
  const invoice = await prisma.invoice.create({ data: { organizationId, clientId, invoiceDate: new Date("2026-01-01T00:00:00.000Z") } });
  await prisma.invoiceItem.create({ data: { organizationId, invoiceId: invoice.id, description: "Website Development", quantity: new Prisma.Decimal("1"), unitPrice: new Prisma.Decimal("10000"), lineTotal: new Prisma.Decimal("0"), position: 0 } });
  return invoice.id;
}
async function cleanup(organizationId: string) {
  await prisma.invoiceRelation.deleteMany({ where: { organizationId } });
  await prisma.payment.deleteMany({ where: { organizationId } });
  await prisma.invoiceEmailAttempt.deleteMany({ where: { organizationId } });
  await prisma.invoiceItem.deleteMany({ where: { organizationId } });
  await prisma.invoice.deleteMany({ where: { organizationId } });
  await prisma.invoiceSequence.deleteMany({ where: { organizationId } });
  await prisma.clientContact.deleteMany({ where: { organizationId } });
  await prisma.client.deleteMany({ where: { organizationId } });
}
