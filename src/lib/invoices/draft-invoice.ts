import "server-only";

import { Prisma, type Invoice } from "@/generated/prisma/client";
import { getPrismaClient } from "../prisma";
import { normalizeInvoiceCurrencyCode } from "./currency";
import { calculateInvoiceLineTotal, calculateInvoiceTotals } from "./invoice-financials";

export class DraftInvoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftInvoiceError";
  }
}

export type DraftInvoiceItemInput = Readonly<{
  serviceId?: string | null;
  description: string;
  quantity: string;
  /** Omit only when explicitly requesting the service's default price. */
  unitPrice?: string;
  useServiceDefaultPrice?: boolean;
  position?: number;
}>;

export type CreateDraftInvoiceInput = Readonly<{
  clientId: string;
  projectTitle?: string | null;
  invoiceDate?: Date | null;
  dueDate?: Date | null;
  currencyCode?: string;
  discountLabel?: string | null;
  discountAmount?: string;
  notes?: string | null;
  paymentTerms?: string | null;
  items: readonly DraftInvoiceItemInput[];
}>;

export type UpdateDraftInvoiceInput = Readonly<{
  clientId?: string;
  projectTitle?: string | null;
  invoiceDate?: Date | null;
  dueDate?: Date | null;
  currencyCode?: string;
  discountLabel?: string | null;
  discountAmount?: string;
  notes?: string | null;
  paymentTerms?: string | null;
}>;

type PreparedItem = {
  serviceId: string | null;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  position: number;
};

/** Create an unnumbered draft. organizationId must come from trusted server context. */
export async function createDraftInvoice(
  organizationId: string,
  input: CreateDraftInvoiceInput,
): Promise<Invoice> {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    await requireActiveClient(tx, organizationId, input.clientId);
    const currencyCode = normalizeCurrency(input.currencyCode ?? "LKR");
    const items = await prepareItems(tx, organizationId, currencyCode, input.items);
    const discountAmount = parseDecimal(input.discountAmount ?? "0", "Discount amount");
    const totals = calculateAndValidateTotals(items, discountAmount);

    const invoice = await tx.invoice.create({
      data: {
        organizationId,
        clientId: input.clientId,
        projectTitle: input.projectTitle ?? null,
        invoiceDate: validDate(input.invoiceDate, "Invoice date"),
        dueDate: validDate(input.dueDate, "Due date"),
        currencyCode,
        discountLabel: input.discountLabel ?? null,
        discountAmount,
        subtotal: totals.subtotal,
        grandTotal: totals.grandTotal,
        notes: input.notes ?? null,
        paymentTerms: input.paymentTerms ?? null,
      },
    });
    await tx.invoiceItem.createMany({
      data: items.map((item) => ({ ...item, organizationId, invoiceId: invoice.id })),
    });
    return invoice;
  });
}

