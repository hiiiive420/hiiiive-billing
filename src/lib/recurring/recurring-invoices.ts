import "server-only";

import { Prisma, type RecurringInvoiceFrequency } from "@/generated/prisma/client";
import { getPrismaClient } from "../prisma";
import { createDraftInvoiceInTransaction, prepareDraftInvoiceItems, calculateAndValidateDraftTotals, DraftInvoiceError, type CreateDraftInvoiceInput } from "../invoices/draft-invoice";
import { normalizeInvoiceCurrencyCode } from "../invoices/currency";
import { colomboCalendarDate, nextRecurringDate, nextUpcomingRecurringDate } from "./recurring-schedule";

export type RecurringItemInput = Readonly<{
  billingMode: "QUANTITY" | "FLAT_FEE";
  serviceId?: string | null;
  description: string;
  quantity?: string;
  unitPrice?: string;
  amount?: string;
}>;
export type RecurringPlanInput = Readonly<{
  clientId: string;
  name: string;
  projectTitle?: string | null;
  currencyCode: string;
  frequency: RecurringInvoiceFrequency;
  startDate: string;
  dueInDays?: number | null;
  discountLabel?: string | null;
  discountAmount?: string;
  paymentTerms?: string | null;
  notes?: string | null;
  items: readonly RecurringItemInput[];
}>;

export class RecurringInvoiceError extends Error {
  constructor(message: string) { super(message); this.name = "RecurringInvoiceError"; }
}

export async function createRecurringPlan(organizationId: string, input: RecurringPlanInput) {
  return saveRecurringPlan(organizationId, null, input);
}

export async function updateRecurringPlan(organizationId: string, planId: string, input: RecurringPlanInput) {
  return saveRecurringPlan(organizationId, planId, input);
}

async function saveRecurringPlan(organizationId: string, planId: string | null, input: RecurringPlanInput) {
  const prisma = getPrismaClient();
  const parsed = validatePlanInput(input);
  return prisma.$transaction(async (tx) => {
    const client = await tx.client.findFirst({
      where: { id: parsed.clientId, organizationId, active: true },
      select: { id: true },
    });
    if (!client) throw new RecurringInvoiceError("Select an active client.");
    const prepared = await prepareDraftInvoiceItems(tx, organizationId, parsed.currencyCode, parsed.items);
    const discount = new Prisma.Decimal(parsed.discountAmount ?? "0");
    calculateAndValidateDraftTotals(prepared, discount);
    const date = dateValue(parsed.startDate);
    if (planId) {
      const existing = await tx.recurringInvoicePlan.findFirst({ where: { id: planId, organizationId }, select: { id: true } });
      if (!existing) throw new RecurringInvoiceError("Recurring plan was not found in this organization.");
      await tx.recurringInvoiceItem.deleteMany({ where: { organizationId, planId } });
      const plan = await tx.recurringInvoicePlan.update({
        where: { organizationId_id: { organizationId, id: planId } },
        data: {
          clientId: parsed.clientId, name: parsed.name, projectTitle: parsed.projectTitle ?? null,
          currencyCode: parsed.currencyCode, frequency: parsed.frequency, startDate: date,
          nextRunDate: dateValue(nextUpcomingRecurringDate(parsed.startDate, parsed.frequency, colomboCalendarDate())),
          dueInDays: parsed.dueInDays ?? null, discountLabel: parsed.discountLabel ?? null,
          discountAmount: discount, paymentTerms: parsed.paymentTerms ?? null, notes: parsed.notes ?? null,
        },
      });
      await tx.recurringInvoiceItem.createMany({ data: prepared.map((item) => ({
        organizationId, planId, serviceId: item.serviceId, description: item.description,
        billingMode: item.billingMode, quantity: item.quantity, unitPrice: item.unitPrice, position: item.position,
      })) });
      return plan;
    }
    const plan = await tx.recurringInvoicePlan.create({ data: {
      organizationId, clientId: parsed.clientId, name: parsed.name, projectTitle: parsed.projectTitle ?? null,
      currencyCode: parsed.currencyCode, frequency: parsed.frequency, startDate: date, nextRunDate: date,
      dueInDays: parsed.dueInDays ?? null, discountLabel: parsed.discountLabel ?? null,
      discountAmount: discount, paymentTerms: parsed.paymentTerms ?? null, notes: parsed.notes ?? null,
      items: { createMany: { data: prepared.map((item) => ({
        serviceId: item.serviceId, description: item.description,
        billingMode: item.billingMode, quantity: item.quantity, unitPrice: item.unitPrice, position: item.position,
      })) } },
    } });
    return plan;
  });
}

