import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { AuthorizationError, OrganizationContextNotFoundError, requireOrganizationBySlug } from "../auth/authorization";
import { parseInvoResponse, normalizeInvoProposal, type InvoParserDependencies } from "../ai/invo";
import type { InvoActionResult, InvoDefaultPriceOffer, InvoMessage, InvoTarget } from "../ai/invo-contract";
import { getPrismaClient } from "../prisma";
import { Prisma } from "@/generated/prisma/client";
import { calculateInvoiceLineTotal, calculateInvoiceTotals } from "./invoice-financials";
import { normalizeRecurringMoneyInput } from "../recurring/recurring-money-input";
import { normalizeInvoiceCurrencyCode } from "./currency";

const FAILURE = "Invo couldn't process that request right now. You can try again or continue manually.";

export async function prepareInvoProposal(organizationSlug: string, targetValue: unknown, rawMessages: unknown, rawOffers: unknown = [],
  dependencies: InvoParserDependencies = {}): Promise<InvoActionResult> {
  if (targetValue !== "INVOICE" && targetValue !== "RECURRING") return { ok: false, error: FAILURE };
  const target: InvoTarget = targetValue;
  let organizationId: string;
  try {
    ({ organizationId } = await requireOrganizationBySlug(organizationSlug, "INVO_USE"));
    await requireOrganizationBySlug(organizationSlug, target === "INVOICE" ? "INVOICE_CREATE" : "RECURRING_INVOICE_MANAGE");
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false, error: "You do not have permission to use Invo for this billing task." };
    if (error instanceof OrganizationContextNotFoundError) return { ok: false, error: "This organization is not accessible." };
    return { ok: false, error: "Could not verify access to this workspace." };
  }
  const messages = normalizeMessages(rawMessages);
  if (!messages) return { ok: false, error: "Add a message of up to 2,000 characters." };
  try {
    const query = messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
    const context = await lookupContext(organizationId, query);
    const structured = await parseInvoResponse(target, messages, context, dependencies);
    const incomingOffers = verifyOffers(organizationId, target, rawOffers, dependencies.env ?? process.env);
    let proposal = normalizeInvoProposal(structured.proposal);
    const client = await exactClient(organizationId, proposal.clientHint);
    const suggestions = client ? [] : await similarClients(organizationId, proposal.clientHint);
    const services = await Promise.all(proposal.items.map((item) => exactService(organizationId, item.serviceHint)));
    const missing: string[] = [];
    const ambiguities = [...structured.ambiguities];
    const defaultPriceOffers: InvoDefaultPriceOffer[] = [];
    if (structured.proposal.discountAmount !== null && proposal.discountAmount === null) addUnique(missing, "A valid fixed discount amount");
    const revisedItems = proposal.items.map((item, index) => {
      const service = services[index];
      if (!service?.defaultUnitPrice || service.currencyCode !== proposal.currencyCode) return item;
      const agreed = confirmedServiceDefault(messages) && incomingOffers.some((offer) => offer.serviceId === service.id && offer.currencyCode === service.currencyCode && offer.amount === service.defaultUnitPrice);
      const priceKey = item.billingMode === "FLAT_FEE" ? "amount" : "unitPrice";
      const supplied = item[priceKey];
      const explicitlyEntered = suppliedInConversation(messages, supplied);
      if (agreed) return { ...item, [priceKey]: service.defaultUnitPrice };
      if (!explicitlyEntered) {
        addUnique(ambiguities, `I found ${service.name} with a default price of ${service.currencyCode} ${service.defaultUnitPrice}. Should I use that amount?`);
        defaultPriceOffers.push({
          token: signOffer(organizationId, target, service.id, service.currencyCode, service.defaultUnitPrice, dependencies.env ?? process.env),
          itemIndex: index, serviceName: service.name, currencyCode: service.currencyCode, amount: service.defaultUnitPrice,
        });
        return { ...item, [priceKey]: null };
      }
      return item;
    });
    proposal = { ...proposal, items: revisedItems };
    if (proposal.clientHint && !client) {
      const msg = suggestions.length ? `Choose the matching client: ${suggestions.map((x) => x.name).join(", ")}.` : `No active client named “${proposal.clientHint}” was found. Choose or create a client in the form.`;
      addUnique(ambiguities, msg);
    }
    if (!proposal.clientHint) addUnique(missing, "Client");
    if (!proposal.currencyCode) addUnique(missing, "Currency");
    if (containsAmbiguousDollar(messages) && !explicitDollarCode(messages)) addUnique(ambiguities, "Which currency do you mean by $ — USD or another currency?");
    if (proposal.items.length === 0) addUnique(missing, "At least one invoice item");
    proposal.items.forEach((item, index) => {
      if (!item.description && !item.serviceHint) addUnique(missing, `Item ${index + 1} description`);
      if (item.billingMode === "FLAT_FEE") {
        if (!isNonNegative(item.amount)) addUnique(missing, `Item ${index + 1} amount`);
      } else {
        if (!isPositive(item.quantity)) addUnique(missing, `Item ${index + 1} quantity`);
        if (!isNonNegative(item.unitPrice)) addUnique(missing, `Item ${index + 1} unit price`);
      }
    });
    if (proposal.discountAmount !== null && !isNonNegative(proposal.discountAmount)) addUnique(missing, "A valid nonnegative fixed discount");
    if (proposal.items.every((item) => item.billingMode === "FLAT_FEE" ? isNonNegative(item.amount) : isPositive(item.quantity) && isNonNegative(item.unitPrice)) && proposal.items.length) {
      const lines = proposal.items.map((item) => item.billingMode === "FLAT_FEE"
        ? new Prisma.Decimal(item.amount!)
        : calculateInvoiceLineTotal(new Prisma.Decimal(item.quantity!), new Prisma.Decimal(item.unitPrice!)));
      const totals = calculateInvoiceTotals(lines, new Prisma.Decimal(proposal.discountAmount ?? "0"));
      if (totals.grandTotal.isNegative()) addUnique(missing, "Discount amount cannot exceed the item subtotal");
    }
    if (target === "RECURRING") {
      if (!proposal.planName?.trim()) addUnique(missing, "Plan name");
      if (!proposal.frequency) addUnique(missing, "Monthly or yearly frequency");
      if (!validDate(proposal.startDate)) addUnique(missing, "First scheduled date");
      if (proposal.dueInDays !== null && (!Number.isInteger(proposal.dueInDays) || proposal.dueInDays < 0 || proposal.dueInDays > 3650)) addUnique(missing, "Due period from 0 to 3650 days");
      if (proposal.frequency && !["MONTHLY", "YEARLY"].includes(proposal.frequency)) addUnique(missing, "Monthly or yearly frequency");
    } else {
      if (proposal.invoiceDate && !validDate(proposal.invoiceDate)) addUnique(missing, "A valid invoice date");
      if (proposal.dueDate && !validDate(proposal.dueDate)) addUnique(missing, "A valid due date");
      if (proposal.dueInDays !== null && (!Number.isInteger(proposal.dueInDays) || proposal.dueInDays < 0 || proposal.dueInDays > 3650)) addUnique(missing, "Due period from 0 to 3650 days");
    }
    if (proposal.currencyCode) {
      try { normalizeInvoiceCurrencyCode(proposal.currencyCode); } catch { addUnique(missing, "A valid three-letter currency code"); }
    }
    const ready = structured.state === "READY_PROPOSAL" && missing.length === 0 && ambiguities.length === 0 && client !== null;
    const message = ready ? structured.assistantMessage : clarify(missing, ambiguities, structured.assistantMessage);
    return { ok: true, result: {
      state: ready ? "READY_PROPOSAL" : "ASK_USER", assistantMessage: message,
      target, missingFields: unique(missing), ambiguities: unique(ambiguities), proposal,
      resolvedClient: client, clientSuggestions: suggestions,
      resolvedServices: services, defaultPriceOffers,
    } };
  } catch {
    return { ok: false, error: FAILURE };
  }
}

