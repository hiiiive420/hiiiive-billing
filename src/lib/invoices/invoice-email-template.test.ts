import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildInvoiceEmailDefaults, validateInvoiceEmailSubject } from "./invoice-email-template";

describe("deterministic invoice email content", () => {
  it("includes trusted invoice values and optional due/payment lines deterministically", () => {
    const content = buildInvoiceEmailDefaults({
      invoiceNumber: "I202610231", projectTitle: "Brand identity", clientName: "Example Client",
      currencyCode: "LKR", grandTotal: "12345.5", invoiceDate: "2026-10-23",
      dueDate: "2026-11-06", paymentTerms: "Due within 14 days",
    }, { name: "Hiiiive", email: "billing@hiiiive.lk" });
    assert.equal(content.subject, "Invoice I202610231 – Brand identity – Hiiiive");
    assert.match(content.bodyText, /Dear Example Client,/);
    assert.match(content.bodyText, /Invoice I202610231 for Brand identity/);
    assert.match(content.bodyText, /Invoice Amount: LKR 12,345\.50/);
    assert.match(content.bodyText, /Invoice Date: October 23, 2026/);
    assert.match(content.bodyText, /Payment Terms: Due within 14 days/);
    assert.match(content.bodyText, /Due Date: November 6, 2026/);
    assert.match(content.bodyText, /billing@hiiiive\.lk/);
  });

  it("omits optional lines cleanly and rejects subject header injection", () => {
    const content = buildInvoiceEmailDefaults({
      invoiceNumber: "I202610232", projectTitle: null, clientName: "Client",
      currencyCode: "USD", grandTotal: "1", invoiceDate: "2026-10-23", dueDate: null, paymentTerms: null,
    }, { name: "Hiiiive" });
    assert.equal(content.subject, "Invoice I202610232 – Hiiiive");
    assert.doesNotMatch(content.bodyText, /Payment Terms:|Due Date:|@hiiiive/);
    assert.throws(() => validateInvoiceEmailSubject("Invoice\r\nBcc: x@example.test"), /line breaks/);
    assert.throws(() => validateInvoiceEmailSubject(""), /required/);
    assert.throws(() => validateInvoiceEmailSubject("x".repeat(201)), /200 characters/);
  });
});
