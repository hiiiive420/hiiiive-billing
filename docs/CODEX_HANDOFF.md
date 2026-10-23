# Codex Handoff

# Task ID: INV-017 — Conventional Invoice Form UI Foundation

- **Status:** Complete (new draft creation; draft editing deferred)

## Summary

Added a responsive development-only invoice entry form at `/dev/invoices/new`. It supports searchable client and service selection, free-text line items, currency-aware service defaults, exact string/BigInt preview totals, discounts, notes, and new draft saving. Issue Invoice and Preview remain disabled. A dev-only fixture helper upserts deterministic sample organization/client/service records. Draft edits are deferred because the existing header and item update service calls do not provide one atomic full-form save.

## Security and data behavior

- The route and every Server Action return not-found in production.
- Organization scope resolves from the fixed server-side `hiiiive` slug; the dev-only helper provides deterministic sample data and no client-provided organization ID is accepted.
- Server actions reuse `searchInvoiceClients()`, `searchInvoiceServices()`, and `createDraftInvoice()`. The server draft service remains authoritative for validation and persisted totals.
- The form sends only editable fields; statuses, numbering, template binding, and persisted totals are not controlled by UI state.
- Preview values are exact decimal-string/BigInt calculations and are labeled as non-authoritative.

## Tests and checks

- Added focused helper tests for currency warnings, mismatched service currencies, free-text items, ignored forged tenant/total fields, and exact preview arithmetic.
- `npm test` — passed, 89 unit/integration tests and 8 PDF tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; `/dev/invoices/new` is not exposed as a production UI route.
- `npm run db:migrate:status` — passed; all 9 migrations are applied. No migration was required.

## Blockers

- Draft edit mode is not included. The current draft header and item update services each use their own transaction, so wiring both as a single form save could leave a partial update. A combined atomic draft update service is needed first.

---

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

---

# Task ID: INV-017A — Flat Fee Invoice Items

- **Status:** Complete

## Summary

Added explicit `QUANTITY` and `FLAT_FEE` item billing modes. Existing and omitted modes remain `QUANTITY`. Flat fees persist canonically as quantity `1`, unit price equal to amount, and recalculated line total equal to amount. The invoice entry form now exposes an explicit billing-method control and only applies service defaults after the user requests them.

## Schema and migration

- Added `InvoiceItemBillingMode` and `InvoiceItem.billingMode @default(QUANTITY)`.
- Applied migration `20261023060949_add_invoice_item_billing_mode`. Its SQL adds the enum and a non-null column with `DEFAULT 'QUANTITY'`; existing item financial values are not updated.

## Draft, issuance, and documents

- Draft creation and item replacement support flat-fee amount inputs and explicit service-default requests, while preserving legacy quantity inputs.
- Issuance independently recalculates and validates. Flat-fee quantity must be exactly `1`, and persisted line total must equal unit price; invalid rows fail before sequence reservation.
- Draft edit read models expose `billingMode` and a flat `amount`. Issued document loading carries persisted billing mode through to the trusted renderer.
- All-flat-fee invoices use `ITEM | SERVICES | AMOUNT`; mixed invoices keep the five-column table and show dashes for flat-fee quantity/unit-price cells. PDF remains one-page A4.

## Tests and checks

- `npm exec prisma format` — passed.
- `npm run prisma:validate` — passed.
- `npm run prisma:generate` — passed.
- `npm test` — passed, 100 unit/integration tests and 8 PDF tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed.
- `npm run db:migrate:status` — passed; all 10 migrations are applied.

## Blockers

None known.

---

# Task ID: INV-017B — Invoice Entry UI Polish & Preview Financial Parity

- **Status:** Complete

## Summary

Refined the invoice item's billing method into a compact keyboard-accessible segmented radio control. Flat fee rows keep the amount field and calculated amount while hiding quantity and unit price; quantity rows retain their existing fields. The currency warning now ignores a completely untouched item row.

Preview arithmetic now uses integer decimal units. Quantity line totals round individually to four decimal places with ROUND_HALF_UP before subtotaling, flat fees are previewed as their entered amount, and valid discounts are subtracted exactly. Invalid or negative discount input produces a neutral payable preview and a validation message. These values remain preview-only; the server continues to calculate and validate saved totals.

## Tests and checks

