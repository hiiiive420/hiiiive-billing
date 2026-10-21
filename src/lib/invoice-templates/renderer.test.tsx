import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValidElement, type ReactNode } from "react";
import {
  formatAmount,
  isHiiiiveTemplateConfig,
  parseHiiiiveTemplateConfig,
  TemplateConfigError,
  type InvoiceView,
} from "./config";
import { resolveInvoiceRenderer, UnknownInvoiceRendererError } from "./registry";
import { InvoiceCurrencyCodeError, normalizeInvoiceCurrencyCode } from "../invoices/currency";

const validConfig = {
  companyName: "Hiiiive",
  bankName: "",
  accountName: "",
  accountNumber: "",
  headingFontName: "DejaVu Serif",
  bodyFontName: "DM Sans",
  primaryColor: "#255B83",
};

const baseInvoice: InvoiceView = {
  invoiceNumber: "I2026101923",
  projectTitle: "Price Pointer Artwork",
  invoiceDate: "2026-10-19",
  clientName: "Visaga Clothing Hub",
  currencyCode: "LKR",
  items: [{ description: "Price Pointer Artwork", quantity: "185", unitPrice: "100.00", lineTotal: "18500.00" }],
  subtotal: "18500.00",
  discountLabel: "PREFERRED CLIENT DISCOUNT",
  discountAmount: "4625.00",
  grandTotal: "13875.00",
  notes: "Sample note",
};

describe("Hiiiive invoice renderer", () => {
  it("resolves the trusted renderer and rejects unknown keys", () => {
    assert.equal(typeof resolveInvoiceRenderer("hiiiive-default"), "function");
    assert.throws(() => resolveInvoiceRenderer("untrusted-renderer"), UnknownInvoiceRendererError);
  });

  it("accepts valid config and rejects malformed config", () => {
    assert.equal(isHiiiiveTemplateConfig(validConfig), true);
    assert.deepEqual(parseHiiiiveTemplateConfig(validConfig), validConfig);
    assert.equal(isHiiiiveTemplateConfig({ ...validConfig, primaryColor: "red; background:url(x)" }), false);
    assert.throws(() => parseHiiiiveTemplateConfig({ ...validConfig, companyName: 42 }), TemplateConfigError);
  });

  it("normalizes currency codes to uppercase and rejects malformed values", () => {
    assert.equal(normalizeInvoiceCurrencyCode("lkr"), "LKR");
    assert.equal(normalizeInvoiceCurrencyCode("usd"), "USD");
    for (const code of ["US", "USDX", "U$D", " USD", "USD ", "USD\n", "\uFF11\uFF12\uFF13"]) {
      assert.throws(() => normalizeInvoiceCurrencyCode(code), InvoiceCurrencyCodeError);
    }
  });

  it("formats plain amounts with separators and two display decimals", () => {
    assert.equal(formatAmount("100"), "100.00");
    assert.equal(formatAmount("18500"), "18,500.00");
    assert.equal(formatAmount("13875.005"), "13,875.01");
  });
  it("prints item indices as 1., 2., and so on", () => {
    const Renderer = resolveInvoiceRenderer("hiiiive-default");
    const invoice = {
      ...baseInvoice,
      items: [
        { description: "First service", quantity: "1", unitPrice: "1", lineTotal: "1" },
        { description: "Second service", quantity: "1", unitPrice: "1", lineTotal: "1" },
      ],
    };
    const markup = textContent(Renderer({ config: validConfig, invoice }));
    assert.match(markup, /1\.First service/);
    assert.match(markup, /2\.Second service/);
  });

  it("hides the complete project line when projectTitle is absent", () => {
    const Renderer = resolveInvoiceRenderer("hiiiive-default");
    const markup = textContent(Renderer({ config: validConfig, invoice: { ...baseInvoice, projectTitle: null } }));
    assert.doesNotMatch(markup, /Project\s*-/);
    assert.match(markup, /Date: October 19, 2026/);
  });

  it("renders a non-LKR invoice code in the final note without currency prefixes", () => {
    const Renderer = resolveInvoiceRenderer("hiiiive-default");
    const invoice = { ...baseInvoice, currencyCode: "usd" };
    const markup = textContent(Renderer({ config: validConfig, invoice }));
    assert.match(markup, /All amounts are in USD\./);
    assert.match(markup, /18,500\.00/);
    assert.doesNotMatch(markup, /(?:LKR|USD)\s+18,500\.00/);
  });

  it("hides a zero discount row", () => {
    const Renderer = resolveInvoiceRenderer("hiiiive-default");
    const markup = textContent(Renderer({ config: validConfig, invoice: { ...baseInvoice, discountAmount: "0.0000" } }));
    assert.doesNotMatch(markup, /PREFERRED CLIENT DISCOUNT/);
  });
  it("does not mutate invoice financial values while rendering", () => {
    const Renderer = resolveInvoiceRenderer("hiiiive-default");
    const invoice = Object.freeze({
      ...baseInvoice,
      items: Object.freeze(baseInvoice.items.map((item) => Object.freeze({ ...item }))),
    });
    const before = [invoice.subtotal, invoice.discountAmount, invoice.grandTotal, invoice.items[0].lineTotal];
    Renderer({ config: validConfig, invoice });
    assert.deepEqual([invoice.subtotal, invoice.discountAmount, invoice.grandTotal, invoice.items[0].lineTotal], before);
  });
});

function textContent(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (isValidElement(node)) return textContent((node.props as { children?: ReactNode }).children);
  return "";
}
