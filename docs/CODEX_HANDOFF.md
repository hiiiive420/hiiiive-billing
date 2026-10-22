# Codex Handoff

- **Task ID:** INV-016 — Invoice Form Read Model & Client/Service Queries
- **Status:** Complete

## Summary

Added server-only client and service searches plus a DRAFT-only invoice editing read model. Search results are tenant-scoped, active-only, minimal, deterministically ordered, and limited. Draft amounts remain exact decimal strings and item order is stable.

## Files changed

- `src/lib/invoices/invoice-entry-queries.ts`
- `src/lib/invoices/invoice-entry-queries.test.ts`
- `package.json`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/CODEX_HANDOFF.md`

## Read model behavior and integrity

- `searchInvoiceClients()` and `searchInvoiceServices()` return active records in the supplied organization only, with a default limit of 20 and hard maximum of 50.
- Search text is trimmed, capped at 100 characters, and wildcard characters are escaped as literal text. Ordering is by name then ID.
- `loadDraftInvoiceForEditing()` rejects cross-tenant and non-DRAFT invoices, returns ISO `YYYY-MM-DD` dates and exact Decimal strings, and orders items by position then ID.
- Read queries only perform selects; no database migration was required.

## Tests and checks

- `npm test` — passed, 84 unit/integration checks and eight PDF checks.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; optimized production build completed.
- `npm run db:migrate:status` — passed; all nine migrations are applied. No migration was needed.

## Blockers

None known.
