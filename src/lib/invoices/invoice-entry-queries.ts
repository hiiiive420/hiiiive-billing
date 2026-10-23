import "server-only";

import { getPrismaClient } from "../prisma";
import { normalizeInvoiceCurrencyCode } from "./currency";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_QUERY_LENGTH = 100;

export class InvoiceEntryQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceEntryQueryError";
  }
}

export type InvoiceEntrySearchOptions = Readonly<{ limit?: number }>;

export type InvoiceClientSearchResult = Readonly<{
  id: string;
  name: string;
  billingAddress: string | null;
  email: string | null;
  phone: string | null;
}>;

export type InvoiceServiceSearchResult = Readonly<{
  id: string;
  name: string;
  description: string | null;
  defaultUnitPrice: string | null;
  currencyCode: string;
}>;

export type DraftInvoiceEditReadModel = Readonly<{
  id: string;
  clientId: string;
  projectTitle: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currencyCode: string;
  discountLabel: string | null;
  discountAmount: string;
  notes: string | null;
  paymentTerms: string | null;
  subtotal: string;
  grandTotal: string;
  items: readonly Readonly<{
    id: string;
    billingMode: "QUANTITY" | "FLAT_FEE";
    serviceId: string | null;
    description: string;
    quantity: string;
    unitPrice: string;
    /** Flat-fee amount for the editor; null for quantity-priced items. */
    amount: string | null;
    lineTotal: string;
    position: number;
  }>[];
}>;

/** organizationId must be supplied by trusted server-side authorization context. */
export async function searchInvoiceClients(
  organizationId: string,
  query = "",
  options: InvoiceEntrySearchOptions = {},
): Promise<InvoiceClientSearchResult[]> {
  const text = normalizeQuery(query);
  const limit = normalizeLimit(options.limit);
  const prisma = getPrismaClient();
  const clients = await prisma.client.findMany({
    where: {
      organizationId,
      active: true,
      ...(text.length > 0
        ? {
            OR: [
              { name: { contains: escapeLikeWildcards(text), mode: "insensitive" } },
              { email: { contains: escapeLikeWildcards(text), mode: "insensitive" } },
              { phone: { contains: escapeLikeWildcards(text), mode: "insensitive" } },
              { billingAddress: { contains: escapeLikeWildcards(text), mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: { id: true, name: true, billingAddress: true, email: true, phone: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limit,
  });
  return clients;
}

/** Service defaults remain denominated in their own currency; this query never converts them. */
export async function searchInvoiceServices(
  organizationId: string,
  query = "",
  options: InvoiceEntrySearchOptions = {},
): Promise<InvoiceServiceSearchResult[]> {
  const text = normalizeQuery(query);
  const limit = normalizeLimit(options.limit);
  const prisma = getPrismaClient();
  const services = await prisma.service.findMany({
    where: {
      organizationId,
      active: true,
      ...(text.length > 0
        ? {
            OR: [
              { name: { contains: escapeLikeWildcards(text), mode: "insensitive" } },
              { description: { contains: escapeLikeWildcards(text), mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: { id: true, name: true, description: true, defaultUnitPrice: true, currencyCode: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limit,
  });
  return services.map((service) => ({
    id: service.id,
    name: service.name,
    description: service.description,
    defaultUnitPrice: service.defaultUnitPrice?.toString() ?? null,
    currencyCode: normalizeServiceCurrency(service.currencyCode),
  }));
}

/** Load only a tenant-owned DRAFT and return exact decimal/date representations for form state. */
export async function loadDraftInvoiceForEditing(
  organizationId: string,
  invoiceId: string,
): Promise<DraftInvoiceEditReadModel> {
  const prisma = getPrismaClient();
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId, lifecycleStatus: "DRAFT" },
    select: {
      id: true,
      clientId: true,
      projectTitle: true,
      invoiceDate: true,
      dueDate: true,
      currencyCode: true,
      discountLabel: true,
      discountAmount: true,
      notes: true,
      paymentTerms: true,
      subtotal: true,
      grandTotal: true,
      items: {
        where: { organizationId },
        select: {
          id: true,
          billingMode: true,
          serviceId: true,
          description: true,
          quantity: true,
          unitPrice: true,
          lineTotal: true,
          position: true,
        },
        orderBy: [{ position: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!invoice) throw new InvoiceEntryQueryError("Draft invoice was not found in this organization.");

  return {
    id: invoice.id,
    clientId: invoice.clientId,
    projectTitle: invoice.projectTitle,
    invoiceDate: formatCalendarDate(invoice.invoiceDate),
    dueDate: formatCalendarDate(invoice.dueDate),
    currencyCode: normalizeCurrency(invoice.currencyCode),
    discountLabel: invoice.discountLabel,
    discountAmount: invoice.discountAmount.toString(),
    notes: invoice.notes,
    paymentTerms: invoice.paymentTerms,
    subtotal: invoice.subtotal.toString(),
    grandTotal: invoice.grandTotal.toString(),
    items: invoice.items.map((item) => ({
      id: item.id,
      billingMode: item.billingMode,
      serviceId: item.serviceId,
      description: item.description,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
      amount: item.billingMode === "FLAT_FEE" ? item.unitPrice.toString() : null,
      lineTotal: item.lineTotal.toString(),
      position: item.position,
    })),
  };
}

function normalizeQuery(query: unknown): string {
  if (typeof query !== "string") throw new InvoiceEntryQueryError("Search query must be text.");
  const trimmed = query.trim();
  if (trimmed.length > MAX_QUERY_LENGTH) {
    throw new InvoiceEntryQueryError(`Search query cannot exceed ${MAX_QUERY_LENGTH} characters.`);
  }
  return trimmed;
}

function normalizeLimit(limit: unknown): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1) {
    throw new InvoiceEntryQueryError("Result limit must be a positive integer.");
  }
  return Math.min(limit, MAX_LIMIT);
}

function escapeLikeWildcards(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function normalizeServiceCurrency(value: unknown): string {
  try {
    return normalizeInvoiceCurrencyCode(value);
  } catch {
    throw new InvoiceEntryQueryError("A service has an invalid currency code.");
  }
}

function normalizeCurrency(value: unknown): string {
  try {
    return normalizeInvoiceCurrencyCode(value);
  } catch {
    throw new InvoiceEntryQueryError("Draft invoice currency code is invalid.");
  }
}

function formatCalendarDate(value: Date | null): string | null {
  if (value === null) return null;
  return value.toISOString().slice(0, 10);
}

