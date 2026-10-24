export type InvoiceRecipients = Readonly<{ to: string[]; cc: string[]; bcc: string[] }>;

export class RecipientValidationError extends Error {
  constructor(message: string) { super(message); this.name = "RecipientValidationError"; }
}

const MAX_RECIPIENTS = 50;
const MAX_FIELD_LENGTH = 4_000;

export function isValidEmailAddress(value: string): boolean {
  if (value.length > 254 || /[\r\n\s,;<>]/.test(value)) return false;
  const at = value.lastIndexOf("@");
  if (at < 1 || at > 64 || at === value.length - 1) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  if (!/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;
  return domain.split(".").every((label) => label.length > 0 && label.length <= 63
    && /^[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?$/i.test(label));
}

export function parseInvoiceRecipients(input: Readonly<{ to: unknown; cc?: unknown; bcc?: unknown }>): InvoiceRecipients {
  const to = parseField(input.to, "To");
  const cc = parseField(input.cc ?? "", "CC");
  const bcc = parseField(input.bcc ?? "", "BCC");
  if (to.length === 0) throw new RecipientValidationError("Add at least one To recipient.");
  if (to.length + cc.length + bcc.length > MAX_RECIPIENTS) {
    throw new RecipientValidationError(`Use no more than ${MAX_RECIPIENTS} recipients across To, CC, and BCC.`);
  }
  return { to, cc, bcc };
}

function parseField(value: unknown, label: string): string[] {
  if (typeof value !== "string") throw new RecipientValidationError(`${label} recipients must be text.`);
  if (value.length > MAX_FIELD_LENGTH) throw new RecipientValidationError(`${label} recipients are too long.`);
  const entries = value.split(/[;,\r\n]+/).map((email) => email.trim().toLowerCase()).filter(Boolean);
  const unique = [...new Set(entries)];
  for (const email of unique) {
    if (!isValidEmailAddress(email)) throw new RecipientValidationError(`Enter valid email addresses in ${label}.`);
  }
  return unique;
}
