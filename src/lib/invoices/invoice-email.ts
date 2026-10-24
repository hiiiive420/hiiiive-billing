import "server-only";

import { getPrismaClient } from "../prisma";
import { generateIssuedInvoicePdf } from "./generate-issued-invoice-pdf";
import { invoicePdfFilename } from "../invoice-templates/generate-pdf-core";
import { buildInvoiceEmailDefaults, validateInvoiceEmailBody, validateInvoiceEmailSubject } from "./invoice-email-template";
import { parseInvoiceRecipients, RecipientValidationError } from "../email/recipients";
import {
  createInvoiceEmailTransport,
  getInvoiceEmailSender,
  getInvoiceEmailSenderDisplay,
  getSmtpConfiguration,
  InvoiceEmailConfigurationError,
  type InvoiceEmailEnvironment,
  type InvoiceEmailTransport,
  type OutgoingInvoiceEmail,
  type SmtpConfiguration,
} from "../email/smtp";

export class InvoiceEmailError extends Error {
  constructor(message: string) { super(message); this.name = "InvoiceEmailError"; }
}

export type InvoiceEmailActor = Readonly<{ userId: string; email: string }>;
export type InvoiceEmailFormInput = Readonly<{ to: unknown; cc?: unknown; bcc?: unknown; subject: unknown; bodyText: unknown }>;
export type InvoiceEmailComposerData = Readonly<{
  invoice: {
    id: string; invoiceNumber: string; projectTitle: string | null; clientName: string;
    suggestedTo: string; currencyCode: string; grandTotal: string; invoiceDate: string;
    dueDate: string | null; paymentTerms: string | null;
  };
  fromDisplay: string;
  senderConfigured: boolean;
  attachmentFilename: string;
  defaults: { subject: string; bodyText: string };
  recentAttempts: readonly {
    id: string; status: "PENDING" | "SENT" | "PARTIALLY_SENT" | "FAILED"; timestamp: string;
    toRecipients: readonly string[]; ccCount: number;
  }[];
}>;

type InvoiceEmailDependencies = Readonly<{
  env?: InvoiceEmailEnvironment;
  transportFactory?: (configuration: SmtpConfiguration) => InvoiceEmailTransport;
  pdfGenerator?: typeof generateIssuedInvoicePdf;
  now?: () => Date;
}>;

export async function loadInvoiceEmailComposerData(organizationId: string, invoiceId: string): Promise<InvoiceEmailComposerData> {
  const prisma = getPrismaClient();
  const invoice = await prisma.invoice.findFirst({
    where: { organizationId, id: invoiceId },
    select: {
      id: true, lifecycleStatus: true, invoiceNumber: true, projectTitle: true, clientNameSnapshot: true,
      clientEmailSnapshot: true, currencyCode: true, grandTotal: true, invoiceDate: true,
      dueDate: true, paymentTerms: true,
    },
  });
  if (!invoice || !invoiceEmailLifecycleAllowed(invoice.lifecycleStatus)
    || !invoice.invoiceNumber || !invoice.clientNameSnapshot || !invoice.invoiceDate) {
    throw new InvoiceEmailError("This issued invoice is not available for sending.");
  }
  const emailData = {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    projectTitle: invoice.projectTitle,
    clientName: invoice.clientNameSnapshot,
    suggestedTo: invoice.clientEmailSnapshot ?? "",
    currencyCode: invoice.currencyCode,
    grandTotal: invoice.grandTotal.toString(),
    invoiceDate: invoice.invoiceDate.toISOString().slice(0, 10),
    dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
    paymentTerms: invoice.paymentTerms,
  };
  const senderDisplay = getInvoiceEmailSenderDisplay();
  const attempts = await prisma.invoiceEmailAttempt.findMany({
      where: { organizationId, invoiceId },
      select: { id: true, status: true, createdAt: true, sentAt: true, failedAt: true, toRecipients: true, ccRecipients: true },
      orderBy: { createdAt: "desc" }, take: 5,
    });
  return {
    invoice: emailData,
    fromDisplay: senderDisplay.value,
    senderConfigured: senderDisplay.configured,
    attachmentFilename: invoicePdfFilename(invoice.invoiceNumber),
    defaults: buildInvoiceEmailDefaults(emailData, senderDisplay.sender ?? { name: "Hiiiive" }),
    recentAttempts: attempts.map((attempt) => ({
      id: attempt.id,
      status: attempt.status,
      timestamp: (attempt.sentAt ?? attempt.failedAt ?? attempt.createdAt).toISOString(),
      toRecipients: attempt.toRecipients,
      ccCount: attempt.ccRecipients.length,
    })),
  };
}

