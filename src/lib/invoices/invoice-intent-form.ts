import type { InvoiceIntentSuggestion } from "../ai/invoice-intent-contract";
import type { InvoiceEntryClientDisplay, InvoiceEntryItemState } from "./invoice-entry-ui";

export type InvoiceIntentFormPatch = Readonly<{
  clientQuery: string;
  selectedClient: InvoiceEntryClientDisplay | null;
  projectTitle: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  discountLabel: string;
  discountAmount: string;
  notes: string;
  paymentTerms: string;
  items: readonly (InvoiceEntryItemState & { key: string; position: number; serviceQuery: string; selectedService: null })[];
}>;

export function mapInvoiceIntentSuggestionToForm(
  suggestion: InvoiceIntentSuggestion,
  currentDate: string,
): InvoiceIntentFormPatch {
  const { intent } = suggestion;
  const selectedClient = suggestion.resolvedClient
    ? { id: suggestion.resolvedClient.id, name: suggestion.resolvedClient.displayName, billingAddress: null, email: null, phone: null, active: true }
    : null;
  const serviceByItem = new Map(suggestion.resolvedServices.map((entry) => [entry.itemIndex, entry.service]));
  const items = intent.items.map((item, index) => {
    const service = serviceByItem.get(index) ?? null;
    return {
      key: `ai-item-${index}`,
      position: index,
      billingMode: item.billingMode,
      serviceId: service?.id ?? null,
      serviceQuery: service?.name ?? item.serviceHint ?? "",
      selectedService: null,
      description: item.description ?? item.serviceHint ?? "",
      quantity: item.billingMode === "QUANTITY" ? item.quantity ?? "" : "1",
      unitPrice: item.billingMode === "QUANTITY" ? item.unitPrice ?? "" : "",
      amount: item.billingMode === "FLAT_FEE" ? item.amount ?? "" : "",
      useServiceDefaultPrice: false,
    };
  });
  if (items.length === 0) {
    items.push({
      key: "ai-item-0", position: 0, billingMode: "QUANTITY", serviceId: null, serviceQuery: "", selectedService: null,
      description: "", quantity: "", unitPrice: "", amount: "", useServiceDefaultPrice: false,
    });
  }
  // A validated explicit dueDate always wins when both dueDate and dueInDays are supplied.
  const baseDate = intent.invoiceDate ?? currentDate;
  const dueDate = intent.dueDate ?? (intent.dueInDays === null ? "" : addDays(baseDate, intent.dueInDays));
  return {
    clientQuery: selectedClient?.name ?? intent.clientHint ?? "",
    selectedClient,
    projectTitle: intent.projectTitle ?? "",
    invoiceDate: intent.invoiceDate ?? "",
    dueDate,
    currency: intent.currencyCode ?? "",
    discountLabel: intent.discountLabel ?? "",
    discountAmount: intent.discountAmount ?? "0",
    notes: intent.notes ?? "",
    paymentTerms: intent.paymentTerms ?? "",
    items,
  };
}

function addDays(isoDate: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || !Number.isSafeInteger(days) || days < 0) return "";
  let [year, month, day] = isoDate.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year!, month!)) return "";
  for (let remaining = days; remaining > 0; remaining -= 1) {
    day! += 1;
    if (day! > daysInMonth(year!, month!)) {
      day = 1;
      month! += 1;
      if (month! > 12) { month = 1; year! += 1; }
    }
  }
  if (year! > 9999) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
