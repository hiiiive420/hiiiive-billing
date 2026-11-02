import Link from "next/link";
import { createElement } from "react";
import { notFound } from "next/navigation";
import { IssueInvoiceControl } from "@/components/invoices/issue-invoice-control";
import { WorkspaceHeader } from "@/components/master-data/workspace-shell";
import { AuthorizationError, OrganizationContextNotFoundError, requireOrganizationBySlug } from "@/lib/auth/authorization";
import { DraftInvoicePreviewError, loadDraftInvoicePreview } from "@/lib/invoices/draft-invoice-preview";
import { resolveInvoiceRenderer } from "@/lib/invoice-templates/registry";
import { issueOrganizationInvoiceAction } from "../../actions";
import { InvoicePreviewScale } from "@/app/dev/invoice-preview/invoice-preview-scale";

export const dynamic = "force-dynamic";

export default async function OrganizationDraftPreviewPage({ params }: { params: Promise<{ organizationSlug: string; invoiceId: string }> }) {
  const { organizationSlug, invoiceId } = await params;
  let workspace;
  try { workspace = await requireOrganizationBySlug(organizationSlug, "INVOICE_EDIT_DRAFT"); }
  catch (error) {
    if (error instanceof OrganizationContextNotFoundError) notFound();
    return <main className="preview-shell"><p role="alert">{error instanceof AuthorizationError ? "You do not have permission to preview this invoice." : "We couldn't verify access to this workspace."}</p></main>;
  }
  let document;
  try { document = await loadDraftInvoicePreview(workspace.organizationId, invoiceId); }
  catch (error) {
    if (error instanceof DraftInvoicePreviewError) notFound();
    return <main className="preview-shell"><p role="alert">We couldn&apos;t prepare this draft preview. Check the draft and active invoice template.</p></main>;
  }
  const invoiceDocument = createElement(resolveInvoiceRenderer(document.rendererKey), { config: document.config, invoice: document.invoice });
  const basePath = `/app/${encodeURIComponent(workspace.organizationSlug)}/invoices`;
  const issue = issueOrganizationInvoiceAction.bind(null, workspace.organizationSlug, invoiceId);
  return <main className="preview-shell">
    <WorkspaceHeader workspace={workspace} current="invoices" />
    <header className="preview-banner invoice-document-toolbar">
      <div className="invoice-document-context">
        <nav aria-label="Breadcrumb"><Link href={basePath}>Invoices</Link><span aria-hidden="true">/</span><Link href={`${basePath}/${encodeURIComponent(invoiceId)}/edit`}>Edit draft</Link></nav>
        <div className="invoice-document-title"><h1>Draft preview</h1><span className="invoice-status-chip status-chip status-chip-draft">Not issued</span></div>
        <p>This preview uses the current client details and active default template. They remain editable until the invoice is issued.</p>
      </div>
      <div className="document-actions">
        <Link className="entry-button entry-button-light" href={`${basePath}/${encodeURIComponent(invoiceId)}/edit`}>Back to Edit</Link>
        <IssueInvoiceControl issue={issue} invoiceBasePath={basePath} />
      </div>
    </header>
    <InvoicePreviewScale>{invoiceDocument}</InvoicePreviewScale>
  </main>;
}