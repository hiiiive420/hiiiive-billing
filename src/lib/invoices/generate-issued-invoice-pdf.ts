import "server-only";

import { generateInvoicePdf, invoicePdfFilename } from "../invoice-templates/generate-pdf";
import { loadIssuedInvoiceDocument } from "./issued-invoice-document";

export type IssuedInvoicePdf = Readonly<{
  filename: string;
  bytes: Uint8Array;
}>;

/** Loads and renders only a persisted invoice in an issued or closed lifecycle state. */
export async function generateIssuedInvoicePdf(
  organizationId: string,
  invoiceId: string,
): Promise<IssuedInvoicePdf> {
  const document = await loadIssuedInvoiceDocument(organizationId, invoiceId);
  const filename = invoicePdfFilename(document.invoice.invoiceNumber);
  const bytes = await generateInvoicePdf(document);
  return {
    filename,
    bytes,
  };
}
