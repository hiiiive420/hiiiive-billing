# Codex Handoff

## Task
INV-021 — Authenticated Production Invoice Workspace

## Status
Complete. Authenticated production draft create/edit routes are implemented; Preview and Issue remain disabled.

## Summary
Added the first production invoice workspace using the INV-020 Cloudflare Access identity and RBAC foundation. Organization slugs are selectors resolved only through the current user's active memberships. Production actions independently authorize each search and mutation. The existing responsive invoice form is shared by production and development routes.

## Routes Added
- `/app` — redirects users with one active membership, lists only their organizations when multiple, and gives an access/provisioning message when unavailable.
- `/app/[organizationSlug]/invoices/new` — permission-protected draft creation.
- `/app/[organizationSlug]/invoices/[invoiceId]/edit` — DRAFT-only edit loading and saving.

## Organization / Authorization Behavior
`requireOrganizationBySlug()` searches only `getCurrentUserMemberships()` and returns the trusted membership organization ID after checking permission. An inaccessible slug receives the same not-found behavior whether invalid, foreign, or inactive. `INVOICE_CREATE` protects create page and its search/save actions; `INVOICE_EDIT_DRAFT` protects edit page and its search/save actions. Client-supplied organization IDs, roles, users, and membership IDs are ignored by form parsing.

## Shared Form Reuse
Moved the single form UI to `src/components/invoices/invoice-entry-form.tsx` and injects server action references and presentation details. Development routes retain their fixture actions and development labels. Production shows Hiiiive Billing, organization, current user, and role without development messaging. Existing responsive, quantity/flat-fee, search, money formatting, preview, and discount behavior remains shared.

## Create / Edit Behavior
Create uses `createDraftInvoice()` with parsed editable fields and trusted organization scope; success links to the production edit route. Edit loads through `loadDraftInvoiceForEditing()` and saves through atomic `updateFullDraftInvoice()`. Persisted totals and lifecycle/payment state remain server-controlled. Saved service prices are restored as entered and current defaults are not reapplied.

## Tests and Checks
- `npm test` — passed: 118 unit/integration tests and 8 PDF tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; production routes are dynamic and present at the intended paths.
- `npm run db:migrate:status` — passed; all 10 migrations are applied. No migration was needed.
- `npm audit --omit=dev` — passed; 0 production dependency vulnerabilities.

Production action tests cover BILLING and ADMIN create/edit, VIEWER denial, searches, forged organization/role/status/total fields, foreign organization scope, quantity/flat-fee/free-text items, preserved explicit service price, and full draft updates. Existing invoice service tests cover cross-tenant and non-DRAFT edit rejection.

## Security Notes
Production actions never call the development organization helper. Slugs are resolved through active persisted memberships, permissions are checked on every Server Action, and no client organization ID is accepted. No production list/history, payment, Preview, or Issue behavior was added. Existing `/dev/invoices/*` routes retain their production not-found guards and fixture context.

## Blockers / Next Step
Local production-route testing requires `DEV_AUTH_EMAIL` to identify an existing active `User` with an active `OrganizationMembership`. Production deployment still requires Cloudflare Access audience/team configuration, enforced MFA, and origin protection. Preview and Issue are deferred to INV-022.