- Added focused tests for the requested multiplication regression, fifth-decimal half-up boundaries, per-line subtotal rounding, flat-fee totals, discount arithmetic and invalid discounts, mode switching, flat-fee payloads, and empty-row currency warning behavior.
- `npm test` — passed, 103 unit/integration tests and 8 PDF tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed.
- `npm run db:migrate:status` — passed; all 10 migrations are applied. No migration was needed.

## Blockers

None known.

---

# Task ID: INV-017C — Hydration Stability & Financial Number Formatting

- **Status:** Complete

## Summary

Removed dynamic selected classes from the billing-method labels and styled selection through the controlled radio's `:checked` state. The initial billing mode remains a fixed `QUANTITY` value. Added reusable exact-string helpers for money formatting and grouped-input normalization. Money fields show canonical values while focused and thousands separators while blurred; valid grouped paste is normalized before form state and payload parsing. Preview calculations and server financial/storage rules are unchanged.

## Tests and checks

- Added focused tests for deterministic initial mode, grouped formatting and normalization, comma-free canonical payloads, preview formatting, existing flat-fee totals, and server-matching quantity precision.
- `npm test` — passed, 105 unit/integration tests and 8 PDF tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed.
- `npm run db:migrate:status` — passed; all 10 migrations are applied. No migration was needed.

## Blockers

None known.

---

# Task ID: INV-018 — Atomic Full Draft Update Service

- **Status:** Complete

## Summary

Added server-only `updateFullDraftInvoice(organizationId, invoiceId, input)` for complete draft-form updates. It replaces the full item list and writes all editable invoice header fields and server-derived totals atomically. It reuses the existing item preparation, service default, currency, Decimal, and total validation helpers. No edit UI or migration was added.

## Transaction and security behavior

- Locks the tenant-scoped invoice row with `SELECT ... FOR UPDATE`, using the same lock as targeted draft edits and `issueInvoice()`.
- Rejects cross-organization, non-DRAFT, numbered, or issued-at invoices; requires an active same-organization client and validates all active same-organization services.
- Validates/prepares all items and totals before replacement, then deletes/recreates items and updates the invoice within the same Prisma transaction. Errors roll back both item and header changes.
- Does not update issuance snapshots or reserve invoice sequence values. Full invoice-form draft edits must use this service; do not chain header and item update transactions.

## Tests and checks

- PostgreSQL integration coverage includes full header/item updates, quantity and flat-fee items, free-text and service-backed items, service default opt-in/currency rules, explicit price precedence, tenant/activity validation, invalid item/discount rollback, issued and cross-tenant rejection, sequence non-consumption, and edit-versus-issue serialization.
- `npm test` — passed, 110 unit/integration tests and 8 PDF tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed.
- `npm run db:migrate:status` — passed; all 10 migrations are applied. No migration was needed.

## Blockers

None known.

---

# Task ID: INV-019 — Saved Draft Edit UI

- **Status:** Complete

## Summary

Added the development-only `/dev/invoices/[invoiceId]/edit` route and reused the existing invoice-entry form for create and edit workflows. The route loads only a tenant-owned, unissued DRAFT. The form restores saved header values and deterministically ordered items, then saves the complete form through `updateFullDraftInvoice()`.

Create mode retains its existing save behavior and now links the created draft to its edit route. Edit mode remains editable after a successful save and displays a save confirmation.

## Restore and save behavior

- The draft read model returns the selected client's display details plus each item's current service details for informational display.
- Saved quantity, unit price, flat amount, billing mode, item order, and original currency are mapped directly from exact persisted strings. Existing saved prices stay authoritative; service defaults are not applied when reopening.
- Edit Server Actions independently block production, resolve the fixed development organization on the server, whitelist editable form data, and call the atomic full-draft update service. Client-supplied tenant IDs and persisted totals are ignored.
- Preview and Issue Invoice remain disabled. No migration was required.

## Tests and checks

- Added coverage for edit-state mapping, exact money strings, original currency warning state, saved service price preservation, client/service display data, DRAFT-only loading, and existing atomic update protections.
- `npm test` — passed, 112 unit/integration tests and 8 PDF tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; includes `/dev/invoices/[invoiceId]/edit`.
- `npm run db:migrate:status` — passed; all 10 migrations are applied. No migration was needed.

## Blockers

None known.
