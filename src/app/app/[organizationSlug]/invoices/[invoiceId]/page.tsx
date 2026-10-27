import Link from "next/link";
import { createElement } from "react";
import { notFound } from "next/navigation";
import { AuthorizationError, hasPermission, OrganizationContextNotFoundError, requireOrganizationBySlug } from "@/lib/auth/authorization";
import { loadIssuedInvoiceDocument, IssuedInvoiceDocumentError } from "@/lib/invoices/issued-invoice-document";
import { resolveInvoiceRenderer } from "@/lib/invoice-templates/registry";
import { InvoicePreviewScale } from "@/app/dev/invoice-preview/invoice-preview-scale";
import { loadInvoicePaymentSummary } from "@/lib/invoices/invoice-payments";
import { formatMoneyDisplay } from "@/lib/invoices/invoice-entry-ui";

export const dynamic = "force-dynamic";

export default async function IssuedInvoicePage({ params }: { params: Promise<{ organizationSlug: string; invoiceId: string }> }) {
  const { organizationSlug, invoiceId } = await params;
  let workspace;
  try { workspace = await requireOrganizationBySlug(organizationSlug, "INVOICE_READ"); }
  catch (error) {
    if (error instanceof OrganizationContextNotFoundError) notFound();
    return <main className="preview-shell"><p role="alert">{error instanceof AuthorizationError ? "You do not have permission to view invoices in this organization." : "We couldn't verify access to this workspace."}</p></main>;
  }
  let document;
  try { document = await loadIssuedInvoiceDocument(workspace.organizationId, invoiceId); }
  catch (error) {
    if (error instanceof IssuedInvoiceDocumentError && /not found|Only issued/i.test(error.message)) notFound();
    return <main className="preview-shell"><p role="alert">This issued invoice could not be rendered. Its saved document configuration may require historical review.</p></main>;
  }
  const invoiceDocument = createElement(resolveInvoiceRenderer(document.rendererKey), { config: document.config, invoice: document.invoice });
  const workspaceHref = `/app/${encodeURIComponent(workspace.organizationSlug)}/invoices`;
  const basePath = `/app/${encodeURIComponent(workspace.organizationSlug)}/invoices/${encodeURIComponent(invoiceId)}`;
  let paymentSummary = null;
  let paymentSummaryAvailable = true;
  if (hasPermission(workspace.role, "PAYMENT_READ")) {
    try { paymentSummary = await loadInvoicePaymentSummary(workspace.organizationId, invoiceId); }
    catch { paymentSummaryAvailable = false; }
  }
  return <main className="preview-shell">
    <div className="preview-banner"><Link className="entry-button entry-button-light invoice-workspace-breadcrumb" href={workspaceHref}>Invoices</Link> · <strong>{document.invoice.invoiceNumber}</strong> | {document.lifecycleStatus.replaceAll("_", " ")} | {document.paymentStatus.replaceAll("_", " ")}
      <div className="document-actions"><Link className="entry-button entry-button-light" href={`${basePath}/pdf`} download>Download PDF</Link>{document.lifecycleStatus === "ISSUED" && hasPermission(workspace.role, "INVOICE_SEND") && <Link className="entry-button entry-button-primary" href={`${basePath}/send`}>Send Invoice</Link>}</div>
    </div>
    {hasPermission(workspace.role, "PAYMENT_READ") && (paymentSummary ? <section className="issued-payment-summary" aria-label="Payment summary">
      <div className="issued-payment-heading"><strong>Payment</strong><span className={`invoice-status-chip invoice-status-${paymentSummary.paymentStatus.toLowerCase()}`}>{paymentSummary.paymentStatus.replaceAll("_", " ")}</span></div>
      <dl><div><dt>Invoice Total</dt><dd>{paymentSummary.currencyCode} {formatMoneyDisplay(paymentSummary.grandTotal)}</dd></div><div><dt>Paid</dt><dd>{paymentSummary.currencyCode} {formatMoneyDisplay(paymentSummary.totalPaid)}</dd></div><div><dt>Balance Due</dt><dd>{paymentSummary.currencyCode} {formatMoneyDisplay(paymentSummary.balanceDue)}</dd></div>
        {paymentSummary.overpaidAmount !== "0" && <div><dt>Overpaid</dt><dd>{paymentSummary.currencyCode} {formatMoneyDisplay(paymentSummary.overpaidAmount)}</dd></div>}</dl>
      <div className="issued-payment-actions"><Link className="entry-button entry-button-light" href={`${basePath}/payments`}>View Payments</Link>
        {paymentSummary.lifecycleStatus === "ISSUED" && hasPermission(workspace.role, "PAYMENT_RECORD") && <Link className="entry-button entry-button-light" href={`${basePath}/payments#record-payment`}>Record Payment</Link>}</div>
      {paymentSummary.paymentStatus === "PAID" && hasPermission(workspace.role, "PAYMENT_RECORD") && <p>Additional payments are accepted and may create an overpayment.</p>}
    </section> : !paymentSummaryAvailable && <section className="issued-payment-summary" role="status"><strong>Payment summary is temporarily unavailable.</strong></section>)}
    <InvoicePreviewScale>{invoiceDocument}</InvoicePreviewScale>
  </main>;
}
