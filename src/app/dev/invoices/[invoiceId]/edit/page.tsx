import { notFound } from "next/navigation";
import { InvoiceEntryForm } from "@/components/invoices/invoice-entry-form";
import { devInvoiceEntryAvailable } from "@/lib/invoices/invoice-entry-ui";
import { loadDraftInvoiceForEditing } from "@/lib/invoices/invoice-entry-queries";
import { getDevInvoiceOrganizationId } from "../../context";
import { saveDraftAction, saveDraftChangesAction, searchClientsAction, searchServicesAction } from "../../new/actions";

export default async function EditDraftInvoicePage({ params }: { params: Promise<{ invoiceId: string }> }) {
  if (!devInvoiceEntryAvailable(process.env.NODE_ENV)) notFound();
  const { invoiceId } = await params;
  const organizationId = await getDevInvoiceOrganizationId();
  let draft: Awaited<ReturnType<typeof loadDraftInvoiceForEditing>>;
  try {
    draft = await loadDraftInvoiceForEditing(organizationId, invoiceId);
  } catch {
    notFound();
  }
  return <InvoiceEntryForm
    invoiceId={invoiceId}
    initialDraft={draft}
    actions={{ searchClients: searchClientsAction, searchServices: searchServicesAction, saveDraft: saveDraftAction, saveDraftChanges: saveDraftChangesAction }}
    presentation={{ mode: "development", editBasePath: "/dev/invoices" }}
  />;
}