/** Update draft header fields and recalculate totals from its persisted item inputs. */
export async function updateDraftInvoice(
  organizationId: string,
  invoiceId: string,
  input: UpdateDraftInvoiceInput,
): Promise<Invoice> {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const invoice = await lockAndLoadDraft(tx, organizationId, invoiceId);
    if (input.clientId !== undefined) await requireActiveClient(tx, organizationId, input.clientId);
    const currencyCode = input.currencyCode === undefined
      ? normalizeCurrency(invoice.currencyCode)
      : normalizeCurrency(input.currencyCode);
    const currentItems = await tx.invoiceItem.findMany({
      where: { organizationId, invoiceId },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    });
    if (currentItems.length === 0) throw new DraftInvoiceError("A draft invoice must contain at least one item.");
    const items: PreparedItem[] = currentItems.map((item) => {
      const quantity = decimalFromDb(item.quantity);
      const unitPrice = decimalFromDb(item.unitPrice);
      if (!quantity.greaterThan(0) || unitPrice.isNegative()) {
        throw new DraftInvoiceError("Existing draft item has an invalid quantity or unit price.");
      }
      return {
        serviceId: item.serviceId,
        description: item.description,
        quantity,
        unitPrice,
        lineTotal: calculateInvoiceLineTotal(quantity, unitPrice),
        position: item.position,
      };
    });
    const discountAmount = input.discountAmount === undefined
      ? decimalFromDb(invoice.discountAmount)
      : parseDecimal(input.discountAmount, "Discount amount");
    const totals = calculateAndValidateTotals(items, discountAmount);

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]!;
      const currentItem = currentItems[index]!;
      const result = await tx.invoiceItem.updateMany({
        where: { id: currentItem.id, organizationId, invoiceId },
        data: { lineTotal: item.lineTotal },
      });
      if (result.count !== 1) throw new DraftInvoiceError("Draft item changed during update.");
    }
    const updated = await tx.invoice.updateMany({
      where: { id: invoiceId, organizationId, lifecycleStatus: "DRAFT" },
      data: {
        ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
        ...(input.projectTitle !== undefined ? { projectTitle: input.projectTitle } : {}),
        ...(input.invoiceDate !== undefined ? { invoiceDate: validDate(input.invoiceDate, "Invoice date") } : {}),
        ...(input.dueDate !== undefined ? { dueDate: validDate(input.dueDate, "Due date") } : {}),
        currencyCode,
        ...(input.discountLabel !== undefined ? { discountLabel: input.discountLabel } : {}),
        discountAmount,
        subtotal: totals.subtotal,
        grandTotal: totals.grandTotal,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.paymentTerms !== undefined ? { paymentTerms: input.paymentTerms } : {}),
      },
    });
    if (updated.count !== 1) throw new DraftInvoiceError("Only draft invoices may be edited.");
    return tx.invoice.findFirstOrThrow({ where: { id: invoiceId, organizationId } });
  });
}

/** Atomically replace the full item list and update all invoice totals. */
export async function replaceDraftInvoiceItems(
  organizationId: string,
  invoiceId: string,
  inputItems: readonly DraftInvoiceItemInput[],
): Promise<Invoice> {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const invoice = await lockAndLoadDraft(tx, organizationId, invoiceId);
    const currencyCode = normalizeCurrency(invoice.currencyCode);
    const items = await prepareItems(tx, organizationId, currencyCode, inputItems);
    const discountAmount = decimalFromDb(invoice.discountAmount);
    const totals = calculateAndValidateTotals(items, discountAmount);

    await tx.invoiceItem.deleteMany({ where: { organizationId, invoiceId } });
    await tx.invoiceItem.createMany({
      data: items.map((item) => ({ ...item, organizationId, invoiceId })),
    });
    const updated = await tx.invoice.updateMany({
      where: { id: invoiceId, organizationId, lifecycleStatus: "DRAFT" },
      data: { subtotal: totals.subtotal, grandTotal: totals.grandTotal },
    });
    if (updated.count !== 1) throw new DraftInvoiceError("Only draft invoices may be edited.");
    return tx.invoice.findFirstOrThrow({ where: { id: invoiceId, organizationId } });
  });
}

