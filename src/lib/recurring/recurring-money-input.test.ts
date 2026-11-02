import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeRecurringMoneyInput, RecurringMoneyInputError } from "./recurring-money-input";

test("recurring money input strips valid grouping separators without using floating point", () => {
  assert.equal(normalizeRecurringMoneyInput("55,000", "invalid"), "55000");
  assert.equal(normalizeRecurringMoneyInput("1,234,567.8900", "invalid"), "1234567.8900");
  assert.equal(normalizeRecurringMoneyInput("0", "invalid"), "0");
  assert.equal(normalizeRecurringMoneyInput("55000", "invalid"), "55000");
});

test("recurring money input rejects malformed grouping and excessive precision with a field message", () => {
  assert.throws(() => normalizeRecurringMoneyInput("55,00", "Enter a valid amount for Item 1."), {
    name: "RecurringMoneyInputError",
    message: "Enter a valid amount for Item 1.",
  } satisfies Partial<RecurringMoneyInputError>);
  assert.throws(() => normalizeRecurringMoneyInput("1,000.12345", "Enter a valid amount for Item 1."), RecurringMoneyInputError);
});
