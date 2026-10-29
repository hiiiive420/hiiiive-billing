import { notFound } from "next/navigation";
import { AuthorizationError, OrganizationContextNotFoundError, requireOrganizationBySlug } from "@/lib/auth/authorization";
import { resolveInvoiceRenderer } from "@/lib/invoice-templates/registry";
import type { InvoiceView } from "@/lib/invoice-templates/config";
import { loadSettingsWorkspace } from "@/lib/settings/workspace";
import { MasterDataLinks } from "@/components/master-data/workspace-shell";
import { InvoicePreviewScale } from "@/app/dev/invoice-preview/invoice-preview-scale";
import { InvoiceSettingsForm, OrganizationSettingsForm } from "./settings-forms";

export const dynamic = "force-dynamic";
const InvoiceRenderer = resolveInvoiceRenderer("hiiiive-default");
const previewInvoice: InvoiceView = {
  invoiceNumber: "PREVIEW", projectTitle: "Website Development", invoiceDate: "2026-01-01",
  clientName: "Sample Client", clientBillingAddress: null, currencyCode: "LKR",
  items: [{ billingMode: "FLAT_FEE", description: "Website Development", quantity: "1", unitPrice: "10000.00", lineTotal: "10000.00" }],
  subtotal: "10000.00", discountLabel: null, discountAmount: "0.00", grandTotal: "10000.00", notes: null,
};

export default async function SettingsPage({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  let workspace;
  try { workspace = await requireOrganizationBySlug(organizationSlug, "ORGANIZATION_SETTINGS"); }
  catch (error) {
    if (error instanceof OrganizationContextNotFoundError) notFound();
    return <main className="app-workspace-gate"><section className="app-workspace-card" role="status"><p className="app-workspace-brand">Hiiiive Billing</p><h1>Settings access</h1><p>{error instanceof AuthorizationError ? "You do not have permission to manage settings in this organization." : "We couldn't verify access to this workspace."}</p></section></main>;
  }
  const settings = await loadSettingsWorkspace(workspace.organizationId);
  const base = `/app/${encodeURIComponent(workspace.organizationSlug)}`;
  return <main className="entry-page entry-page-production master-data-page settings-page">
    <div className="entry-workspace-bar"><strong>Hiiiive Billing</strong><span>{workspace.organizationName}</span><span className="entry-workspace-user">{workspace.userLabel} · {workspace.role}</span></div>
    <MasterDataLinks workspace={workspace} current="settings" />
    <header className="entry-header"><div><div className="entry-eyebrow">WORKSPACE</div><div className="entry-title-row"><h1>Settings</h1></div></div></header>
    <OrganizationSettingsForm slug={workspace.organizationSlug} name={settings.organization.name} />
    {settings.template ? <>
      <InvoiceSettingsForm slug={workspace.organizationSlug} config={settings.template} />
      <section className="settings-preview entry-card" aria-labelledby="settings-preview-title">
        <div className="entry-section-heading"><div><h2 id="settings-preview-title">Invoice preview</h2><p>Sample data only. Previewing does not create an invoice or use an invoice number.</p></div></div>
        <div className="settings-preview-frame"><InvoicePreviewScale><InvoiceRenderer config={settings.template} invoice={previewInvoice} /></InvoicePreviewScale></div>
      </section>
    </> : <section className="entry-card settings-unavailable" role="status"><h2>Invoice template unavailable</h2><p>The supported active default invoice template could not be loaded. Organization settings remain available.</p></section>}
    <p className="settings-source-note">Organization name is used in the workspace. Invoice display name is printed on invoices. These values are managed separately.</p>
    <div className="settings-return"><a href={`${base}/invoices`}>Return to Invoice Workspace</a></div>
  </main>;
}