export async function setRecurringPlanActive(organizationId: string, planId: string, active: boolean) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const plan = await tx.recurringInvoicePlan.findFirst({ where: { id: planId, organizationId } });
    if (!plan) throw new RecurringInvoiceError("Recurring plan was not found in this organization.");
    if (active && !plan.isActive) {
      const today = colomboCalendarDate();
      const next = plan.nextRunDate.toISOString().slice(0, 10) >= today
        ? plan.nextRunDate.toISOString().slice(0, 10)
        : nextUpcomingRecurringDate(plan.startDate.toISOString().slice(0, 10), plan.frequency, today);
      return tx.recurringInvoicePlan.update({ where: { organizationId_id: { organizationId, id: planId } }, data: { isActive: true, nextRunDate: dateValue(next) } });
    }
    return tx.recurringInvoicePlan.update({ where: { organizationId_id: { organizationId, id: planId } }, data: { isActive: active } });
  });
}

export async function listRecurringPlans(organizationId: string, query = "") {
  const prisma = getPrismaClient();
  const q = query.trim().slice(0, 100).replace(/[\\%_]/g, "\\$&");
  return prisma.recurringInvoicePlan.findMany({
    where: { organizationId, ...(q ? { OR: [
      { name: { contains: q, mode: "insensitive" } },
      { projectTitle: { contains: q, mode: "insensitive" } },
      { client: { name: { contains: q, mode: "insensitive" } } },
    ] } : {}) },
    include: { client: { select: { name: true } }, items: true, runs: { orderBy: [{ scheduledFor: "desc" }, { id: "desc" }], take: 1 } },
    orderBy: [{ isActive: "desc" }, { nextRunDate: "asc" }, { name: "asc" }], take: 100,
  });
}

export async function listRecurringClients(organizationId: string) {
  return getPrismaClient().client.findMany({ where: { organizationId, active: true }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 500 });
}

export async function loadRecurringPlan(organizationId: string, planId: string) {
  const prisma = getPrismaClient();
  return prisma.recurringInvoicePlan.findFirst({
    where: { id: planId, organizationId },
    include: {
      client: { select: { id: true, name: true, active: true } },
      items: { include: { service: { select: { name: true } } }, orderBy: [{ position: "asc" }, { id: "asc" }] },
      runs: { include: { generatedInvoice: { select: { id: true, invoiceNumber: true, lifecycleStatus: true } } }, orderBy: [{ scheduledFor: "desc" }, { id: "desc" }], take: 50 },
    },
  });
}

/** Runs at most one due occurrence per plan. Dates use the Asia/Colombo calendar. */
export async function runDueRecurringInvoices(today = colomboCalendarDate()) {
  const prisma = getPrismaClient();
  const due = await prisma.recurringInvoicePlan.findMany({
    where: { isActive: true, nextRunDate: { lte: dateValue(today) } },
    select: { organizationId: true, id: true },
    orderBy: [{ nextRunDate: "asc" }, { id: "asc" }],
  });
  const results = [];
  for (const plan of due) results.push(await processOneDuePlan(plan.organizationId, plan.id, today));
  return { checked: due.length, results };
}

