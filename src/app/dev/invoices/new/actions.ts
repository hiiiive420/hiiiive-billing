"use server";

import { notFound } from "next/navigation";
import { createDraftInvoice, DraftInvoiceError, updateFullDraftInvoice, type DraftInvoiceItemInput } from "@/lib/invoices/draft-invoice";
import { searchInvoiceClients, searchInvoiceServices } from "@/lib/invoices/invoice-entry-queries";
import { devInvoiceEntryAvailable, parseInvoiceDraftFormPayload, type InvoiceDraftFormPayload } from "@/lib/invoices/invoice-entry-ui";
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
    const invoice = await createDraftInvoice(organizationId, {
      clientId: form.clientId,
      projectTitle: form.projectTitle || null,
      invoiceDate: parseDate(form.invoiceDate),
      dueDate: parseDate(form.dueDate),
      currencyCode: form.currencyCode,
      discountLabel: form.discountLabel || null,
      discountAmount: form.discountAmount,
      notes: form.notes || null,
      paymentTerms: form.paymentTerms || null,
      items: toDraftItems(form.items),
    });
    return { ok: true as const, invoiceId: invoice.id };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not save draft." };
  }
}

export async function saveDraftChangesAction(invoiceId: string, value: unknown) {
  requireDevelopment();
  let form: InvoiceDraftFormPayload;
  let invoiceDate: Date | null;
  let dueDate: Date | null;
  try {
    form = parseInvoiceDraftFormPayload(value);
    invoiceDate = parseDate(form.invoiceDate);
    dueDate = parseDate(form.dueDate);
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Invoice form data is invalid." };
  }

  try {
    const organizationId = await getDevInvoiceOrganizationId();
    await updateFullDraftInvoice(organizationId, invoiceId, {
      clientId: form.clientId,
      projectTitle: form.projectTitle || null,
      invoiceDate,
      dueDate,
      currencyCode: form.currencyCode,
      discountLabel: form.discountLabel || null,
      discountAmount: form.discountAmount,
      notes: form.notes || null,
      paymentTerms: form.paymentTerms || null,
      items: toDraftItems(form.items),
    });
    return { ok: true as const };
  } catch (error) {
    if (error instanceof DraftInvoiceError) return { ok: false as const, error: error.message };
    return { ok: false as const, error: "Could not update this draft. It may no longer be editable." };
  }
}

function toDraftItems(items: InvoiceDraftFormPayload["items"]): DraftInvoiceItemInput[] {
  return items.map((item, position) => item.billingMode === "FLAT_FEE"
    ? {
        billingMode: "FLAT_FEE" as const,
        serviceId: item.serviceId,
        description: item.description,
        ...(item.useServiceDefaultPrice ? {} : { amount: item.amount! }),
        ...(item.useServiceDefaultPrice ? { useServiceDefaultPrice: true } : {}),
        position,
      }
    : {
        billingMode: "QUANTITY" as const,
        serviceId: item.serviceId,
        description: item.description,
        quantity: item.quantity,
        ...(item.useServiceDefaultPrice ? {} : { unitPrice: item.unitPrice! }),
        ...(item.useServiceDefaultPrice ? { useServiceDefaultPrice: true } : {}),
        position,
      });
}

function parseDate(value: string): Date | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Enter a valid calendar date.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Enter a valid calendar date.");
  return date;
}
