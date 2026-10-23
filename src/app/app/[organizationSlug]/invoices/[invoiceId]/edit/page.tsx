import { notFound } from "next/navigation";
import { InvoiceEntryForm } from "@/components/invoices/invoice-entry-form";
import { AuthorizationError, OrganizationContextNotFoundError, ProvisioningError, requireOrganizationBySlug } from "@/lib/auth/authorization";
import { AuthenticationError } from "@/lib/auth/identity";
import { loadDraftInvoiceForEditing } from "@/lib/invoices/invoice-entry-queries";
import { searchEditClientsAction, searchEditServicesAction, updateOrganizationDraftAction } from "../../actions";

export default async function EditOrganizationDraftPage({ params }: { params: Promise<{ organizationSlug: string; invoiceId: string }> }) {
  const { organizationSlug, invoiceId } = await params;
  let workspace;
  try {
    workspace = await requireOrganizationBySlug(organizationSlug, "INVOICE_EDIT_DRAFT");
  } catch (error) {
    if (error instanceof OrganizationContextNotFoundError) notFound();
    return <AccessMessage error={error} />;
  }

  let draft;
  try {
    draft = await loadDraftInvoiceForEditing(workspace.organizationId, invoiceId);
  } catch {
    notFound();
  }
  const searchClients = searchEditClientsAction.bind(null, workspace.organizationSlug);
  const searchServices = searchEditServicesAction.bind(null, workspace.organizationSlug);
  const saveDraftChanges = updateOrganizationDraftAction.bind(null, workspace.organizationSlug);

  return <InvoiceEntryForm
    invoiceId={invoiceId}
    initialDraft={draft}
    actions={{ searchClients, searchServices, saveDraftChanges }}
    presentation={{
      mode: "production",
      organizationName: workspace.organizationName,
      userLabel: workspace.userLabel,
      role: workspace.role,
      editBasePath: `/app/${encodeURIComponent(workspace.organizationSlug)}/invoices`,
    }}
  />;
}

function AccessMessage({ error }: { error: unknown }) {
  const message = process.env.NODE_ENV !== "production" && (error instanceof AuthenticationError || error instanceof ProvisioningError)
    ? error.message
    : error instanceof AuthorizationError
      ? "You do not have permission to edit drafts in this organization."
      : "We couldn't verify access to this workspace.";
  return <main className="app-workspace-gate"><section className="app-workspace-card" role="status">
    <p className="app-workspace-brand">Hiiiive Billing</p><h1>Workspace access</h1><p>{message}</p>
  </section></main>;
}
