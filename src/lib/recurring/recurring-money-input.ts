/** Convert display-grouped money into the canonical decimal strings used by Prisma Decimal. */
export class RecurringMoneyInputError extends Error {
  constructor(message: string) { super(message); this.name = "RecurringMoneyInputError"; }
}

export function normalizeRecurringMoneyInput(value: string, label: string): string {
  const trimmed = value.trim();
  if (/^-?\d+(?:\.\d{1,4})?$/.test(trimmed)) return trimmed;
  if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d{1,4})?$/.test(trimmed)) return trimmed.replaceAll(",", "");
  throw new RecurringMoneyInputError(label);
}
