import type { CSSProperties } from "react";
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

export function HiiiiveInvoice({ config: untrustedConfig, invoice }: HiiiiveInvoiceProps) {
  const config = parseHiiiiveTemplateConfig(untrustedConfig);
  const sheetStyle = {
    "--invoice-accent": config.primaryColor,
    "--invoice-heading-font": "'DejaVu Serif', '" + config.headingFontName + "', Georgia, serif",
    "--invoice-body-font": "'DM Sans', '" + config.bodyFontName + "', Arial, sans-serif",
  } as CSSProperties;
  const discountIsZero = isZeroDecimal(invoice.discountAmount);
  const currencyCode = normalizeInvoiceCurrencyCode(invoice.currencyCode);

  return (
    <article className="invoice-sheet" style={sheetStyle} aria-label={`Invoice ${invoice.invoiceNumber}`}>
      <header className="invoice-heading">
        <h1>INVOICE-{invoice.invoiceNumber}</h1>
        {invoice.projectTitle && <p className="invoice-project">Project - {invoice.projectTitle}</p>}
        <p className="invoice-date">Date: {formatInvoiceDate(invoice.invoiceDate)}</p>
      </header>

      <section className="invoice-parties" aria-label="Client and payment information">
        <div>
          <h2>TO:</h2>
          <p className="client-name">{invoice.clientName}</p>
          {invoice.clientBillingAddress && <p className="client-address">{invoice.clientBillingAddress}</p>}
        </div>
        <div className="payment-information">
          <h2>PAYMENT INFORMATION:</h2>
          <p>Bank: {config.bankName ?? ""}</p>
          <p>Name: {config.accountName ?? ""}</p>
          <p>Account: {config.accountNumber ?? ""}</p>
        </div>
      </section>

      <table className="invoice-lines">
        <thead>
          <tr><th>ITEM</th><th>SERVICES</th><th>QTY</th><th>UNIT PRICE</th><th>AMOUNT</th></tr>
        </thead>
        <tbody>
          {invoice.items.map((item, index) => (
            <tr key={`${index}-${item.description}`}>
              <td className="item-index">{index + 1}.</td>
              <td>{item.description}</td>
              <td className="quantity">{item.quantity}</td>
              <td className="amount">{formatAmount(item.unitPrice)}</td>
              <td className="amount">{formatAmount(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="invoice-totals" aria-label="Invoice totals">
        <div className="total-row"><span>SUBTOTAL</span><span>{formatAmount(invoice.subtotal)}</span></div>
        {!discountIsZero && <div className="total-row"><span>{invoice.discountLabel || "DISCOUNT"}</span><span>-{formatAmount(invoice.discountAmount)}</span></div>}
        <div className="total-row payable"><span>AMOUNT PAYABLE</span><span>{formatAmount(invoice.grandTotal)}</span></div>
      </section>

      <footer className="invoice-notes">
        {invoice.notes && <p>{invoice.notes}</p>}
        {config.footerNote && <p>{config.footerNote}</p>}
        <p>All amounts are in {currencyCode}.</p>
        <span className="company-display-name">{config.companyName}</span>
      </footer>
    </article>
  );
}
