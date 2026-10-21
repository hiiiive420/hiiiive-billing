# Codex Handoff

- **Task ID:** INV-009A — Replacement Lineage Integrity
- **Status:** Complete

## Summary

A replacement invoice can now be linked as REPLACED_BY to only one source invoice per organization. The service rejects already-linked targets after acquiring the existing stable-order invoice locks, and the database enforces the same invariant.

## Schema and service changes

- `InvoiceRelation` uniqueness is now `(organizationId, targetInvoiceId, relationType)`.
- `supersedeInvoice` checks target lineage after locking all source and replacement invoice rows in stable ID order.
- Payment logic was not changed.

## Files changed

- `prisma/schema.prisma`
- `prisma/migrations/20261021140000_enforce_replacement_lineage/migration.sql`
- `src/lib/invoices/rework-invoice.ts`
- `src/lib/invoices/payments-rework.test.ts`
- `docs/DATABASE.md`
- `docs/BUSINESS-RULES.md`
- `docs/CODEX_HANDOFF.md`

## Migration result

`prisma migrate dev --create-only` was blocked by the non-interactive environment. The migration SQL was generated from the live database/schema diff and reviewed; it replaces the previous indexes with the target uniqueness index. `prisma migrate deploy` applied it successfully, and migration status reports the database schema is up to date.

## New tests and results

- An already-linked replacement is rejected and the attempted source remains ISSUED.
- Concurrent attempts by two sources to use the same replacement produce one success and one failure, with one source relation and the losing source still ISSUED.
- Existing one-source-to-three-replacements behavior passes.
- Full PostgreSQL integration suite: 34 tests passed.

## Checks

- `npm exec prisma format`, `npm run prisma:validate`, `npm run prisma:generate`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run db:migrate:status` — passed.

## Blockers

None.