async function processOneDuePlan(organizationId: string, planId: string, today: string) {
  const prisma = getPrismaClient();
  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "RecurringInvoicePlan"
        WHERE "organizationId" = ${organizationId}::uuid AND "id" = ${planId}::uuid
        FOR UPDATE
      `;
      if (locked.length !== 1) return { planId, status: "SKIPPED" as const };
      const plan = await tx.recurringInvoicePlan.findFirst({
        where: { id: planId, organizationId, isActive: true, nextRunDate: { lte: dateValue(today) } },
        include: { items: { orderBy: [{ position: "asc" }, { id: "asc" }] } },
      });
      if (!plan) return { planId, status: "SKIPPED" as const };
      const scheduledFor = plan.nextRunDate;
      const existingRun = await tx.recurringInvoiceRun.findUnique({ where: { planId_scheduledFor: { planId, scheduledFor } } });
      if (existingRun?.status === "GENERATED") return { planId, status: "ALREADY_GENERATED" as const };
      const client = await tx.client.findFirst({ where: { id: plan.clientId, organizationId, active: true }, select: { id: true } });
      if (!client) {
        const failure = { status: "FAILED" as const, failureCode: "CLIENT_INACTIVE", safeFailureMessage: "The selected client is inactive or unavailable." };
        if (existingRun) await tx.recurringInvoiceRun.update({ where: { id: existingRun.id }, data: { ...failure, completedAt: new Date() } });
        else await tx.recurringInvoiceRun.create({ data: { organizationId, planId, scheduledFor, ...failure } });
        return { planId, status: failure.status, code: failure.failureCode };
      }
      const draftInput: CreateDraftInvoiceInput = {
        clientId: plan.clientId,
        projectTitle: plan.projectTitle,
        invoiceDate: scheduledFor,
        dueDate: plan.dueInDays === null ? null : addDays(scheduledFor, plan.dueInDays),
        currencyCode: normalizeInvoiceCurrencyCode(plan.currencyCode),
        discountLabel: plan.discountLabel,
        discountAmount: plan.discountAmount.toString(),
        paymentTerms: plan.paymentTerms,
        notes: plan.notes,
        items: plan.items.map((item) => item.billingMode === "FLAT_FEE"
          ? { billingMode: "FLAT_FEE" as const, serviceId: item.serviceId, description: item.description, amount: item.unitPrice.toString(), position: item.position }
          : { billingMode: "QUANTITY" as const, serviceId: item.serviceId, description: item.description, quantity: item.quantity.toString(), unitPrice: item.unitPrice.toString(), position: item.position }),
      };
      const invoice = await createDraftInvoiceInTransaction(tx, organizationId, draftInput);
      if (existingRun) await tx.recurringInvoiceRun.update({ where: { id: existingRun.id }, data: { status: "GENERATED", generatedInvoiceId: invoice.id, failureCode: null, safeFailureMessage: null, completedAt: new Date() } });
      else await tx.recurringInvoiceRun.create({ data: { organizationId, planId, scheduledFor, generatedInvoiceId: invoice.id, status: "GENERATED", completedAt: new Date() } });
      await tx.recurringInvoicePlan.update({ where: { id: planId }, data: { nextRunDate: dateValue(nextRecurringDate(plan.startDate.toISOString().slice(0, 10), plan.frequency, scheduledFor.toISOString().slice(0, 10))) } });
      return { planId, status: "GENERATED" as const, invoiceId: invoice.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  } catch (error) {
    const safeFailureMessage = error instanceof DraftInvoiceError ? error.message : "The recurring draft could not be generated. It will be retried.";
    await prisma.$transaction(async (tx) => {
      const plan = await tx.recurringInvoicePlan.findFirst({ where: { id: planId, organizationId }, select: { nextRunDate: true } });
      if (!plan) return;
      await tx.recurringInvoiceRun.upsert({
        where: { planId_scheduledFor: { planId, scheduledFor: plan.nextRunDate } },
        create: { organizationId, planId, scheduledFor: plan.nextRunDate, status: "FAILED", failureCode: "GENERATION_FAILED", safeFailureMessage, completedAt: new Date() },
        update: { status: "FAILED", failureCode: "GENERATION_FAILED", safeFailureMessage, completedAt: new Date() },
      });
    });
    return { planId, status: "FAILED" as const, code: "GENERATION_FAILED" };
  }
}

function validatePlanInput(input: RecurringPlanInput) {
  if (!input || typeof input !== "object") throw new RecurringInvoiceError("Recurring plan data is invalid.");
  if (typeof input.clientId !== "string" || !input.clientId) throw new RecurringInvoiceError("Choose a client.");
  if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 120) throw new RecurringInvoiceError("Enter a plan name up to 120 characters.");
  let currencyCode: string;
  try { currencyCode = normalizeInvoiceCurrencyCode(input.currencyCode); } catch { throw new RecurringInvoiceError("Currency must be a three-letter code."); }
  if (input.frequency !== "MONTHLY" && input.frequency !== "YEARLY") throw new RecurringInvoiceError("Choose monthly or yearly frequency.");
  try { dateValue(input.startDate); }
  catch { throw new RecurringInvoiceError("Enter a valid first scheduled date."); }
  if (input.dueInDays !== undefined && input.dueInDays !== null && (!Number.isSafeInteger(input.dueInDays) || input.dueInDays < 0 || input.dueInDays > 3650)) throw new RecurringInvoiceError("Due in days must be from 0 to 3650.");
  if (!Array.isArray(input.items) || input.items.length === 0) throw new RecurringInvoiceError("Add at least one recurring item.");
  const items = input.items.map((item, position) => item.billingMode === "FLAT_FEE"
    ? { billingMode: "FLAT_FEE" as const, serviceId: item.serviceId ?? null, description: item.description, amount: item.amount ?? "", position }
    : { billingMode: "QUANTITY" as const, serviceId: item.serviceId ?? null, description: item.description, quantity: item.quantity ?? "", unitPrice: item.unitPrice ?? "", position });
  return { ...input, name: input.name.trim(), currencyCode, items };
}

function dateValue(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RecurringInvoiceError("Enter a valid calendar date.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new RecurringInvoiceError("Enter a valid calendar date.");
  return date;
}
function addDays(date: Date, days: number) { const result = new Date(date); result.setUTCDate(result.getUTCDate() + days); return result; }
