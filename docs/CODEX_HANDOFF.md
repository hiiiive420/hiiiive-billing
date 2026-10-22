# Codex Handoff

- **Task ID:** INV-013 — Freeze Invoice Template Version at Issuance
- **Status:** Complete

## Summary

`issueInvoice()` resolves the organization's single active default template and latest immutable version before reserving a number. It validates the trusted renderer and structured configuration, then binds the selected version in the same transaction as invoice numbering and issuance. A partial unique index prevents multiple active defaults, and a database trigger requires a version binding on new issuance and prevents changing or clearing it afterward. Existing historical/manual invoices are not backfilled and may remain null.

## Files changed

- `prisma/schema.prisma`
- `prisma/migrations/20261022100000_freeze_invoice_template_at_issuance/migration.sql`
- `src/lib/invoices/issue-invoice.ts`
- `src/lib/invoices/issue-invoice.test.ts`
- `src/lib/invoices/payments-rework.test.ts`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- `docs/SECURITY.md`
- `docs/BUSINESS-RULES.md`
- `docs/CODEX_HANDOFF.md`

## Resolution and immutability

- Template lookup is scoped to `organizationId` and locks the active default row while issuing. The partial unique index allows at most one active default per organization.
- The highest positive version is selected. Unsupported renderer keys, invalid config, absent active default, and absent/invalid versions fail before sequence reservation.
- The existing tenant-safe composite FK prevents cross-organization version links. The issued invoice keeps its version through ISSUED, SUPERSEDED, VOID, and WRITTEN_OFF states.
- Future issued-invoice PDF rendering must read renderer key/config through the invoice's saved `templateVersionId`; it must not follow a newer default.

## Tests and checks

- Migration SQL adds the active-default partial unique index and an invoice trigger for required-on-issuance and immutable-after-issuance bindings. It was applied to the development database.
- Existing nullable bindings remain unchanged; no backfill is performed.
- `npm test` — passed, 62 tests total (54 integration/unit tests plus eight PDF tests); all existing issuance concurrency and numbering checks pass.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; optimized production build completed.
- `npm run db:migrate:status` — passed; all nine migrations are applied.

## Blockers

None known.
