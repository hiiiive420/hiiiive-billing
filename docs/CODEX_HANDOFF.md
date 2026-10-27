# Codex Handoff

## Task
INV-026 — Payment Recording & Payment History UI

## Status
Implementation complete and uncommitted. INV-026A confirms the payment UI copy, CSS classes, and safe eligibility error mapping. No migration was required.

## Summary
Added a tenant-scoped payment summary and history view for invoices, plus an authorized payment recording flow that delegates financial validation, locking, and status updates to the existing transaction service. The frozen issued invoice document remains unchanged.

## Routes / Navigation
The issued invoice page displays a compact payment summary above the A4 document. `View Payments` opens `/app/[organizationSlug]/invoices/[invoiceId]/payments`; `Record Payment` is offered when the user has `PAYMENT_RECORD` and the invoice lifecycle is ISSUED. The payment page links back to the issued invoice and invoice workspace.

## Payment Read Model
`src/lib/invoices/invoice-payments.ts` scopes invoice lookup to the trusted organization ID and returns persisted invoice values, exact Decimal payment totals, balances, overpayment, and supported history fields as strings/ISO dates. Issued client display prefers the frozen snapshot. Reads compare the payment-row sum with persisted paymentStatus and report mismatches without repairing state.

## Record Payment Flow
The payment Server Action independently resolves the authorized organization through `requireOrganizationBySlug(..., "PAYMENT_RECORD")`, parses only amount, payment date, method, reference, and internal note, then calls the existing `recordPayment()` service. It revalidates the payment page, issued invoice, and workspace. The form stays on the payment page and refreshes authoritative server data after success.

## Existing Payment Business Rules
The existing service allows recording only for ISSUED invoices; DRAFT, SUPERSEDED, VOID, and WRITTEN_OFF are rejected. It requires a positive amount with no more than four decimal places, uses the invoice currency, takes the existing invoice row lock, and updates paymentStatus from the aggregate payment sum. Payment history is append-only in the UI. The Payment model does not record who entered a payment.

## Partial / Full / Overpayment Behavior
Zero paid is UNPAID; a positive sum below grandTotal is PARTIALLY_PAID; a sum at or above grandTotal is PAID. Overpayment is accepted by the existing service: grandTotal stays unchanged, balance due is shown as zero, and the excess is shown as Overpaid. Additional payments on a PAID invoice are explicitly described as potentially overpaying.

## Payment History
History is newest first by payment date, with recorded time and ID tie-breakers. It shows the model's amount, payment date, method, reference, internal note, and recorded-at timestamp. No edit, delete, refund, reversal, or receipt email is available.

## RBAC / Tenant Isolation
The payment page requires `PAYMENT_READ`; the Server Action independently requires `PAYMENT_RECORD`. The slug is resolved against active memberships, and only the returned organization ID scopes data and writes. Browser input cannot override organization scope, currency, totals, payment status, role, or user identity; invoice IDs remain tenant-scoped by the existing service.

## Responsive UI
Summary cards and form stack on narrow screens. Payment history rows become compact readable cards without horizontal overflow.

## Tests and Checks
- `npm test` — passed: 165 unit/integration tests and 8 PDF tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; `/app/[organizationSlug]/invoices/[invoiceId]/payments` is in the production route manifest.
- `npm run db:migrate:status` — passed; all 13 migrations are applied.
- `npm audit --omit=dev` — passed; 0 production vulnerabilities.
- `git diff --check` — passed.

## Migration Status
No schema or migration changes were made. Database is up to date at 13 migrations.

## Limitations / Next Step
Wrong payments cannot be corrected in this MVP because edit/delete/refund/reversal flows are not included. No recorder identity is stored. After acceptance, suggested next task: INV-027 — Client & Service Management UI.
