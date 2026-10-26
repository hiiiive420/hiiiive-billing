import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthorizationError, hasPermission, OrganizationContextNotFoundError, ProvisioningError, requireOrganizationBySlug } from "@/lib/auth/authorization";
import { AuthenticationError } from "@/lib/auth/identity";
import { loadInvoiceWorkspace, type InvoiceWorkspaceRow } from "@/lib/invoices/invoice-workspace";
import { formatMoneyDisplay } from "@/lib/invoices/invoice-entry-ui";

export const dynamic = "force-dynamic";

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

export default async function InvoiceWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ organizationSlug }, query] = await Promise.all([params, searchParams]);
  let workspace;
  try {
    workspace = await requireOrganizationBySlug(organizationSlug, "INVOICE_READ");
  } catch (error) {
    if (error instanceof OrganizationContextNotFoundError) notFound();
    return <WorkspaceAccessMessage error={error} />;
  }

  const result = await loadInvoiceWorkspace(workspace.organizationId, query);
  const canCreate = hasPermission(workspace.role, "INVOICE_CREATE");
  const basePath = `/app/${encodeURIComponent(workspace.organizationSlug)}/invoices`;
  const queryString = result.filters.query ? `&q=${encodeURIComponent(result.filters.query)}` : "";
  const lifecycleString = result.filters.lifecycle !== "ALL" ? `&lifecycle=${result.filters.lifecycle}` : "";
  const paymentString = result.filters.payment !== "ALL" ? `&payment=${result.filters.payment}` : "";
  const sortString = result.filters.sort !== "updated_desc" ? `&sort=${result.filters.sort}` : "";
  const filterQuery = `${queryString}${lifecycleString}${paymentString}${sortString}`;
  const clearHref = basePath;
  const previousHref = `${basePath}?page=${result.filters.page - 1}${filterQuery}`;
  const nextHref = `${basePath}?page=${result.filters.page + 1}${filterQuery}`;

  return <main className="entry-page entry-page-production invoice-workspace-page">
    <div className="entry-workspace-bar"><strong>Hiiiive Billing</strong><span>{workspace.organizationName}</span><span className="entry-workspace-user">{workspace.userLabel} · {workspace.role}</span></div>
    <header className="entry-header">
      <div><div className="entry-eyebrow">INVOICES</div><div className="entry-title-row"><h1>Invoice Workspace</h1></div></div>
      {canCreate && <Link className="entry-button entry-button-primary" href={`${basePath}/new`}>+ New Invoice</Link>}
    </header>

    <section className="invoice-workspace-summary" aria-label="Organization invoice counts">
      <SummaryCard label="Drafts" count={result.summary.drafts} tone="draft" />
      <SummaryCard label="Issued / Outstanding" count={result.summary.outstanding} tone="unpaid" />
      <SummaryCard label="Partially Paid" count={result.summary.partiallyPaid} tone="partial" />
      <SummaryCard label="Paid" count={result.summary.paid} tone="paid" />
    </section>
    <p className="invoice-workspace-summary-note">Counts show the full organization, independent of the current filters.</p>

    <section className="entry-card invoice-workspace-list" aria-labelledby="invoice-list-title">
      <div className="invoice-workspace-list-heading"><div><h2 id="invoice-list-title">Invoices</h2><p>{result.totalRows} {result.totalRows === 1 ? "invoice" : "invoices"} match the current view.</p></div></div>
      <form className="invoice-workspace-filters" method="get" action={basePath}>
        <label className="entry-field invoice-search-field" htmlFor="invoice-search">Search invoices
          <input id="invoice-search" name="q" type="search" maxLength={100} defaultValue={result.filters.query} placeholder="Invoice number, client, or project" />
        </label>
        <label className="entry-field" htmlFor="invoice-lifecycle">Lifecycle
          <select id="invoice-lifecycle" name="lifecycle" defaultValue={result.filters.lifecycle}>
            <option value="ALL">All</option><option value="DRAFT">Draft</option><option value="ISSUED">Issued</option>
            <option value="SUPERSEDED">Superseded</option><option value="VOID">Void</option><option value="WRITTEN_OFF">Written Off</option>
          </select>
        </label>
        <label className="entry-field" htmlFor="invoice-payment">Payment
          <select id="invoice-payment" name="payment" defaultValue={result.filters.payment}>
            <option value="ALL">All</option><option value="UNPAID">Unpaid</option><option value="PARTIALLY_PAID">Partially Paid</option><option value="PAID">Paid</option>
          </select>
        </label>
        <label className="entry-field" htmlFor="invoice-sort">Sort
          <select id="invoice-sort" name="sort" defaultValue={result.filters.sort}>
            <option value="updated_desc">Recently Updated</option><option value="date_desc">Newest Invoice Date</option>
            <option value="date_asc">Oldest Invoice Date</option><option value="number_asc">Invoice Number</option>
          </select>
        </label>
        <div className="invoice-filter-actions"><button className="entry-button entry-button-primary" type="submit">Apply</button>
          {(result.filters.query || result.filters.lifecycle !== "ALL" || result.filters.payment !== "ALL" || result.filters.sort !== "updated_desc") && <Link className="entry-button entry-button-light" href={clearHref}>Clear filters</Link>}
        </div>
      </form>

      {result.rows.length === 0 ? <div className="invoice-workspace-empty" role="status">
        <strong>{result.organizationInvoiceCount === 0 ? "No invoices yet." : "No invoices match the current search and filters."}</strong>
        {result.organizationInvoiceCount === 0
          ? canCreate && <Link className="entry-button entry-button-primary" href={`${basePath}/new`}>Create first invoice</Link>
          : <Link className="entry-button entry-button-light" href={clearHref}>Clear filters</Link>}
      </div> : <>
        <div className="invoice-workspace-table-wrap">
          <table className="invoice-workspace-table">
            <thead><tr><th>Invoice</th><th>Client</th><th>Project</th><th>Invoice Date</th><th>Amount</th><th>Lifecycle</th><th>Payment</th><th>Email</th><th>Updated</th><th>Actions</th></tr></thead>
            <tbody>{result.rows.map((row) => <InvoiceTableRow key={row.id} row={row} basePath={basePath} role={workspace.role} />)}</tbody>
          </table>
        </div>
        <div className="invoice-workspace-cards">{result.rows.map((row) => <InvoiceCard key={row.id} row={row} basePath={basePath} role={workspace.role} />)}</div>
        <nav className="invoice-workspace-pagination" aria-label="Invoice pages">
          {result.filters.page > 1 ? <Link className="entry-button entry-button-light" href={previousHref}>Previous</Link> : <span className="entry-button entry-button-light is-disabled" aria-disabled="true">Previous</span>}
          <span>Page {result.filters.page} of {result.totalPages}</span>
          {result.filters.page < result.totalPages ? <Link className="entry-button entry-button-light" href={nextHref}>Next</Link> : <span className="entry-button entry-button-light is-disabled" aria-disabled="true">Next</span>}
        </nav>
      </>}
    </section>
  </main>;
}

