"use server";

import { revalidatePath } from "next/cache";
import { AuthorizationError, OrganizationContextNotFoundError, requireOrganizationBySlug } from "@/lib/auth/authorization";
import { createService, updateService, MasterDataValidationError } from "@/lib/master-data/mutations";
import { MasterDataNotFoundError } from "@/lib/master-data/workspaces";
import type { MasterDataActionState } from "@/components/master-data/forms";

function serviceForm(formData: FormData) {
  return {
    name: formData.get("name"), description: formData.get("description"),
    defaultUnitPrice: formData.get("defaultUnitPrice"), currencyCode: formData.get("currencyCode"),
    // HTML omits an unchecked checkbox. Missing means inactive for both create and edit.
    active: formData.get("active") === "on",
  };
}

async function authorized(organizationSlug: string, permission: "SERVICE_CREATE" | "SERVICE_EDIT") {
  try { return await requireOrganizationBySlug(organizationSlug, permission); }
  catch (error) {
    if (error instanceof AuthorizationError || error instanceof OrganizationContextNotFoundError) throw new Error("You do not have permission to manage services in this organization.");
    throw new Error("We couldn't verify access to this workspace.");
  }
}

export async function createServiceAction(organizationSlug: string, _state: MasterDataActionState, formData: FormData): Promise<MasterDataActionState> {
  let workspace;
  try { workspace = await authorized(organizationSlug, "SERVICE_CREATE"); }
  catch (error) { return { error: error instanceof Error ? error.message : "Could not save this service." }; }
  try {
    const service = await createService(workspace.organizationId, serviceForm(formData));
    try { revalidatePath(`/app/${encodeURIComponent(organizationSlug)}/services`); } catch { /* The client refreshes after success. */ }
    return { success: "Service created.", entityId: service.id };
  } catch (error) { return { error: safeError(error, "Could not save this service.") }; }
}

export async function updateServiceAction(organizationSlug: string, serviceId: string, _state: MasterDataActionState, formData: FormData): Promise<MasterDataActionState> {
  let workspace;
  try { workspace = await authorized(organizationSlug, "SERVICE_EDIT"); }
  catch (error) { return { error: error instanceof Error ? error.message : "Could not update this service." }; }
  try {
    await updateService(workspace.organizationId, serviceId, serviceForm(formData));
    try {
      revalidatePath(`/app/${encodeURIComponent(organizationSlug)}/services`);
      revalidatePath(`/app/${encodeURIComponent(organizationSlug)}/services/${encodeURIComponent(serviceId)}`);
    } catch { /* The client refreshes after success. */ }
    return { success: "Service saved." };
  } catch (error) { return { error: safeError(error, "Could not update this service.") }; }
}

function safeError(error: unknown, fallback: string) {
  if (error instanceof MasterDataNotFoundError) return "This record is not available in this organization.";
  return error instanceof MasterDataValidationError ? error.message : fallback;
}
