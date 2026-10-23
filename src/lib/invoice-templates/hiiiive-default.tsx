import { createElement, type CSSProperties, type ReactNode } from "react";
import {
  formatAmount,
  formatInvoiceDate,
  isZeroDecimal,
  parseHiiiiveTemplateConfig,
  type InvoiceView,
} from "./config";
import { normalizeInvoiceCurrencyCode } from "../invoices/currency";

export type HiiiiveInvoiceProps = Readonly<{
  config: unknown;
  invoice: InvoiceView;
}>;

type InvoiceNode = string | Readonly<{
  tag: string;
  className?: string;
  ariaLabel?: string;
  style?: CSSProperties;
  key?: string;
  children: readonly InvoiceNode[];
}>;

function element(
  tag: string,
  children: readonly InvoiceNode[],
  attributes: Omit<Extract<InvoiceNode, { tag: string }>, "tag" | "children"> = {},
): InvoiceNode {
  return { tag, ...attributes, children };
}

function buildInvoiceTree({ config: untrustedConfig, invoice }: HiiiiveInvoiceProps): InvoiceNode {
  const config = parseHiiiiveTemplateConfig(untrustedConfig);
  const sheetStyle = {
    "--invoice-accent": config.primaryColor,
    "--invoice-heading-font": "'DejaVu Serif', '" + config.headingFontName + "', Georgia, serif",
    "--invoice-body-font": "'DM Sans', '" + config.bodyFontName + "', Arial, sans-serif",
  } as CSSProperties;
  const discountIsZero = isZeroDecimal(invoice.discountAmount);
  const currencyCode = normalizeInvoiceCurrencyCode(invoice.currencyCode);
  const allFlatFee = invoice.items.length > 0 && invoice.items.every((item) => item.billingMode === "FLAT_FEE");

  const children: InvoiceNode[] = [element("header", [
    element("h1", [`INVOICE-${invoice.invoiceNumber}`]),
    ...(invoice.projectTitle ? [element("p", [`Project - ${invoice.projectTitle}`], { className: "invoice-project" })] : []),
    element("p", [`Date: ${formatInvoiceDate(invoice.invoiceDate)}`], { className: "invoice-date" }),
  ], { className: "invoice-heading" }), element("section", [
    element("div", [element("h2", ["TO:"]), element("p", [invoice.clientName], { className: "client-name" }),
      ...(invoice.clientBillingAddress ? [element("p", [invoice.clientBillingAddress], { className: "client-address" })] : [])]),
    element("div", [element("h2", ["PAYMENT INFORMATION:"]),
      element("p", [`Bank: ${config.bankName ?? ""}`]),
      element("p", [`Name: ${config.accountName ?? ""}`]),
      element("p", [`Account: ${config.accountNumber ?? ""}`])], { className: "payment-information" }),
  ], { className: "invoice-parties", ariaLabel: "Client and payment information" })];

  children.push(element("table", [
    element("thead", [element("tr", (allFlatFee
      ? ["ITEM", "SERVICES", "AMOUNT"]
      : ["ITEM", "SERVICES", "QTY", "UNIT PRICE", "AMOUNT"]
    ).map((label) => element("th", [label])))]),
    element("tbody", invoice.items.map((item, index) => element("tr", [
      element("td", [`${index + 1}.`], { className: "item-index" }), element("td", [item.description]),
      ...(!allFlatFee ? [
        element("td", [item.billingMode === "FLAT_FEE" ? "—" : item.quantity], { className: "quantity" }),
        element("td", [item.billingMode === "FLAT_FEE" ? "—" : formatAmount(item.unitPrice)], { className: "amount" }),
      ] : []),
      element("td", [formatAmount(item.lineTotal)], { className: "amount" }),
    ], { key: `${index}-${item.description}` }))),
  ], { className: `invoice-lines${allFlatFee ? " invoice-lines-flat" : ""}` }));

  children.push(element("section", [
    element("div", [element("span", ["SUBTOTAL"]), element("span", [formatAmount(invoice.subtotal)])], { className: "total-row" }),
    ...(!discountIsZero ? [element("div", [element("span", [invoice.discountLabel || "DISCOUNT"]),
      element("span", [`-${formatAmount(invoice.discountAmount)}`])], { className: "total-row" })] : []),
    element("div", [element("span", ["AMOUNT PAYABLE"]), element("span", [formatAmount(invoice.grandTotal)])], { className: "total-row payable" }),
  ], { className: "invoice-totals", ariaLabel: "Invoice totals" }));

  children.push(element("footer", [
    ...(invoice.notes ? [element("p", [invoice.notes])] : []),
    ...(config.footerNote ? [element("p", [config.footerNote])] : []),
    element("p", [`All amounts are in ${currencyCode}.`]),
    element("span", [config.companyName], { className: "company-display-name" }),
  ], { className: "invoice-notes" }));

  return element("article", children, {
    className: "invoice-sheet",
    style: sheetStyle,
    ariaLabel: `Invoice ${invoice.invoiceNumber}`,
  });
}

function toReactNode(node: InvoiceNode, index = 0): ReactNode {
  if (typeof node === "string") return node;
  return createElement(node.tag, {
    key: node.key ?? index,
    ...(node.className ? { className: node.className } : {}),
    ...(node.ariaLabel ? { "aria-label": node.ariaLabel } : {}),
    ...(node.style ? { style: node.style } : {}),
  }, ...node.children.map(toReactNode));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#x27;",
  })[character]!);
}

function serializeNode(node: InvoiceNode): string {
  if (typeof node === "string") return escapeHtml(node);
  const attributes = [
    node.className ? `class="${escapeHtml(node.className)}"` : "",
    node.ariaLabel ? `aria-label="${escapeHtml(node.ariaLabel)}"` : "",
    node.style ? `style="${escapeHtml(Object.entries(node.style).map(([key, value]) => `${key}: ${String(value)}`).join(";"))}"` : "",
  ].filter(Boolean).join(" ");
  return `<${node.tag}${attributes ? ` ${attributes}` : ""}>${node.children.map(serializeNode).join("")}</${node.tag}>`;
}

export function renderHiiiiveInvoiceHtml(props: HiiiiveInvoiceProps): string {
  return serializeNode(buildInvoiceTree(props));
}

export function HiiiiveInvoice(props: HiiiiveInvoiceProps) {
  return toReactNode(buildInvoiceTree(props));
}
