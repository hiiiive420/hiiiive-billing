import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { getPrismaClient } from "../prisma";
import { createRecurringPlan, runDueRecurringInvoices, setRecurringPlanActive, updateRecurringPlan } from "./recurring-invoices";
import { normalizeRecurringMoneyInput, RecurringMoneyInputError } from "./recurring-money-input";

const prisma = getPrismaClient();
after(async () => { await prisma.$disconnect(); });

test("formatted flat-fee input is canonicalized before validation and the exact monthly LKR plan saves", async () => {
  const token = randomUUID();
  const organization = await prisma.organization.create({ data: { name: `Plan save ${token}`, slug: `plan-save-${token}` } });
  const client = await prisma.client.create({ data: { organizationId: organization.id, name: `Client ${token}` } });
  const rawInput = {
    clientId: client.id,
    name: "Social Media Package",
    projectTitle: "Social Media",
    currencyCode: "LKR",
    frequency: "MONTHLY" as const,
    startDate: "2026-11-10",
    dueInDays: 14,
    discountLabel: "",
    discountAmount: "0",
    paymentTerms: "",
    notes: "",
    items: [{ billingMode: "FLAT_FEE" as const, description: "Social Media", amount: "55,000", serviceId: null }],
  };
  try {
    assert.throws(
      () => normalizeRecurringMoneyInput("55,00", "Enter a valid amount for Item 1."),
      RecurringMoneyInputError,
    );
    assert.equal(normalizeRecurringMoneyInput("55,000", "Enter a valid amount for Item 1."), "55000");
    await assert.rejects(createRecurringPlan(organization.id, rawInput), /Flat-fee amount must be a decimal string/);

    const plan = await createRecurringPlan(organization.id, {
      ...rawInput,
      items: [{ ...rawInput.items[0], amount: normalizeRecurringMoneyInput(rawInput.items[0].amount, "Enter a valid amount for Item 1.") }],
    });
    assert.equal(plan.frequency, "MONTHLY");
    assert.equal(plan.currencyCode, "LKR");
    assert.equal(plan.startDate.toISOString().slice(0, 10), "2026-11-10");
    assert.equal(plan.nextRunDate.toISOString().slice(0, 10), "2026-11-10");
    assert.equal(plan.dueInDays, 14);
    assert.equal(plan.discountAmount.toString(), "0");
    assert.equal(plan.discountLabel, "");

    const saved = await prisma.recurringInvoicePlan.findFirstOrThrow({
      where: { id: plan.id, organizationId: organization.id },
      include: { items: true },
    });
    assert.equal(saved.isActive, true);
    assert.equal(saved.items.length, 1);
    assert.equal(saved.items[0]?.billingMode, "FLAT_FEE");
    assert.equal(saved.items[0]?.quantity.toString(), "1");
    assert.equal(saved.items[0]?.unitPrice.toString(), "55000");
    assert.equal(saved.items[0]?.serviceId, null);
    assert.equal(await prisma.invoice.count({ where: { organizationId: organization.id } }), 0);
    assert.equal(await prisma.invoiceSequence.count({ where: { organizationId: organization.id } }), 0);
    assert.equal(await prisma.payment.count({ where: { organizationId: organization.id } }), 0);
    assert.equal(await prisma.invoiceEmailAttempt.count({ where: { organizationId: organization.id } }), 0);
  } finally {
    await prisma.recurringInvoiceItem.deleteMany({ where: { organizationId: organization.id } });
    await prisma.recurringInvoicePlan.deleteMany({ where: { organizationId: organization.id } });
    await prisma.client.deleteMany({ where: { organizationId: organization.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  }
});

test("recurring runs are idempotent, create ordinary drafts, and apply price edits prospectively", async () => {
  const token = randomUUID();
  const organization = await prisma.organization.create({ data: { name: `Recurring ${token}`, slug: `recurring-${token}` } });
  const client = await prisma.client.create({ data: { organizationId: organization.id, name: `Client ${token}` } });
  const startDate = "2026-11-02";
  const plan = await createRecurringPlan(organization.id, {
    clientId: client.id, name: "Visaga Social Media Management", projectTitle: "Social Media Management",
    currencyCode: "LKR", frequency: "MONTHLY", startDate, dueInDays: 14,
    items: [{ billingMode: "FLAT_FEE", description: "Monthly management", amount: "55000" }],
  });
  try {
    const outcomes = await Promise.all([runDueRecurringInvoices(startDate), runDueRecurringInvoices(startDate)]);
    assert.equal(outcomes.flatMap((entry) => entry.results).filter((entry) => entry.status === "GENERATED").length, 1);
    const run = await prisma.recurringInvoiceRun.findFirstOrThrow({ where: { organizationId: organization.id, planId: plan.id, scheduledFor: new Date(`${startDate}T00:00:00.000Z`) }, include: { generatedInvoice: { include: { items: true } } } });
    assert.equal(run.status, "GENERATED");
    assert.equal(run.generatedInvoice?.lifecycleStatus, "DRAFT");
    assert.equal(run.generatedInvoice?.invoiceNumber, null);
    assert.equal(run.generatedInvoice?.issuedAt, null);
    assert.equal(run.generatedInvoice?.grandTotal.toString(), "55000");
    assert.equal(run.generatedInvoice?.items[0]?.unitPrice.toString(), "55000");
    assert.equal(await prisma.recurringInvoiceRun.count({ where: { organizationId: organization.id, planId: plan.id } }), 1);

    await updateRecurringPlan(organization.id, plan.id, {
      clientId: client.id, name: plan.name, projectTitle: plan.projectTitle, currencyCode: "LKR", frequency: "MONTHLY", startDate,
      dueInDays: 14, items: [{ billingMode: "FLAT_FEE", description: "Monthly management", amount: "60000" }],
    });
    const nextDate = "2026-12-02";
    const next = await runDueRecurringInvoices(nextDate);
    assert.equal(next.results.some((entry) => entry.planId === plan.id && entry.status === "GENERATED"), true);
    const drafts = await prisma.recurringInvoiceRun.findMany({ where: { organizationId: organization.id, planId: plan.id }, include: { generatedInvoice: true }, orderBy: { scheduledFor: "asc" } });
    assert.deepEqual(drafts.map((entry) => entry.generatedInvoice?.grandTotal.toString()), ["55000", "60000"]);
    const scheduledAhead = await prisma.recurringInvoicePlan.findFirstOrThrow({ where: { id: plan.id, organizationId: organization.id }, select: { nextRunDate: true } });
    await setRecurringPlanActive(organization.id, plan.id, false);
    const paused = await prisma.recurringInvoicePlan.findFirstOrThrow({ where: { id: plan.id, organizationId: organization.id }, select: { nextRunDate: true, isActive: true } });
    assert.equal(paused.isActive, false);
    assert.equal(paused.nextRunDate.toISOString(), scheduledAhead.nextRunDate.toISOString());
    await setRecurringPlanActive(organization.id, plan.id, true);
    const resumed = await prisma.recurringInvoicePlan.findFirstOrThrow({ where: { id: plan.id, organizationId: organization.id }, select: { nextRunDate: true, isActive: true } });
    assert.equal(resumed.isActive, true);
    assert.equal(resumed.nextRunDate.toISOString(), scheduledAhead.nextRunDate.toISOString());
  } finally {
    const runs = await prisma.recurringInvoiceRun.findMany({ where: { organizationId: organization.id, planId: plan.id }, select: { generatedInvoiceId: true } });
    await prisma.recurringInvoiceRun.deleteMany({ where: { organizationId: organization.id, planId: plan.id } });
    const invoiceIds = runs.flatMap((run) => run.generatedInvoiceId ? [run.generatedInvoiceId] : []);
    await prisma.invoiceItem.deleteMany({ where: { organizationId: organization.id, invoiceId: { in: invoiceIds } } });
    await prisma.invoice.deleteMany({ where: { organizationId: organization.id, id: { in: invoiceIds } } });
    await prisma.recurringInvoiceItem.deleteMany({ where: { organizationId: organization.id, planId: plan.id } });
    await prisma.recurringInvoicePlan.deleteMany({ where: { organizationId: organization.id, id: plan.id } });
    await prisma.client.deleteMany({ where: { organizationId: organization.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  }
});

test("an inactive-client FAILED occurrence is reused and generated on concurrent retry", async () => {
  const token = randomUUID();
  const organization = await prisma.organization.create({ data: { name: `Retry ${token}`, slug: `retry-${token}` } });
  const client = await prisma.client.create({ data: { organizationId: organization.id, name: `Client ${token}` } });
  const scheduledFor = "2026-11-05";
  const plan = await createRecurringPlan(organization.id, {
    clientId: client.id, name: "Inactive client retry", currencyCode: "LKR", frequency: "MONTHLY", startDate: scheduledFor,
    items: [{ billingMode: "FLAT_FEE", description: "Monthly service", amount: "55000" }],
  });
  try {
    await prisma.client.update({ where: { id: client.id }, data: { active: false } });
    const first = await runDueRecurringInvoices(scheduledFor);
    assert.equal(first.results.some((result) => result.planId === plan.id && result.status === "FAILED"), true);
    const failedRun = await prisma.recurringInvoiceRun.findUniqueOrThrow({ where: { planId_scheduledFor: { planId: plan.id, scheduledFor: new Date(`${scheduledFor}T00:00:00.000Z`) } } });
    assert.equal(failedRun.status, "FAILED");
    assert.equal(failedRun.generatedInvoiceId, null);
    const waitingPlan = await prisma.recurringInvoicePlan.findFirstOrThrow({ where: { id: plan.id, organizationId: organization.id }, select: { nextRunDate: true } });
    assert.equal(waitingPlan.nextRunDate.toISOString().slice(0, 10), scheduledFor);

    await prisma.client.update({ where: { id: client.id }, data: { active: true } });
    const concurrentRetries = await Promise.all([runDueRecurringInvoices(scheduledFor), runDueRecurringInvoices(scheduledFor)]);
    assert.equal(concurrentRetries.flatMap((result) => result.results).filter((result) => result.planId === plan.id && result.status === "GENERATED").length, 1);

    const generatedRun = await prisma.recurringInvoiceRun.findUniqueOrThrow({ where: { id: failedRun.id }, include: { generatedInvoice: true } });
    assert.equal(generatedRun.status, "GENERATED");
    assert.equal(generatedRun.generatedInvoiceId, generatedRun.generatedInvoice?.id);
    assert.equal(generatedRun.generatedInvoice?.lifecycleStatus, "DRAFT");
    assert.equal(generatedRun.generatedInvoice?.invoiceNumber, null);
    assert.equal(generatedRun.generatedInvoice?.grandTotal.toString(), "55000");
    assert.equal(await prisma.recurringInvoiceRun.count({ where: { organizationId: organization.id, planId: plan.id } }), 1);
    assert.equal(await prisma.invoice.count({ where: { organizationId: organization.id, id: generatedRun.generatedInvoiceId } }), 1);

    const advancedPlan = await prisma.recurringInvoicePlan.findFirstOrThrow({ where: { id: plan.id, organizationId: organization.id }, select: { nextRunDate: true } });
    assert.equal(advancedPlan.nextRunDate.toISOString().slice(0, 10), "2026-12-05");
    await runDueRecurringInvoices(scheduledFor);
    assert.equal(await prisma.recurringInvoiceRun.count({ where: { organizationId: organization.id, planId: plan.id } }), 1);
    assert.equal(await prisma.invoice.count({ where: { organizationId: organization.id } }), 1);
    const unchangedPlan = await prisma.recurringInvoicePlan.findFirstOrThrow({ where: { id: plan.id, organizationId: organization.id }, select: { nextRunDate: true } });
    assert.equal(unchangedPlan.nextRunDate.toISOString(), advancedPlan.nextRunDate.toISOString());
  } finally {
    const runs = await prisma.recurringInvoiceRun.findMany({ where: { organizationId: organization.id, planId: plan.id }, select: { generatedInvoiceId: true } });
    await prisma.recurringInvoiceRun.deleteMany({ where: { organizationId: organization.id, planId: plan.id } });
    const invoiceIds = runs.flatMap((run) => run.generatedInvoiceId ? [run.generatedInvoiceId] : []);
    await prisma.invoiceItem.deleteMany({ where: { organizationId: organization.id, invoiceId: { in: invoiceIds } } });
    await prisma.invoice.deleteMany({ where: { organizationId: organization.id, id: { in: invoiceIds } } });
    await prisma.recurringInvoiceItem.deleteMany({ where: { organizationId: organization.id, planId: plan.id } });
    await prisma.recurringInvoicePlan.deleteMany({ where: { organizationId: organization.id, id: plan.id } });
    await prisma.client.deleteMany({ where: { organizationId: organization.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  }
});
