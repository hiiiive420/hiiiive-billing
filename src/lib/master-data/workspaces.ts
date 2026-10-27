import "server-only";

import { getPrismaClient } from "@/lib/prisma";

const PAGE_SIZE = 25;
const MAX_QUERY_LENGTH = 100;
const escapeLikeWildcards = (value: string) => value.replace(/[\\%_]/g, "\\$&");

export class MasterDataNotFoundError extends Error {
  constructor() { super("Record was not found in this organization."); this.name = "MasterDataNotFoundError"; }
}

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

function parseFilters(params: SearchParams) {
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  const query = (rawQuery ?? "").trim();
  const rawPage = Array.isArray(params.page) ? params.page[0] : params.page;
  const parsedPage = typeof rawPage === "string" && /^\d+$/.test(rawPage) ? Number(rawPage) : 1;
  return { query: query.slice(0, MAX_QUERY_LENGTH), requestedPage: Number.isSafeInteger(parsedPage) ? Math.max(1, parsedPage) : 1 };
}

export async function loadClientWorkspace(organizationId: string, params: SearchParams = {}) {
  const { query, requestedPage } = parseFilters(params);
  const search = escapeLikeWildcards(query);
  const where = {
    organizationId,
    ...(query ? { OR: [
      { name: { contains: search, mode: "insensitive" as const } },
      { email: { contains: search, mode: "insensitive" as const } },
      { phone: { contains: search, mode: "insensitive" as const } },
      { businessRegistrationOrTaxIdentifier: { contains: search, mode: "insensitive" as const } },
    ] } : {}),
  };
  const prisma = getPrismaClient();
  const [totalRows, organizationClientCount] = await Promise.all([
    prisma.client.count({ where }),
    query ? prisma.client.count({ where: { organizationId } }) : Promise.resolve(0),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const rows = await prisma.client.findMany({
    where,
    select: { id: true, name: true, email: true, phone: true, billingAddress: true, active: true, updatedAt: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  return { rows, totalRows, totalPages, page, query, organizationClientCount };
}

export async function loadClientDetail(organizationId: string, clientId: string) {
  const client = await getPrismaClient().client.findFirst({
    where: { organizationId, id: clientId },
    select: {
      id: true, name: true, businessRegistrationOrTaxIdentifier: true, phone: true, email: true,
      billingAddress: true, notes: true, active: true, updatedAt: true,
      contacts: { where: { organizationId }, select: { id: true, name: true, email: true, phone: true, billingContact: true, primaryContact: true, active: true }, orderBy: [{ primaryContact: "desc" }, { name: "asc" }, { id: "asc" }] },
    },
  });
  if (!client) throw new MasterDataNotFoundError();
  return client;
}

export async function loadServiceWorkspace(organizationId: string, params: SearchParams = {}) {
  const { query, requestedPage } = parseFilters(params);
  const search = escapeLikeWildcards(query);
  const where = { organizationId, ...(query ? { OR: [
    { name: { contains: search, mode: "insensitive" as const } },
    { description: { contains: search, mode: "insensitive" as const } },
  ] } : {}) };
  const prisma = getPrismaClient();
  const [totalRows, organizationServiceCount] = await Promise.all([
    prisma.service.count({ where }),
    query ? prisma.service.count({ where: { organizationId } }) : Promise.resolve(0),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const rows = await prisma.service.findMany({
    where,
    select: { id: true, name: true, description: true, defaultUnitPrice: true, currencyCode: true, active: true, updatedAt: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  return { rows: rows.map((row) => ({ ...row, defaultUnitPrice: row.defaultUnitPrice?.toString() ?? null })), totalRows, totalPages, page, query, organizationServiceCount };
}

export async function loadServiceDetail(organizationId: string, serviceId: string) {
  const service = await getPrismaClient().service.findFirst({
    where: { organizationId, id: serviceId },
    select: { id: true, name: true, description: true, defaultUnitPrice: true, currencyCode: true, active: true, updatedAt: true },
  });
  if (!service) throw new MasterDataNotFoundError();
  return { ...service, defaultUnitPrice: service.defaultUnitPrice?.toString() ?? null };
}
