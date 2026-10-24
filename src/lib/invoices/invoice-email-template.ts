import { formatAmount, formatInvoiceDate } from "../invoice-templates/config";

export type InvoiceEmailTemplateData = Readonly<{
  invoiceNumber: string;
  projectTitle: string | null;
  clientName: string;
  currencyCode: string;
  grandTotal: string;
  invoiceDate: string;
  dueDate: string | null;
  paymentTerms: string | null;
}>;

export type InvoiceEmailSender = Readonly<{ email?: string; name: string }>;
export type InvoiceEmailContent = Readonly<{ subject: string; bodyText: string }>;

export function buildInvoiceEmailDefaults(invoice: InvoiceEmailTemplateData, sender: InvoiceEmailSender): InvoiceEmailContent {
  const projectTitle = oneLine(invoice.projectTitle);
  const subjectBase = projectTitle
    ? `Invoice ${invoice.invoiceNumber} – ${projectTitle} – Hiiiive`
    : `Invoice ${invoice.invoiceNumber} – Hiiiive`;
  const subject = subjectBase.slice(0, 200);
  const lines = [
    `Dear ${oneLine(invoice.clientName)},`,
    "",
    `Please find attached Invoice ${invoice.invoiceNumber}${projectTitle ? ` for ${projectTitle}` : ""}.`,
    "",
    `Invoice Amount: ${invoice.currencyCode} ${formatAmount(invoice.grandTotal)}`,
    `Invoice Date: ${formatInvoiceDate(invoice.invoiceDate)}`,
    ...(invoice.paymentTerms?.trim() ? [`Payment Terms: ${oneLine(invoice.paymentTerms)}`] : []),
    ...(invoice.dueDate ? [`Due Date: ${formatInvoiceDate(invoice.dueDate)}`] : []),
    "",
    "Kindly review the attached invoice and let us know if you require any clarification.",
    "",
    "Thank you.",
    "",
    "Best Regards,",
    oneLine(sender.name),
    ...(sender.email ? [sender.email] : []),
  ];
  return { subject, bodyText: lines.join("\n") };
}

export function validateInvoiceEmailSubject(value: unknown): string {
  if (typeof value !== "string") throw new Error("Subject must be text.");
  const subject = value.trim();
  if (!subject) throw new Error("Subject is required.");
  if (/[\r\n]/.test(subject)) throw new Error("Subject cannot contain line breaks.");
  if (subject.length > 200) throw new Error("Subject cannot exceed 200 characters.");
  return subject;
}

export function validateInvoiceEmailBody(value: unknown): string {
  if (typeof value !== "string") throw new Error("Message must be text.");
  if (!value.trim()) throw new Error("Message is required.");
  if (value.length > 10_000) throw new Error("Message cannot exceed 10,000 characters.");
  return value;
}

function oneLine(value: string | null | undefined): string {
  return (value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}
