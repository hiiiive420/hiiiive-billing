"use server";

import { notFound } from "next/navigation";
import { createDraftInvoice, DraftInvoiceError, updateFullDraftInvoice } from "@/lib/invoices/draft-invoice";
import { searchInvoiceClients, searchInvoiceServices } from "@/lib/invoices/invoice-entry-queries";
import { devInvoiceEntryAvailable, parseInvoiceDraftFormPayload, type InvoiceDraftFormPayload } from "@/lib/invoices/invoice-entry-ui";
import { toCreateDraftInvoiceInput, toUpdateFullDraftInvoiceInput } from "@/lib/invoices/invoice-entry-form-server";
import { getDevInvoiceOrganizationId } from "../context";

function requireDevelopment() {
  if (!devInvoiceEntryAvailable(process.env.NODE_ENV)) notFound();
}

export async function searchClientsAction(query: string) {
  requireDevelopment();
  try {
    return { ok: true as const, results: await searchInvoiceClients(await getDevInvoiceOrganizationId(), query) };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Client search failed." };
  }
}

export async function searchServicesAction(query: string) {
  requireDevelopment();
  try {
    return { ok: true as const, results: await searchInvoiceServices(await getDevInvoiceOrganizationId(), query) };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Service search failed." };
  }
}

export async function saveDraftAction(value: unknown) {
  requireDevelopment();
  try {
    const form = parseInvoiceDraftFormPayload(value);
    const organizationId = await getDevInvoiceOrganizationId();
    const invoice = await createDraftInvoice(organizationId, toCreateDraftInvoiceInput(form));
    return { ok: true as const, invoiceId: invoice.id };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not save draft." };
  }
}

export async function saveDraftChangesAction(invoiceId: string, value: unknown) {
  requireDevelopment();
  let form: InvoiceDraftFormPayload;
  try {
    form = parseInvoiceDraftFormPayload(value);
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Invoice form data is invalid." };
  }

  try {
    const organizationId = await getDevInvoiceOrganizationId();
    await updateFullDraftInvoice(organizationId, invoiceId, toUpdateFullDraftInvoiceInput(form));
    return { ok: true as const };
  } catch (error) {
    if (error instanceof DraftInvoiceError) return { ok: false as const, error: error.message };
    return { ok: false as const, error: "Could not update this draft. It may no longer be editable." };
  }
}