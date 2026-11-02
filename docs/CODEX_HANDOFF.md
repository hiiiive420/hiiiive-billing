# Codex Handoff

## Task
INV-030 — Recurring Invoice Automation + Draft Autosave & Issue Flow

## Status
Implementation is present and the focused migration has been applied to the local development database. All automated checks completed successfully except the repository's default Turbopack build, which failed in its CSS child process; the webpack production build passed. No commit was created. Browser acceptance could not be performed because Chrome Computer Use was not approved.

## Repository Baseline
Checkout: `D:\Billing_Hive\hiiiive-billing`.

At task start, the worktree was clean and `main`, `origin/main`, and `origin/HEAD` were at `4c205a7 feat: polish production application ux` (INV-029). No commit or push was made for INV-030.

## Schema / Migration
Added `RecurringInvoicePlan`, `RecurringInvoiceItem`, and `RecurringInvoiceRun`, plus monthly/yearly and generated/failed enums. Added tenant-safe client/service/plan/invoice relations and a database unique index on `(planId, scheduledFor)`; generated invoice relation is unique. Migration: `20261102090000_recurring_invoice_automation`.

## Permissions
Added `RECURRING_INVOICE_READ` and `RECURRING_INVOICE_MANAGE`. ADMIN and BILLING receive both. VIEWER receives neither. Routes/actions use centralized `requireOrganizationBySlug()` checks.

## Draft Autosave Threshold
First production save waits for an active selected client, a valid three-letter currency, and at least one described item with valid quantity and nonnegative unit price, or valid flat-fee amount. Zero price remains allowed. Project title, dates, terms, notes, discount, service selection, and AI are optional. A project title or client alone creates no row.

## First Autosave
After a 950 ms debounce, the canonical `createDraftInvoice()` creates an unnumbered DRAFT. Client form state is retained while the browser URL changes to `/invoices/{draftId}/edit` through `history.replaceState()`.

## Subsequent Autosave / Concurrency
Edits serialize through one in-flight promise, with the latest form revision coalesced and saved afterward to the same draft using `updateFullDraftInvoice()`. Failure preserves browser state, shows an inline error, and exposes Save now. A lightweight `beforeunload` warning covers pending/failed changes to an existing draft.

## Invoice Action / Issue Flow
New and existing production drafts show autosave status, Preview, Save now, and Issue Invoice when a persisted draft is saved. Preview and issue wait for the latest save. Issue calls only the existing `issueInvoice()` action and remains explicitly confirmed. If issue fails after save, the DRAFT remains and the UI says it was saved. Generated recurring drafts use this same editor, preview, and issue flow.

## Routes / Navigation
Added `/app/[organizationSlug]/recurring`, `/recurring/new`, and `/recurring/[planId]`, with permission-gated Recurring navigation. Plan detail supports edit, pause/resume, and linked run history. Issued invoice actions keep Send Invoice primary, Record Payment accent, and PDF/payments links secondary; invoice breadcrumb link is quiet.

## Recurring Plan Model
Plan is organization/client scoped and stores name, project, currency, frequency, start and next-run dates, active state, due offset, discount, terms, and notes. Search is bounded and case-insensitive across plan name, client, and project.

## Recurring Items
Relational items store description, billing mode, exact Decimal quantity/unit price, position, and an optional tenant-safe Service reference. Flat fee uses canonical quantity one. Plan price values do not inherit future Service defaults.

## Monthly Scheduling
Preserves the start-date day anchor. Short months clamp to their last day; later months return to the original anchor (Jan 31 → Feb 28/29 → Mar 31).

## Yearly Scheduling
Preserves the start-date month/day. A Feb 29 anchor maps to Feb 28 in non-leap years and returns to Feb 29 in leap years.

## Asia/Colombo Date Rules
Runner derives the current date in `Asia/Colombo`; all recurrence and stored schedule dates are calendar `DATE` values. No UTC-server local-time arithmetic is used.

## Draft Generation
Server-only runner calls the canonical draft creator within its generation transaction. It copies plan terms/items into a normal unnumbered DRAFT with scheduled invoice date and optional due offset. It does not issue, number, freeze a template, email, or create payments.

## Idempotency / Concurrency
Runner locks each due plan row, checks its unique occurrence row, and atomically commits invoice/items, run history, and nextRunDate. At most one overdue occurrence per plan is processed in one runner execution. The database unique occurrence index is the final duplicate guard.

## Pause / Resume
Pause preserves plan, anchor, runs, invoices, and any future nextRunDate. Resume keeps that future date; if it passed while paused, it selects the first anchored occurrence after today in Colombo time. Historical missed periods are not replayed. Active plan edits recompute the next future occurrence.

## Run History
Run ledger records scheduled date, status, safe failure code/message, completion time, and relational generated-invoice link. Plan detail links DRAFT runs to the normal edit route and issued invoices to their normal invoice route. Inactive clients produce a safe failed run and do not advance the date; later runs retry that occurrence.

## Scheduler / Cron Endpoint
Added `POST /api/internal/recurring-invoices/run`, authenticated with `Authorization: Bearer ...` using constant-time comparison. Secret boundary is `RECURRING_INVOICE_CRON_SECRET` in the server environment only; `.env.example` contains an empty placeholder. Production should call the endpoint once daily.

## Security / Tenant Isolation
Every recurring read/mutation derives the organization from the authenticated active membership. Plan items enforce same-organization Service references; clients are revalidated as active at generation; invoices/runs keep tenant-safe relations. Cron runs from persisted organization data and returns safe errors. No role or organization ID is accepted as authority from the browser.

