import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { InvoiceLifecycleStatus, InvoicePaymentStatus, PaymentMethod } from "@/generated/prisma/enums";
import { getPrismaClient } from "../prisma";

export class InvoicePaymentReadModelError extends Error {
  constructor(message = "Payment information is temporarily unavailable.") {
    super(message);
    this.name = "InvoicePaymentReadModelError";
  }
}

export type InvoicePaymentSummary = Readonly<{
  invoiceId: string;
  invoiceNumber: string | null;
  lifecycleStatus: InvoiceLifecycleStatus;
  paymentStatus: InvoicePaymentStatus;
  clientName: string;
  currencyCode: string;
  grandTotal: string;
  totalPaid: string;
  balanceDue: string;
  overpaidAmount: string;
  payments: readonly Readonly<{
    id: string;
    amount: string;
    paidAt: string;
    method: PaymentMethod;
    reference: string | null;
    internalNote: string | null;
    createdAt: string;
  }>[];
}>;

/** organizationId must come from trusted server-side authorization context. */
export async function loadInvoicePaymentSummary(organizationId: string, invoiceId: string): Promise<InvoicePaymentSummary> {
  const invoice = await getPrismaClient().invoice.findFirst({
    where: { id: invoiceId, organizationId },
    select: {
      id: true, invoiceNumber: true, lifecycleStatus: true, paymentStatus: true,
      currencyCode: true, grandTotal: true, clientNameSnapshot: true,
      client: { select: { name: true } },
      payments: {
        where: { organizationId },
        orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        select: { id: true, amount: true, paidAt: true, method: true, reference: true, internalNote: true, createdAt: true },
      },
    },
  });
  if (!invoice) throw new InvoicePaymentReadModelError("Invoice was not found in this organization.");

  const totalPaid = invoice.payments.reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0));
  const expectedStatus: InvoicePaymentStatus = totalPaid.isZero()
    ? "UNPAID"
    : totalPaid.lessThan(invoice.grandTotal) ? "PARTIALLY_PAID" : "PAID";
  if (expectedStatus !== invoice.paymentStatus) {
    throw new InvoicePaymentReadModelError("Payment information does not match the saved invoice status.");
  }
  const balanceDue = Prisma.Decimal.max(invoice.grandTotal.minus(totalPaid), new Prisma.Decimal(0));
  const overpaidAmount = Prisma.Decimal.max(totalPaid.minus(invoice.grandTotal), new Prisma.Decimal(0));
  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    lifecycleStatus: invoice.lifecycleStatus,
    paymentStatus: invoice.paymentStatus,
    clientName: invoice.lifecycleStatus === "DRAFT"
      ? invoice.client.name
      : invoice.clientNameSnapshot ?? invoice.client.name,
    currencyCode: invoice.currencyCode,
    grandTotal: invoice.grandTotal.toString(),
    totalPaid: totalPaid.toString(),
    balanceDue: balanceDue.toString(),
    overpaidAmount: overpaidAmount.toString(),
    payments: invoice.payments.map((payment) => ({
      id: payment.id,
      amount: payment.amount.toString(),
      paidAt: payment.paidAt.toISOString(),
      method: payment.method,
      reference: payment.reference,
      internalNote: payment.internalNote,
      createdAt: payment.createdAt.toISOString(),
    })),
  };
}
