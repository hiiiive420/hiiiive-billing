import "server-only";

import { AuthorizationError, OrganizationContextNotFoundError, requireOrganizationBySlug } from "../auth/authorization";
import { INVOICE_INTENT_UNAVAILABLE_MESSAGE, parseInvoiceIntent, type InvoiceIntentParserDependencies } from "../ai/invoice-intent";
import type { InvoiceIntentActionResult } from "../ai/invoice-intent-contract";
import { resolveInvoiceIntentHints } from "./invoice-intent-resolver";

const INVALID_INPUT_MESSAGE = "Enter an invoice description with at least a few details, up to 2,000 characters.";

export async function generateInvoiceIntentForOrganization(
  organizationSlug: string,
  rawText: unknown,
  dependencies: Readonly<{
    parser?: (text: string, parserDependencies?: InvoiceIntentParserDependencies) => ReturnType<typeof parseInvoiceIntent>;
    parserDependencies?: InvoiceIntentParserDependencies;
  }> = {},
): Promise<InvoiceIntentActionResult> {
  let organizationId: string;
  try {
    ({ organizationId } = await requireOrganizationBySlug(organizationSlug, "INVOICE_CREATE"));
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false, error: "You do not have permission to create invoices in this organization." };
    if (error instanceof OrganizationContextNotFoundError) return { ok: false, error: "This organization is not accessible." };
    return { ok: false, error: "Could not verify access to this workspace." };
  }

  if (typeof rawText !== "string") return { ok: false, error: INVALID_INPUT_MESSAGE };
  const text = rawText.trim();
  if (text.length > 2_000 || text.length < 5 || !/[\p{L}\p{N}]{3}/u.test(text)) {
    return { ok: false, error: INVALID_INPUT_MESSAGE };
  }

  try {
    const intent = await (dependencies.parser ?? parseInvoiceIntent)(text, dependencies.parserDependencies);
    const suggestion = await resolveInvoiceIntentHints(organizationId, intent);
    return { ok: true, suggestion };
  } catch {
    return { ok: false, error: INVOICE_INTENT_UNAVAILABLE_MESSAGE };
  }
}
