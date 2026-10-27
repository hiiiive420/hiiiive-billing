import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoicePaymentForm } from "@/components/invoices/invoice-payment-form";
import { AuthorizationError, hasPermission, OrganizationContextNotFoundError, ProvisioningError, requireOrganizationBySlug } from "@/lib/auth/authorization";
import { AuthenticationError } from "@/lib/auth/identity";
import { InvoicePaymentReadModelError, loadInvoicePaymentSummary } from "@/lib/invoices/invoice-payments";
import { formatMoneyDisplay } from "@/lib/invoices/invoice-entry-ui";
import { recordOrganizationInvoicePaymentAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function InvoicePaymentsPage({ params }: { params: Promise<{ organizationSlug: string; invoiceId: string }> }) {
  const { organizationSlug, invoiceId } = await params;
  let workspace;
  try { workspace = await requireOrganizationBySlug(organizationSlug, "PAYMENT_READ"); }
  catch (error) {
    if (error instanceof OrganizationContextNotFoundError) notFound();
    return <AccessMessage error={error} />;
  }
  let summary;
  try { summary = await loadInvoicePaymentSummary(workspace.organizationId, invoiceId); }
  catch (error) {
    if (error instanceof InvoicePaymentReadModelError && /not found/i.test(error.message)) notFound();
    return <main className="entry-page entry-page-production"><section className="app-workspace-card" role="alert"><h1>Payments unavailable</h1><p>{error instanceof InvoicePaymentReadModelError ? error.message : "We couldn't load payment information."}</p></section></main>;
  }
  const basePath = `/app/${encodeURIComponent(workspace.organizationSlug)}/invoices`;
  const invoiceHref = `${basePath}/${encodeURIComponent(invoiceId)}`;
  const canRecord = hasPermission(workspace.role, "PAYMENT_RECORD") && summary.lifecycleStatus === "ISSUED";
  const action = recordOrganizationInvoicePaymentAction.bind(null, workspace.organizationSlug, invoiceId);
  const defaultDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return <main className="entry-page entry-page-production invoice-payments-page">
    <div className="entry-workspace-bar"><strong>Hiiiive Billing</strong><span>{workspace.organizationName}</span><span className="entry-workspace-user">{workspace.userLabel} · {workspace.role}</span></div>
    <nav className="invoice-payment-breadcrumbs" aria-label="Invoice navigation"><Link href={invoiceHref}>← Back to Invoice</Link><Link href={basePath}>Back to Invoices</Link></nav>
    <header className="entry-header invoice-payment-header"><div><div className="entry-eyebrow">PAYMENTS</div><div className="entry-title-row"><h1>{summary.invoiceNumber ?? "Invoice"}</h1><StatusChip status={summary.lifecycleStatus} /></div><p className="invoice-payment-client">Client: {summary.clientName}</p></div></header>
    <section className="invoice-payment-summary" aria-label="Payment summary">
      <article><span>Payment Status</span><StatusChip status={summary.paymentStatus} /></article>
      <article><span>Invoice Total</span><strong>{money(summary.currencyCode, summary.grandTotal)}</strong></article>
      <article><span>Total Paid</span><strong>{money(summary.currencyCode, summary.totalPaid)}</strong></article>
      <article><span>Balance Due</span><strong>{money(summary.currencyCode, summary.balanceDue)}</strong></article>
      {summary.overpaidAmount !== "0" && <article className="invoice-payment-overpaid"><span>Overpaid</span><strong>{money(summary.currencyCode, summary.overpaidAmount)}</strong></article>}
    </section>
    {summary.overpaidAmount !== "0" && <p className="invoice-payment-warning" role="note">Payments exceed the invoice total. No refund or reversal is available here.</p>}
    {canRecord && <>
      {summary.paymentStatus === "PAID" && <p className="invoice-payment-warning" role="note">Additional payments are accepted by the existing payment service and may result in an overpayment.</p>}
      <InvoicePaymentForm currencyCode={summary.currencyCode} initialDate={defaultDate} action={action} />
    </>}
    {!canRecord && summary.lifecycleStatus !== "ISSUED" && <p className="invoice-payment-readonly">Payments can only be recorded for issued invoices. This page is read-only.</p>}
    <section className="entry-card invoice-payment-history" aria-labelledby="payment-history-title">
      <div className="entry-section-heading"><div><h2 id="payment-history-title">Payment History</h2><p>Newest payments first</p></div></div>
      {summary.payments.length === 0 ? <p className="invoice-payment-empty">No payments recorded yet.</p> : <div className="invoice-payment-history-list">{summary.payments.map((payment) => <article className="invoice-payment-history-item" key={payment.id}>
        <div className="invoice-payment-history-primary"><strong>{money(summary.currencyCode, payment.amount)}</strong><span>{formatDate(payment.paidAt)} · {methodLabel(payment.method)}</span></div>
        <div><span>Recorded at {formatDateTime(payment.createdAt)}</span>{payment.reference && <span>Reference: {payment.reference}</span>}{payment.internalNote && <p>{payment.internalNote}</p>}</div>
      </article>)}</div>}
    </section>
  </main>;
}

function money(currency: string, value: string) { return `${currency} ${formatMoneyDisplay(value)}`; }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Asia/Colombo" }).format(new Date(value)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Colombo" }).format(new Date(value)); }
function methodLabel(value: string) { return ({ BANK_TRANSFER: "Bank transfer", CASH: "Cash", CHEQUE: "Cheque", CARD: "Card", OTHER: "Other" } as Record<string, string>)[value] ?? value; }
function StatusChip({ status }: { status: string }) {
  const labels: Record<string, string> = { ISSUED: "Issued", DRAFT: "Draft", SUPERSEDED: "Superseded", VOID: "Void", WRITTEN_OFF: "Written Off", UNPAID: "Unpaid", PARTIALLY_PAID: "Partially Paid", PAID: "Paid" };
  return <span className={`invoice-status-chip invoice-status-${status.toLowerCase()}`}>{labels[status] ?? status}</span>;
}
function AccessMessage({ error }: { error: unknown }) {
  const message = process.env.NODE_ENV !== "production" && (error instanceof AuthenticationError || error instanceof ProvisioningError)
    ? error.message
    : error instanceof AuthorizationError ? "You do not have permission to view payments in this organization." : "We couldn't verify access to this workspace.";
  return <main className="app-workspace-gate"><section className="app-workspace-card" role="status"><p className="app-workspace-brand">Hiiiive Billing</p><h1>Workspace access</h1><p>{message}</p></section></main>;
}
