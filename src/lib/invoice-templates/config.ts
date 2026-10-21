export type HiiiiveTemplateConfig = Readonly<{
  companyName: string;
  bankName?: string;
  accountName?: string;
  accountNumber?: string;
  headingFontName: string;
  bodyFontName: string;
  primaryColor: string;
  currencyDisplayLabel: string;
  footerNote?: string;
}>;

export type InvoiceLineView = Readonly<{
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}>;

export type InvoiceView = Readonly<{
  invoiceNumber: string;
  projectTitle?: string | null;
  invoiceDate: string;
  clientName: string;
  clientBillingAddress?: string | null;
  currencyCode: string;
  items: readonly InvoiceLineView[];
  subtotal: string;
  discountLabel?: string | null;
  discountAmount: string;
  grandTotal: string;
  notes?: string | null;
}>;

export class TemplateConfigError extends Error {
  constructor() {
    super("The invoice template configuration is invalid.");
    this.name = "TemplateConfigError";
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

export function isHiiiiveTemplateConfig(value: unknown): value is HiiiiveTemplateConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const config = value as Record<string, unknown>;
  return nonEmptyString(config.companyName)
    && optionalString(config.bankName)
    && optionalString(config.accountName)
    && optionalString(config.accountNumber)
    && nonEmptyString(config.headingFontName)
    && /^[A-Za-z0-9 ,-]{1,60}$/.test(config.headingFontName)
    && nonEmptyString(config.bodyFontName)
    && /^[A-Za-z0-9 ,-]{1,60}$/.test(config.bodyFontName)
    && typeof config.primaryColor === "string"
    && /^#[0-9A-Fa-f]{6}$/.test(config.primaryColor)
    && nonEmptyString(config.currencyDisplayLabel)
    && optionalString(config.footerNote);
}

export function parseHiiiiveTemplateConfig(value: unknown): HiiiiveTemplateConfig {
  if (!isHiiiiveTemplateConfig(value)) throw new TemplateConfigError();
  return value;
}

/** Formats decimal text without converting financial values to binary floats. */
export function formatAmount(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new TypeError("Amount must be a decimal string.");
  const [, sign, integerDigits, fractionDigits = ""] = match;
  const scaled = BigInt(integerDigits) * BigInt(100) + BigInt((fractionDigits + "000").slice(0, 2));
  const shouldRoundUp = Number(fractionDigits[2] ?? "0") >= 5;
  const rounded = shouldRoundUp ? scaled + BigInt(1) : scaled;
  const whole = (rounded / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (rounded % BigInt(100)).toString().padStart(2, "0");
  const displayedSign = sign === "-" && rounded !== BigInt(0) ? "-" : "";
  return `${displayedSign}${whole}.${cents}`;
}

export function formatCurrencyAmount(value: string, currencyLabel: string): string {
  return `${currencyLabel} ${formatAmount(value)}`;
}
export function formatInvoiceDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) throw new TypeError("Invoice date must begin with an ISO calendar date.");
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(date);
}

export function isZeroDecimal(value: string): boolean {
  return /^[-+]?0*(?:\.0*)?$/.test(value.trim());
}
