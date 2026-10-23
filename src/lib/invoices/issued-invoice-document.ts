import "server-only";

import type { InvoiceView } from "../invoice-templates/config";
import { parseHiiiiveTemplateConfig } from "../invoice-templates/config";
import { resolveInvoiceRenderer } from "../invoice-templates/registry";
import { getPrismaClient } from "../prisma";

const documentLifecycleStatuses = ["ISSUED", "SUPERSEDED", "VOID", "WRITTEN_OFF"] as const;

export class IssuedInvoiceDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IssuedInvoiceDocumentError";
  }
}

export type IssuedInvoiceDocument = Readonly<{
  rendererKey: string;
  config: unknown;
  invoice: InvoiceView;
}>;

/** Callers must derive organizationId from trusted server-side authorization context. */
export async function loadIssuedInvoiceDocument(
  organizationId: string,
  invoiceId: string,
): Promise<IssuedInvoiceDocument> {
  const prisma = getPrismaClient();
  const invoice = await prisma.invoice.findFirst({
    where: { organizationId, id: invoiceId },
    select: {
      id: true,
      organizationId: true,
      lifecycleStatus: true,
      templateVersionId: true,
      invoiceNumber: true,
      projectTitle: true,
      invoiceDate: true,
      clientNameSnapshot: true,
      clientBillingAddressSnapshot: true,
      currencyCode: true,
      subtotal: true,
      discountLabel: true,
      discountAmount: true,
      grandTotal: true,
      notes: true,
      templateVersion: { select: { rendererKey: true, config: true } },
      items: {
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: { description: true, billingMode: true, quantity: true, unitPrice: true, lineTotal: true },
      },
    },
  });

  if (!invoice) {
    throw new IssuedInvoiceDocumentError("Invoice was not found in this organization.");
  }
  if (!(documentLifecycleStatuses as readonly string[]).includes(invoice.lifecycleStatus)) {
    throw new IssuedInvoiceDocumentError("Only issued or closed invoices can be rendered as official documents.");
  }
  if (!invoice.invoiceNumber) {
    throw new IssuedInvoiceDocumentError("The issued invoice has no persisted invoice number.");
  }
  if (!invoice.invoiceDate) {
    throw new IssuedInvoiceDocumentError("The issued invoice has no persisted invoice date.");
  }
  if (!invoice.clientNameSnapshot) {
    throw new IssuedInvoiceDocumentError("The issued invoice has no client name snapshot.");
  }
  if (!invoice.templateVersionId || !invoice.templateVersion) {
    throw new IssuedInvoiceDocumentError(
      "The issued invoice has no frozen template version; explicit historical handling is required.",
    );
  }

  let config: unknown;
  try {
    resolveInvoiceRenderer(invoice.templateVersion.rendererKey);
    if (invoice.templateVersion.rendererKey !== "hiiiive-default") {
      throw new Error("Unsupported invoice renderer.");
    }
    config = parseHiiiiveTemplateConfig(invoice.templateVersion.config);
  } catch {
    throw new IssuedInvoiceDocumentError("The invoice's frozen template renderer or configuration is invalid.");
  }

  return {
    rendererKey: invoice.templateVersion.rendererKey,
    config,
    invoice: {
      invoiceNumber: invoice.invoiceNumber,
      projectTitle: invoice.projectTitle,
      invoiceDate: invoice.invoiceDate.toISOString().slice(0, 10),
      clientName: invoice.clientNameSnapshot,
      clientBillingAddress: invoice.clientBillingAddressSnapshot,
      currencyCode: invoice.currencyCode,
      items: invoice.items.map((item) => ({
        description: item.description,
        billingMode: item.billingMode,
        quantity: item.quantity.toString(),
        unitPrice: item.unitPrice.toString(),
        lineTotal: item.lineTotal.toString(),
      })),
      subtotal: invoice.subtotal.toString(),
      discountLabel: invoice.discountLabel,
      discountAmount: invoice.discountAmount.toString(),
      grandTotal: invoice.grandTotal.toString(),
      notes: invoice.notes,
    },
  };
}