## Financial Safety
Recurring form validation reuses draft item preparation, exact Prisma Decimal math, and canonical discount bounds. Generated drafts are created by the canonical draft service. Schedule and draft generation do not touch InvoiceSequence, historical invoices/items, payments, email attempts, clients, or service defaults.

## Responsive UI
Recurring table is horizontally contained in its own scroll region; plan forms reuse the invoice workspace layout and app shell. Automated browser checks at 1440/1024/768/390 were not completed because Chrome Computer Use was not approved for this turn.

## Tests and Checks
- `npx prisma validate`: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- Invoice autosave-threshold and recurrence schedule tests: 17 passed.
- Recurring PostgreSQL integration test: passed (concurrent idempotency, no-number DRAFT, and prospective price update).
- Full `npm test`: 175 passed; PDF suite 8 passed.
- `npm run build`: Turbopack failed while spawning its CSS worker. `npx next build --webpack`: passed, and output lists the recurring pages and internal cron route.
- `npm audit --omit=dev`: passed, 0 vulnerabilities.
- `git diff --check`: passed (Git reports expected LF-to-CRLF working-copy warnings).

## Migration Status
Prisma migration `20261102090000_recurring_invoice_automation` was created and applied successfully to local `hiiiive_billing`. `npm run db:migrate:status`: database schema is up to date (14 migrations found).

## Deployment Requirement
Set a long random `RECURRING_INVOICE_CRON_SECRET` in production secret management and schedule one daily POST to `/api/internal/recurring-invoices/run` with the matching bearer token. Do not place the secret in Settings DB, client code, or logs.

## Limitations / Next Step
The Chrome UI permission request timed out and a retry reported that Chrome was not approved, so no browser acceptance was performed. No invoice was issued or emailed. The repository's default Turbopack build remains environment-blocked; use the successful webpack build result for route verification.

Suggested next step:

QA-001 — Production Readiness / Security / End-to-End Acceptance

## INV-030B — Recurring Plan Save and Payment Navigation

The recurring create failure was caused by the flat-fee amount arriving as the formatted string `55,000`. The existing `prepareDraftInvoiceItems()` Decimal parser intentionally accepts canonical decimal strings and rejected grouping punctuation; the Server Action then returned the generic fallback because it did not classify `DraftInvoiceError` as a safe validation message. `saveRecurringPlanAction()` now validates and canonicalizes correctly grouped values (`55,000` → `55000`) before service validation, without floating-point conversion. Malformed grouping returns an item-specific validation message. Known draft validation messages are returned safely; unexpected save errors are logged only in development.

The plan service now requires an active client in the trusted organization. Regression coverage exercises the exact monthly LKR example (canonical 2026-11-10 start date, 14-day due offset, zero discount, blank optional fields, flat-fee 55,000, no Service), verifies stored quantity 1 and exact Decimal price, and confirms plan creation does not create invoices, invoice sequences, payments, or email attempts. The test also proves the raw grouped amount fails at the Decimal service boundary and normalization fixes it. Existing inactive-client runner coverage now deactivates the client only after creating a valid plan.

The controlled browser date input already provides `YYYY-MM-DD` through `e.target.value`; the action passes that string unchanged, and recurring schedule calculations remain timezone-safe and Asia/Colombo calendar-based. Payment navigation now shows only the invoice-specific back link; review found no other duplicate contextual invoice links in subordinate invoice pages. Global Invoices navigation remains in the workspace header.

INV-030B checks: `npx prisma validate`, `npm test` (183 tests plus 8 PDF tests), `npm run typecheck`, `npm run lint`, `npm run db:migrate:status` (14 migrations; schema up to date), `npm audit --omit=dev` (0 vulnerabilities), and `git diff --check` passed. The local recurring plan integration regression passed against PostgreSQL. Manual acceptance was completed in the Codex built-in browser: the exact SESo2/LKR/monthly flat-fee plan saved and opened its detail page; the list showed next run `2026-11-10`; and the issued invoice Payments page showed one contextual “← Back to Invoice” link and no duplicate “Back to Invoices” link. No migration was created for INV-030B. Changes remain uncommitted.

## INV-030A — Recurring Retry / Autosave Acceptance Audit
The existing recurring retry implementation reuses the unique `(planId, scheduledFor)` FAILED occurrence while holding the plan row lock. A PostgreSQL regression covers inactive Client → reactivation → concurrent retry: exactly one run transitions to GENERATED, exactly one ordinary DRAFT is associated, and `nextRunDate` advances once. A later run creates neither a second occurrence nor Draft. No recurrence migration or scheduling changes were needed.

Cron review found malformed Authorization values could previously pass if the raw configured secret was sent without a Bearer scheme. The endpoint now requires exactly one Bearer token; absent, malformed, wrong, or different-length credentials fail safely. Comparison remains timing-safe, the secret stays server-only, and no browser session authorization is used. Route auth regression tests cover these cases and ensure the secret is not returned.

Autosave single-flight regression confirms rapid first triggers share one create and establish one draft ID; later saves update that draft. A persisted edit read-model assertion verifies the created Draft can be reloaded from the normal edit route after refresh. Preview and issue both await `saveLatest`; failed saves stop the action, while a saved Draft remains intact if issuance fails. `issueInvoice()` financial and sequence behavior was not changed. Browser refresh was not manually exercised because the prior Chrome UI permission was unavailable.

INV-030A checks: focused autosave/cron tests passed; recurring and invoice action PostgreSQL tests passed; full `npm test` passed (180 tests plus 8 PDF tests); `npx prisma validate`, `npm run typecheck`, `npm run lint`, `npm run db:migrate:status`, `npm audit --omit=dev` (0 vulnerabilities), and `git diff --check` passed. Database is up to date with 14 migrations; no new migration was added. Changes remain uncommitted.
