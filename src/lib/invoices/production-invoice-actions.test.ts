import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { OrganizationRole } from "@/generated/prisma/enums";
import { getPrismaClient } from "@/lib/prisma";
import { loadDraftInvoiceForEditing } from "@/lib/invoices/invoice-entry-queries";
import {
  createOrganizationDraftAction,
  issueOrganizationInvoiceAction,
  searchCreateClientsAction,
  searchEditServicesAction,
  updateOrganizationDraftAction,
} from "@/app/app/[organizationSlug]/invoices/actions";

const prisma = getPrismaClient();
after(async () => { await prisma.$disconnect(); });

describe("production invoice Server Actions (PostgreSQL integration)", () => {
  it("authorizes each operation, derives tenant scope from membership, creates, and atomically edits drafts", async () => {
    const token = randomUUID();
    const email = `workspace-${token}@example.test`;
    const org = await prisma.organization.create({ data: { name: `Workspace ${token}`, slug: `workspace-${token}` } });
    const foreignOrg = await prisma.organization.create({ data: { name: `Foreign ${token}`, slug: `foreign-${token}` } });
    const user = await prisma.user.create({ data: { email } });
    const client = await prisma.client.create({ data: { organizationId: org.id, name: "Allowed Client" } });
    const foreignClient = await prisma.client.create({ data: { organizationId: foreignOrg.id, name: "Foreign Client" } });
    const service = await prisma.service.create({
      data: { organizationId: org.id, name: "Explicit Price Service", defaultUnitPrice: "999.0000", currencyCode: "USD" },
    });
    const previousDevEmail = process.env.DEV_AUTH_EMAIL;
    process.env.DEV_AUTH_EMAIL = email;
    const invoiceIds: string[] = [];
    try {
      await prisma.organizationMembership.create({
        data: { organizationId: org.id, userId: user.id, role: OrganizationRole.BILLING },
      });
      const foreignInvoice = await prisma.invoice.create({ data: { organizationId: foreignOrg.id, clientId: foreignClient.id } });

      const ownClients = await searchCreateClientsAction(org.slug, "Allowed");
      assert.equal(ownClients.ok, true);
      if (ownClients.ok) assert.deepEqual(ownClients.results.map((row) => row.name), ["Allowed Client"]);
      assert.equal((await searchCreateClientsAction(foreignOrg.slug, "Foreign")).ok, false);
      assert.equal((await searchEditServicesAction(org.slug, "Explicit")).ok, true);

      const created = await createOrganizationDraftAction(org.slug, {
        organizationId: foreignOrg.id,
        role: "ADMIN",
        userId: "forged-user",
        lifecycleStatus: "ISSUED",
        paymentStatus: "PAID",
        invoiceNumber: "FORGED-1",
        subtotal: "1",
        grandTotal: "999999",
        clientId: client.id,
        projectTitle: "Production draft",
        invoiceDate: "2026-10-20",
        dueDate: "2026-11-20",
        currencyCode: "USD",
        discountLabel: "",
        discountAmount: "0",
        notes: "Initial notes",
        paymentTerms: "Due in 30 days",
        items: [
          { billingMode: "QUANTITY", serviceId: service.id, description: "Service at explicit price", quantity: "2", unitPrice: "12.5000" },
          { billingMode: "FLAT_FEE", serviceId: null, description: "Flat fee", amount: "55000" },
          { billingMode: "QUANTITY", serviceId: null, description: "Free text", quantity: "1", unitPrice: "3" },
        ],
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;
      invoiceIds.push(created.invoiceId);
      const persisted = await prisma.invoice.findFirstOrThrow({ where: { id: created.invoiceId } });
      assert.equal(persisted.organizationId, org.id);
      assert.equal(persisted.lifecycleStatus, "DRAFT");
      assert.equal(persisted.paymentStatus, "UNPAID");
      assert.equal(persisted.invoiceNumber, null);
      assert.equal(persisted.grandTotal.toString(), "55028");
      const createdItems = await prisma.invoiceItem.findMany({ where: { invoiceId: created.invoiceId }, orderBy: { position: "asc" } });
      assert.deepEqual(createdItems.map((item) => item.billingMode), ["QUANTITY", "FLAT_FEE", "QUANTITY"]);
      assert.equal(createdItems[0]?.unitPrice.toString(), "12.5");
      assert.equal(createdItems[1]?.quantity.toString(), "1");
      assert.equal(createdItems[2]?.serviceId, null);

      const updatePayload = {
        organizationId: foreignOrg.id,
        role: "VIEWER",
        lifecycleStatus: "ISSUED",
        subtotal: "0",
        grandTotal: "0",
        clientId: client.id,
        projectTitle: "Updated production draft",
        invoiceDate: "2026-10-21",
        dueDate: "2026-11-21",
        currencyCode: "CAD",
        discountLabel: "Courtesy",
        discountAmount: "1.25",
        notes: "Updated notes",
        paymentTerms: "Due on receipt",
        items: [
          { billingMode: "QUANTITY", serviceId: service.id, description: "Keep explicit saved price", quantity: "2", unitPrice: "12.5000" },
          { billingMode: "FLAT_FEE", serviceId: null, description: "Updated flat fee", amount: "20" },
        ],
      };
      assert.deepEqual(await updateOrganizationDraftAction(org.slug, created.invoiceId, updatePayload), { ok: true });
      const missingTemplateIssue = await issueOrganizationInvoiceAction(org.slug, created.invoiceId);
      assert.equal(missingTemplateIssue.ok, false);
      if (!missingTemplateIssue.ok) assert.match(missingTemplateIssue.error, /active default invoice template/i);
      assert.equal((await prisma.invoice.findFirstOrThrow({ where: { id: created.invoiceId } })).lifecycleStatus, "DRAFT");
      const edited = await loadDraftInvoiceForEditing(org.id, created.invoiceId);
      assert.equal(edited.currencyCode, "CAD");
      assert.equal(edited.items[0]?.unitPrice, "12.5");
      assert.equal(edited.items[0]?.service?.defaultUnitPrice, "999");
      assert.equal(edited.items[1]?.billingMode, "FLAT_FEE");
      assert.equal(edited.items[1]?.amount, "20");
      assert.equal(edited.grandTotal, "43.75");

      assert.equal((await updateOrganizationDraftAction(org.slug, foreignInvoice.id, updatePayload)).ok, false);
      assert.equal((await createOrganizationDraftAction(foreignOrg.slug, { ...updatePayload, items: [{ billingMode: "FLAT_FEE", serviceId: null, description: "Foreign", amount: "1" }] })).ok, false);

      await prisma.organizationMembership.updateMany({ where: { organizationId: org.id, userId: user.id }, data: { role: OrganizationRole.ADMIN } });
      const adminCreate = await createOrganizationDraftAction(org.slug, {
        clientId: client.id, projectTitle: "Admin created", invoiceDate: "", dueDate: "", currencyCode: "LKR",
        discountLabel: "", discountAmount: "0", notes: "", paymentTerms: "",
        items: [{ billingMode: "FLAT_FEE", serviceId: null, description: "Admin flat", amount: "5" }],
      });
      assert.equal(adminCreate.ok, true);
      if (adminCreate.ok) invoiceIds.push(adminCreate.invoiceId);
      assert.deepEqual(await updateOrganizationDraftAction(org.slug, created.invoiceId, updatePayload), { ok: true });

      await prisma.organizationMembership.updateMany({ where: { organizationId: org.id, userId: user.id }, data: { role: OrganizationRole.VIEWER } });
      assert.equal((await searchCreateClientsAction(org.slug, "")).ok, false);
      assert.equal((await searchEditServicesAction(org.slug, "")).ok, false);
      assert.equal((await createOrganizationDraftAction(org.slug, updatePayload)).ok, false);
      assert.equal((await updateOrganizationDraftAction(org.slug, created.invoiceId, updatePayload)).ok, false);
      const viewerIssue = await issueOrganizationInvoiceAction(org.slug, created.invoiceId);
      assert.equal(viewerIssue.ok, false);
      if (!viewerIssue.ok) assert.match(viewerIssue.error, /permission/i);
      assert.equal((await loadDraftInvoiceForEditing(org.id, created.invoiceId)).id, created.invoiceId);

      await prisma.organizationMembership.updateMany({ where: { organizationId: org.id, userId: user.id }, data: { active: false } });
      assert.equal((await searchCreateClientsAction(org.slug, "")).ok, false);
    } finally {
      if (previousDevEmail === undefined) delete process.env.DEV_AUTH_EMAIL;
      else process.env.DEV_AUTH_EMAIL = previousDevEmail;
      await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.invoice.deleteMany({ where: { organizationId: { in: [org.id, foreignOrg.id] } } });
      await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: [org.id, foreignOrg.id] } } });
      await prisma.service.deleteMany({ where: { organizationId: org.id } });
      await prisma.client.deleteMany({ where: { organizationId: { in: [org.id, foreignOrg.id] } } });
      await prisma.user.deleteMany({ where: { id: user.id } });
      await prisma.organization.deleteMany({ where: { id: { in: [org.id, foreignOrg.id] } } });
    }
  });
});
