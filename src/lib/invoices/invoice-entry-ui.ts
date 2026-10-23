export type InvoiceFormItem = {
  billingMode: "QUANTITY" | "FLAT_FEE";
  serviceId: string | null;
  description: string;
  useServiceDefaultPrice?: boolean;
} & (
  | { billingMode: "QUANTITY"; quantity: string; unitPrice?: string }
  | { billingMode: "FLAT_FEE"; amount?: string }
);

export type InvoiceEntryItemState = {
  billingMode: "QUANTITY" | "FLAT_FEE";
  serviceId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  useServiceDefaultPrice: boolean;
};

export const DEFAULT_INVOICE_BILLING_MODE = "QUANTITY" as const;

export type InvoiceDraftFormPayload = {
  clientId: string;
  projectTitle: string;
  invoiceDate: string;
  dueDate: string;
  currencyCode: string;
  discountLabel: string;
  discountAmount: string;
  notes: string;
  paymentTerms: string;
  items: InvoiceFormItem[];
};

export function currencyChangeWarningVisible(changed: boolean, itemCount: number): boolean {
  return changed && itemCount > 0;
}

export function itemHasMeaningfulContent(item: InvoiceEntryItemState): boolean {
  return Boolean(item.serviceId || item.description.trim() ||
    (item.billingMode === "FLAT_FEE" ? item.amount.trim() : item.unitPrice.trim()));
}

const CANONICAL_MONEY_PATTERN = /^\d+(?:\.\d{1,4})?$/;
const GROUPED_MONEY_PATTERN = /^\d{1,3}(?:,\d{3})+(?:\.\d{1,4})?$/;

/** Remove only valid thousands grouping; malformed text stays intact for server validation. */
export function normalizeMoneyInput(value: string): string {
  const normalized = value.trim();
  if (CANONICAL_MONEY_PATTERN.test(normalized)) return normalized;
  return GROUPED_MONEY_PATTERN.test(normalized) ? normalized.replaceAll(",", "") : value;
}

