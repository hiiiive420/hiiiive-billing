import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkspaceHeader } from "@/components/master-data/workspace-shell";
import { RecurringPlanForm } from "@/components/recurring/recurring-plan-form";
import { RecurringPlanStatus } from "@/components/recurring/recurring-plan-status";
import { hasPermission, requireOrganizationBySlug } from "@/lib/auth/authorization";
import { listRecurringClients, loadRecurringPlan } from "@/lib/recurring/recurring-invoices";
import { saveRecurringPlanAction, setRecurringPlanActiveAction } from "../actions";

export default async function RecurringPlanDetailPage({ params }: { params: Promise<{ organizationSlug: string; planId: string }> }) {
  const { organizationSlug, planId } = await params;
  let workspace;
  try { workspace = await requireOrganizationBySlug(organizationSlug, "RECURRING_INVOICE_READ"); } catch { notFound(); }
  const plan = await loadRecurringPlan(workspace.organizationId, planId);
  if (!plan) notFound();
  const base = `/app/${encodeURIComponent(workspace.organizationSlug)}/recurring`;
  const invoices = `/app/${encodeURIComponent(workspace.organizationSlug)}/invoices`;
  const canManage = hasPermission(workspace.role, "RECURRING_INVOICE_MANAGE");
  const clients = canManage ? await listRecurringClients(workspace.organizationId) : [];
  const initial = {
    clientId: plan.clientId, name: plan.name, projectTitle: plan.projectTitle ?? "", currencyCode: plan.currencyCode,
    frequency: plan.frequency, startDate: plan.startDate.toISOString().slice(0, 10), dueInDays: plan.dueInDays?.toString() ?? "",
    discountLabel: plan.discountLabel ?? "", discountAmount: plan.discountAmount.toString(), paymentTerms: plan.paymentTerms ?? "", notes: plan.notes ?? "",
    items: plan.items.map((item) => ({ billingMode: item.billingMode, description: item.description, quantity: item.quantity.toString(), unitPrice: item.unitPrice.toString(), amount: item.billingMode === "FLAT_FEE" ? item.unitPrice.toString() : "" })),
  } as const;
  return <main className="entry-page entry-page-production"><WorkspaceHeader workspace={workspace} current="recurring" />
    <header className="entry-header"><div><div className="entry-eyebrow"><Link href={base}>RECURRING</Link> / PLAN</div><h1>{plan.name}</h1><p>{plan.client.name} · {plan.frequency === "MONTHLY" ? "Monthly" : "Yearly"} · {plan.isActive ? "Active" : "Paused"}</p></div>
      {canManage && <RecurringPlanStatus active={plan.isActive} planId={plan.id} setActive={setRecurringPlanActiveAction.bind(null, workspace.organizationSlug)} />}</header>
    <section className="entry-card"><h2>Plan details</h2>{canManage
      ? <RecurringPlanForm organizationSlug={workspace.organizationSlug} clients={clients} planId={plan.id} initial={initial} save={saveRecurringPlanAction.bind(null, workspace.organizationSlug)} />
      : <p>{plan.items.map((item) => `${item.description}: ${plan.currencyCode} ${item.billingMode === "FLAT_FEE" ? item.unitPrice : item.quantity.mul(item.unitPrice)}`).join(" · ")}</p>}
    </section>
    <section className="entry-card"><h2>Run history</h2><div className="recurring-table-wrap"><table className="recurring-table"><thead><tr><th>Scheduled</th><th>Result</th><th>Invoice</th><th>Details</th></tr></thead><tbody>
      {plan.runs.map((run) => { const href = run.generatedInvoice ? run.generatedInvoice.lifecycleStatus === "DRAFT" ? `${invoices}/${encodeURIComponent(run.generatedInvoice.id)}/edit` : `${invoices}/${encodeURIComponent(run.generatedInvoice.id)}` : null; return <tr key={run.id}><td>{run.scheduledFor.toISOString().slice(0, 10)}</td><td>{run.status === "GENERATED" ? "Generated" : "Failed"}</td><td>{href ? <Link href={href}>{run.generatedInvoice?.invoiceNumber ?? "Draft"}</Link> : "—"}</td><td>{run.safeFailureMessage ?? "—"}</td></tr>; })}
      {plan.runs.length === 0 && <tr><td colSpan={4}>No runs recorded yet.</td></tr>}
    </tbody></table></div></section>
    <p className="entry-hint">Resume sets the next run to the first anchored occurrence after today in Asia/Colombo. Missed occurrences are not replayed as a backlog.</p>
  </main>;
}
