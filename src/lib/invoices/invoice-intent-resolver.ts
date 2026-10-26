import "server-only";

import { getPrismaClient } from "../prisma";
import type { InvoiceIntent } from "../ai/invoice-intent-contract";
import type { InvoiceIntentSuggestion } from "../ai/invoice-intent-contract";

/** Exact normalized match only. Every lookup is scoped to trusted organizationId. */
export async function resolveInvoiceIntentHints(organizationId: string, intent: InvoiceIntent): Promise<InvoiceIntentSuggestion> {
  const [client, resolvedServices] = await Promise.all([
    intent.clientHint ? findUniqueClient(organizationId, intent.clientHint) : Promise.resolve(null),
    Promise.all(intent.items.map(async (item, itemIndex) => ({
      itemIndex,
      service: item.serviceHint ? await findUniqueService(organizationId, item.serviceHint) : null,
    }))),
  ]);
  const ambiguities = [...intent.ambiguities];
  if (intent.clientHint && !client) addUnique(ambiguities, `Client “${intent.clientHint}” could not be uniquely matched. Choose a client in the invoice form.`);
  for (const result of resolvedServices) {
    const hint = intent.items[result.itemIndex]?.serviceHint;
    if (hint && !result.service) addUnique(ambiguities, `Service “${hint}” could not be uniquely matched. Search for it in the invoice form or leave it unlinked.`);
  }
  return {
    intent,
    resolvedClient: client,
    resolvedServices,
    ambiguities,
    missingInformation: [...intent.missingInformation],
  };
}

async function findUniqueClient(organizationId: string, hint: string): Promise<{ id: string; displayName: string } | null> {
  const matches = await getPrismaClient().$queryRaw<Array<{ id: string; name: string }>>`
    SELECT "id"::text AS "id", "name"
    FROM "Client"
    WHERE "organizationId" = ${organizationId}::uuid
      AND "active" = true
      AND lower(regexp_replace(btrim("name"), '[[:space:]]+', ' ', 'g')) = lower(regexp_replace(btrim(${hint}), '[[:space:]]+', ' ', 'g'))
    ORDER BY "id" ASC
    LIMIT 2
  `;
  return matches.length === 1 ? { id: matches[0]!.id, displayName: matches[0]!.name } : null;
}

async function findUniqueService(organizationId: string, hint: string): Promise<{ id: string; name: string } | null> {
  const matches = await getPrismaClient().$queryRaw<Array<{ id: string; name: string }>>`
    SELECT "id"::text AS "id", "name"
    FROM "Service"
    WHERE "organizationId" = ${organizationId}::uuid
      AND "active" = true
      AND lower(regexp_replace(btrim("name"), '[[:space:]]+', ' ', 'g')) = lower(regexp_replace(btrim(${hint}), '[[:space:]]+', ' ', 'g'))
    ORDER BY "id" ASC
    LIMIT 2
  `;
  return matches.length === 1 ? { id: matches[0]!.id, name: matches[0]!.name } : null;
}

function addUnique(values: string[], value: string): void {
  if (!values.some((existing) => existing.toLowerCase() === value.toLowerCase())) values.push(value);
}