/** Format a canonical decimal string for display without converting it to a JS number. */
export function formatMoneyDisplay(value: string): string {
  if (!CANONICAL_MONEY_PATTERN.test(value)) return value;
  const [whole = "", fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

export function devInvoiceEntryAvailable(environment: string | undefined): boolean {
  return environment !== "production";
}

export function servicePriceGuidance(serviceCurrency: string, invoiceCurrency: string): string | null {
  return serviceCurrency.toUpperCase() === invoiceCurrency.toUpperCase()
    ? null
    : `Default price is in ${serviceCurrency.toUpperCase()}. Enter ${invoiceCurrency.toUpperCase()} price manually.`;
}

export function resolveServiceDefaultPrice(
  enteredPrice: string,
  defaultPrice: string | null,
  serviceCurrency: string,
  invoiceCurrency: string,
): string {
  if (enteredPrice.trim() !== "") return enteredPrice;
  if (defaultPrice !== null && serviceCurrency.toUpperCase() === invoiceCurrency.toUpperCase()) return defaultPrice;
  return enteredPrice;
}

/** A deliberate mode switch preserves both sets of entered numbers without converting either. */
export function switchInvoiceItemBillingMode(
  item: InvoiceEntryItemState,
  billingMode: "QUANTITY" | "FLAT_FEE",
): InvoiceEntryItemState {
  return { ...item, billingMode, useServiceDefaultPrice: false };
}

export function mapDraftItemToEntryState(item: {
  billingMode?: "QUANTITY" | "FLAT_FEE";
  serviceId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  amount?: string | null;
}): InvoiceEntryItemState {
  const billingMode = item.billingMode ?? "QUANTITY";
  return {
    billingMode,
    serviceId: item.serviceId,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    amount: billingMode === "FLAT_FEE" ? item.amount ?? item.unitPrice : item.amount ?? "",
    useServiceDefaultPrice: false,
  };
}

export function entryItemToPreviewItem(item: InvoiceEntryItemState): InvoiceFormItem {
  const common = { serviceId: item.serviceId, description: item.description };
  return item.billingMode === "FLAT_FEE"
    ? { ...common, billingMode: "FLAT_FEE", amount: item.amount }
    : { ...common, billingMode: "QUANTITY", quantity: item.quantity, unitPrice: item.unitPrice };
}

/** Parse only editable form fields. Extra client properties, including tenant IDs and totals, are ignored. */
export function parseInvoiceDraftFormPayload(value: unknown): InvoiceDraftFormPayload {
  if (typeof value !== "object" || value === null) throw new Error("Invoice form data is invalid.");
  const form = value as Record<string, unknown>;
  const text = (key: string): string => {
    const field = form[key];
    if (typeof field !== "string") throw new Error(`Invoice field ${key} is invalid.`);
    return field;
  };
  if (!Array.isArray(form.items) || form.items.length === 0) throw new Error("Add at least one invoice item.");
  const items = form.items.map((raw, index): InvoiceFormItem => {
    if (typeof raw !== "object" || raw === null) throw new Error(`Invoice item ${index + 1} is invalid.`);
    const item = raw as Record<string, unknown>;
    if (typeof item.description !== "string") throw new Error(`Complete the description for item ${index + 1}.`);
    if (item.serviceId !== null && typeof item.serviceId !== "string") throw new Error(`Invoice item ${index + 1} service is invalid.`);
    const useServiceDefaultPrice = item.useServiceDefaultPrice === true;
    const serviceFields = {
      serviceId: item.serviceId as string | null,
      description: item.description,
      ...(useServiceDefaultPrice ? { useServiceDefaultPrice: true } : {}),
    };
    if (item.billingMode === "FLAT_FEE") {
      if (item.amount !== undefined && typeof item.amount !== "string") throw new Error(`Invoice item ${index + 1} amount is invalid.`);
      if (item.amount === undefined && !useServiceDefaultPrice) throw new Error(`Enter an amount for item ${index + 1}.`);
      return { ...serviceFields, billingMode: "FLAT_FEE", ...(item.amount !== undefined ? { amount: normalizeMoneyInput(item.amount) } : {}) };
    }
    if (item.billingMode !== undefined && item.billingMode !== "QUANTITY") throw new Error(`Invoice item ${index + 1} billing method is invalid.`);
    if (typeof item.quantity !== "string" || (item.unitPrice !== undefined && typeof item.unitPrice !== "string")) {
      throw new Error(`Complete the quantity and unit price for item ${index + 1}.`);
    }
    if (item.unitPrice === undefined && !useServiceDefaultPrice) throw new Error(`Enter a unit price for item ${index + 1}.`);
    return {
      ...serviceFields,
      billingMode: "QUANTITY",
      quantity: item.quantity,
      ...(item.unitPrice !== undefined ? { unitPrice: normalizeMoneyInput(item.unitPrice) } : {}),
    };
  });
  return {
    clientId: text("clientId"),
    projectTitle: text("projectTitle"),
    invoiceDate: text("invoiceDate"),
    dueDate: text("dueDate"),
    currencyCode: text("currencyCode"),
    discountLabel: text("discountLabel"),
    discountAmount: normalizeMoneyInput(text("discountAmount")),
    notes: text("notes"),
    paymentTerms: text("paymentTerms"),
    items,
  };
}

function scaledDecimal(value: string, scale: number): bigint | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,4})?$/.test(normalized)) return null;
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  if (fraction.length > scale) return null;
  const digits = BigInt(whole) * BigInt(10) ** BigInt(scale) + BigInt((fraction + "0".repeat(scale)).slice(0, scale) || "0");
  return negative ? -digits : digits;
}

function decimalString(value: bigint, scale: number): string {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const base = BigInt(10) ** BigInt(scale);
  const whole = absolute / base;
  const fraction = (absolute % base).toString().padStart(scale, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** Preview uses the server's four-decimal ROUND_HALF_UP line rounding with integer arithmetic. */
export function calculateInvoicePreview(items: readonly InvoiceFormItem[], discountAmount: string) {
  const amountUnitsFor = (item: InvoiceFormItem): bigint | null => {
    if (item.billingMode === "FLAT_FEE") return scaledDecimal(item.amount ?? "", 4);
    const quantity = scaledDecimal(item.quantity, 4);
    const unitPrice = scaledDecimal(item.unitPrice ?? "", 4);
    if (quantity === null || unitPrice === null || quantity <= BigInt(0)) return null;
    const product = quantity * unitPrice;
    const divisor = BigInt(10000);
    const quotient = product / divisor;
    const remainder = product % divisor;
    return quotient + (remainder >= BigInt(5000) ? BigInt(1) : BigInt(0));
  };
  const subtotalUnits = items.reduce((sum, item) => sum + (amountUnitsFor(item) ?? BigInt(0)), BigInt(0));
  const parsedDiscount = scaledDecimal(discountAmount, 4);
  const discountValid = parsedDiscount !== null;
  const discountUnits = parsedDiscount ?? BigInt(0);
  return {
    subtotal: decimalString(subtotalUnits, 4),
    discount: discountValid ? decimalString(discountUnits, 4) : "—",
    discountValid,
    payable: discountValid ? decimalString(subtotalUnits - discountUnits, 4) : "—",
    amountFor: (item: InvoiceFormItem) => {
      const amount = amountUnitsFor(item);
      return amount === null ? "—" : decimalString(amount, 4);
    },
  };
}