export async function sendIssuedInvoiceEmail(
  organizationId: string,
  invoiceId: string,
  actor: InvoiceEmailActor,
  input: InvoiceEmailFormInput,
  dependencies: InvoiceEmailDependencies = {},
): Promise<Readonly<{ attemptId: string; providerMessageId: string | null }>> {
  let recipients;
  let subject: string;
  let bodyText: string;
  try {
    recipients = parseInvoiceRecipients(input);
    subject = validateInvoiceEmailSubject(input.subject);
    bodyText = validateInvoiceEmailBody(input.bodyText);
  } catch (error) {
    if (error instanceof RecipientValidationError) throw new InvoiceEmailError(error.message);
    throw new InvoiceEmailError(error instanceof Error ? error.message : "Invoice email content is invalid.");
  }

  const prisma = getPrismaClient();
  const invoice = await prisma.invoice.findFirst({
    where: { organizationId, id: invoiceId },
    select: { id: true, invoiceNumber: true, lifecycleStatus: true },
  });
  if (!invoice?.invoiceNumber || !invoiceEmailLifecycleAllowed(invoice.lifecycleStatus)) throw new InvoiceEmailError("Only issued invoices can be emailed.");

  const env = dependencies.env ?? process.env;
  let sender;
  let smtpConfiguration;
  try {
    sender = getInvoiceEmailSender(env);
    smtpConfiguration = getSmtpConfiguration(env);
  } catch (error) {
    if (error instanceof InvoiceEmailConfigurationError) throw error;
    throw new InvoiceEmailConfigurationError();
  }

  const attempt = await prisma.invoiceEmailAttempt.create({
    data: {
      organizationId,
      invoiceId,
      requestedByUserId: actor.userId,
      requestedByEmailSnapshot: actor.email,
      fromEmail: sender.email,
      fromName: sender.name,
      toRecipients: recipients.to,
      ccRecipients: recipients.cc,
      bccRecipients: recipients.bcc,
      subject,
      bodyText,
    },
    select: { id: true },
  });

  let stage: "PDF" | "SMTP" = "PDF";
  let providerMessageId: string | null = null;
  let acceptedRecipients: string[] = [];
  let rejectedRecipients: string[] = [];
  try {
    const pdf = await (dependencies.pdfGenerator ?? generateIssuedInvoicePdf)(organizationId, invoiceId);
    stage = "SMTP";
    const transport = (dependencies.transportFactory ?? createInvoiceEmailTransport)(smtpConfiguration);
    const message: OutgoingInvoiceEmail = {
      from: { name: sender.name, address: sender.email },
      to: recipients.to,
      ...(recipients.cc.length ? { cc: recipients.cc } : {}),
      ...(recipients.bcc.length ? { bcc: recipients.bcc } : {}),
      subject,
      text: bodyText,
      attachments: [{ filename: pdf.filename, content: pdf.bytes, contentType: "application/pdf" }],
    };
    const result = await transport.sendMail(message);
    acceptedRecipients = (result.accepted ?? []).map(normalizeResultRecipient);
    rejectedRecipients = (result.rejected ?? []).map(normalizeResultRecipient);
    if (acceptedRecipients.length === 0) throw new Error("NO_RECIPIENTS_ACCEPTED");
    providerMessageId = sanitizeProviderMessageId(result.messageId);
  } catch {
    const failedAt = (dependencies.now ?? (() => new Date()))();
    const pdfFailure = stage === "PDF";
    const safeFailureMessage = pdfFailure
      ? "The official invoice PDF could not be prepared. No invoice data was changed."
      : "We couldn't send the invoice email. No invoice data was changed. You can review the recipients and try again.";
    const failureUpdate = await prisma.invoiceEmailAttempt.updateMany({
      where: { organizationId, id: attempt.id, status: "PENDING" },
      data: {
        status: "FAILED",
        failedAt,
        failureCode: pdfFailure ? "PDF_GENERATION_FAILED" : "SMTP_SEND_FAILED",
        safeFailureMessage,
        acceptedRecipients,
        rejectedRecipients,
      },
    });
    if (failureUpdate.count !== 1) throw new InvoiceEmailError("The invoice email attempt could not be recorded.");
    throw new InvoiceEmailError(safeFailureMessage);
  }

  const sentAt = (dependencies.now ?? (() => new Date()))();
  const partial = rejectedRecipients.length > 0;
  const safeFailureMessage = partial
    ? "The invoice was delivered to some recipients, but one or more addresses were rejected. Review the delivery details before sending again."
    : null;
  const sentUpdate = await prisma.invoiceEmailAttempt.updateMany({
    where: { organizationId, id: attempt.id, status: "PENDING" },
    data: {
      status: partial ? "PARTIALLY_SENT" : "SENT",
      sentAt,
      ...(partial ? { failedAt: sentAt, failureCode: "PARTIAL_RECIPIENT_REJECTION", safeFailureMessage } : {}),
      providerMessageId,
      acceptedRecipients,
      rejectedRecipients,
    },
  });
  if (sentUpdate.count !== 1) {
    throw new InvoiceEmailError("The email may have been accepted, but its send status could not be recorded. Contact an administrator before retrying.");
  }
  if (partial) throw new InvoiceEmailError(safeFailureMessage!);
  return { attemptId: attempt.id, providerMessageId };
}

export function invoiceEmailLifecycleAllowed(status: string): boolean {
  return status === "ISSUED";
}

function sanitizeProviderMessageId(value: string | undefined): string | null {
  if (!value) return null;
  const safe = value.replace(/[\r\n\u0000-\u001f\u007f]/g, "").slice(0, 500);
  return safe || null;
}

function normalizeResultRecipient(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase();
  if (value && typeof value === "object" && "address" in value && typeof value.address === "string") return value.address.toLowerCase();
  return "unknown";
}
