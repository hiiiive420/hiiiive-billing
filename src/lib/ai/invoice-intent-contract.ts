export type InvoiceIntentItem = Readonly<{
  billingMode: "QUANTITY" | "FLAT_FEE";
  serviceHint: string | null;
  description: string | null;
  quantity: string | null;
  unitPrice: string | null;
  amount: string | null;
}>;

export type InvoiceIntent = Readonly<{
  clientHint: string | null;
  projectTitle: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  dueInDays: number | null;
  currencyCode: string | null;
  discountLabel: string | null;
  discountAmount: string | null;
  paymentTerms: string | null;
  notes: string | null;
  items: readonly InvoiceIntentItem[];
  ambiguities: readonly string[];
  missingInformation: readonly string[];
}>;

export type InvoiceIntentSuggestion = Readonly<{
  intent: InvoiceIntent;
  resolvedClient: Readonly<{ id: string; displayName: string }> | null;
  resolvedServices: readonly Readonly<{
    itemIndex: number;
    service: Readonly<{ id: string; name: string }> | null;
  }>[];
  ambiguities: readonly string[];
  missingInformation: readonly string[];
}>;

export type InvoiceIntentActionResult =
  | Readonly<{ ok: true; suggestion: InvoiceIntentSuggestion }>
  | Readonly<{ ok: false; error: string }>;
