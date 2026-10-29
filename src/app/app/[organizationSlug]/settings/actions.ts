"use server";

import { revalidatePath } from "next/cache";
import { AuthorizationError, OrganizationContextNotFoundError, requireOrganizationBySlug } from "@/lib/auth/authorization";
import { SettingsTemplateUnavailableError, SettingsValidationError, updateInvoiceDisplaySettings, updateOrganizationSettings } from "@/lib/settings/mutations";

export type SettingsActionState = { error?: string; success?: string };

async function authorized(slug: string) {
  try { return await requireOrganizationBySlug(slug, "ORGANIZATION_SETTINGS"); }
  catch (error) {
    if (error instanceof AuthorizationError || error instanceof OrganizationContextNotFoundError) throw new Error("You do not have permission to manage settings in this organization.");
    throw new Error("We couldn't verify access to this workspace.");
  }
}
function formFields(formData: FormData, fields: readonly string[]) {
  return Object.fromEntries(fields.map((field) => [field, formData.get(field)]));
}
function message(error: unknown, fallback: string) {
  if (error instanceof SettingsValidationError) return error.message;
  if (error instanceof SettingsTemplateUnavailableError) return "The invoice template is unavailable. Contact an administrator.";
  return fallback;
}
function refresh(slug: string) {
  const base = `/app/${encodeURIComponent(slug)}`;
  for (const path of ["/settings", "/invoices", "/invoices/new", "/clients", "/services"]) {
    try { revalidatePath(`${base}${path}`); } catch { /* The client refreshes after success. */ }
  }
}

export async function saveOrganizationSettingsAction(slug: string, _state: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  let workspace;
  try { workspace = await authorized(slug); } catch (error) { return { error: error instanceof Error ? error.message : "Could not save organization settings." }; }
  try {
    await updateOrganizationSettings(workspace.organizationId, formFields(formData, ["name"]));
    refresh(slug);
    return { success: "Organization settings saved." };
  } catch (error) { return { error: message(error, "Could not save organization settings.") }; }
}

export async function saveInvoiceDisplaySettingsAction(slug: string, _state: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  let workspace;
  try { workspace = await authorized(slug); } catch (error) { return { error: error instanceof Error ? error.message : "Could not save invoice settings." }; }
  try {
    await updateInvoiceDisplaySettings(workspace.organizationId, formFields(formData, ["companyName", "bankName", "accountName", "accountNumber", "primaryColor"]));
    refresh(slug);
    return { success: "Invoice settings saved for future documents." };
  } catch (error) { return { error: message(error, "Could not save invoice settings.") }; }
}
