import "server-only";

import { OrganizationRole } from "@/generated/prisma/enums";
import type { OrganizationMembership, User } from "@/generated/prisma/client";
import { getPrismaClient } from "../prisma";
import { getRequestIdentity } from "./identity";

export const PERMISSIONS = [
  "INVOICE_READ",
  "INVOICE_CREATE",
  "INVOICE_EDIT_DRAFT",
  "INVOICE_ISSUE",
  "INVOICE_SEND",
  "PAYMENT_READ",
  "PAYMENT_RECORD",
  "CLIENT_READ",
  "CLIENT_CREATE",
  "CLIENT_EDIT",
  "SERVICE_READ",
  "SERVICE_CREATE",
  "SERVICE_EDIT",
  "USER_ADMIN",
  "ORGANIZATION_SETTINGS",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type CurrentUser = Pick<User, "id" | "email" | "displayName">;
export type CurrentMembership = Pick<OrganizationMembership, "id" | "organizationId" | "userId" | "role"> & {
  organization: { id: string; name: string; slug: string };
};

const ROLE_PERMISSIONS: Readonly<Record<OrganizationRole, readonly Permission[]>> = {
  [OrganizationRole.ADMIN]: PERMISSIONS,
  [OrganizationRole.BILLING]: [
    "INVOICE_READ", "INVOICE_CREATE", "INVOICE_EDIT_DRAFT", "INVOICE_ISSUE", "INVOICE_SEND", "PAYMENT_READ", "PAYMENT_RECORD",
    "CLIENT_READ", "CLIENT_CREATE", "CLIENT_EDIT", "SERVICE_READ", "SERVICE_CREATE", "SERVICE_EDIT",
  ],
  [OrganizationRole.VIEWER]: ["INVOICE_READ", "PAYMENT_READ"],
};

export class AuthorizationError extends Error {
  constructor(message = "You are not authorized to access this resource.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class ProvisioningError extends Error {
  constructor() {
    super("The authenticated account is not available. Contact an administrator.");
    this.name = "ProvisioningError";
  }
}

export class OrganizationContextNotFoundError extends Error {
  constructor() {
    super("This organization is not accessible.");
    this.name = "OrganizationContextNotFoundError";
  }
}

/** Unknown or future roles and permissions are denied by default. */
export function hasPermission(role: unknown, permission: Permission): boolean {
  if (typeof role !== "string" || !Object.hasOwn(ROLE_PERMISSIONS, role)) return false;
  return ROLE_PERMISSIONS[role as OrganizationRole].includes(permission);
}

export async function requireCurrentUser(): Promise<CurrentUser> {
  const identity = await getRequestIdentity();
  const user = await getPrismaClient().user.findUnique({
    where: { email: identity.email },
    select: { id: true, email: true, displayName: true, active: true },
  });
  if (!user?.active) throw new ProvisioningError();
  return { id: user.id, email: user.email, displayName: user.displayName };
}

export async function getCurrentUserMemberships(): Promise<CurrentMembership[]> {
  const user = await requireCurrentUser();
  return getPrismaClient().organizationMembership.findMany({
    where: { userId: user.id, active: true },
    select: {
      id: true,
      organizationId: true,
      userId: true,
      role: true,
      organization: { select: { id: true, name: true, slug: true } },
    },
    orderBy: [{ organization: { name: "asc" } }, { organizationId: "asc" }],
  });
}

/** Returns a membership only when the current user has an active membership in this organization. */
export async function requireOrganizationMembership(organizationId: string): Promise<CurrentMembership> {
  const user = await requireCurrentUser();
  const membership = await getPrismaClient().organizationMembership.findFirst({
    where: { organizationId, userId: user.id, active: true },
    select: {
      id: true,
      organizationId: true,
      userId: true,
      role: true,
      organization: { select: { id: true, name: true, slug: true } },
    },
  });
  // Keep missing, foreign, and inactive organization memberships indistinguishable.
  if (!membership) throw new AuthorizationError();
  return membership;
}

export async function requireOrganizationPermission(
  organizationId: string,
  permission: Permission,
): Promise<CurrentMembership> {
  const membership = await requireOrganizationMembership(organizationId);
  if (!hasPermission(membership.role, permission)) {
    throw new AuthorizationError("You do not have permission to perform this action.");
  }
  return membership;
}

/** Resolves a URL slug only by inspecting the current user's active memberships. */
export async function requireOrganizationBySlug(slug: string, permission: Permission) {
  const memberships = await getCurrentUserMemberships();
  const membership = memberships.find((candidate) => candidate.organization.slug === slug);
  if (!membership) throw new OrganizationContextNotFoundError();
  if (!hasPermission(membership.role, permission)) {
    throw new AuthorizationError("You do not have permission to perform this action.");
  }
  const user = await requireCurrentUser();
  return {
    organizationId: membership.organizationId,
    organizationSlug: membership.organization.slug,
    organizationName: membership.organization.name,
    userId: membership.userId,
    userLabel: user.displayName ?? user.email,
    userEmail: user.email,
    role: membership.role,
  };
}
