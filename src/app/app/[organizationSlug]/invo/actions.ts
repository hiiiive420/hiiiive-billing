"use server";

import { prepareInvoProposal } from "@/lib/invoices/invo-service";

export async function sendInvoMessage(organizationSlug: string, target: unknown, messages: unknown, offers: unknown) {
  return prepareInvoProposal(organizationSlug, target, messages, offers);
}