function SummaryCard({ label, count, tone }: { label: string; count: number; tone: string }) {
  return <article className={`invoice-summary-card invoice-summary-${tone}`}><span>{label}</span><strong>{count}</strong></article>;
}

function InvoiceTableRow({ row, basePath, role }: { row: InvoiceWorkspaceRow; basePath: string; role: string }) {
  return <tr>
    <td><strong>{row.displayNumber}</strong></td><td>{row.clientName}</td><td>{row.projectTitle ?? <span className="invoice-quiet">—</span>}</td>
    <td>{formatDate(row.invoiceDate)}</td><td>{row.currencyCode} {formatInvoiceAmount(row.grandTotal)}</td>
    <td><StatusChip status={row.lifecycleStatus} /></td><td>{row.lifecycleStatus === "DRAFT" ? <span className="invoice-quiet">—</span> : <StatusChip status={row.paymentStatus} />}</td>
    <td><EmailStatus row={row} /></td><td>{formatDateTime(row.updatedAt)}</td><td><InvoiceActions row={row} basePath={basePath} role={role} /></td>
  </tr>;
}

function InvoiceCard({ row, basePath, role }: { row: InvoiceWorkspaceRow; basePath: string; role: string }) {
  return <article className="invoice-workspace-card">
    <header><div><strong>{row.displayNumber}</strong><span>{row.clientName}</span></div><StatusChip status={row.lifecycleStatus} /></header>
    <dl><div><dt>Project</dt><dd>{row.projectTitle ?? <span className="invoice-quiet">—</span>}</dd></div>
      <div><dt>Invoice Date</dt><dd>{formatDate(row.invoiceDate)}</dd></div><div><dt>Amount</dt><dd>{row.currencyCode} {formatInvoiceAmount(row.grandTotal)}</dd></div>
      <div><dt>Payment</dt><dd>{row.lifecycleStatus === "DRAFT" ? <span className="invoice-quiet">—</span> : <StatusChip status={row.paymentStatus} />}</dd></div>
      <div><dt>Email</dt><dd><EmailStatus row={row} /></dd></div><div><dt>Updated</dt><dd>{formatDateTime(row.updatedAt)}</dd></div></dl>
    <InvoiceActions row={row} basePath={basePath} role={role} />
  </article>;
}

