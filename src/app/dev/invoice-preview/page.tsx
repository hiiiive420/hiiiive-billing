import { notFound } from "next/navigation";
import { resolveInvoiceRenderer } from "@/lib/invoice-templates/registry";
import { devSampleInvoice, devSampleTemplateConfig } from "@/lib/invoice-templates/dev-sample";
import { InvoicePreviewScale } from "./invoice-preview-scale";

const InvoiceRenderer = resolveInvoiceRenderer("hiiiive-default");

export default function InvoicePreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="preview-shell">
      <div className="preview-banner">
        <strong>Development preview</strong> | Static sample invoice | Not connected to invoice data
        <span> | </span><a href="/dev/invoice-preview/pdf">Download sample PDF</a>
      </div>
      <InvoicePreviewScale><InvoiceRenderer config={devSampleTemplateConfig} invoice={devSampleInvoice} /></InvoicePreviewScale>
    </main>
  );
}
