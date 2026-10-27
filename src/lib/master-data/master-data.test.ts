import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { OrganizationRole } from "@/generated/prisma/enums";
import { createClientAction, createClientContactAction, updateClientAction } from "@/app/app/[organizationSlug]/clients/actions";
import { createServiceAction, updateServiceAction } from "@/app/app/[organizationSlug]/services/actions";
import { getPrismaClient } from "@/lib/prisma";
import { MasterDataValidationError } from "./mutations";
import { loadClientDetail, loadClientWorkspace, loadServiceDetail, loadServiceWorkspace, MasterDataNotFoundError } from "./workspaces";
import { searchInvoiceClients, searchInvoiceServices } from "@/lib/invoices/invoice-entry-queries";

const prisma = getPrismaClient();
after(async () => { await prisma.$disconnect(); });

describe("client and service master data (PostgreSQL integration)", () => {
  it("scopes, searches, paginates, validates, authorizes mutations, and keeps service defaults prospective", async () => {
    const token = randomUUID();
    const org = await prisma.organization.create({ data: { name: `Master ${token}`, slug: `master-${token}` } });
    const foreignOrg = await prisma.organization.create({ data: { name: `Foreign ${token}`, slug: `foreign-master-${token}` } });
    const billingEmail = `master-billing-${token}@example.test`;
    const viewerEmail = `master-viewer-${token}@example.test`;
    const billing = await prisma.user.create({ data: { email: billingEmail } });
    const viewer = await prisma.user.create({ data: { email: viewerEmail } });
    const previousDevEmail = process.env.DEV_AUTH_EMAIL;
    const foreignClient = await prisma.client.create({ data: { organizationId: foreignOrg.id, name: "Foreign Client" } });
    const foreignService = await prisma.service.create({ data: { organizationId: foreignOrg.id, name: "Foreign Service" } });
    const seededClients: string[] = [];
    try {
      await prisma.organizationMembership.createMany({ data: [
        { organizationId: org.id, userId: billing.id, role: OrganizationRole.BILLING },
        { organizationId: org.id, userId: viewer.id, role: OrganizationRole.VIEWER },
      ] });
      for (let index = 0; index < 27; index += 1) {
        const client = await prisma.client.create({ data: { organizationId: org.id, name: `Client ${index.toString().padStart(2, "0")}`, email: index === 4 ? "FindMe@example.test" : null } });
        seededClients.push(client.id);
      }
      const firstPage = await loadClientWorkspace(org.id);
      assert.equal(firstPage.totalRows, 27);
      assert.equal(firstPage.rows.length, 25);
      const lastPage = await loadClientWorkspace(org.id, { page: "99" });
      assert.equal(lastPage.page, 2);
      assert.equal(lastPage.rows.length, 2);
      const search = await loadClientWorkspace(org.id, { q: "  FINDme@EXAMPLE.TEST  " });
      assert.equal(search.totalRows, 1);
      assert.equal(search.rows[0]?.email, "FindMe@example.test");
      assert.equal((await loadServiceWorkspace(org.id)).totalRows, 0);
      await assert.rejects(loadClientDetail(org.id, foreignClient.id), MasterDataNotFoundError);
      await assert.rejects(loadServiceDetail(org.id, foreignService.id), MasterDataNotFoundError);

      process.env.DEV_AUTH_EMAIL = billingEmail;
      const clientForm = new FormData();
      clientForm.set("name", " Action Created ");
      clientForm.set("email", "BILLING@example.test");
      clientForm.set("organizationId", foreignOrg.id);
      clientForm.set("role", "ADMIN");
      clientForm.set("userId", viewer.id);
      const createdClient = await createClientAction(org.slug, {}, clientForm);
      assert.equal(createdClient.success, "Client created.", JSON.stringify(createdClient));
      assert.ok(createdClient.entityId);
      const storedClient = await prisma.client.findFirstOrThrow({ where: { organizationId: org.id, id: createdClient.entityId } });
      assert.equal(storedClient.name, "Action Created");
      assert.equal(storedClient.email, "billing@example.test");
      assert.equal(storedClient.active, true);
      assert.equal((await searchInvoiceClients(org.id, "Action Created")).some((entry) => entry.id === createdClient.entityId), true);

      const clientUpdate = new FormData();
      clientUpdate.set("name", "Action Created Updated");
      clientUpdate.set("email", "updated@example.test");
      const updatedClient = await updateClientAction(org.slug, createdClient.entityId!, {}, clientUpdate);
      assert.equal(updatedClient.success, "Client saved.");
      assert.equal((await loadClientDetail(org.id, createdClient.entityId!)).active, false);
      clientUpdate.set("active", "on");
      assert.equal((await updateClientAction(org.slug, createdClient.entityId!, {}, clientUpdate)).success, "Client saved.");
      assert.equal((await loadClientDetail(org.id, createdClient.entityId!)).active, true);

      const contactForm = new FormData();
      contactForm.set("name", "Accounts Contact");
      contactForm.set("email", "accounts@example.test");
      contactForm.set("billingContact", "on");
      const contactResult = await createClientContactAction(org.slug, createdClient.entityId!, {}, contactForm);
      assert.equal(contactResult.success, "Contact added.");
      const detail = await loadClientDetail(org.id, createdClient.entityId!);
      assert.equal(detail.contacts[0]?.billingContact, true);
      assert.equal(detail.contacts[0]?.active, true);
      const foreignContact = await createClientContactAction(org.slug, foreignClient.id, {}, contactForm);
      assert.equal(foreignContact.error, "This record is not available in this organization.");

      const serviceForm = new FormData();
      serviceForm.set("name", "Website Development");
      serviceForm.set("defaultUnitPrice", "50000.1250");
      serviceForm.set("currencyCode", "lkr");
      serviceForm.set("organizationId", foreignOrg.id);
      serviceForm.set("active", "on");
      const serviceResult = await createServiceAction(org.slug, {}, serviceForm);
      assert.equal(serviceResult.success, "Service created.");
      assert.ok(serviceResult.entityId);
      const service = await prisma.service.findFirstOrThrow({ where: { organizationId: org.id, id: serviceResult.entityId } });
      assert.equal(service.defaultUnitPrice?.toString(), "50000.125");
      assert.equal(service.currencyCode, "LKR");
      assert.equal(service.active, true);
      assert.equal((await searchInvoiceServices(org.id, "Website Development")).some((entry) => entry.id === service.id), true);
      const serviceUpdate = new FormData();
      serviceUpdate.set("name", "Website Development Updated");
      serviceUpdate.set("defaultUnitPrice", "60000");
      serviceUpdate.set("currencyCode", "LKR");
      const updatedService = await updateServiceAction(org.slug, serviceResult.entityId!, {}, serviceUpdate);
      assert.equal(updatedService.success, "Service saved.");
      const inactiveService = await loadServiceDetail(org.id, serviceResult.entityId!);
      assert.equal(inactiveService.active, false);
      assert.equal((await loadServiceWorkspace(org.id)).rows.find((row) => row.id === serviceResult.entityId)?.active, false);
      assert.equal((await searchInvoiceServices(org.id, "Website Development")).some((entry) => entry.id === service.id), false);
      serviceUpdate.set("active", "on");
      assert.equal((await updateServiceAction(org.slug, serviceResult.entityId!, {}, serviceUpdate)).success, "Service saved.");
      const activeService = await loadServiceDetail(org.id, serviceResult.entityId!);
      assert.equal(activeService.active, true);
      assert.equal(activeService.defaultUnitPrice, "60000");
      assert.equal((await searchInvoiceServices(org.id, "Website Development")).some((entry) => entry.id === service.id), true);
      assert.equal((await loadServiceWorkspace(org.id, { q: "website development" })).totalRows, 1);
      const foreignServiceEdit = await updateServiceAction(org.slug, foreignService.id, {}, serviceUpdate);
      assert.equal(foreignServiceEdit.error, "This record is not available in this organization.");

      const foreignEdit = await updateClientAction(org.slug, foreignClient.id, {}, clientForm);
      assert.equal(foreignEdit.error, "This record is not available in this organization.");
      const invalidService = new FormData();
      invalidService.set("name", "Invalid Price");
      invalidService.set("defaultUnitPrice", "-1");
      invalidService.set("currencyCode", "LKR");
      const invalidResult = await createServiceAction(org.slug, {}, invalidService);
      assert.match(invalidResult.error ?? "", /nonnegative/);
      const createInactiveForm = new FormData();
      createInactiveForm.set("name", "Inactive by default input");
      createInactiveForm.set("currencyCode", "LKR");
      const createdInactive = await createServiceAction(org.slug, {}, createInactiveForm);
      assert.ok(createdInactive.entityId);
      assert.equal((await loadServiceDetail(org.id, createdInactive.entityId!)).active, false);
      await assert.rejects(import("./mutations").then(({ parseClientInput }) => parseClientInput({ name: "  " })), MasterDataValidationError);

      process.env.DEV_AUTH_EMAIL = viewerEmail;
      const denied = await createClientAction(org.slug, {}, clientForm);
      assert.match(denied.error ?? "", /permission to manage clients/);
      const deniedService = await createServiceAction(org.slug, {}, serviceForm);
      assert.match(deniedService.error ?? "", /permission to manage services/);
      const unchangedForeign = await prisma.client.findFirstOrThrow({ where: { organizationId: foreignOrg.id, id: foreignClient.id } });
      assert.equal(unchangedForeign.name, "Foreign Client");
    } finally {
      if (previousDevEmail === undefined) delete process.env.DEV_AUTH_EMAIL;
      else process.env.DEV_AUTH_EMAIL = previousDevEmail;
      await prisma.clientContact.deleteMany({ where: { organizationId: org.id } });
      await prisma.service.deleteMany({ where: { organizationId: foreignOrg.id } });
      await prisma.client.deleteMany({ where: { organizationId: { in: [org.id, foreignOrg.id] } } });
      await prisma.service.deleteMany({ where: { organizationId: org.id } });
      await prisma.organizationMembership.deleteMany({ where: { organizationId: org.id } });
      await prisma.user.deleteMany({ where: { id: { in: [billing.id, viewer.id] } } });
      await prisma.organization.deleteMany({ where: { id: { in: [org.id, foreignOrg.id] } } });
      assert.equal(seededClients.length, 27);
    }
  });
});
