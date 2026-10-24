import Link from "next/link";
import { createElement } from "react";
import { notFound } from "next/navigation";
import { AuthorizationError, hasPermission, OrganizationContextNotFoundError, requireOrganizationBySlug } from "@/lib/auth/authorization";
import { loadIssuedInvoiceDocument, IssuedInvoiceDocumentError } from "@/lib/invoices/issued-invoice-document";
import { resolveInvoiceRenderer } from "@/lib/invoice-templates/registry";
import { InvoicePreviewScale } from "@/app/dev/invoice-preview/invoice-preview-scale";

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
  const basePath = `/app/${encodeURIComponent(workspace.organizationSlug)}/invoices/${encodeURIComponent(invoiceId)}`;
  return <main className="preview-shell">
    <div className="preview-banner"><strong>{document.invoice.invoiceNumber}</strong> | {document.lifecycleStatus.replaceAll("_", " ")} | {document.paymentStatus.replaceAll("_", " ")}
      <div className="document-actions"><Link className="entry-button entry-button-light" href={`${basePath}/pdf`} download>Download PDF</Link>{document.lifecycleStatus === "ISSUED" && hasPermission(workspace.role, "INVOICE_SEND") && <Link className="entry-button entry-button-primary" href={`${basePath}/send`}>Send Invoice</Link>}</div>
    </div>
    <InvoicePreviewScale>{invoiceDocument}</InvoicePreviewScale>
  </main>;
}
