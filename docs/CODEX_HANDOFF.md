# Codex Handoff

## Task
INV-025 — Invoice Workspace / List / Search / Status

## Status
Implementation complete and uncommitted. No migration was required.

## Summary
Added the production invoice operations workspace. The workspace is read-only with respect to invoice, payment, lifecycle, numbering, and email-delivery state; actions continue through separately authorized routes.

## Route / Navigation
`/app` redirects a single-membership user to `/app/{organizationSlug}/invoices`. Users with multiple memberships choose an organization and enter the same workspace. Workspace access/gate copy displays the spaced brand, “Hiiiive Billing”. The workspace requires `INVOICE_READ` and provides `+ New Invoice` only with `INVOICE_CREATE`. Create/edit, issued invoice, preview, and send views include a usable Next.js link to the invoice workspace, built from the authorized server route context.

## Workspace Read Model
`src/lib/invoices/invoice-workspace.ts` validates query inputs and returns a 25-row tenant-scoped page, minimal row DTOs, latest email attempt status/time, and full-organization summary counts. It does not return invoice items, payments, recipient lists, BCC, email bodies, or provider fields. Draft client names come from the current Client; issued-family names prefer `clientNameSnapshot`. Persisted invoice numbers, dates, currency, and grand totals are displayed without recalculation. The operational Updated timestamp is formatted in Asia/Colombo; date-only invoiceDate remains formatted in UTC to preserve its calendar day.

## Summary Counts
Cards count DRAFT; ISSUED + UNPAID; ISSUED + PARTIALLY_PAID; and ISSUED + PAID. SUPERSEDED, VOID, and WRITTEN_OFF are excluded. Counts are organization-wide and independent of table filters.

## Search / Filters / Sort
Search is trimmed, case-insensitive, bounded to 100 characters, and server-side across invoice number, project title, draft current client name, and issued-family snapshot name. Lifecycle/payment filters and four allowlisted sort keys are URL-driven. Payment filters exclude drafts. Invalid query keys fall back to safe defaults. Pagination is server-side at 25 rows and clamps out-of-range pages.

## Lifecycle / Payment Display
Drafts display “Draft”, current client name, invoice date or “Not set”, and no payment/email status. Issued-family rows display the permanent invoice number and frozen client name when available. Lifecycle and payment states use separate restrained chips. Only DRAFT, ISSUED, SUPERSEDED, VOID, and WRITTEN_OFF are represented.

## Email Delivery Status
The latest attempt determines Sending, Sent, Partially sent, or Failed; no attempt displays Never sent. Drafts show a dash. The query requests one attempt per displayed invoice and exposes only status and terminal/created timestamp.

## RBAC / Tenant Isolation
The route resolves the slug through `requireOrganizationBySlug(slug, "INVOICE_READ")`. The read model accepts only that trusted organization ID and scopes list, search, and counts. Central `hasPermission()` gates create, edit, and send links; destination pages remain independently authorized. VIEWER can read and cannot create, edit, or send.

## Responsive UI
Desktop uses an operational invoice table. At tablet/mobile widths it becomes compact invoice cards with tappable actions; the desktop table is hidden to avoid forcing horizontal overflow.

## Tests and Checks
- `npm test` — passed: 162 unit/integration tests and 8 PDF tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed without warnings.
- `npm run build` — passed; `/app/[organizationSlug]/invoices` is in the production route manifest.
- `npm run db:migrate:status` — passed; all 13 migrations are applied.
- `npm audit --omit=dev` — passed; 0 production vulnerabilities.
- `git diff --check` — passed.

## Migration Status
No schema or migration changes were made. Database is up to date at 13 migrations.

## Blockers / Next Step
No implementation blocker. Final interactive desktop/mobile browser acceptance remains for the operator; no browser automation tool is connected in this session.
