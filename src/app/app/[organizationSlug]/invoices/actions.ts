"use server";

import { AuthorizationError, OrganizationContextNotFoundError, ProvisioningError, requireOrganizationBySlug } from "@/lib/auth/authorization";
import { AuthenticationError } from "@/lib/auth/identity";
import { createDraftInvoice, DraftInvoiceError, updateFullDraftInvoice, type CreateDraftInvoiceInput, type UpdateFullDraftInvoiceInput } from "@/lib/invoices/draft-invoice";
import { searchInvoiceClients, searchInvoiceServices } from "@/lib/invoices/invoice-entry-queries";
import { toCreateDraftInvoiceInput, toUpdateFullDraftInvoiceInput } from "@/lib/invoices/invoice-entry-form-server";
import { parseInvoiceDraftFormPayload } from "@/lib/invoices/invoice-entry-ui";

export async function searchCreateClientsAction(organizationSlug: string, query: string) {
  try {
    const { organizationId } = await requireOrganizationBySlug(organizationSlug, "INVOICE_CREATE");
    return { ok: true as const, results: await searchInvoiceClients(organizationId, query) };
  } catch (error) {
    return { ok: false as const, error: accessMessage(error, "Client search failed.") };
  }
}

export async function searchCreateServicesAction(organizationSlug: string, query: string) {
  try {
    const { organizationId } = await requireOrganizationBySlug(organizationSlug, "INVOICE_CREATE");
    return { ok: true as const, results: await searchInvoiceServices(organizationId, query) };
  } catch (error) {
    return { ok: false as const, error: accessMessage(error, "Service search failed.") };
  }
}

export async function searchEditClientsAction(organizationSlug: string, query: string) {
  try {
    const { organizationId } = await requireOrganizationBySlug(organizationSlug, "INVOICE_EDIT_DRAFT");
    return { ok: true as const, results: await searchInvoiceClients(organizationId, query) };
  } catch (error) {
    return { ok: false as const, error: accessMessage(error, "Client search failed.") };
  }
}

export async function searchEditServicesAction(organizationSlug: string, query: string) {
  try {
    const { organizationId } = await requireOrganizationBySlug(organizationSlug, "INVOICE_EDIT_DRAFT");
    return { ok: true as const, results: await searchInvoiceServices(organizationId, query) };
  } catch (error) {
    return { ok: false as const, error: accessMessage(error, "Service search failed.") };
  }
}

export async function createOrganizationDraftAction(organizationSlug: string, value: unknown) {
  let organizationId: string;
  try {
    ({ organizationId } = await requireOrganizationBySlug(organizationSlug, "INVOICE_CREATE"));
  } catch (error) {
    return { ok: false as const, error: accessMessage(error, "Could not save this draft.") };
  }
  let input: CreateDraftInvoiceInput;
  try {
    input = toCreateDraftInvoiceInput(parseInvoiceDraftFormPayload(value));
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Invoice form data is invalid." };
  }
  try {
    const invoice = await createDraftInvoice(organizationId, input);
    return { ok: true as const, invoiceId: invoice.id };
  } catch (error) {
    return { ok: false as const, error: error instanceof DraftInvoiceError ? error.message : "Could not save this draft." };
  }
}

export async function updateOrganizationDraftAction(organizationSlug: string, invoiceId: string, value: unknown) {
  let organizationId: string;
  try {
    ({ organizationId } = await requireOrganizationBySlug(organizationSlug, "INVOICE_EDIT_DRAFT"));
  } catch (error) {
    return { ok: false as const, error: accessMessage(error, "Could not update this draft.") };
  }
  let input: UpdateFullDraftInvoiceInput;
  try {
    input = toUpdateFullDraftInvoiceInput(parseInvoiceDraftFormPayload(value));
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Invoice form data is invalid." };
  }
  try {
    await updateFullDraftInvoice(organizationId, invoiceId, input);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: error instanceof DraftInvoiceError ? error.message : "Could not update this draft. It may no longer be editable." };
  }
}

function accessMessage(error: unknown, fallback: string): string {
  if (error instanceof AuthenticationError && process.env.NODE_ENV !== "production") return error.message;
  if (error instanceof ProvisioningError && process.env.NODE_ENV !== "production") return error.message;
  if (error instanceof OrganizationContextNotFoundError) return "This organization is not accessible.";
  if (error instanceof AuthorizationError) return "You do not have permission to access this workspace.";
  return fallback;
}

