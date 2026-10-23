import { AuthorizationError, OrganizationContextNotFoundError, requireOrganizationBySlug } from "@/lib/auth/authorization";
import { generateIssuedInvoicePdf } from "@/lib/invoices/generate-issued-invoice-pdf";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ organizationSlug: string; invoiceId: string }> }) {
  const { organizationSlug, invoiceId } = await params;
  let organizationId: string;
  try { ({ organizationId } = await requireOrganizationBySlug(organizationSlug, "INVOICE_READ")); }
  catch (error) {
    const status = error instanceof OrganizationContextNotFoundError ? 404 : error instanceof AuthorizationError ? 403 : 401;
    return new Response("This invoice is not available.", { status, headers: { "Cache-Control": "private, no-store" } });
  }
  try {
    const pdf = await generateIssuedInvoicePdf(organizationId, invoiceId);
    return new Response(new Uint8Array(pdf.bytes), { status: 200, headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdf.filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return new Response("This invoice PDF could not be generated.", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  }
}
