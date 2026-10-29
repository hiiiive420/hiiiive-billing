import "server-only";

import { parseHiiiiveTemplateConfig } from "@/lib/invoice-templates/config";
import { getPrismaClient } from "@/lib/prisma";

export type SettingsWorkspace = Readonly<{
  organization: { name: string; slug: string };
  template: null | {
    companyName: string; bankName: string; accountName: string; accountNumber: string;
    headingFontName: string; bodyFontName: string; primaryColor: string;
  };
}>;

export class SettingsUnavailableError extends Error {
  constructor() { super("Settings are temporarily unavailable."); this.name = "SettingsUnavailableError"; }
}

export async function loadSettingsWorkspace(organizationId: string): Promise<SettingsWorkspace> {
  const prisma = getPrismaClient();
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true, slug: true } });
  if (!organization) throw new SettingsUnavailableError();
  const templates = await prisma.invoiceTemplate.findMany({
    where: { organizationId, active: true, isDefault: true }, take: 2,
    select: { id: true, key: true },
  });
  if (templates.length !== 1 || templates[0]!.key !== "hiiiive-default") return { organization, template: null };
  const version = await prisma.invoiceTemplateVersion.findFirst({
    where: { organizationId, templateId: templates[0]!.id }, orderBy: { version: "desc" }, select: { rendererKey: true, config: true },
  });
  if (!version || version.rendererKey !== "hiiiive-default") return { organization, template: null };
  try {
    const config = parseHiiiiveTemplateConfig(version.config);
    return { organization, template: {
      companyName: config.companyName, bankName: config.bankName ?? "", accountName: config.accountName ?? "",
      accountNumber: config.accountNumber ?? "", headingFontName: config.headingFontName,
      bodyFontName: config.bodyFontName, primaryColor: config.primaryColor,
    } };
  } catch { return { organization, template: null }; }
}
