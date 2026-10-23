import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { OrganizationRole } from "@/generated/prisma/enums";
import { getPrismaClient } from "../prisma";
import {
  AuthorizationError,
  getCurrentUserMemberships,
  hasPermission,
  PERMISSIONS,
  ProvisioningError,
  requireCurrentUser,
  requireOrganizationMembership,
  requireOrganizationPermission,
} from "./authorization";

const prisma = getPrismaClient();
after(async () => { await prisma.$disconnect(); });

describe("organization authorization (PostgreSQL integration)", () => {
  it("enforces the complete role matrix and denies unknown roles", () => {
    const expected: Record<string, readonly string[]> = {
      ADMIN: PERMISSIONS,
      BILLING: ["INVOICE_READ", "INVOICE_CREATE", "INVOICE_EDIT_DRAFT", "INVOICE_ISSUE", "PAYMENT_READ", "PAYMENT_RECORD"],
      VIEWER: ["INVOICE_READ", "PAYMENT_READ"],
    };
    for (const role of [OrganizationRole.ADMIN, OrganizationRole.BILLING, OrganizationRole.VIEWER]) {
      for (const permission of PERMISSIONS) {
        assert.equal(hasPermission(role, permission), expected[role]!.includes(permission), `${role} / ${permission}`);
      }
    }
    assert.equal(hasPermission("FUTURE_ROLE", "INVOICE_READ"), false);
    assert.equal(hasPermission("toString", "INVOICE_READ"), false);
  });

  it("resolves active app users and active memberships, and denies inactive or foreign membership", async () => {
    const token = randomUUID();
    const email = `auth-${token}@example.test`;
    const foreignEmail = `foreign-${token}@example.test`;
    const organization = await prisma.organization.create({ data: { name: `Auth ${token}`, slug: `auth-${token}` } });
    const foreignOrganization = await prisma.organization.create({ data: { name: `Foreign ${token}`, slug: `foreign-${token}` } });
    const user = await prisma.user.create({ data: { email, displayName: "Auth Test" } });
    const foreignUser = await prisma.user.create({ data: { email: foreignEmail } });
    const previousDevEmail = process.env.DEV_AUTH_EMAIL;
    process.env.DEV_AUTH_EMAIL = email.toUpperCase();
    try {
      await prisma.organizationMembership.create({
        data: { organizationId: organization.id, userId: user.id, role: OrganizationRole.BILLING },
      });
      await prisma.organizationMembership.create({
        data: { organizationId: foreignOrganization.id, userId: user.id, role: OrganizationRole.VIEWER, active: false },
      });
      await prisma.organizationMembership.create({
        data: { organizationId: foreignOrganization.id, userId: foreignUser.id, role: OrganizationRole.ADMIN },
      });

      assert.deepEqual(await requireCurrentUser(), { id: user.id, email, displayName: "Auth Test" });
      process.env.DEV_AUTH_EMAIL = `unknown-${token}@example.test`;
      await assert.rejects(requireCurrentUser(), ProvisioningError);
      process.env.DEV_AUTH_EMAIL = email.toUpperCase();
      const memberships = await getCurrentUserMemberships();
      assert.equal(memberships.length, 1);
      assert.equal(memberships[0]?.organization.slug, organization.slug);
      assert.equal((await requireOrganizationMembership(organization.id)).role, OrganizationRole.BILLING);
      assert.equal((await requireOrganizationPermission(organization.id, "INVOICE_EDIT_DRAFT")).role, OrganizationRole.BILLING);
      await assert.rejects(requireOrganizationPermission(organization.id, "USER_ADMIN"), AuthorizationError);
      await assert.rejects(requireOrganizationMembership(foreignOrganization.id), AuthorizationError);

      await prisma.organizationMembership.updateMany({ where: { organizationId: organization.id, userId: user.id }, data: { active: false } });
      assert.deepEqual(await getCurrentUserMemberships(), []);
      await assert.rejects(requireOrganizationMembership(organization.id), AuthorizationError);
      await prisma.user.update({ where: { id: user.id }, data: { active: false } });
      await assert.rejects(requireCurrentUser(), ProvisioningError);
    } finally {
      if (previousDevEmail === undefined) delete process.env.DEV_AUTH_EMAIL;
      else process.env.DEV_AUTH_EMAIL = previousDevEmail;
      await prisma.organizationMembership.deleteMany({ where: { OR: [{ organizationId: organization.id }, { organizationId: foreignOrganization.id }] } });
      await prisma.user.deleteMany({ where: { id: { in: [user.id, foreignUser.id] } } });
      await prisma.organization.deleteMany({ where: { id: { in: [organization.id, foreignOrganization.id] } } });
    }
  });
});
