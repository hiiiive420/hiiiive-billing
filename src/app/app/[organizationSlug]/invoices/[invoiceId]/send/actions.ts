"use server";

import { AuthorizationError, OrganizationContextNotFoundError, ProvisioningError, requireOrganizationBySlug } from "@/lib/auth/authorization";
import { AuthenticationError } from "@/lib/auth/identity";
import { InvoiceEmailConfigurationError } from "@/lib/email/smtp";
import { InvoiceEmailError, sendIssuedInvoiceEmail } from "@/lib/invoices/invoice-email";

export async function sendOrganizationInvoiceEmailAction(organizationSlug: string, invoiceId: string, input: unknown) {
  let workspace;
  try {
    workspace = await requireOrganizationBySlug(organizationSlug, "INVOICE_SEND");
  } catch (error) {
    return { ok: false as const, error: accessMessage(error) };
  }
  try {
    const result = await sendIssuedInvoiceEmail(workspace.organizationId, invoiceId, {
      userId: workspace.userId,
      email: workspace.userEmail,
    }, parseEmailInput(input));
    return { ok: true as const, attemptId: result.attemptId };
  } catch (error) {
    if (error instanceof InvoiceEmailError || error instanceof InvoiceEmailConfigurationError) {
      return { ok: false as const, error: error.message };
    }
    return { ok: false as const, error: "We couldn't send the invoice email. No invoice data was changed. You can review the recipients and try again." };
  }
}

function parseEmailInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvoiceEmailError("Invoice email content is invalid.");
  const input = value as Record<string, unknown>;
  return { to: input.to, cc: input.cc, bcc: input.bcc, subject: input.subject, bodyText: input.bodyText };
}

function accessMessage(error: unknown): string {
  if (error instanceof OrganizationContextNotFoundError) return "This organization is not accessible.";
  if (error instanceof AuthorizationError) return "You do not have permission to send invoices in this organization.";
  if (process.env.NODE_ENV !== "production" && error instanceof AuthenticationError) return error.message;
  if (process.env.NODE_ENV !== "production" && error instanceof ProvisioningError) return error.message;
  return "We couldn't verify access to this workspace.";
}
