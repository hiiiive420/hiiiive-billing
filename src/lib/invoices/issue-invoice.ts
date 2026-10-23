import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma, type Invoice } from "@/generated/prisma/client";
import { parseHiiiiveTemplateConfig } from "../invoice-templates/config";
import { resolveInvoiceRenderer } from "../invoice-templates/registry";
import { getPrismaClient } from "../prisma";
import { normalizeInvoiceCurrencyCode } from "./currency";
import { calculateInvoiceLineTotal, calculateInvoiceTotals } from "./invoice-financials";

const SEQUENCE_KEY = "DEFAULT";
const INVOICE_TIME_ZONE = "Asia/Colombo";

export class InvoiceIssuanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceIssuanceError";
  }
}

/**
 * Issues a draft belonging to the supplied organization. Callers must derive
 * organizationId from trusted server-side authorization context, never input.
 */
export async function issueInvoice(
  organizationId: string,
  invoiceId: string,
): Promise<Invoice> {
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    // Serialize issuance with draft edits so issuance cannot read stale headers/items.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Invoice"
      WHERE "organizationId" = ${organizationId}::uuid AND "id" = ${invoiceId}::uuid
      FOR UPDATE
    `;
    if (locked.length !== 1) {
      throw new InvoiceIssuanceError("Invoice was not found in this organization.");
    }
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: { items: true, client: true },
    });

    if (!invoice) {
      throw new InvoiceIssuanceError("Invoice was not found in this organization.");
    }
    if (invoice.lifecycleStatus !== "DRAFT") {
      throw new InvoiceIssuanceError("Only draft invoices may be issued.");
    }
    if (invoice.invoiceNumber !== null) {
      throw new InvoiceIssuanceError("A draft invoice must not already have a number.");
    }

    const templateVersionId = await resolveIssuanceTemplateVersion(tx, organizationId);
    let currencyCode: string;
    try {
      currencyCode = normalizeInvoiceCurrencyCode(invoice.currencyCode);
    } catch {
      throw new InvoiceIssuanceError("Invoice currency code must contain exactly three ASCII letters.");
    }
    if (invoice.items.length === 0) {
      throw new InvoiceIssuanceError("An invoice must contain at least one item.");
    }

    const discountAmount = new Prisma.Decimal(invoice.discountAmount.toString());
    if (discountAmount.isNegative()) {
      throw new InvoiceIssuanceError("Discount amount cannot be negative.");
    }

    const lineTotals = invoice.items.map((item) => {
      const quantity = new Prisma.Decimal(item.quantity.toString());
      const unitPrice = new Prisma.Decimal(item.unitPrice.toString());
      if (unitPrice.isNegative()) {
        throw new InvoiceIssuanceError("Invoice item unit price cannot be negative.");
      }
      let lineTotal: Prisma.Decimal;
      if (item.billingMode === "FLAT_FEE") {
        if (!quantity.equals(1)) {
          throw new InvoiceIssuanceError("Flat-fee items must have the canonical quantity of 1.");
        }
        if (!item.lineTotal.equals(unitPrice)) {
          throw new InvoiceIssuanceError("Flat-fee item total must equal its stored amount.");
        }
        lineTotal = unitPrice;
      } else {
        if (!quantity.greaterThan(0)) {
          throw new InvoiceIssuanceError("Invoice item quantity must be positive.");
        }
        lineTotal = calculateInvoiceLineTotal(quantity, unitPrice);
      }
      return { id: item.id, lineTotal };
    });

    const totals = calculateInvoiceTotals(lineTotals.map(({ lineTotal }) => lineTotal), discountAmount);
    if (discountAmount.greaterThan(totals.subtotal)) {
      throw new InvoiceIssuanceError("Discount amount cannot exceed subtotal.");
    }
    const issuedAt = new Date();
    const invoiceDate = invoice.invoiceDate ?? colomboCalendarDate(issuedAt);

    // Insert the first sequence row with nextValue=2 (reserving 1), or
    // atomically reserve the current nextValue and increment it under the
    // unique organization/key constraint. The sequence value commits only if
    // all following invoice writes in this transaction succeed.
    const reservations = await tx.$queryRaw<
      Array<{ prefix: string; reservedValue: number }>
    >`
      INSERT INTO "InvoiceSequence"
        ("id", "organizationId", "key", "prefix", "nextValue", "createdAt", "updatedAt")
      VALUES
        (${randomUUID()}::uuid, ${organizationId}::uuid, ${SEQUENCE_KEY}, 'I', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("organizationId", "key")
      DO UPDATE SET
        "nextValue" = "InvoiceSequence"."nextValue" + 1,
        "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "prefix", "nextValue" - 1 AS "reservedValue"
    `;
    const reservation = reservations[0];
    if (!reservation) {
      throw new Error("Invoice sequence reservation returned no value.");
    }

    const invoiceNumber = `${reservation.prefix}${formatInvoiceDate(invoiceDate)}${reservation.reservedValue}`;

    for (const { id, lineTotal } of lineTotals) {
      const itemUpdate = await tx.invoiceItem.updateMany({
        where: { id, organizationId, invoiceId },
        data: { lineTotal },
      });
      if (itemUpdate.count !== 1) {
        throw new InvoiceIssuanceError("Invoice item is no longer available in this organization.");
      }
    }

    const update = await tx.invoice.updateMany({
      where: {
        id: invoiceId,
        organizationId,
        lifecycleStatus: "DRAFT",
        invoiceNumber: null,
      },
      data: {
        invoiceNumber,
        invoiceDate,
        issuedAt,
        lifecycleStatus: "ISSUED",
        templateVersionId,
        currencyCode,
        subtotal: totals.subtotal,
        discountAmount,
        grandTotal: totals.grandTotal,
        clientNameSnapshot: invoice.client.name,
        clientBillingAddressSnapshot: invoice.client.billingAddress,
        clientEmailSnapshot: invoice.client.email,
        clientPhoneSnapshot: invoice.client.phone,
      },
    });

    if (update.count !== 1) {
      throw new InvoiceIssuanceError("Invoice is no longer a draft and cannot be issued.");
    }

    const issuedInvoice = await tx.invoice.findFirst({
      where: { id: invoiceId, organizationId },
    });
    if (!issuedInvoice) {
      throw new Error("Issued invoice could not be reloaded.");
    }

    return issuedInvoice;
  });
}

async function resolveIssuanceTemplateVersion(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> {
  const defaults = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "InvoiceTemplate"
    WHERE "organizationId" = ${organizationId}::uuid
      AND "active" = TRUE
      AND "isDefault" = TRUE
    FOR SHARE
  `;
  if (defaults.length !== 1) {
    throw new InvoiceIssuanceError("The organization must have one active default invoice template.");
  }

  const version = await tx.invoiceTemplateVersion.findFirst({
    where: { organizationId, templateId: defaults[0]!.id },
    orderBy: { version: "desc" },
  });
  if (!version || !Number.isInteger(version.version) || version.version < 1) {
    throw new InvoiceIssuanceError("The active default invoice template has no valid version.");
  }

  try {
    resolveInvoiceRenderer(version.rendererKey);
    if (version.rendererKey === "hiiiive-default") parseHiiiiveTemplateConfig(version.config);
  } catch {
    throw new InvoiceIssuanceError("The active default invoice template version is invalid or unsupported.");
  }

  return version.id;
}

function colomboCalendarDate(timestamp: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: INVOICE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(timestamp);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return new Date(
    Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)),
  );
}

function formatInvoiceDate(date: Date): string {
  const year = date.getUTCFullYear().toString().padStart(4, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  return `${year}${month}${day}`;
}
