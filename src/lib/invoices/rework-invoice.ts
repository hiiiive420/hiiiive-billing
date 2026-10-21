import "server-only";

import { Prisma, type InvoiceRelation } from "@/generated/prisma/client";
import { getPrismaClient } from "../prisma";

export class InvoiceReworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceReworkError";
  }
}

export type ReworkInvoiceInput = {
  organizationId: string;
  sourceInvoiceId: string;
  replacementInvoiceIds: string[];
  reason: string;
};

/** organizationId must come from trusted server-side authorization context. */
export async function supersedeInvoice(
  input: ReworkInvoiceInput,
): Promise<InvoiceRelation[]> {
  const { organizationId, sourceInvoiceId, replacementInvoiceIds, reason } = input;
  if (replacementInvoiceIds.length === 0) {
    throw new InvoiceReworkError("At least one replacement invoice is required.");
  }
  if (new Set(replacementInvoiceIds).size !== replacementInvoiceIds.length) {
    throw new InvoiceReworkError("Replacement invoice IDs must not contain duplicates.");
  }
  if (replacementInvoiceIds.includes(sourceInvoiceId)) {
    throw new InvoiceReworkError("An invoice cannot replace itself.");
  }
  if (reason.trim().length === 0) {
    throw new InvoiceReworkError("A reason is required to supersede an invoice.");
  }

  const invoiceIds = [sourceInvoiceId, ...replacementInvoiceIds];
  if (!invoiceIds.every(isUuid)) {
    throw new InvoiceReworkError("Invoice IDs must be valid UUIDs.");
  }

  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    // Lock source and targets in a stable order so concurrent rework requests
    // cannot both validate and supersede the same source.
    const idList = Prisma.join(invoiceIds.map((id) => Prisma.sql`${id}::uuid`));
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Invoice"
      WHERE "organizationId" = ${organizationId}::uuid AND "id" IN (${idList})
      ORDER BY "id"
      FOR UPDATE
    `;

    const invoices = await tx.invoice.findMany({
      where: { organizationId, id: { in: invoiceIds } },
      select: { id: true, lifecycleStatus: true },
    });
    const byId = new Map(invoices.map((invoice) => [invoice.id, invoice]));
    const source = byId.get(sourceInvoiceId);
    if (!source) {
      throw new InvoiceReworkError("Source invoice was not found in this organization.");
    }
    if (source.lifecycleStatus !== "ISSUED") {
      throw new InvoiceReworkError("Only an issued invoice may be superseded.");
    }
    if (replacementInvoiceIds.some((id) => !byId.has(id))) {
      throw new InvoiceReworkError("Every replacement invoice must belong to this organization.");
    }
    if (replacementInvoiceIds.some((id) => byId.get(id)?.lifecycleStatus !== "DRAFT")) {
      throw new InvoiceReworkError("Every replacement invoice must be a draft.");
    }

    const alreadyLinked = await tx.invoiceRelation.findFirst({
      where: {
        organizationId,
        targetInvoiceId: { in: replacementInvoiceIds },
        relationType: "REPLACED_BY",
      },
      select: { targetInvoiceId: true },
    });
    if (alreadyLinked) {
      throw new InvoiceReworkError("A replacement invoice may only be linked to one source invoice.");
    }

    const updated = await tx.invoice.updateMany({
      where: { id: sourceInvoiceId, organizationId, lifecycleStatus: "ISSUED" },
      data: { lifecycleStatus: "SUPERSEDED" },
    });
    if (updated.count !== 1) {
      throw new InvoiceReworkError("Source invoice is no longer eligible to be superseded.");
    }

    await tx.invoiceRelation.createMany({
      data: replacementInvoiceIds.map((targetInvoiceId) => ({
        organizationId,
        sourceInvoiceId,
        targetInvoiceId,
        relationType: "REPLACED_BY" as const,
        reason,
      })),
    });

    return tx.invoiceRelation.findMany({
      where: {
        organizationId,
        sourceInvoiceId,
        targetInvoiceId: { in: replacementInvoiceIds },
        relationType: "REPLACED_BY",
      },
      orderBy: { targetInvoiceId: "asc" },
    });
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