function normalizeMessages(value: unknown): InvoMessage[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 14) return null;
  const result: InvoMessage[] = [];
  let size = 0;
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const row = entry as Record<string, unknown>;
    if ((row.role !== "user" && row.role !== "assistant") || typeof row.content !== "string") return null;
    const content = row.content.trim();
    if (content.length < 1 || content.length > 2_000) return null;
    size += content.length;
    result.push({ role: row.role, content });
  }
  return size <= 8_000 && result.at(-1)?.role === "user" ? result : null;
}

async function lookupContext(organizationId: string, query: string) {
  const prisma = getPrismaClient();
  const q = query.trim().slice(0, 80).replace(/[\\%_]/g, "\\$&");
  if (!q) return { clients: [], services: [] };
  const [clients, services] = await Promise.all([
    prisma.client.findMany({ where: { organizationId, active: true, name: { contains: q, mode: "insensitive" } }, select: { name: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 8 }),
    prisma.service.findMany({ where: { organizationId, active: true, name: { contains: q, mode: "insensitive" } }, select: { name: true, defaultUnitPrice: true, currencyCode: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 8 }),
  ]);
  return { clients: clients.map((item) => item.name), services: services.map((item) => ({ name: item.name, defaultUnitPrice: item.defaultUnitPrice ? canonicalAmount(item.defaultUnitPrice.toString()) : null, currencyCode: item.currencyCode })) };
}

async function exactClient(organizationId: string, hint: string | null) {
  if (!hint) return null;
  const result = await getPrismaClient().$queryRaw<Array<{ id: string; name: string }>>`
    SELECT "id"::text AS "id", "name" FROM "Client" WHERE "organizationId" = ${organizationId}::uuid AND "active" = true
    AND lower(regexp_replace(btrim("name"), '[[:space:]]+', ' ', 'g')) = lower(regexp_replace(btrim(${hint}), '[[:space:]]+', ' ', 'g')) ORDER BY "id" LIMIT 2`;
  return result.length === 1 ? result[0]! : null;
}
async function similarClients(organizationId: string, hint: string | null) {
  if (!hint) return [];
  const q = hint.trim().slice(0, 80).replace(/[\\%_]/g, "\\$&");
  return getPrismaClient().client.findMany({ where: { organizationId, active: true, name: { contains: q, mode: "insensitive" } }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 5 });
}
async function exactService(organizationId: string, hint: string | null) {
  if (!hint) return null;
  const result = await getPrismaClient().$queryRaw<Array<{ id: string; name: string; defaultUnitPrice: string | null; currencyCode: string }>>`
    SELECT "id"::text AS "id", "name", "defaultUnitPrice"::text AS "defaultUnitPrice", "currencyCode" FROM "Service"
    WHERE "organizationId" = ${organizationId}::uuid AND "active" = true AND lower(regexp_replace(btrim("name"), '[[:space:]]+', ' ', 'g')) = lower(regexp_replace(btrim(${hint}), '[[:space:]]+', ' ', 'g')) ORDER BY "id" LIMIT 2`;
  return result.length === 1 ? { ...result[0]!, defaultUnitPrice: result[0]!.defaultUnitPrice ? canonicalAmount(result[0]!.defaultUnitPrice) : null } : null;
}
function isNonNegative(value: string | null) { try { const normalized = value === null ? null : normalizeRecurringMoneyInput(value, ""); return normalized !== null && !normalized.startsWith("-") && fitsDecimal(normalized); } catch { return false; } }
function isPositive(value: string | null) { try { const normalized = value === null ? null : normalizeRecurringMoneyInput(value, ""); return normalized !== null && !normalized.startsWith("-") && /[1-9]/.test(normalized) && fitsDecimal(normalized); } catch { return false; } }
function fitsDecimal(value: string) { return /^\d{1,15}(?:\.\d{1,4})?$/.test(value); }
function validDate(value: string | null): boolean { if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const date = new Date(`${value}T00:00:00.000Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value; }
function containsAmbiguousDollar(messages: readonly InvoMessage[]) { return messages.some((message) => message.role === "user" && message.content.includes("$")); }
function explicitDollarCode(messages: readonly InvoMessage[]) { return messages.some((message) => message.role === "user" && /\b(?:USD|CAD|AUD|NZD|SGD|HKD|EUR|GBP|LKR|INR)\b.{0,12}\$|\$.{0,12}\b(?:USD|CAD|AUD|NZD|SGD|HKD|EUR|GBP|LKR|INR)\b/i.test(message.content)); }
function clarify(missing: string[], ambiguities: string[], fallback: string) {
  const needs = [...new Set([...ambiguities, ...missing])];
  return needs.length ? `I can prepare this. ${needs.slice(0, 4).join(" ")}` : fallback;
}
function confirmedServiceDefault(messages: readonly InvoMessage[]) {
  const lastUser = messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
  return /\b(yes|confirm|use it|use that|go ahead|that amount)\b/i.test(lastUser);
}
function signOffer(organizationId: string, target: InvoTarget, serviceId: string, currencyCode: string, amount: string, env: Readonly<Record<string, string | undefined>>) {
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OpenAI is unavailable");
  const payload = Buffer.from(JSON.stringify({ organizationId, target, serviceId, currencyCode, amount, expires: Date.now() + 60 * 60 * 1000 })).toString("base64url");
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
function verifyOffers(organizationId: string, target: InvoTarget, rawOffers: unknown, env: Readonly<Record<string, string | undefined>>) {
  if (!Array.isArray(rawOffers) || rawOffers.length > 10) return [] as Array<{ serviceId: string; currencyCode: string; amount: string }>;
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) return [];
  const verified: Array<{ serviceId: string; currencyCode: string; amount: string }> = [];
  for (const token of rawOffers) {
    if (typeof token !== "string" || token.length > 1000) continue;
    const [payload, signature, ...extra] = token.split(".");
    if (!payload || !signature || extra.length) continue;
    const expected = createHmac("sha256", key).update(payload).digest();
    let actual: Buffer;
    try { actual = Buffer.from(signature, "base64url"); } catch { continue; }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) continue;
    try {
      const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
      if (parsed.organizationId !== organizationId || parsed.target !== target || typeof parsed.expires !== "number" || parsed.expires < Date.now() || typeof parsed.serviceId !== "string" || typeof parsed.currencyCode !== "string" || typeof parsed.amount !== "string") continue;
      verified.push({ serviceId: parsed.serviceId, currencyCode: parsed.currencyCode, amount: parsed.amount });
    } catch { continue; }
  }
  return verified;
}
function suppliedInConversation(messages: readonly InvoMessage[], amount: string | null) {
  if (amount === null) return false;
  const grouped = amount.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return messages.some((message) => message.role === "user" && new RegExp(`(?:^|[^\\d])(?:${escapeRegExp(amount)}|${escapeRegExp(grouped)})(?:[^\\d]|$)`, "i").test(message.content));
}
function canonicalAmount(value: string) { return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value; }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function addUnique(values: string[], value: string) { if (!values.some((existing) => existing.toLowerCase() === value.toLowerCase())) values.push(value); }
function unique(values: string[]) { return [...new Set(values)]; }
