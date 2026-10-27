"use server";

import { revalidatePath } from "next/cache";
import { AuthorizationError, OrganizationContextNotFoundError, ProvisioningError, requireOrganizationBySlug } from "@/lib/auth/authorization";
import { AuthenticationError } from "@/lib/auth/identity";
import { PaymentRecordingError, recordPayment } from "@/lib/invoices/record-payment";
import type { PaymentMethod } from "@/generated/prisma/enums";

const methods = new Set<PaymentMethod>(["BANK_TRANSFER", "CASH", "CHEQUE", "CARD", "OTHER"]);

export async function recordOrganizationInvoicePaymentAction(organizationSlug: string, invoiceId: string, input: unknown) {
  let workspace;
  try {
    workspace = await requireOrganizationBySlug(organizationSlug, "PAYMENT_RECORD");
  } catch (error) {
    return { ok: false as const, error: accessMessage(error) };
  }
  let parsed;
  try {
    parsed = parsePaymentInput(input);
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Payment details are invalid." };
  }
  try {
    await recordPayment(workspace.organizationId, invoiceId, parsed);
    const base = `/app/${encodeURIComponent(workspace.organizationSlug)}/invoices`;
    try {
      revalidatePath(`${base}/${encodeURIComponent(invoiceId)}/payments`);
      revalidatePath(`${base}/${encodeURIComponent(invoiceId)}`);
      revalidatePath(base);
    } catch {
      // The write has committed; the client also calls router.refresh() on success.
    }
    return { ok: true as const };
  } catch (error) {
    if (error instanceof PaymentRecordingError) {
      const message = /not found/i.test(error.message) ? "This invoice is not available for payment recording." :
        /only be recorded|no longer eligible/i.test(error.message) ? "This invoice is not eligible for payment recording." :
        /amount|date/i.test(error.message) ? error.message : "The payment could not be recorded.";
      return { ok: false as const, error: message };
    }
    return { ok: false as const, error: "The payment could not be recorded." };
  }
}

function parsePaymentInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Payment details are invalid.");
  const input = value as Record<string, unknown>;
  if (typeof input.amount !== "string" || input.amount.length > 64) throw new Error("Payment amount is invalid.");
  if (typeof input.paidAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.paidAt)) throw new Error("Payment date is invalid.");
  const paidAt = new Date(`${input.paidAt}T12:00:00.000Z`);
  if (Number.isNaN(paidAt.getTime()) || paidAt.toISOString().slice(0, 10) !== input.paidAt) throw new Error("Payment date is invalid.");
  if (typeof input.method !== "string" || !methods.has(input.method as PaymentMethod)) throw new Error("Payment method is invalid.");
  const optionalText = (key: "reference" | "internalNote", max: number): string | null => {
    const value = input[key];
    if (value === undefined || value === null) return null;
    if (typeof value !== "string" || value.length > max) throw new Error("Payment details are invalid.");
    return value.trim() || null;
  };
  return { amount: input.amount, paidAt, method: input.method as PaymentMethod, reference: optionalText("reference", 200), internalNote: optionalText("internalNote", 2000) };
}

function accessMessage(error: unknown): string {
  if (error instanceof OrganizationContextNotFoundError) return "This organization is not accessible.";
  if (error instanceof AuthorizationError) return "You do not have permission to record payments in this organization.";
  if (process.env.NODE_ENV !== "production" && (error instanceof AuthenticationError || error instanceof ProvisioningError)) return error.message;
  return "We couldn't verify access to this workspace.";
}
