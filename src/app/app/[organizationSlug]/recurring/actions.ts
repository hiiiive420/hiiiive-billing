"use server";

import { revalidatePath } from "next/cache";
import { requireOrganizationBySlug, AuthorizationError, OrganizationContextNotFoundError, ProvisioningError } from "@/lib/auth/authorization";
import { AuthenticationError } from "@/lib/auth/identity";
import { DraftInvoiceError } from "@/lib/invoices/draft-invoice";
import { createRecurringPlan, RecurringInvoiceError, setRecurringPlanActive, updateRecurringPlan, type RecurringPlanInput } from "@/lib/recurring/recurring-invoices";
import { normalizeRecurringMoneyInput, RecurringMoneyInputError } from "@/lib/recurring/recurring-money-input";

export async function saveRecurringPlanAction(organizationSlug: string, planId: string | null, value: unknown) {
  try {
    const { organizationId } = await requireOrganizationBySlug(organizationSlug, "RECURRING_INVOICE_MANAGE");
    const input = parsePlan(value);
    const plan = planId ? await updateRecurringPlan(organizationId, planId, input) : await createRecurringPlan(organizationId, input);
    revalidatePath(`/app/${encodeURIComponent(organizationSlug)}/recurring`);
    return { ok: true as const, planId: plan.id };
  } catch (error) {
    if (process.env.NODE_ENV !== "production" && isUnexpectedSaveError(error)) console.error("Recurring plan save failed", error);
    return { ok: false as const, error: safeMessage(error, "Could not save this recurring plan.") };
  }
}

export async function setRecurringPlanActiveAction(organizationSlug: string, planId: string, active: boolean) {
  try {
    const { organizationId } = await requireOrganizationBySlug(organizationSlug, "RECURRING_INVOICE_MANAGE");
    if (typeof active !== "boolean") throw new RecurringInvoiceError("Plan status is invalid.");
    await setRecurringPlanActive(organizationId, planId, active);
    revalidatePath(`/app/${encodeURIComponent(organizationSlug)}/recurring`);
    revalidatePath(`/app/${encodeURIComponent(organizationSlug)}/recurring/${encodeURIComponent(planId)}`);
    return { ok: true as const };
  } catch (error) { return { ok: false as const, error: safeMessage(error, "Could not update this recurring plan.") }; }
}

function parsePlan(value: unknown): RecurringPlanInput {
  if (!value || typeof value !== "object") throw new RecurringInvoiceError("Recurring plan data is invalid.");
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.items)) throw new RecurringInvoiceError("Recurring items are invalid.");
  const text = (key: string) => typeof record[key] === "string" ? record[key] as string : "";
  const items = record.items.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new RecurringInvoiceError("Recurring item is invalid.");
    const item = raw as Record<string, unknown>;
    const flatFee = item.billingMode === "FLAT_FEE";
    const amountLabel = `Enter a valid amount for Item ${index + 1}.`;
    return {
      billingMode: flatFee ? "FLAT_FEE" as const : "QUANTITY" as const,
      serviceId: typeof item.serviceId === "string" && item.serviceId ? item.serviceId : null,
      description: typeof item.description === "string" ? item.description : "",
      ...(flatFee ? { amount: normalizeRecurringMoneyInput(typeof item.amount === "string" ? item.amount : "", amountLabel) } : {
        quantity: typeof item.quantity === "string" ? item.quantity : "",
        unitPrice: normalizeRecurringMoneyInput(typeof item.unitPrice === "string" ? item.unitPrice : "", `Enter a valid unit price for Item ${index + 1}.`),
      }),
    };
  });
  const due = record.dueInDays === "" || record.dueInDays === null || record.dueInDays === undefined ? null : Number(record.dueInDays);
  return {
    clientId: text("clientId"), name: text("name"), projectTitle: text("projectTitle"), currencyCode: text("currencyCode"),
    frequency: record.frequency === "YEARLY" ? "YEARLY" : "MONTHLY", startDate: text("startDate"), dueInDays: due,
    discountLabel: text("discountLabel"),
    discountAmount: normalizeRecurringMoneyInput(text("discountAmount") || "0", "Enter a valid discount amount."),
    paymentTerms: text("paymentTerms"), notes: text("notes"), items,
  };
}

function safeMessage(error: unknown, fallback: string) {
  if (error instanceof RecurringInvoiceError) return error.message;
  if (error instanceof DraftInvoiceError) return error.message;
  if (error instanceof RecurringMoneyInputError) return error.message;
  if (error instanceof AuthorizationError) return "You do not have permission to manage recurring invoices.";
  if (error instanceof OrganizationContextNotFoundError) return "This organization is not accessible.";
  if (process.env.NODE_ENV !== "production" && (error instanceof AuthenticationError || error instanceof ProvisioningError)) return error.message;
  return fallback;
}

function isUnexpectedSaveError(error: unknown) {
  return !(error instanceof RecurringInvoiceError || error instanceof DraftInvoiceError || error instanceof RecurringMoneyInputError ||
    error instanceof AuthorizationError || error instanceof OrganizationContextNotFoundError ||
    error instanceof AuthenticationError || error instanceof ProvisioningError);
}
