import { notFound } from "next/navigation";
import { devInvoiceEntryAvailable } from "@/lib/invoices/invoice-entry-ui";
import { InvoiceEntryForm } from "./invoice-entry-form";

export default function NewInvoicePage() {
  if (!devInvoiceEntryAvailable(process.env.NODE_ENV)) notFound();
  return <InvoiceEntryForm />;
}
