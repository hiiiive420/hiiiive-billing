import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { OrganizationRole } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { hasPermission } from "../auth/authorization";
import { getPrismaClient } from "../prisma";
import { issueInvoice } from "./issue-invoice";
import { INVOICE_WORKSPACE_PAGE_SIZE, loadInvoiceWorkspace, parseInvoiceWorkspaceFilters } from "./invoice-workspace";

const prisma = getPrismaClient();
const templateConfig = { companyName: "Hiiiive", headingFontName: "DejaVu Serif", bodyFontName: "DM Sans", primaryColor: "#255B83" };
after(async () => { await prisma.$disconnect(); });

describe("invoice workspace query parsing", () => {
  it("allowlists filters, trims and bounds search, and safely defaults invalid values", () => {
    assert.deepEqual(parseInvoiceWorkspaceFilters({
      q: "  client search  ", lifecycle: "ISSUED", payment: "PARTIALLY_PAID", sort: "date_asc", page: "3",
    }), { query: "client search", lifecycle: "ISSUED", payment: "PARTIALLY_PAID", sort: "date_asc", page: 3 });
    assert.deepEqual(parseInvoiceWorkspaceFilters({
      q: "x".repeat(140), lifecycle: "DROP TABLE", payment: "bogus", sort: "grandTotal", page: "-5",
    }), { query: "x".repeat(100), lifecycle: "ALL", payment: "ALL", sort: "updated_desc", page: 1 });
    assert.equal(parseInvoiceWorkspaceFilters({ page: "999999999999999999999" }).page, 1_000_000);
    assert.equal(parseInvoiceWorkspaceFilters({ q: [" first ", "second"] }).query, "first");
  });
});

