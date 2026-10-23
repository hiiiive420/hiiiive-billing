import { notFound } from "next/navigation";
import { devInvoiceEntryAvailable } from "@/lib/invoices/invoice-entry-ui";
import { InvoiceEntryForm } from "@/components/invoices/invoice-entry-form";
import { saveDraftAction, saveDraftChangesAction, searchClientsAction, searchServicesAction } from "./actions";

export default function NewInvoicePage() {
  if (!devInvoiceEntryAvailable(process.env.NODE_ENV)) notFound();
  return <InvoiceEntryForm
    actions={{ searchClients: searchClientsAction, searchServices: searchServicesAction, saveDraft: saveDraftAction, saveDraftChanges: saveDraftChangesAction }}
    presentation={{ mode: "development", editBasePath: "/dev/invoices" }}
  />;
}
