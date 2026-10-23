import "server-only";

import type { CreateDraftInvoiceInput, DraftInvoiceItemInput, UpdateFullDraftInvoiceInput } from "./draft-invoice";
import type { InvoiceDraftFormPayload } from "./invoice-entry-ui";

export function toCreateDraftInvoiceInput(form: InvoiceDraftFormPayload): CreateDraftInvoiceInput {
  return {
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
  };
}

export function toUpdateFullDraftInvoiceInput(form: InvoiceDraftFormPayload): UpdateFullDraftInvoiceInput {
  return {
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
  };
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
