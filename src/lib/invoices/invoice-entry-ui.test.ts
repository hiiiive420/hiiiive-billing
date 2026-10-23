import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateInvoicePreview,
  DEFAULT_INVOICE_BILLING_MODE,
  currencyChangeWarningVisible,
  formatMoneyDisplay,
  itemHasMeaningfulContent,
  devInvoiceEntryAvailable,
  mapDraftItemToEntryState,
  mapDraftInvoiceToEntryInitialState,
  normalizeMoneyInput,
  parseInvoiceDraftFormPayload,
  resolveServiceDefaultPrice,
  servicePriceGuidance,
  switchInvoiceItemBillingMode,
} from "./invoice-entry-ui";

describe("invoice entry form helpers", () => {
  it("shows a currency change warning only when items are present", () => {
    assert.equal(currencyChangeWarningVisible(true, 1), true);
    assert.equal(currencyChangeWarningVisible(true, 0), false);
    assert.equal(currencyChangeWarningVisible(false, 2), false);
  });

  it("ignores an untouched initial item when deciding whether currency warning applies", () => {
    const empty = { billingMode: "QUANTITY" as const, serviceId: null, description: "", quantity: "1", unitPrice: "", amount: "", useServiceDefaultPrice: false };
    assert.equal(itemHasMeaningfulContent(empty), false);
    assert.equal(itemHasMeaningfulContent({ ...empty, description: "Design" }), true);
  });

  it("keeps the invoice entry route unavailable in production", () => {
    assert.equal(devInvoiceEntryAvailable("production"), false);
    assert.equal(devInvoiceEntryAvailable("development"), true);
  });

  it("keeps initial billing mode deterministic and formats money without floating point", () => {
    assert.equal(DEFAULT_INVOICE_BILLING_MODE, "QUANTITY");
    assert.equal(formatMoneyDisplay("25000"), "25,000");
    assert.equal(formatMoneyDisplay("1000000"), "1,000,000");
    assert.equal(formatMoneyDisplay("1234.5"), "1,234.5");
    assert.equal(formatMoneyDisplay("1234.5678"), "1,234.5678");
    assert.equal(normalizeMoneyInput("25,000"), "25000");
    assert.equal(normalizeMoneyInput("1,234.5678"), "1234.5678");
    assert.equal(normalizeMoneyInput("1,00"), "1,00");
    const preview = calculateInvoicePreview([{
      billingMode: "QUANTITY", serviceId: null, description: "", quantity: "1", unitPrice: normalizeMoneyInput("1,000,000"),
    }], "0");
    assert.equal(preview.subtotal, "1000000");
    assert.equal(formatMoneyDisplay(preview.subtotal), "1,000,000");
  });

  it("requires manual price entry for mismatched service currencies", () => {
    assert.equal(servicePriceGuidance("usd", "LKR"), "Default price is in USD. Enter LKR price manually.");
    assert.equal(servicePriceGuidance("lkr", "LKR"), null);
    assert.equal(resolveServiceDefaultPrice("", "25.00", "USD", "LKR"), "");
    assert.equal(resolveServiceDefaultPrice("", "25.00", "LKR", "LKR"), "25.00");
    assert.equal(resolveServiceDefaultPrice("19.00", "25.00", "LKR", "LKR"), "19.00");
  });

  it("keeps free-text items and ignores untrusted organization IDs and totals", () => {
    const form = parseInvoiceDraftFormPayload({
      clientId: "client-1", projectTitle: "", invoiceDate: "", dueDate: "", currencyCode: "LKR",
      discountLabel: "", discountAmount: "0", notes: "", paymentTerms: "",
      organizationId: "attacker-org", subtotal: "0", grandTotal: "0", lifecycleStatus: "ISSUED",
      items: [{ serviceId: null, description: "Custom work", quantity: "1", unitPrice: "12.50", lineTotal: "0" }],
    });
    assert.deepEqual(form.items, [{ serviceId: null, description: "Custom work", billingMode: "QUANTITY", quantity: "1", unitPrice: "12.50" }]);
    assert.equal("organizationId" in form, false);
    assert.equal("grandTotal" in form, false);
  });

  it("keeps flat-fee payloads limited to editable amount fields and preserves quantity mode payloads", () => {
    const flat = parseInvoiceDraftFormPayload({
      clientId: "client-1", projectTitle: "", invoiceDate: "", dueDate: "", currencyCode: "LKR",
      discountLabel: "", discountAmount: "0", notes: "", paymentTerms: "",
      items: [{ billingMode: "FLAT_FEE", serviceId: null, description: "Monthly", amount: "55000", quantity: "1", unitPrice: "55000", lineTotal: "55000" }],
    });
    assert.deepEqual(flat.items, [{ billingMode: "FLAT_FEE", serviceId: null, description: "Monthly", amount: "55000" }]);
    const quantity = parseInvoiceDraftFormPayload({
      clientId: "client-1", projectTitle: "", invoiceDate: "", dueDate: "", currencyCode: "LKR",
      discountLabel: "", discountAmount: "0", notes: "", paymentTerms: "",
      items: [{ serviceId: null, description: "Four posters", quantity: "4", unitPrice: "1500" }],
    });
    assert.deepEqual(quantity.items, [{ billingMode: "QUANTITY", serviceId: null, description: "Four posters", quantity: "4", unitPrice: "1500" }]);
  });

  it("normalizes grouped money in the canonical draft payload", () => {
    const form = parseInvoiceDraftFormPayload({
      clientId: "client-1", projectTitle: "", invoiceDate: "", dueDate: "", currencyCode: "LKR",
      discountLabel: "", discountAmount: "1,000", notes: "", paymentTerms: "",
      items: [
        { billingMode: "FLAT_FEE", serviceId: null, description: "Monthly", amount: "55,000" },
        { billingMode: "QUANTITY", serviceId: null, description: "Extra", quantity: "1.3333", unitPrice: "10,000.5" },
      ],
    });
    assert.equal(form.discountAmount, "1000");
    assert.deepEqual(form.items.map((item) => item.billingMode === "FLAT_FEE" ? item.amount : item.unitPrice), ["55000", "10000.5"]);
    assert.equal(JSON.stringify(form).includes(",000"), false);
  });

  it("switches billing modes without converting either mode's entered amounts", () => {
    const quantity = { billingMode: "QUANTITY" as const, serviceId: null, description: "Item", quantity: "4", unitPrice: "1500", amount: "55000", useServiceDefaultPrice: false };
    const flat = switchInvoiceItemBillingMode(quantity, "FLAT_FEE");
    assert.equal(flat.billingMode, "FLAT_FEE");
    assert.equal(flat.amount, "55000");
    assert.equal(flat.quantity, "4");
    assert.equal(flat.unitPrice, "1500");
    const mapped = mapDraftItemToEntryState({ billingMode: "FLAT_FEE", serviceId: null, description: "Monthly", quantity: "1", unitPrice: "55000", amount: "55000" });
    assert.equal(mapped.billingMode, "FLAT_FEE");
    assert.equal(mapped.amount, "55000");
  });

  it("maps saved draft values, item modes, service details, positions, and currency deterministically", () => {
    const initial = mapDraftInvoiceToEntryInitialState({
      id: "draft-1",
      client: { id: "client-1", name: "Acme", billingAddress: "1 Main St", email: "billing@acme.test", phone: "555-0100", active: true },
      projectTitle: "October work",
      invoiceDate: "2026-10-01",
      dueDate: "2026-10-15",
      currencyCode: "USD",
      discountLabel: "Courtesy",
      discountAmount: "1234.5678",
      notes: "Keep exact values",
      paymentTerms: "14 days",
      items: [
        {
          id: "item-quantity", billingMode: "QUANTITY", serviceId: "service-1", description: "Saved quantity",
          quantity: "1.3333", unitPrice: "25000.1234", amount: null, position: 4,
          service: { id: "service-1", name: "Current service", description: null, defaultUnitPrice: "999999.1234", currencyCode: "CAD" },
        },
        {
          id: "item-flat", billingMode: "FLAT_FEE", serviceId: null, description: "Saved flat fee",
          quantity: "1", unitPrice: "55000", amount: "55000", position: 9, service: null,
        },
      ],
    });
    assert.equal(initial.clientQuery, "Acme");
    assert.equal(initial.selectedClient.id, "client-1");
    assert.equal(initial.projectTitle, "October work");
    assert.equal(initial.invoiceDate, "2026-10-01");
    assert.equal(initial.currency, "USD");
    assert.equal(initial.originalCurrency, "USD");
    assert.equal(initial.currencyChanged, false);
    assert.equal(initial.discountAmount, "1234.5678");
    assert.equal(initial.items[0]?.billingMode, "QUANTITY");
    assert.equal(initial.items[0]?.unitPrice, "25000.1234");
    assert.equal(initial.items[0]?.selectedService?.defaultUnitPrice, "999999.1234");
    assert.equal(initial.items[0]?.useServiceDefaultPrice, false);
    assert.equal(initial.items[0]?.position, 4);
    assert.equal(initial.items[1]?.billingMode, "FLAT_FEE");
    assert.equal(initial.items[1]?.amount, "55000");
    assert.equal(initial.items[1]?.position, 9);
  });

  it("rounds each quantity line to four decimals using ROUND_HALF_UP before subtotal", () => {
    const regression = { billingMode: "QUANTITY" as const, serviceId: null, description: "", quantity: "1.3333", unitPrice: "10.5555" };
    const result = calculateInvoicePreview([regression], "0");
    assert.equal(result.amountFor(regression), "14.0736");
    assert.equal(result.subtotal, "14.0736");
    const tieUp = { ...regression, quantity: "1.0001", unitPrice: "1.5000" };
    const belowTie = { ...regression, quantity: "1.0001", unitPrice: "1.4999" };
    assert.equal(calculateInvoicePreview([tieUp], "0").amountFor(tieUp), "1.5002");
    assert.equal(calculateInvoicePreview([belowTie], "0").amountFor(belowTie), "1.5");
  });

  it("sums individually rounded lines and applies exact discount arithmetic", () => {
    const result = calculateInvoicePreview([
      { billingMode: "QUANTITY", serviceId: null, description: "First", quantity: "1.3333", unitPrice: "2.2222" },
      { billingMode: "QUANTITY", serviceId: null, description: "Second", quantity: "0.1250", unitPrice: "4.0001" },
    ], "0.1250");
    assert.equal(result.amountFor({ billingMode: "QUANTITY", serviceId: null, description: "First", quantity: "1.3333", unitPrice: "2.2222" }), "2.9629");
    assert.equal(result.subtotal, "3.4629");
    assert.equal(result.discount, "0.125");
    assert.equal(result.payable, "3.3379");
  });

  it("previews flat fee as a single amount and rejects misleading discount previews", () => {
    const flat = { billingMode: "FLAT_FEE" as const, serviceId: null, description: "Flat", amount: "55000" };
    const flatPreview = calculateInvoicePreview([flat], "0");
    assert.equal(flatPreview.amountFor(flat), "55000");
    assert.equal(flatPreview.subtotal, "55000");
    assert.equal(flatPreview.payable, "55000");
    const largePreview = calculateInvoicePreview([flat], "0");
    assert.equal(largePreview.subtotal, "55000");
    for (const invalid of ["-1", "1.12345", "abc"]) {
      const result = calculateInvoicePreview([flat], invalid);
      assert.equal(result.discountValid, false);
      assert.equal(result.discount, "—");
      assert.equal(result.payable, "—");
    }
  });
});
