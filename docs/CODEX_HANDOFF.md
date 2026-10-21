# Codex Handoff

- **Task ID:** INV-011B — Invoice Currency Rules
- **Status:** Complete

## Summary

Formalized invoice-level currency validation, issuance behavior, service-price currency rules, and renderer display. No Prisma schema, migration, exchange-rate, or conversion changes were made.

## Files changed

- `src/lib/invoices/currency.ts`
- `src/lib/invoices/issue-invoice.ts`
- `src/lib/invoices/issue-invoice.test.ts`
- `src/lib/invoice-templates/config.ts`
- `src/lib/invoice-templates/hiiiive-default.tsx`
- `src/lib/invoice-templates/renderer.test.tsx`
- `src/app/dev/invoice-preview/page.tsx`
- `docs/BUSINESS-RULES.md`
- `docs/DATABASE.md`
- `docs/SECURITY.md`
- `docs/CODEX_HANDOFF.md`

## Currency behavior

- `Invoice.currencyCode` is authoritative. Draft currency remains editable; issuance validates and stores the uppercase code, which must remain immutable after issuance.
- Validation accepts exactly three ASCII letters and normalizes them to uppercase. Malformed values fail before sequence reservation.
- A service default price is not auto-applied or converted when its currency differs from the invoice currency; an explicit invoice unit price is required.
- Rendered financial values remain plain numbers, with the final note `All amounts are in {invoice.currencyCode}.` Currency is not template configuration.
- Future invoice entry should offer a currency selector defaulting to LKR. AI input must ask for clarification when a symbol such as `$` is ambiguous.

## Tests and checks

- `npm test` — 46 tests passed, including uppercase normalization, malformed code rejection, non-LKR renderer note, financial data non-mutation, and PostgreSQL issuance normalization/rollback coverage.
- `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run db:migrate:status` — passed; database schema is up to date.

## Blockers

None.
