import "server-only";

import { notFound } from "next/navigation";
import { getPrismaClient } from "@/lib/prisma";
import { devInvoiceEntryAvailable } from "@/lib/invoices/invoice-entry-ui";

const DEV_ORGANIZATION_SLUG = "hiiiive";
const DEV_CLIENT_ID = "00000000-0000-4000-8000-000000000017";
const DEV_SERVICE_ID = "00000000-0000-4000-8000-000000000018";

export async function getDevInvoiceOrganizationId(): Promise<string> {
  if (!devInvoiceEntryAvailable(process.env.NODE_ENV)) notFound();
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.upsert({
      where: { slug: DEV_ORGANIZATION_SLUG },
      create: { name: "Hiiiive Development", slug: DEV_ORGANIZATION_SLUG },
      update: {},
      select: { id: true },
    });
    await tx.client.upsert({
      where: { organizationId_id: { organizationId: organization.id, id: DEV_CLIENT_ID } },
      create: {
        id: DEV_CLIENT_ID,
        organizationId: organization.id,
        name: "Development Client",
        email: "billing@example.test",
        phone: "+94 11 555 0100",
        billingAddress: "Development address · Colombo",
      },
      update: {},
    });
    await tx.service.upsert({
      where: { organizationId_id: { organizationId: organization.id, id: DEV_SERVICE_ID } },
      create: {
        id: DEV_SERVICE_ID,
        organizationId: organization.id,
        name: "Consulting service",
        description: "Sample service for development invoice entry",
        defaultUnitPrice: "25000.0000",
        currencyCode: "LKR",
      },
      update: {},
    });
    return organization.id;
  });
}