function InvoiceActions({ row, basePath, role }: { row: InvoiceWorkspaceRow; basePath: string; role: string }) {
  const invoicePath = `${basePath}/${encodeURIComponent(row.id)}`;
  if (row.lifecycleStatus === "DRAFT") {
    return hasPermission(role, "INVOICE_EDIT_DRAFT")
      ? <div className="invoice-row-actions"><Link href={`${invoicePath}/edit`}>Edit</Link></div>
      : <span className="invoice-quiet">—</span>;
  }
  return <div className="invoice-row-actions">
    <Link href={invoicePath}>View</Link><Link href={`${invoicePath}/pdf`} prefetch={false}>Download</Link>
    {row.lifecycleStatus === "ISSUED" && hasPermission(role, "INVOICE_SEND") && <Link href={`${invoicePath}/send`}>Send</Link>}
  </div>;
}

function StatusChip({ status }: { status: string }) {
  const labels: Record<string, string> = {
    DRAFT: "Draft", ISSUED: "Issued", SUPERSEDED: "Superseded", VOID: "Void", WRITTEN_OFF: "Written Off",
    UNPAID: "Unpaid", PARTIALLY_PAID: "Partially Paid", PAID: "Paid",
  };
  return <span className={`invoice-status-chip invoice-status-${status.toLowerCase()}`}>{labels[status] ?? status}</span>;
}

function EmailStatus({ row }: { row: InvoiceWorkspaceRow }) {
  if (row.lifecycleStatus === "DRAFT") return <span className="invoice-quiet">—</span>;
  const labels = { PENDING: "Sending", SENT: "Sent", PARTIALLY_SENT: "Partially sent", FAILED: "Failed" } as const;
  const status = row.latestEmailStatus;
  if (!status) return <span className="invoice-email-state">Never sent</span>;
  const timestamp = row.latestEmailAt?.toISOString();
  return <span className={`invoice-email-state invoice-email-${status.toLowerCase()}`} title={timestamp ? `Latest attempt: ${timestamp}` : undefined}>{labels[status]}</span>;
}

function formatDate(date: Date | null): string {
  if (!date) return "Not set";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

function formatInvoiceAmount(value: string): string {
  const [whole, fraction] = value.split(".");
  return formatMoneyDisplay(fraction === undefined ? `${whole}.00` : `${whole}.${fraction.padEnd(2, "0")}`);
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Colombo" }).format(date);
}

function WorkspaceAccessMessage({ error }: { error: unknown }) {
  const message = process.env.NODE_ENV !== "production" && (error instanceof AuthenticationError || error instanceof ProvisioningError)
    ? error.message
    : error instanceof AuthorizationError ? "You do not have permission to view invoices in this organization." : "We couldn't verify access to this workspace.";
  return <main className="app-workspace-gate"><section className="app-workspace-card" role="status"><p className="app-workspace-brand">Hiiiive Billing</p><h1>Invoice workspace</h1><p>{message}</p></section></main>;
}
