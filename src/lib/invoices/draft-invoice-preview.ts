import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { parseHiiiiveTemplateConfig } from "../invoice-templates/config";
import { resolveInvoiceRenderer } from "../invoice-templates/registry";
import { getPrismaClient } from "../prisma";
import { normalizeInvoiceCurrencyCode } from "./currency";
import { calculateInvoiceLineTotal, calculateInvoiceTotals } from "./invoice-financials";

export class DraftInvoicePreviewError extends Error {
  constructor(message: string) { super(message); this.name = "DraftInvoicePreviewError"; }
}

export type DraftInvoicePreview = Readonly<{ rendererKey: string; config: unknown; invoice: {
  invoiceNumber: string; projectTitle: string | null; invoiceDate: string; clientName: string;
  clientBillingAddress: string | null; currencyCode: string;
  items: { description: string; billingMode: "QUANTITY" | "FLAT_FEE"; quantity: string; unitPrice: string; lineTotal: string }[];
  subtotal: string; discountLabel: string | null; discountAmount: string; grandTotal: string; notes: string | null;
} }>;

/** Read-only DRAFT preview using the current active default template and current client details. */
export async function loadDraftInvoicePreview(organizationId: string, invoiceId: string): Promise<DraftInvoicePreview> {
  const prisma = getPrismaClient();
  const invoice = await prisma.invoice.findFirst({
    where: { organizationId, id: invoiceId, lifecycleStatus: "DRAFT", invoiceNumber: null, issuedAt: null },
    select: { projectTitle: true, invoiceDate: true, currencyCode: true, discountLabel: true, discountAmount: true, notes: true,
      client: { select: { name: true, billingAddress: true } },
      items: { where: { organizationId }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { description: true, billingMode: true, quantity: true, unitPrice: true, lineTotal: true } },
    },
  });
  if (!invoice) throw new DraftInvoicePreviewError("Draft invoice was not found in this organization.");
  if (invoice.items.length === 0) throw new DraftInvoicePreviewError("A draft needs at least one item before it can be previewed.");
  const templates = await prisma.invoiceTemplate.findMany({ where: { organizationId, active: true, isDefault: true }, select: { id: true }, take: 2 });
  if (templates.length !== 1) throw new DraftInvoicePreviewError("The organization must have one active default invoice template to preview.");
  const version = await prisma.invoiceTemplateVersion.findFirst({ where: { organizationId, templateId: templates[0]!.id }, orderBy: { version: "desc" }, select: { rendererKey: true, config: true, version: true } });
  if (!version || !Number.isInteger(version.version) || version.version < 1) throw new DraftInvoicePreviewError("The active default invoice template has no valid version.");
  let config: unknown;
  try {
    resolveInvoiceRenderer(version.rendererKey);
    if (version.rendererKey !== "hiiiive-default") throw new Error("Unsupported renderer");
    config = parseHiiiiveTemplateConfig(version.config);
  } catch { throw new DraftInvoicePreviewError("The active default invoice template version is invalid or unsupported."); }
  let currencyCode: string;
  try { currencyCode = normalizeInvoiceCurrencyCode(invoice.currencyCode); }
  catch { throw new DraftInvoicePreviewError("Invoice currency code is invalid."); }
  try {
    const lineTotals = invoice.items.map((item) => {
      const quantity = new Prisma.Decimal(item.quantity.toString());
      const unitPrice = new Prisma.Decimal(item.unitPrice.toString());
      if (unitPrice.isNegative()) throw new Error();
      if (item.billingMode === "FLAT_FEE") {
        if (!quantity.equals(1) || !item.lineTotal.equals(unitPrice)) throw new Error();
        return unitPrice;
      }
      if (!quantity.greaterThan(0)) throw new Error();
      return calculateInvoiceLineTotal(quantity, unitPrice);
    });
    const discountAmount = new Prisma.Decimal(invoice.discountAmount.toString());
    const totals = calculateInvoiceTotals(lineTotals, discountAmount);
    if (discountAmount.isNegative() || totals.grandTotal.isNegative()) throw new Error();
    const date = invoice.invoiceDate ?? new Date();
    const dateParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const dateFields = Object.fromEntries(dateParts.map((part) => [part.type, part.value]));
    return { rendererKey: version.rendererKey, config, invoice: {
      invoiceNumber: "DRAFT PREVIEW", projectTitle: invoice.projectTitle,
      invoiceDate: `${dateFields.year}-${dateFields.month}-${dateFields.day}`,
      clientName: invoice.client.name, clientBillingAddress: invoice.client.billingAddress, currencyCode,
      items: invoice.items.map((item, index) => ({ description: item.description, billingMode: item.billingMode,
        quantity: item.billingMode === "FLAT_FEE" ? "1" : item.quantity.toString(), unitPrice: item.unitPrice.toString(), lineTotal: lineTotals[index]!.toString() })),
      subtotal: totals.subtotal.toString(), discountLabel: invoice.discountLabel, discountAmount: discountAmount.toString(), grandTotal: totals.grandTotal.toString(), notes: invoice.notes,
    } };
  } catch { throw new DraftInvoicePreviewError("Draft financial values are invalid and cannot be previewed."); }
}