describe("invoice workspace read model (PostgreSQL integration)", () => {
  it("returns the explicit empty-organization read model", async () => {
    const organization = await prisma.organization.create({ data: { name: "Empty workspace", slug: `empty-workspace-${randomUUID()}` } });
    const empty = await loadInvoiceWorkspace(organization.id);
    assert.equal(empty.organizationInvoiceCount, 0);
    assert.equal(empty.totalRows, 0);
    assert.equal(empty.rows.length, 0);
    assert.deepEqual(empty.summary, { drafts: 0, outstanding: 0, partiallyPaid: 0, paid: 0 });
    await prisma.organization.delete({ where: { id: organization.id } });
  });

  it("scopes rows and counts, preserves historical clients, searches/filters/sorts/pages, and returns latest safe email status", async () => {
    const token = randomUUID();
    const organization = await prisma.organization.create({ data: { name: `Workspace ${token}`, slug: `invoice-workspace-${token}` } });
    const foreignOrganization = await prisma.organization.create({ data: { name: `Foreign ${token}`, slug: `foreign-workspace-${token}` } });
    const client = await prisma.client.create({ data: { organizationId: organization.id, name: "Original Client" } });
    const foreignClient = await prisma.client.create({ data: { organizationId: foreignOrganization.id, name: "Foreign Needle" } });
    const draftClient = await prisma.client.create({ data: { organizationId: organization.id, name: "Draft Current Client" } });
    await prisma.invoiceTemplate.create({ data: {
      organizationId: organization.id, key: "workspace-default", name: "Workspace", active: true, isDefault: true,
      versions: { create: { version: 1, rendererKey: "hiiiive-default", config: templateConfig } },
    } });
    const user = await prisma.user.create({ data: { email: `workspace-${token}@example.test` } });
    await prisma.organizationMembership.create({ data: { organizationId: organization.id, userId: user.id, role: OrganizationRole.ADMIN } });

    const draft = await createDraft(organization.id, draftClient.id, { projectTitle: "Alpha Project", invoiceDate: "2026-01-31" });
    const undatedDraft = await createDraft(organization.id, draftClient.id, { projectTitle: null, invoiceDate: null });
    const foreignDraft = await createDraft(foreignOrganization.id, foreignClient.id, { projectTitle: "Foreign Secret" });

    const issued = await createIssued(organization.id, client.id, { projectTitle: "Issued Alpha", invoiceDate: "2026-02-01" });
    await prisma.client.update({ where: { id: client.id }, data: { name: "Renamed Client" } });
    const paid = await createIssued(organization.id, client.id, { projectTitle: "Paid Alpha", invoiceDate: "2026-02-03" });
    const partial = await createIssued(organization.id, client.id, { projectTitle: "Partial Alpha", invoiceDate: "2026-02-02" });
    const superseded = await createIssued(organization.id, client.id, { projectTitle: "Superseded Alpha" });
    const voided = await createIssued(organization.id, client.id, { projectTitle: "Void Alpha" });
    const writtenOff = await createIssued(organization.id, client.id, { projectTitle: "Written off Alpha" });
    await prisma.invoice.update({ where: { id: paid.id }, data: { paymentStatus: "PAID" } });
    await prisma.invoice.update({ where: { id: partial.id }, data: { paymentStatus: "PARTIALLY_PAID" } });
    await prisma.invoice.update({ where: { id: superseded.id }, data: { lifecycleStatus: "SUPERSEDED" } });
    await prisma.invoice.update({ where: { id: voided.id }, data: { lifecycleStatus: "VOID" } });
    await prisma.invoice.update({ where: { id: writtenOff.id }, data: { lifecycleStatus: "WRITTEN_OFF" } });

    const emailPending = await createIssued(organization.id, client.id, { projectTitle: "Email Pending" });
    const emailSent = await createIssued(organization.id, client.id, { projectTitle: "Email Sent" });
    const emailPartial = await createIssued(organization.id, client.id, { projectTitle: "Email Partial" });
    const emailFailed = await createIssued(organization.id, client.id, { projectTitle: "Email Failed" });
    const emailLatest = await createIssued(organization.id, client.id, { projectTitle: "Email Latest" });
    const created = new Date("2026-10-01T12:00:00.000Z");
    const memberId = await prisma.organizationMembership.findFirstOrThrow({ where: { organizationId: organization.id, userId: user.id } });
    await createEmailAttempt(organization.id, emailPending.id, user.id, "PENDING", created);
    await createEmailAttempt(organization.id, emailSent.id, user.id, "SENT", created);
    await createEmailAttempt(organization.id, emailPartial.id, user.id, "PARTIALLY_SENT", created);
    await createEmailAttempt(organization.id, emailFailed.id, user.id, "FAILED", created);
    await createEmailAttempt(organization.id, emailLatest.id, user.id, "SENT", created);
    await createEmailAttempt(organization.id, emailLatest.id, user.id, "FAILED", new Date("2026-10-02T12:00:00.000Z"));

    const all = await loadInvoiceWorkspace(organization.id);
      assert.equal(all.filters.sort, "updated_desc");
      assert.equal(all.rows.every((row, index) => index === 0 || all.rows[index - 1]!.updatedAt >= row.updatedAt), true);
      assert.equal(all.organizationInvoiceCount, 13);
      assert.equal(all.rows.length, 13);
      assert.equal(all.rows.some((row) => row.id === foreignDraft.id), false);
      assert.deepEqual(all.summary, { drafts: 2, outstanding: 6, partiallyPaid: 1, paid: 1 });
      const draftRow = all.rows.find((row) => row.id === draft.id)!;
      const issuedRow = all.rows.find((row) => row.id === issued.id)!;
      assert.equal(draftRow.displayNumber, "Draft");
      assert.equal(draftRow.clientName, "Draft Current Client");
      assert.equal(draftRow.paymentStatus, "UNPAID");
      assert.equal(draftRow.latestEmailStatus, null);
      assert.equal(issuedRow.clientName, "Original Client");
      assert.equal(issuedRow.displayNumber, issued.invoiceNumber);
      assert.equal(issuedRow.latestEmailStatus, null);
      assert.equal(all.rows.find((row) => row.id === undatedDraft.id)?.invoiceDate, null);
      assert.equal("bccRecipients" in draftRow, false);

      const foreignSearch = await loadInvoiceWorkspace(organization.id, { q: "Foreign Needle" });
      assert.equal(foreignSearch.totalRows, 0);
      assert.equal(foreignSearch.organizationInvoiceCount, 13);
      assert.equal((await loadInvoiceWorkspace(organization.id, { q: "  ORIGINAL CLIENT  " })).totalRows, 1);
      assert.equal((await loadInvoiceWorkspace(organization.id, { q: "draft current client" })).totalRows, 2);
      assert.equal((await loadInvoiceWorkspace(organization.id, { q: "renamed client" })).totalRows, 10);
      assert.equal((await loadInvoiceWorkspace(organization.id, { q: "ALPHA PROJECT" })).rows[0]?.id, draft.id);
      assert.equal((await loadInvoiceWorkspace(organization.id, { q: issued.invoiceNumber! })).rows[0]?.id, issued.id);

      const paymentFilter = await loadInvoiceWorkspace(organization.id, { payment: "PAID" });
      assert.equal(paymentFilter.totalRows, 1);
      assert.equal(paymentFilter.rows[0]?.id, paid.id);
      assert.equal((await loadInvoiceWorkspace(organization.id, { lifecycle: "ISSUED", payment: "PAID" })).totalRows, 1);
      assert.equal((await loadInvoiceWorkspace(organization.id, { lifecycle: "DRAFT", payment: "UNPAID" })).totalRows, 0);
      assert.equal((await loadInvoiceWorkspace(organization.id, { lifecycle: "SUPERSEDED" })).rows[0]?.id, superseded.id);
      assert.equal((await loadInvoiceWorkspace(organization.id, { lifecycle: "VOID" })).rows[0]?.id, voided.id);
      assert.equal((await loadInvoiceWorkspace(organization.id, { lifecycle: "WRITTEN_OFF" })).rows[0]?.id, writtenOff.id);
      assert.equal((await loadInvoiceWorkspace(organization.id, { lifecycle: "ISSUED" })).rows.every((row) => row.lifecycleStatus === "ISSUED"), true);

      const emailRows = await loadInvoiceWorkspace(organization.id, { q: "Email " });
      const emailByProject = new Map(emailRows.rows.map((row) => [row.projectTitle, row]));
      assert.equal(emailByProject.get("Email Pending")?.latestEmailStatus, "PENDING");
      assert.equal(emailByProject.get("Email Sent")?.latestEmailStatus, "SENT");
      assert.equal(emailByProject.get("Email Partial")?.latestEmailStatus, "PARTIALLY_SENT");
      assert.equal(emailByProject.get("Email Failed")?.latestEmailStatus, "FAILED");
      assert.equal(emailByProject.get("Email Latest")?.latestEmailStatus, "FAILED");
      assert.equal(emailByProject.get("Email Latest")?.latestEmailAt?.toISOString(), "2026-10-02T12:00:00.000Z");
      assert.equal("bccRecipients" in emailByProject.get("Email Latest")!, false);

      const dateSort = await loadInvoiceWorkspace(organization.id, { sort: "date_asc" });
      assert.equal(dateSort.rows[0]?.id, draft.id);
      const unknownSort = await loadInvoiceWorkspace(organization.id, { sort: "subtotal" });
      assert.equal(unknownSort.filters.sort, "updated_desc");
      const numberSort = await loadInvoiceWorkspace(organization.id, { sort: "number_asc" });
      const numbered = numberSort.rows.filter((row) => row.lifecycleStatus !== "DRAFT");
      assert.deepEqual(numbered.map((row) => row.displayNumber), [...numbered.map((row) => row.displayNumber)].sort());
      assert.equal(numberSort.rows.slice(-2).every((row) => row.lifecycleStatus === "DRAFT"), true);

      await prisma.invoice.createMany({ data: Array.from({ length: 27 }, (_, index) => ({
        organizationId: organization.id, clientId: draftClient.id, projectTitle: `Paging ${index}`,
        invoiceDate: new Date(Date.UTC(2026, 0, index + 1)), grandTotal: new Prisma.Decimal(index + 1),
      })) });
      const firstPage = await loadInvoiceWorkspace(organization.id, { q: "Paging" });
      const secondPage = await loadInvoiceWorkspace(organization.id, { q: "Paging", page: "2" });
      assert.equal(firstPage.rows.length, 25);
      assert.equal(secondPage.rows.length, 2);
      assert.equal(new Set([...firstPage.rows, ...secondPage.rows].map((row) => row.id)).size, 27);
      const clamped = await loadInvoiceWorkspace(organization.id, { q: "Paging", page: "999" });
      assert.equal(clamped.filters.page, 2);
      assert.equal(clamped.rows.length, 2);
      assert.equal(INVOICE_WORKSPACE_PAGE_SIZE, 25);
      assert.equal(memberId.organizationId, organization.id);
      assert.equal(hasPermission("VIEWER", "INVOICE_READ"), true);
      assert.equal(hasPermission("VIEWER", "INVOICE_CREATE"), false);
      assert.equal(hasPermission("VIEWER", "INVOICE_EDIT_DRAFT"), false);
    assert.equal(hasPermission("VIEWER", "INVOICE_SEND"), false);
  });
});

