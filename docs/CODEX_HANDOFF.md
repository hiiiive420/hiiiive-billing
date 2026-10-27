# Codex Handoff

## Task
INV-027 — Client & Service Management UI

## Status
INV-027 remains uncommitted. INV-027B fixes the Service active-state persistence issue found during manual acceptance. No schema or migration changes.

## Repository Baseline
Started from clean `main` at `579bcd7`, matching `origin/main`; INV-026 and INV-027A were committed. Baseline migration status was expected to be 13 applied.

## Existing Schema Discovered
Client supports name, business/tax identifier, phone, email, billing address, notes, active state, and timestamps. ClientContact supports name, email, phone, billing and primary flags, active state, and timestamps. Service supports name, description, Decimal(19,4) default price, three-letter currency code, active state, and timestamps. Names are not unique. Tenant-safe relations use `organizationId`; restrictive deletes preserve history.

## Permissions Used
Dedicated centralized `CLIENT_READ/CREATE/EDIT` and `SERVICE_READ/CREATE/EDIT`. ADMIN and BILLING have all six; VIEWER has none. Invoice visibility does not grant master-data access.

## Routes / Navigation
Added `/app/[organizationSlug]/clients`, `/clients/new`, `/clients/[clientId]`, and corresponding `/services` routes. The invoice, client, and service workspaces have compact permission-gated navigation links.

## Client Workspace
Server-side case-insensitive search covers name, email, phone, and business/tax identifier. Lists are tenant-scoped, ordered, and paginated at 25 rows. Desktop uses a table; narrow screens use cards. Inactive clients remain visible and no delete action is provided.

## Client Create / Edit
Forms use only supported Client fields with server-side validation and allowlisted actions. Active state can be changed on edit. Historical issued client snapshots are not written during master-data updates.

## Client Contacts
Client detail displays and supports create/edit of existing ClientContact fields. Writes require `CLIENT_EDIT` and are scoped by organization, parent Client, and contact ID. Contacts can be deactivated; no delete action exists.

## Service Workspace
Server-side case-insensitive search covers name and description; lists are tenant-scoped and paginated at 25 rows. Desktop table and responsive cards show current status and supported price fields. Active state can be changed; no delete action exists.

## Service Create / Edit
Forms validate supported name, description, price, currency, and active fields. Prices use Decimal strings and are bounded to Decimal(19,4); negative or malformed values are rejected. The Active service checkbox defaults to checked on create; omission from FormData is explicitly parsed as false on create and edit. The edit bug was caused by the shared action parser treating a missing checkbox as `true`.

## Service Pricing / Currency Rules
Defaults remain prospective draft-entry conveniences. They apply only when explicitly requested and the currency matches; explicit invoice entry prices win. No conversion or automatic invoice-currency changes were added.

## Historical Invoice Safety
Client edits leave issued invoice snapshots unchanged. Service edits do not rewrite existing InvoiceItems, amounts, totals, or issued documents. Tests verify issued client snapshot and item values remain frozen while a future draft can use the updated service default.

## AI / Conventional Invoice Compatibility
Existing lookup and resolver implementations are unchanged. New/edited active master data is available through the existing organization-scoped query paths; inactive clients/services remain excluded from new-draft suggestions as before.

## RBAC / Tenant Isolation
Every route resolves a trusted organization through `requireOrganizationBySlug()`. Server Actions independently require dedicated create/edit permissions and never accept tenant scope from browser fields. Detail and mutation queries scope entity IDs to the trusted organization; contact writes also scope through the parent Client.

## Responsive UI
Management lists use desktop tables and responsive cards. Forms and contacts stack on narrow viewports; compact navigation links connect the invoice, client, and service workspaces.

## Tests and Checks
Regression tests cover Service active → inactive, inactive → active, active and unchecked creation, persisted detail/list reads, active lookup filtering, foreign-tenant denial, and unchanged issued invoice/item financial history. Client checkbox parsing was checked and correctly persists both boolean directions; no Client change was needed.
- `npm test` — passed: 167 unit/integration tests and 8 PDF tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; includes the production Client and Service routes.
- `npm run db:migrate:status` — passed; all 13 migrations are applied.
- `npm audit --omit=dev` — passed; 0 production vulnerabilities.
- `git diff --check` — passed.

## Migration Status
No migration created; schema unchanged.

## Limitations / Next Step
No hard deletion or cascading archive behavior. Names have no uniqueness constraint, and the schema does not enforce a single primary contact. Suggested next step after acceptance: INV-028 — Organization / Invoice Template / Payment Settings.
