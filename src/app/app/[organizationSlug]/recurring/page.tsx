import Link from "next/link";
import { notFound } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { calculateInvoiceLineTotal } from "@/lib/invoices/invoice-financials";
import { WorkspaceHeader } from "@/components/master-data/workspace-shell";
import { requireOrganizationBySlug } from "@/lib/auth/authorization";
import { listRecurringPlans } from "@/lib/recurring/recurring-invoices";
import { StatusChip } from "@/components/status-chip";

export default async function RecurringWorkspacePage({ params, searchParams }: { params: Promise<{ organizationSlug: string }>; searchParams: Promise<{ q?: string }> }) {
  const { organizationSlug } = await params;
  const query = (await searchParams).q ?? "";
  let workspace;
  try { workspace = await requireOrganizationBySlug(organizationSlug, "RECURRING_INVOICE_READ"); } catch { notFound(); }
  const plans = await listRecurringPlans(workspace.organizationId, query);
  const base = `/app/${encodeURIComponent(workspace.organizationSlug)}/recurring`;
  return <main className="entry-page entry-page-production"><WorkspaceHeader workspace={workspace} current="recurring" />
    <header className="entry-header"><div><div className="entry-eyebrow">WORKSPACE / BILLING</div><h1>Recurring invoices</h1><p>Plans create drafts for human review. They never issue or send invoices.</p></div><Link className="entry-button entry-button-primary" href={`${base}/new`}>New recurring plan</Link></header>
    <form className="master-data-search" action={base}><label className="entry-field" htmlFor="recurring-search">Search plans, clients, or projects<input id="recurring-search" name="q" defaultValue={query} maxLength={100} /></label><button className="entry-button entry-button-light">Search</button></form>
    <section className="entry-card"><div className="recurring-table-wrap"><table className="recurring-table"><thead><tr><th>Plan</th><th>Client</th><th>Cadence</th><th>Total</th><th>Status</th><th>Next run</th><th>Last generated</th><th>Action</th></tr></thead><tbody>
      {plans.map((plan) => {
        const total = plan.items.reduce((sum, item) => sum.plus(item.billingMode === "FLAT_FEE" ? item.unitPrice : calculateInvoiceLineTotal(item.quantity, item.unitPrice)), new Prisma.Decimal(0)).minus(plan.discountAmount);
        return <tr key={plan.id}><td><Link href={`${base}/${encodeURIComponent(plan.id)}`}>{plan.name}</Link>{plan.projectTitle && <small>{plan.projectTitle}</small>}</td><td>{plan.client.name}</td><td>{plan.frequency === "MONTHLY" ? "Monthly" : "Yearly"}</td><td>{plan.currencyCode} {total.toString()}</td><td><StatusChip status={plan.isActive ? "ACTIVE" : "PAUSED"} /></td><td>{plan.nextRunDate.toISOString().slice(0, 10)}</td><td>{plan.runs[0]?.status === "GENERATED" ? <><StatusChip status="GENERATED" /> {plan.runs[0].scheduledFor.toISOString().slice(0, 10)}</> : plan.runs[0]?.status === "FAILED" ? <StatusChip status="FAILED" /> : "—"}</td><td><Link href={`${base}/${encodeURIComponent(plan.id)}`}>View / Edit</Link></td></tr>;
      })}
      {plans.length === 0 && <tr><td colSpan={8}>No recurring plans found.</td></tr>}
    </tbody></table></div></section>
  </main>;
}
