export class InvoiceCurrencyCodeError extends Error {
  constructor() {
    super("Invoice currency code must contain exactly three ASCII letters.");
    this.name = "InvoiceCurrencyCodeError";
  }
}

/** Validates the ISO-style three-letter format used by MVP and normalizes case. */
export function normalizeInvoiceCurrencyCode(value: unknown): string {
  if (typeof value !== "string" || value.length !== 3 || !/^[A-Za-z]{3}$/.test(value)) {
    throw new InvoiceCurrencyCodeError();
  }
  return value.toUpperCase();
}
