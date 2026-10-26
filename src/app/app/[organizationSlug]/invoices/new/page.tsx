import { notFound } from "next/navigation";
import { InvoiceEntryForm } from "@/components/invoices/invoice-entry-form";
import { requireOrganizationBySlug, OrganizationContextNotFoundError, AuthorizationError, ProvisioningError } from "@/lib/auth/authorization";
import { AuthenticationError } from "@/lib/auth/identity";
import { createOrganizationDraftAction, generateInvoiceIntentAction, searchCreateClientsAction, searchCreateServicesAction } from "../actions";

export default async function NewOrganizationInvoicePage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  let workspace;
  try {
    workspace = await requireOrganizationBySlug(organizationSlug, "INVOICE_CREATE");
  } catch (error) {
    if (error instanceof OrganizationContextNotFoundError) notFound();
    return <AccessMessage error={error} />;
  }
  const searchClients = searchCreateClientsAction.bind(null, workspace.organizationSlug);
  const searchServices = searchCreateServicesAction.bind(null, workspace.organizationSlug);
  const saveDraft = createOrganizationDraftAction.bind(null, workspace.organizationSlug);
  const generateIntent = generateInvoiceIntentAction.bind(null, workspace.organizationSlug);

  return <InvoiceEntryForm
    actions={{ searchClients, searchServices, saveDraft, generateIntent }}
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
      ? "You do not have permission to create invoices in this organization."
      : "We couldn't verify access to this workspace.";
  return <main className="app-workspace-gate"><section className="app-workspace-card" role="status">
    <p className="app-workspace-brand">Hiiiive Billing</p><h1>Workspace access</h1><p>{message}</p>
  </section></main>;
}
