import { notFound } from "next/navigation";
import { InvoiceEmailForm } from "@/components/invoices/invoice-email-form";
import { AuthorizationError, OrganizationContextNotFoundError, ProvisioningError, requireOrganizationBySlug } from "@/lib/auth/authorization";
import { AuthenticationError } from "@/lib/auth/identity";
import { InvoiceEmailError, loadInvoiceEmailComposerData } from "@/lib/invoices/invoice-email";
import { sendOrganizationInvoiceEmailAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function SendInvoicePage({ params }: { params: Promise<{ organizationSlug: string; invoiceId: string }> }) {
  const { organizationSlug, invoiceId } = await params;
  let workspace;
  try {
    workspace = await requireOrganizationBySlug(organizationSlug, "INVOICE_SEND");
  } catch (error) {
    if (error instanceof OrganizationContextNotFoundError) notFound();
    return <AccessMessage error={error} />;
  }

  let composer;
  try {
    composer = await loadInvoiceEmailComposerData(workspace.organizationId, invoiceId);
  } catch (error) {
    if (error instanceof InvoiceEmailError) notFound();
    return <main className="app-workspace-gate"><section className="app-workspace-card" role="alert"><h1>Email invoice</h1><p>We couldn&apos;t load this issued invoice.</p></section></main>;
  }
  const invoiceHref = `/app/${encodeURIComponent(workspace.organizationSlug)}/invoices/${encodeURIComponent(invoiceId)}`;
  const sendAction = sendOrganizationInvoiceEmailAction.bind(null, workspace.organizationSlug, invoiceId);
  return <InvoiceEmailForm
    invoiceNumber={composer.invoice.invoiceNumber}
    fromDisplay={composer.fromDisplay}
    senderConfigured={composer.senderConfigured}
    attachmentFilename={composer.attachmentFilename}
    initialTo={composer.invoice.suggestedTo}
    subject={composer.defaults.subject}
    bodyText={composer.defaults.bodyText}
    recentAttempts={composer.recentAttempts}
    invoiceHref={invoiceHref}
    sendAction={sendAction}
  />;
}

function AccessMessage({ error }: { error: unknown }) {
  const message = process.env.NODE_ENV !== "production" && (error instanceof AuthenticationError || error instanceof ProvisioningError)
    ? error.message
    : error instanceof AuthorizationError
      ? "You do not have permission to send invoices in this organization."
      : "We couldn't verify access to this workspace.";
  return <main className="app-workspace-gate"><section className="app-workspace-card" role="status"><p className="app-workspace-brand">Hiiiive Billing</p><h1>Workspace access</h1><p>{message}</p></section></main>;
}