async function lockAndLoadDraft(
  tx: Prisma.TransactionClient,
  organizationId: string,
  invoiceId: string,
) {
  const locks = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Invoice"
    WHERE "organizationId" = ${organizationId}::uuid AND "id" = ${invoiceId}::uuid
    FOR UPDATE
  `;
  if (locks.length !== 1) throw new DraftInvoiceError("Invoice was not found in this organization.");
  const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, organizationId } });
  if (!invoice) throw new DraftInvoiceError("Invoice was not found in this organization.");
  if (invoice.lifecycleStatus !== "DRAFT" || invoice.invoiceNumber !== null || invoice.issuedAt !== null) {
    throw new DraftInvoiceError("Only unissued draft invoices may be edited.");
  }
  return invoice;
}

async function requireActiveClient(
  tx: Prisma.TransactionClient,
  organizationId: string,
  clientId: string,
): Promise<void> {
  const client = await tx.client.findFirst({
    where: { id: clientId, organizationId, active: true },
    select: { id: true },
  });
  if (!client) throw new DraftInvoiceError("An active client in this organization is required.");
}

async function prepareItems(
  tx: Prisma.TransactionClient,
  organizationId: string,
  currencyCode: string,
  inputItems: readonly DraftInvoiceItemInput[],
): Promise<PreparedItem[]> {
  if (!Array.isArray(inputItems) || inputItems.length === 0) {
    throw new DraftInvoiceError("A draft invoice must contain at least one item.");
  }
  const prepared: PreparedItem[] = [];
  for (let index = 0; index < inputItems.length; index += 1) {
    const input = inputItems[index];
    if (!input || typeof input.description !== "string" || input.description.trim().length === 0) {
      throw new DraftInvoiceError("Invoice item description is required.");
    }
    const quantity = parseDecimal(input.quantity, "Item quantity");
    if (!quantity.greaterThan(0)) throw new DraftInvoiceError("Item quantity must be positive.");
    let serviceId = input.serviceId ?? null;
    let defaultPrice: Prisma.Decimal | null = null;
    if (serviceId !== null) {
      const service = await tx.service.findFirst({
        where: { id: serviceId, organizationId, active: true },
        select: { id: true, defaultUnitPrice: true, currencyCode: true },
      });
      if (!service) throw new DraftInvoiceError("Service must be active and belong to this organization.");
      serviceId = service.id;
      if (input.unitPrice === undefined && input.useServiceDefaultPrice === true) {
        let serviceCurrency: string;
        try { serviceCurrency = normalizeInvoiceCurrencyCode(service.currencyCode); }
        catch { throw new DraftInvoiceError("Service currency code is invalid; provide an explicit unit price."); }
        if (serviceCurrency !== currencyCode) {
          throw new DraftInvoiceError("Service default price currency differs from the invoice; provide an explicit unit price.");
        }
        if (service.defaultUnitPrice === null) {
          throw new DraftInvoiceError("Service has no default price; provide an explicit unit price.");
        }
        defaultPrice = decimalFromDb(service.defaultUnitPrice);
      }
    } else if (input.useServiceDefaultPrice === true) {
      throw new DraftInvoiceError("A service is required to use its default price.");
    }
    const unitPrice = input.unitPrice !== undefined
      ? parseDecimal(input.unitPrice, "Unit price")
      : defaultPrice ?? (() => { throw new DraftInvoiceError("Unit price is required unless the service default is explicitly requested."); })();
    if (unitPrice.isNegative()) throw new DraftInvoiceError("Unit price cannot be negative.");
    const position = input.position ?? index;
    if (!Number.isSafeInteger(position) || position < 0 || position > 2_147_483_647) {
      throw new DraftInvoiceError("Item position must be a nonnegative 32-bit integer.");
    }
    prepared.push({
      serviceId,
      description: input.description.trim(),
      quantity,
      unitPrice,
      lineTotal: calculateInvoiceLineTotal(quantity, unitPrice),
      position,
    });
  }
  return prepared;
}

function calculateAndValidateTotals(items: readonly PreparedItem[], discountAmount: Prisma.Decimal) {
  if (discountAmount.isNegative()) throw new DraftInvoiceError("Discount amount cannot be negative.");
  const totals = calculateInvoiceTotals(items.map((item) => item.lineTotal), discountAmount);
  if (discountAmount.greaterThan(totals.subtotal)) {
    throw new DraftInvoiceError("Discount amount cannot exceed subtotal.");
  }
  return totals;
}

function normalizeCurrency(value: unknown): string {
  try { return normalizeInvoiceCurrencyCode(value); }
  catch { throw new DraftInvoiceError("Invoice currency code must contain exactly three ASCII letters."); }
}

function parseDecimal(value: unknown, label: string): Prisma.Decimal {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d{1,4})?$/.test(value)) {
    throw new DraftInvoiceError(`${label} must be a decimal string with at most four fractional digits.`);
  }
  const result = new Prisma.Decimal(value);
  if (!result.isFinite()) throw new DraftInvoiceError(`${label} must be finite.`);
  return result;
}

function decimalFromDb(value: Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(value.toString());
}

function validDate(value: Date | null | undefined, label: string): Date | null {
  if (value == null) return null;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new DraftInvoiceError(`${label} must be a valid date.`);
  }
  return value;
}
