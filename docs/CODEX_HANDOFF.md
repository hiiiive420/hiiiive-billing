# Codex Handoff

## Task
INV-028 — Organization / Invoice Template / Payment Settings

## Status
Implementation complete and uncommitted. No schema or migration changes.

## Repository Baseline
Started clean at `9485f75e736608d2946ee3af11c13604241a487a`, matching `origin/main`. INV-026, INV-027A, and INV-027 are committed. Baseline expected 13 applied migrations.

## Existing Schema / Template Architecture Discovered
Organization supports mutable `name` and immutable-in-settings `slug`. Invoice branding and bank display values live in `InvoiceTemplateVersion.config`. Hiiiive's renderer key is `hiiiive-default`; version rows cannot be updated or deleted. Issuance locks the active default template `FOR SHARE` and binds its latest version.

## Permission Used
Centralized `ORGANIZATION_SETTINGS`; the existing role matrix remains unchanged.

## Routes / Navigation
Added `/app/[organizationSlug]/settings`. Settings navigation is shown only to users with `ORGANIZATION_SETTINGS`.

## Organization Settings
The workspace name can be updated. The tenant slug is read-only. Organization name and invoice display name remain separate.

## Invoice Template Settings
The form exposes invoice display name and supported primary color. Renderer key and fixed font pairing cannot be edited. Existing config fields not exposed by the form are preserved.

## Payment / Bank Settings
Bank name, account name, and account number are bounded, trimmed display strings. Account numbers remain strings, including leading zeros. These values do not process payments.

## Template Versioning Behavior
Changed settings create an immutable version inside a transaction while locking the active default template row `FOR UPDATE`. This serializes with issuance's existing shared lock. Unchanged settings do not create a new version.

## Draft / Future Invoice Behavior
The existing latest-default lookup remains unchanged. Future drafts and issued invoices use the latest active default version per current flow.

## Historical Issued Invoice Safety
Issued invoices remain bound to their original template version. Focused integration coverage checks rendered Bank A/Account A versus future Bank B/Account B and confirms financial/item/payment/email state is unchanged by settings saves.

## Preview Behavior
The settings page renders deterministic `PREVIEW` sample data in the existing Hiiiive renderer. It does not create an invoice or reserve a number.

## Secret / Environment Boundary
SMTP, database, OpenAI, Cloudflare, and deployment secrets remain environment-managed and are not shown or editable.

## RBAC / Tenant Isolation
The page and each Server Action independently require `ORGANIZATION_SETTINGS`. Mutations derive organization scope from trusted membership context and allowlist editable fields.

## Responsive UI
Settings cards and fields stack on narrow viewports. Preview is contained in a bounded, overflow-hidden frame.

## Tests and Checks
- `npm test` — passed: 170 unit/integration tests and 8 PDF tests, including settings authorization, immutable versioning, historical rendering, and no financial mutation.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; includes `/app/[organizationSlug]/settings`.
- `npm run db:migrate:status` — passed; all 13 migrations are applied.
- `npm audit --omit=dev` — passed; 0 production vulnerabilities.
- `git diff --check` — passed.

## Migration Status
No migration created; schema unchanged and all 13 existing migrations are applied.

## Limitations / Next Step
Only the existing Hiiiive renderer and its supported config fields are managed. Suggested next step after acceptance: INV-029 — Production UX Polish & Application Consistency.