async function createDraft(organizationId: string, clientId: string, options: { projectTitle?: string | null; invoiceDate?: string | null }) {
  return prisma.invoice.create({ data: {
    organizationId, clientId, projectTitle: options.projectTitle ?? null,
    invoiceDate: options.invoiceDate ? new Date(`${options.invoiceDate}T00:00:00.000Z`) : null,
    currencyCode: "LKR", grandTotal: new Prisma.Decimal("1250"),
  } });
}

async function createIssued(organizationId: string, clientId: string, options: { projectTitle?: string; invoiceDate?: string } = {}) {
  const invoice = await prisma.invoice.create({ data: {
    organizationId, clientId, projectTitle: options.projectTitle ?? null,
    invoiceDate: new Date(`${options.invoiceDate ?? "2026-03-01"}T00:00:00.000Z`),
    currencyCode: "LKR", grandTotal: new Prisma.Decimal("1250"),
  } });
  await prisma.invoiceItem.create({ data: {
    organizationId, invoiceId: invoice.id, description: "Workspace test service", quantity: new Prisma.Decimal("1"),
    unitPrice: new Prisma.Decimal("1250"), lineTotal: new Prisma.Decimal("1250"), position: 0,
  } });
  return issueInvoice(organizationId, invoice.id);
}

async function createEmailAttempt(
  organizationId: string,
  invoiceId: string,
  userId: string,
  status: "PENDING" | "SENT" | "PARTIALLY_SENT" | "FAILED",
  createdAt: Date,
) {
  const sent = status === "SENT" || status === "PARTIALLY_SENT";
  const failed = status === "FAILED" || status === "PARTIALLY_SENT";
  return prisma.invoiceEmailAttempt.create({ data: {
    organizationId, invoiceId, requestedByUserId: userId,
    requestedByEmailSnapshot: "workspace@example.test", fromEmail: "billing@example.test", fromName: "Billing",
    toRecipients: ["client@example.test"], ccRecipients: [], bccRecipients: ["private@example.test"],
    acceptedRecipients: sent ? ["client@example.test"] : [], rejectedRecipients: failed ? ["other@example.test"] : [],
    subject: "Invoice", bodyText: "Please see invoice.", status, createdAt,
    sentAt: sent ? createdAt : null, failedAt: failed ? createdAt : null,
    failureCode: failed ? "RECIPIENT_REJECTED" : null,
    safeFailureMessage: failed ? "Some recipients could not be reached." : null,
  } });
}
