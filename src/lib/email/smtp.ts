import "server-only";

import nodemailer from "nodemailer";
import { isValidEmailAddress } from "./recipients";

export class InvoiceEmailConfigurationError extends Error {
  constructor(message = "Invoice email is not configured. Contact an administrator.") {
    super(message);
    this.name = "InvoiceEmailConfigurationError";
  }
}

export type InvoiceEmailSender = Readonly<{ email: string; name: string }>;
export type InvoiceEmailEnvironment = Readonly<Record<string, string | undefined>>;
export type SmtpConfiguration = Readonly<{ host: string; port: number; secure: boolean; user: string; password: string }>;
export type OutgoingInvoiceEmail = Readonly<{
  from: { name: string; address: string };
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  attachments: { filename: string; content: Uint8Array; contentType: "application/pdf" }[];
}>;
export type InvoiceEmailTransport = Readonly<{
  sendMail(message: OutgoingInvoiceEmail): Promise<Readonly<{ messageId?: string; accepted?: readonly unknown[]; rejected?: readonly unknown[] }>>;
}>;

export function getInvoiceEmailSender(env: InvoiceEmailEnvironment = process.env): InvoiceEmailSender {
  const email = env.INVOICE_FROM_EMAIL?.trim() ?? "";
  const name = env.INVOICE_FROM_NAME?.trim() || "Hiiiive";
  if (!isValidEmailAddress(email) || /[\r\n\u0000]/.test(name) || name.length > 120) {
    throw new InvoiceEmailConfigurationError();
  }
  return { email, name };
}

export function getInvoiceEmailSenderDisplay(env: InvoiceEmailEnvironment = process.env): Readonly<{ value: string; configured: boolean; sender: InvoiceEmailSender | null }> {
  try {
    const sender = getInvoiceEmailSender(env);
    return { value: `${sender.name} <${sender.email}>`, configured: true, sender };
  } catch {
    return { value: "Sender configuration required", configured: false, sender: null };
  }
}

export function getSmtpConfiguration(env: InvoiceEmailEnvironment = process.env): SmtpConfiguration {
  const host = env.SMTP_HOST?.trim() ?? "";
  const portText = env.SMTP_PORT?.trim() ?? "";
  const secureText = env.SMTP_SECURE?.trim().toLowerCase();
  const user = env.SMTP_USER?.trim() ?? "";
  const password = env.SMTP_PASSWORD ?? "";
  const port = Number(portText);
  if (!host || host.length > 253 || /[\s\r\n/@]/.test(host)
    || !Number.isInteger(port) || port < 1 || port > 65_535
    || (secureText !== "true" && secureText !== "false")
    || !user || !password) {
    throw new InvoiceEmailConfigurationError();
  }
  return { host, port, secure: secureText === "true", user, password };
}

/** Transport creation is lazy: module import, tests, and builds need no SMTP settings. */
export function createInvoiceEmailTransport(configuration: SmtpConfiguration): InvoiceEmailTransport {
  const transporter = nodemailer.createTransport({
    host: configuration.host,
    port: configuration.port,
    secure: configuration.secure,
    ...(configuration.secure ? {} : { requireTLS: true }),
    auth: { user: configuration.user, pass: configuration.password },
  });
  return {
    async sendMail(message) {
      const result = await transporter.sendMail({
        from: { name: message.from.name, address: message.from.address },
        to: message.to,
        ...(message.cc?.length ? { cc: message.cc } : {}),
        ...(message.bcc?.length ? { bcc: message.bcc } : {}),
        subject: message.subject,
        text: message.text,
        attachments: message.attachments.map((attachment) => ({
          filename: attachment.filename,
          content: Buffer.from(attachment.content),
          contentType: attachment.contentType,
        })),
      });
      return { messageId: result.messageId, accepted: result.accepted, rejected: result.rejected };
    },
  };
}
