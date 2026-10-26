import "server-only";

import type { InvoiceLifecycleStatus, InvoicePaymentStatus } from "@/generated/prisma/enums";
import { getPrismaClient } from "../prisma";

export const INVOICE_WORKSPACE_PAGE_SIZE = 25;
const MAX_QUERY_LENGTH = 100;
const lifecycleValues = ["DRAFT", "ISSUED", "SUPERSEDED", "VOID", "WRITTEN_OFF"] as const;
const paymentValues = ["UNPAID", "PARTIALLY_PAID", "PAID"] as const;
const sortValues = ["updated_desc", "date_desc", "date_asc", "number_asc"] as const;

export type InvoiceWorkspaceLifecycleFilter = "ALL" | (typeof lifecycleValues)[number];
export type InvoiceWorkspacePaymentFilter = "ALL" | (typeof paymentValues)[number];
export type InvoiceWorkspaceSort = (typeof sortValues)[number];

export type InvoiceWorkspaceFilters = Readonly<{
  query: string;
  lifecycle: InvoiceWorkspaceLifecycleFilter;
  payment: InvoiceWorkspacePaymentFilter;
  sort: InvoiceWorkspaceSort;
  page: number;
}>;

export type InvoiceWorkspaceRow = Readonly<{
  id: string;
  displayNumber: string;
  lifecycleStatus: InvoiceLifecycleStatus;
  paymentStatus: InvoicePaymentStatus;
  clientName: string;
  projectTitle: string | null;
  invoiceDate: Date | null;
  currencyCode: string;
  grandTotal: string;
  latestEmailStatus: "PENDING" | "SENT" | "PARTIALLY_SENT" | "FAILED" | null;
  latestEmailAt: Date | null;
  updatedAt: Date;
}>;

export type InvoiceWorkspaceResult = Readonly<{
  filters: InvoiceWorkspaceFilters;
  rows: readonly InvoiceWorkspaceRow[];
  totalRows: number;
  organizationInvoiceCount: number;
  totalPages: number;
  summary: Readonly<{ drafts: number; outstanding: number; partiallyPaid: number; paid: number }>;
}>;

export function parseInvoiceWorkspaceFilters(raw: Readonly<Record<string, string | string[] | undefined>>): InvoiceWorkspaceFilters {
  const queryValue = firstValue(raw.q);
  const query = typeof queryValue === "string" ? queryValue.trim().slice(0, MAX_QUERY_LENGTH) : "";
  const lifecycleValue = firstValue(raw.lifecycle);
  const paymentValue = firstValue(raw.payment);
  const sortValue = firstValue(raw.sort);
  const pageValue = firstValue(raw.page);
  return {
    query,
    lifecycle: lifecycleValue === "ALL" || lifecycleValues.some((value) => value === lifecycleValue)
      ? lifecycleValue as InvoiceWorkspaceLifecycleFilter
      : "ALL",
    payment: paymentValue === "ALL" || paymentValues.some((value) => value === paymentValue)
      ? paymentValue as InvoiceWorkspacePaymentFilter
      : "ALL",
    sort: sortValues.some((value) => value === sortValue) ? sortValue as InvoiceWorkspaceSort : "updated_desc",
    page: typeof pageValue === "string" && /^\d+$/.test(pageValue) ? Math.min(Number(pageValue), 1_000_000) || 1 : 1,
  };
}

