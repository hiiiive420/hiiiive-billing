import "server-only";

import { Prisma, type Payment, type PaymentMethod } from "@/generated/prisma/client";
import { getPrismaClient } from "../prisma";

export class PaymentRecordingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentRecordingError";
  }
}

export type RecordPaymentInput = {
  amount: string;
  paidAt: Date;
  method: PaymentMethod;
  reference?: string | null;
  internalNote?: string | null;
};

/** Callers must derive organizationId from trusted server-side authorization context. */
export async function recordPayment(
  organizationId: string,
  invoiceId: string,
  input: RecordPaymentInput,
): Promise<Payment> {
  let amount: Prisma.Decimal;
  try {
    amount = new Prisma.Decimal(input.amount);
  } catch {
    throw new PaymentRecordingError("Payment amount must be a valid decimal value.");
  }

  if (!amount.isFinite() || !amount.greaterThan(0)) {
    throw new PaymentRecordingError("Payment amount must be greater than zero.");
  }
  if (amount.decimalPlaces() > 4) {
    throw new PaymentRecordingError("Payment amount cannot have more than four decimal places.");
  }
  if (!(input.paidAt instanceof Date) || Number.isNaN(input.paidAt.getTime())) {
    throw new PaymentRecordingError("Payment date is invalid.");
  }

  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Invoice"
      WHERE "organizationId" = ${organizationId}::uuid AND "id" = ${invoiceId}::uuid
      FOR UPDATE
    `;
    if (lockedRows.length === 0) {
      throw new PaymentRecordingError("Invoice was not found in this organization.");
    }

    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      select: { id: true, lifecycleStatus: true, grandTotal: true },
    });
    if (!invoice) {
      throw new PaymentRecordingError("Invoice was not found in this organization.");
    }
    if (invoice.lifecycleStatus !== "ISSUED") {
      throw new PaymentRecordingError("Payments can only be recorded for issued invoices.");
    }

    const payment = await tx.payment.create({
      data: {
        organizationId,
        invoiceId,
        amount,
        paidAt: input.paidAt,
        method: input.method,
        reference: input.reference ?? null,
        internalNote: input.internalNote ?? null,
      },
    });

    const paymentTotal = (await tx.payment.aggregate({
      where: { organizationId, invoiceId },
      _sum: { amount: true },
    }))._sum.amount ?? new Prisma.Decimal(0);

    const paymentStatus = paymentTotal.isZero()
      ? "UNPAID"
      : paymentTotal.lessThan(invoice.grandTotal)
        ? "PARTIALLY_PAID"
        : "PAID";

    const update = await tx.invoice.updateMany({
      where: { id: invoiceId, organizationId, lifecycleStatus: "ISSUED" },
      data: { paymentStatus },
    });
    if (update.count !== 1) {
      throw new PaymentRecordingError("Invoice is no longer eligible to receive payments.");
    }

    return payment;
  });
}
