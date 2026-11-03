import { notFound } from "next/navigation";
import { WorkspaceHeader } from "@/components/master-data/workspace-shell";
import { RecurringPlanForm } from "@/components/recurring/recurring-plan-form";
import { requireOrganizationBySlug } from "@/lib/auth/authorization";
import { listRecurringClients } from "@/lib/recurring/recurring-invoices";
import { saveRecurringPlanAction } from "../actions";
import { sendInvoMessage } from "../../invo/actions";

export default async function NewRecurringPlanPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  let workspace;
  try { workspace = await requireOrganizationBySlug(organizationSlug, "RECURRING_INVOICE_MANAGE"); } catch { notFound(); }
  const clients = await listRecurringClients(workspace.organizationId);
  const invo = sendInvoMessage.bind(null, workspace.organizationSlug);
  return <main className="entry-page entry-page-production"><WorkspaceHeader workspace={workspace} current="recurring" />
    <header className="entry-header"><div><div className="entry-eyebrow">RECURRING / NEW</div><h1>New recurring plan</h1><p>Each scheduled occurrence creates an editable invoice draft.</p></div></header>
    <RecurringPlanForm organizationSlug={workspace.organizationSlug} clients={clients} invo={invo} save={saveRecurringPlanAction.bind(null, workspace.organizationSlug)} />
  </main>;
}
