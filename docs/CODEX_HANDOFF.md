# Codex Handoff

- **Task ID:** INV-015 — Draft Invoice Creation & Editing Service
- **Status:** Complete

## Summary

Added server-only draft invoice creation, header editing, and item replacement. The service validates active tenant-owned clients/services, calculates line and invoice totals with Decimal helpers shared with issuance, and keeps drafts unnumbered and unbound to template versions. Draft mutation and issuance acquire the invoice row lock, preventing issuance from reading stale data during concurrent edits.

## Files changed

- `src/lib/invoices/draft-invoice.ts`
- `src/lib/invoices/draft-invoice.test.ts`
- `src/lib/invoices/invoice-financials.ts`
- `src/lib/invoices/issue-invoice.ts`
- `package.json`
- `docs/ARCHITECTURE.md`
- `docs/BUSINESS-RULES.md`
- `docs/SECURITY.md`
- `docs/CODEX_HANDOFF.md`

## Draft behavior and integrity

- `createDraftInvoice(organizationId, input)`, `updateDraftInvoice(organizationId, invoiceId, input)`, and `replaceDraftInvoiceItems(organizationId, invoiceId, items)` accept no caller-controlled lifecycle, numbering, snapshots, template binding, or totals.
- Free-text items are supported. Service defaults require explicit opt-in and matching currency; explicit unit prices take precedence.
- Line totals use four decimal places with `ROUND_HALF_UP`; subtotal and grand total use shared helpers also used by issuance. Issuance independently recalculates before numbering.
- Item replacement and totals commit atomically. Failed create/edit operations reserve no invoice numbers. No database migration was required.

## Tests and checks

- `npm test` — passed, 77 unit/integration checks and eight PDF checks.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; optimized production build completed.
- `npm run db:migrate:status` — passed; all nine migrations are applied.

## Blockers

None known.
