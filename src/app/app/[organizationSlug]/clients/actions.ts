"use server";

import { revalidatePath } from "next/cache";
import { AuthorizationError, OrganizationContextNotFoundError, requireOrganizationBySlug } from "@/lib/auth/authorization";
import { createClient, createClientContact, updateClient, updateClientContact, MasterDataValidationError } from "@/lib/master-data/mutations";
import { MasterDataNotFoundError } from "@/lib/master-data/workspaces";
import type { MasterDataActionState } from "@/components/master-data/forms";

function formObject(formData: FormData, fields: readonly string[], defaultActive = false) {
  const result: Record<string, unknown> = {};
  for (const field of fields) result[field] = formData.get(field);
  result.active = formData.has("active") ? formData.get("active") === "on" : defaultActive;
  result.billingContact = formData.get("billingContact") === "on";
  result.primaryContact = formData.get("primaryContact") === "on";
  return result;
}

async function authorized(organizationSlug: string, permission: "CLIENT_CREATE" | "CLIENT_EDIT") {
  try { return await requireOrganizationBySlug(organizationSlug, permission); }
  catch (error) {
    if (error instanceof AuthorizationError || error instanceof OrganizationContextNotFoundError) throw new Error("You do not have permission to manage clients in this organization.");
    throw new Error("We couldn't verify access to this workspace.");
  }
}

export async function createClientAction(organizationSlug: string, _state: MasterDataActionState, formData: FormData): Promise<MasterDataActionState> {
  let workspace;
  try { workspace = await authorized(organizationSlug, "CLIENT_CREATE"); }
  catch (error) { return { error: error instanceof Error ? error.message : "Could not save this client." }; }
  try {
    const client = await createClient(workspace.organizationId, formObject(formData, ["name", "businessRegistrationOrTaxIdentifier", "phone", "email", "billingAddress", "notes"], true));
    try { revalidatePath(`/app/${encodeURIComponent(organizationSlug)}/clients`); } catch { /* The client refreshes after success. */ }
    return { success: "Client created.", entityId: client.id };
  } catch (error) { return { error: safeError(error, "Could not save this client.") }; }
}

export async function updateClientAction(organizationSlug: string, clientId: string, _state: MasterDataActionState, formData: FormData): Promise<MasterDataActionState> {
  let workspace;
  try { workspace = await authorized(organizationSlug, "CLIENT_EDIT"); }
  catch (error) { return { error: error instanceof Error ? error.message : "Could not update this client." }; }
  try {
    await updateClient(workspace.organizationId, clientId, formObject(formData, ["name", "businessRegistrationOrTaxIdentifier", "phone", "email", "billingAddress", "notes"]));
    try {
      revalidatePath(`/app/${encodeURIComponent(organizationSlug)}/clients`);
      revalidatePath(`/app/${encodeURIComponent(organizationSlug)}/clients/${encodeURIComponent(clientId)}`);
    } catch { /* The client refreshes after success. */ }
    return { success: "Client saved." };
  } catch (error) { return { error: safeError(error, "Could not update this client.") }; }
}

export async function createClientContactAction(organizationSlug: string, clientId: string, _state: MasterDataActionState, formData: FormData): Promise<MasterDataActionState> {
  let workspace;
  try { workspace = await authorized(organizationSlug, "CLIENT_EDIT"); }
  catch (error) { return { error: error instanceof Error ? error.message : "Could not save this contact." }; }
  try {
    await createClientContact(workspace.organizationId, clientId, formObject(formData, ["name", "email", "phone"], true));
    try { revalidatePath(`/app/${encodeURIComponent(organizationSlug)}/clients/${encodeURIComponent(clientId)}`); } catch { /* The client refreshes after success. */ }
    return { success: "Contact added." };
  } catch (error) { return { error: safeError(error, "Could not save this contact.") }; }
}

export async function updateClientContactAction(organizationSlug: string, clientId: string, contactId: string, _state: MasterDataActionState, formData: FormData): Promise<MasterDataActionState> {
  let workspace;
  try { workspace = await authorized(organizationSlug, "CLIENT_EDIT"); }
  catch (error) { return { error: error instanceof Error ? error.message : "Could not update this contact." }; }
  try {
    await updateClientContact(workspace.organizationId, clientId, contactId, formObject(formData, ["name", "email", "phone"]));
    try { revalidatePath(`/app/${encodeURIComponent(organizationSlug)}/clients/${encodeURIComponent(clientId)}`); } catch { /* The client refreshes after success. */ }
    return { success: "Contact saved." };
  } catch (error) { return { error: safeError(error, "Could not update this contact.") }; }
}

function safeError(error: unknown, fallback: string) {
  if (error instanceof MasterDataNotFoundError) return "This record is not available in this organization.";
  return error instanceof MasterDataValidationError ? error.message : fallback;
}
