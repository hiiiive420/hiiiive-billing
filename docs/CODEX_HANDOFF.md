# Codex Handoff

- **Task ID:** INV-010A — Template Version Immutability
- **Status:** Complete

## Summary

Added a PostgreSQL safeguard that makes every `InvoiceTemplateVersion` immutable after creation. Template metadata remains editable, and new template versions remain insertable.

## Migration and safeguard

- Added `enforce_template_version_immutability` as a reviewed SQL migration.
- A `BEFORE UPDATE OR DELETE` row trigger raises an error for every version mutation, including versions not referenced by an invoice.
- Prisma schema and model were unchanged.

## Files changed

- `prisma/migrations/20261021160000_enforce_template_version_immutability/migration.sql`
- `src/lib/invoices/payments-rework.test.ts`
- `docs/DATABASE.md`
- `docs/BUSINESS-RULES.md`
- `docs/SECURITY.md`
- `docs/CODEX_HANDOFF.md`

## Tests and checks

- `npm test` — 35 PostgreSQL integration tests passed. New coverage verifies version creation, rejection of config/rendererKey/version updates and deletion, creation of Version 2, and unchanged Version 1.
- `npm run prisma:validate`, `npm run prisma:generate`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run db:migrate:status` — passed.
- Migration status reports the database schema is up to date.

## Blockers

None.
