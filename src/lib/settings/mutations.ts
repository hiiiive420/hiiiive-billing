import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { parseHiiiiveTemplateConfig, type HiiiiveTemplateConfig } from "@/lib/invoice-templates/config";
import { getPrismaClient } from "@/lib/prisma";

export class SettingsValidationError extends Error {
  constructor(message: string) { super(message); this.name = "SettingsValidationError"; }
}
export class SettingsTemplateUnavailableError extends Error {
  constructor() { super("The supported invoice template is unavailable."); this.name = "SettingsTemplateUnavailableError"; }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SettingsValidationError("Settings are invalid.");
  return value as Record<string, unknown>;
}
function text(input: Record<string, unknown>, field: string, max: number, required: boolean): string {
  const value = input[field];
  if (typeof value !== "string") throw new SettingsValidationError(`Enter a valid ${field === "companyName" ? "invoice display name" : field === "name" ? "organization name" : field}.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new SettingsValidationError(`${field === "companyName" ? "Invoice display name" : field === "name" ? "Organization name" : field} is required.`);
  if (trimmed.length > max) throw new SettingsValidationError(`${field} must be ${max} characters or fewer.`);
  return trimmed;
}

export function parseOrganizationSettings(value: unknown): { name: string } {
  const input = record(value);
  return { name: text(input, "name", 200, true) };
}
export function parseInvoiceDisplaySettings(value: unknown): Pick<HiiiiveTemplateConfig, "companyName" | "bankName" | "accountName" | "accountNumber" | "primaryColor"> {
  const input = record(value);
  const companyName = text(input, "companyName", 200, true);
  const bankName = text(input, "bankName", 120, false);
  const accountName = text(input, "accountName", 120, false);
  const accountNumber = text(input, "accountNumber", 80, false);
  const primaryColor = text(input, "primaryColor", 7, true);
  if (!/^#[0-9A-Fa-f]{6}$/.test(primaryColor)) throw new SettingsValidationError("Choose a valid invoice accent color.");
  return { companyName, bankName, accountName, accountNumber, primaryColor };
}

export async function updateOrganizationSettings(organizationId: string, value: unknown): Promise<void> {
  const data = parseOrganizationSettings(value);
  const result = await getPrismaClient().organization.updateMany({ where: { id: organizationId }, data });
  if (result.count !== 1) throw new SettingsTemplateUnavailableError();
}

/** Serializes with issuance's FOR SHARE lock, then adds a new immutable default-template version. */
export async function updateInvoiceDisplaySettings(organizationId: string, value: unknown): Promise<number | null> {
  const editable = parseInvoiceDisplaySettings(value);
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const defaults = await tx.$queryRaw<Array<{ id: string; key: string }>>`
      SELECT "id", "key" FROM "InvoiceTemplate"
      WHERE "organizationId" = ${organizationId}::uuid AND "active" = TRUE AND "isDefault" = TRUE
      FOR UPDATE`;
    if (defaults.length !== 1 || defaults[0]!.key !== "hiiiive-default") throw new SettingsTemplateUnavailableError();
    const templateId = defaults[0]!.id;
    const current = await tx.invoiceTemplateVersion.findFirst({
      where: { organizationId, templateId }, orderBy: { version: "desc" },
    });
    if (!current || current.rendererKey !== "hiiiive-default") throw new SettingsTemplateUnavailableError();
    let config: HiiiiveTemplateConfig;
    try { config = parseHiiiiveTemplateConfig(current.config); }
    catch { throw new SettingsTemplateUnavailableError(); }
    const nextConfig: HiiiiveTemplateConfig = { ...config, ...editable };
    if (editable.companyName === config.companyName && editable.bankName === (config.bankName ?? "")
      && editable.accountName === (config.accountName ?? "") && editable.accountNumber === (config.accountNumber ?? "")
      && editable.primaryColor === config.primaryColor) return null;
    parseHiiiiveTemplateConfig(nextConfig);
    const version = await tx.invoiceTemplateVersion.create({
      data: { organizationId, templateId, version: current.version + 1, rendererKey: "hiiiive-default", config: nextConfig as Prisma.InputJsonValue },
      select: { version: true },
    });
    return version.version;
  });
}
