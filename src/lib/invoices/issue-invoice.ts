import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma, type Invoice } from "@/generated/prisma/client";
import { getPrismaClient } from "../prisma";
import { normalizeInvoiceCurrencyCode } from "./currency";

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
    let currencyCode: string;
    try {
      currencyCode = normalizeInvoiceCurrencyCode(invoice.currencyCode);
    } catch {
      throw new InvoiceIssuanceError("Invoice currency code must contain exactly three ASCII letters.");
    }
    if (invoice.items.length === 0) {
      throw new InvoiceIssuanceError("An invoice must contain at least one item.");
    }

    const zero = new Prisma.Decimal(0);
    const discountAmount = new Prisma.Decimal(invoice.discountAmount.toString());
    if (discountAmount.isNegative()) {
      throw new InvoiceIssuanceError("Discount amount cannot be negative.");
    }

    let subtotal = zero;
    const lineTotals = invoice.items.map((item) => {
      const quantity = new Prisma.Decimal(item.quantity.toString());
      const unitPrice = new Prisma.Decimal(item.unitPrice.toString());
      if (quantity.isNegative()) {
        throw new InvoiceIssuanceError("Invoice item quantity cannot be negative.");
      }
      if (unitPrice.isNegative()) {
        throw new InvoiceIssuanceError("Invoice item unit price cannot be negative.");
      }

      const lineTotal = quantity
        .mul(unitPrice)
        .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
      subtotal = subtotal.plus(lineTotal);
      return { id: item.id, lineTotal };
    });

    if (discountAmount.greaterThan(subtotal)) {
      throw new InvoiceIssuanceError("Discount amount cannot exceed subtotal.");
    }

    const grandTotal = subtotal.minus(discountAmount);
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
        currencyCode,
        subtotal,
        discountAmount,
        grandTotal,
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
