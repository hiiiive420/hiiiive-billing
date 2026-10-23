import { notFound } from "next/navigation";
import { devInvoiceEntryAvailable } from "@/lib/invoices/invoice-entry-ui";
import { loadDraftInvoiceForEditing } from "@/lib/invoices/invoice-entry-queries";
import { getDevInvoiceOrganizationId } from "../../context";
import { InvoiceEntryForm } from "../../new/invoice-entry-form";

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
  return <InvoiceEntryForm invoiceId={invoiceId} initialDraft={draft} />;
}