/** organizationId must come from requireOrganizationBySlug() on the server. */
export async function loadInvoiceWorkspace(
  organizationId: string,
  rawFilters: Readonly<Record<string, string | string[] | undefined>> = {},
): Promise<InvoiceWorkspaceResult> {
  const filters = parseInvoiceWorkspaceFilters(rawFilters);
  const prisma = getPrismaClient();
  const organizationScope = { organizationId };
  const where = buildInvoiceWhere(organizationId, filters);
  const [grouped, organizationInvoiceCount, totalRows] = await Promise.all([
    prisma.invoice.groupBy({
      by: ["lifecycleStatus", "paymentStatus"],
      where: organizationScope,
      _count: { _all: true },
    }),
    prisma.invoice.count({ where: organizationScope }),
    prisma.invoice.count({ where }),
  ]);
  const summary = grouped.reduce((counts, group) => {
    const count = group._count._all;
    if (group.lifecycleStatus === "DRAFT") counts.drafts += count;
    if (group.lifecycleStatus === "ISSUED" && group.paymentStatus === "UNPAID") counts.outstanding += count;
    if (group.lifecycleStatus === "ISSUED" && group.paymentStatus === "PARTIALLY_PAID") counts.partiallyPaid += count;
    if (group.lifecycleStatus === "ISSUED" && group.paymentStatus === "PAID") counts.paid += count;
    return counts;
  }, { drafts: 0, outstanding: 0, partiallyPaid: 0, paid: 0 });

  const totalPages = Math.max(1, Math.ceil(totalRows / INVOICE_WORKSPACE_PAGE_SIZE));
  const page = Math.min(filters.page, totalPages);
  const rows = await prisma.invoice.findMany({
    where,
    select: {
      id: true,
      invoiceNumber: true,
      lifecycleStatus: true,
      paymentStatus: true,
      projectTitle: true,
      invoiceDate: true,
      currencyCode: true,
      grandTotal: true,
      clientNameSnapshot: true,
      client: { select: { name: true } },
      updatedAt: true,
      emailAttempts: {
        select: { status: true, createdAt: true, sentAt: true, failedAt: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
      },
    },
    orderBy: orderByFor(filters.sort),
    skip: (page - 1) * INVOICE_WORKSPACE_PAGE_SIZE,
    take: INVOICE_WORKSPACE_PAGE_SIZE,
  });

  return {
    filters: { ...filters, page },
    rows: rows.map((invoice) => {
      const latestAttempt = invoice.emailAttempts[0];
      const emailStatus = invoice.lifecycleStatus === "DRAFT" ? null : latestAttempt?.status ?? null;
      return {
        id: invoice.id,
        displayNumber: invoice.lifecycleStatus === "DRAFT" ? "Draft" : invoice.invoiceNumber ?? "Invoice",
        lifecycleStatus: invoice.lifecycleStatus,
        paymentStatus: invoice.paymentStatus,
        clientName: invoice.lifecycleStatus === "DRAFT"
          ? invoice.client.name
          : invoice.clientNameSnapshot ?? invoice.client.name,
        projectTitle: invoice.projectTitle?.trim() || null,
        invoiceDate: invoice.invoiceDate,
        currencyCode: invoice.currencyCode,
        grandTotal: invoice.grandTotal.toString(),
        latestEmailStatus: emailStatus,
        latestEmailAt: latestAttempt ? latestAttempt.sentAt ?? latestAttempt.failedAt ?? latestAttempt.createdAt : null,
        updatedAt: invoice.updatedAt,
      };
    }),
    totalRows,
    organizationInvoiceCount,
    totalPages,
    summary,
  };
}

function buildInvoiceWhere(organizationId: string, filters: InvoiceWorkspaceFilters) {
  const and: object[] = [{ organizationId }];
  if (filters.lifecycle !== "ALL") and.push({ lifecycleStatus: filters.lifecycle });
  if (filters.payment !== "ALL") and.push({ lifecycleStatus: { not: "DRAFT" }, paymentStatus: filters.payment });
  if (filters.query) {
    const query = escapeLikeWildcards(filters.query);
    and.push({
      OR: [
        { invoiceNumber: { contains: query, mode: "insensitive" } },
        { projectTitle: { contains: query, mode: "insensitive" } },
        { lifecycleStatus: "DRAFT", client: { name: { contains: query, mode: "insensitive" } } },
        {
          lifecycleStatus: { in: ["ISSUED", "SUPERSEDED", "VOID", "WRITTEN_OFF"] },
          OR: [
            { clientNameSnapshot: { contains: query, mode: "insensitive" } },
            { clientNameSnapshot: null, client: { name: { contains: query, mode: "insensitive" } } },
          ],
        },
      ],
    });
  }
  return { AND: and };
}

function orderByFor(sort: InvoiceWorkspaceSort) {
  if (sort === "date_desc") return [{ invoiceDate: { sort: "desc" as const, nulls: "last" as const } }, { updatedAt: "desc" as const }, { id: "asc" as const }];
  if (sort === "date_asc") return [{ invoiceDate: { sort: "asc" as const, nulls: "last" as const } }, { updatedAt: "desc" as const }, { id: "asc" as const }];
  if (sort === "number_asc") return [{ invoiceNumber: { sort: "asc" as const, nulls: "last" as const } }, { updatedAt: "desc" as const }, { id: "asc" as const }];
  return [{ updatedAt: "desc" as const }, { id: "asc" as const }];
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function escapeLikeWildcards(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
