import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseInvoiceRecipients, RecipientValidationError } from "./recipients";

describe("invoice email recipients", () => {
  it("parses multiple addresses across comma, semicolon, and newline separators", () => {
    assert.deepEqual(parseInvoiceRecipients({
      to: "  Finance@Example.com, accountant@example.com;\nfinance@example.com ",
      cc: "gm@example.com\nops@example.com",
      bcc: "accounts@example.com; audit@example.com",
    }), {
      to: ["finance@example.com", "accountant@example.com"],
      cc: ["gm@example.com", "ops@example.com"],
      bcc: ["accounts@example.com", "audit@example.com"],
    });
  });

  it("deduplicates within each category while preserving the separate CC and BCC lists", () => {
    assert.deepEqual(parseInvoiceRecipients({
      to: "A@example.com,a@example.com",
      cc: "a@example.com;B@example.com;b@example.com",
      bcc: "hidden@example.com;HIDDEN@example.com",
    }), {
      to: ["a@example.com"], cc: ["a@example.com", "b@example.com"], bcc: ["hidden@example.com"],
    });
  });

  it("requires To and rejects malformed recipients and recipient overflow", () => {
    assert.throws(() => parseInvoiceRecipients({ to: "", cc: "cc@example.com" }), /at least one To/i);
    assert.throws(() => parseInvoiceRecipients({ to: "valid@example.com,not-an-address" }), RecipientValidationError);
    assert.throws(() => parseInvoiceRecipients({ to: Array.from({ length: 51 }, (_, i) => `u${i}@example.test`).join(",") }), /no more than 50/);
    assert.throws(() => parseInvoiceRecipients({ to: "x".repeat(4001) }), /too long/i);
  });
});
