# Codex Handoff

- **Task ID:** INV-014 — Database-Backed Issued Invoice Document & PDF Service
- **Status:** Complete

## Summary

Added a server-only document loader for persisted issued invoices and a PDF wrapper over the existing generator. The loader scopes access by organization, allows issued/closed states only, uses the exact frozen template version, and builds `InvoiceView` from persisted financial values, line items, and client snapshots. Historical invoices with a null template version fail explicitly and require separate historical handling.

## Files changed

- `src/lib/invoices/issued-invoice-document.ts`
- `src/lib/invoices/issued-invoice-document.test.ts`
- `src/lib/invoices/generate-issued-invoice-pdf.ts`
- `package.json`
- `docs/ARCHITECTURE.md`
- `docs/BUSINESS-RULES.md`
- `docs/SECURITY.md`
- `docs/CODEX_HANDOFF.md`

## Document flow and historical fidelity

- The document lookup filters by `organizationId` and invoice ID and accepts ISSUED, SUPERSEDED, VOID, and WRITTEN_OFF states only.
- It loads renderer/config through the invoice's immutable `templateVersionId`, validates both, and does not consult the current default template.
- It reads persisted client snapshots and financial/item values. Prisma decimals are converted with exact decimal strings; items sort by position then ID.
- `generateIssuedInvoicePdf()` delegates to the existing trusted PDF generator and formats `Invoice-{persisted invoiceNumber}.pdf`; it does not duplicate layout or mutate database state.
- Null frozen template references fail clearly. No migration is required; historical rows remain unchanged.

## Tests and checks

- `npm test` — passed, 74 tests total (66 unit/integration tests and eight PDF tests).
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; optimized production build completed.
- `npm run db:migrate:status` — passed; all nine migrations are applied. No migration was needed for this task.

## Blockers

None known.
