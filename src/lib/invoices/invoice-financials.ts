import { Prisma } from "@/generated/prisma/client";

/** Shared precision rules for draft editing and final issuance recalculation. */
export function calculateInvoiceLineTotal(
  quantity: Prisma.Decimal,
  unitPrice: Prisma.Decimal,
): Prisma.Decimal {
  return quantity.mul(unitPrice).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

export function calculateInvoiceTotals(
  lineTotals: readonly Prisma.Decimal[],
  discountAmount: Prisma.Decimal,
): { subtotal: Prisma.Decimal; grandTotal: Prisma.Decimal } {
  const subtotal = lineTotals.reduce(
    (total, lineTotal) => total.plus(lineTotal),
    new Prisma.Decimal(0),
  );
  return { subtotal, grandTotal: subtotal.minus(discountAmount) };
}
