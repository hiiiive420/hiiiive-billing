import { notFound } from "next/navigation";
import { devSampleInvoice, devSampleTemplateConfig } from "@/lib/invoice-templates/dev-sample";
import { generateInvoicePdf, invoicePdfFilename } from "@/lib/invoice-templates/generate-pdf";

export const runtime = "nodejs";

export async function GET() {
  if (process.env.NODE_ENV === "production") notFound();

  const pdf = await generateInvoicePdf({
    rendererKey: "hiiiive-default",
    config: devSampleTemplateConfig,
    invoice: devSampleInvoice,
  });
  const filename = invoicePdfFilename(devSampleInvoice.invoiceNumber);

  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
