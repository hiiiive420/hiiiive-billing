# Security

## Trust boundaries

The browser is an untrusted client. Never accept browser-supplied totals, invoice statuses, final invoice numbers, or organization IDs as authoritative. Derive or validate sensitive values on the server using authorized records and deterministic business logic.

## Authentication and user identities

Authentication is not implemented. Future authentication may map an externally authenticated email identity, such as Cloudflare Access, to `User.email`. Email identities must be normalized to lowercase before storage and before lookup. No passwords, sessions, OAuth tables, or authentication-provider integration are part of the current database foundation.

## Authorization, RBAC, and tenant isolation

- RBAC is organization-scoped through `OrganizationMembership`; a user's role applies within that organization.
- UI visibility is not authorization. Hiding controls or pages does not protect data or operations.
- Future application permissions must be enforced server-side on every protected operation, with organization scoping on every organization-owned read and write.
- MVP1 intends one dedicated account with `ADMIN`; Krishna and working team members use `BILLING`; `VIEWER` is reserved for future read-only use.
- The schema does not limit the number of ADMIN memberships. Future application/service logic must prevent removing or demoting the last active ADMIN in an organization.

## Financial integrity

- Calculate totals and assign invoice numbers on the server only. Never reuse an assigned invoice number.
- Draft creation and edits run through a server-only service scoped by organization. Client and service IDs are resolved within that tenant, inactive records are rejected, and caller-supplied lifecycle, numbering, snapshots, template binding, and financial totals are not accepted. Item line totals and invoice totals are computed from decimal-string quantity and unit-price inputs.
- Draft mutation and issuance lock the invoice row in a transaction so an issuance cannot proceed from stale draft data while a concurrent edit is in progress. Item replacement and recalculated totals commit or roll back together.
- Invoice issuance loads records by authorized `organizationId` and invoice ID, accepts no browser-supplied totals, status, date, or invoice number, and commits the conditional DRAFT transition and sequence reservation in one PostgreSQL transaction. Callers must derive organization scope from trusted server-side authorization context.
- Issuance recalculates line totals, subtotal, and grand total, validates quantities, prices, and discounts, and snapshots client details from the database. Only DRAFT invoices may be issued; issued invoice dates and numbers are thereafter immutable.
- Payment recording accepts only positive amounts for organization-scoped ISSUED invoices. It inserts the payment and recalculates payment status from recorded payment rows while holding the invoice row lock in one transaction; caller-supplied payment status is not accepted.
- Supersession validates organization-scoped source and replacement states, then changes the source to SUPERSEDED and records REPLACED_BY relations atomically. It preserves source payment records and does not redistribute funds.
- Treat persisted line totals and invoice totals as non-authoritative inputs until computed or verified by server logic. The invoice schema stores them as decimal values; browser-supplied totals must never be trusted.
- Scope invoice, client, service, and invoice-item relations by organization. Composite foreign keys enforce tenant matching in the database.
- Validate state transitions and approval authority on the server.
- Issued financial data must not be silently edited; preserve changes and important actions through authorized, auditable workflows.
- AI output is non-authoritative and cannot determine totals, numbering, approval, or sending.

- Use the invoice's currency code as the sole authority for its amounts. Validate and uppercase exactly three ASCII letters before issue; never convert currencies or trust an ambiguous AI-inferred symbol such as `$`. Request clarification when currency cannot be determined safely.
## Invoice template security

- Template configuration is structured JSON presentation/branding data only. `rendererKey` selects a trusted application renderer; do not execute code from template data.
- PostgreSQL rejects UPDATE and DELETE on template versions; changes must create a new version, preserving historical configurations even when unreferenced.
- Issuance selects the active default template only within the supplied organization and validates its trusted renderer/config before reserving a number. A partial unique index prevents ambiguous active defaults; a tenant-safe composite foreign key prevents cross-organization version bindings.
- The invoice template version binding is written atomically with issuance. A database trigger requires a non-null binding for new DRAFT-to-ISSUED transitions and prevents changing or clearing it after issuance, including after supersession, voiding, or write-off. Existing historical/manual invoices may remain unbound.
- Issued-invoice rendering must load the renderer key and config through the invoice's frozen `templateVersionId`; it must not select the current default template.
- The server-only issued document loader scopes invoice access by `organizationId`, rejects DRAFT invoices, and validates the stored renderer key/config before rendering. It reads historical client snapshots and persisted financial values only; it never uses the current Client record. Missing frozen versions fail explicitly rather than falling back.
- The renderer registry maps only trusted application renderer keys and rejects unknown keys. The development preview uses static sample data, performs no database reads, and returns 404 in production.
- MVP1 does not support arbitrary user HTML/CSS uploads. Future SaaS custom templates require a separate security design covering sanitization and isolation before any such feature is implemented.

## PDF generation

- PDF creation runs server-side through the trusted renderer registry. Unknown renderer keys fail; template config is schema-validated and is never interpreted as executable content.
- The PDF service renders the same approved renderer tree and stylesheet used by browser preview. Invoice text is HTML-escaped, the letterhead is loaded from a fixed application asset, and no browser-supplied HTML, CSS, renderer key, or filesystem path is accepted.
- Headless Chromium JavaScript is disabled and all non-data requests are blocked, so rendering cannot fetch arbitrary URLs. The letterhead and four fixed application-controlled Fontsource DM Sans WOFF2 files are inlined as data URLs. The PDF service reads those fonts from fixed paths under `node_modules/@fontsource/dm-sans/files`; it accepts no font URL or filesystem path from request data.
- The development sample PDF route uses static sample data only and returns 404 in production. Production callers must provide invoice data from trusted server-side records and authorization context.
- `puppeteer-core` does not download or manage a browser. The executable path is trusted deployment configuration only; for example, set `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`. Production requires a configured executable, while development/test may resolve only fixed local Chrome/Edge paths. Never accept a binary path from request data.
- Run the application and Chromium as an appropriate non-root OS user with Chromium's sandbox usable. Do not disable the sandbox by default. If deployment requires different Chromium flags, decide that explicitly during deployment.
- DejaVu Serif retains its existing host font behavior. DM Sans is bundled through `@fontsource/dm-sans`; no font binaries are committed manually.

## Secrets and delivery

- Never expose secrets, credentials, or privileged service keys in client code or client-visible responses.
- Send client invoice email only after server-side confirmation that the invoice is approved and issued.
- Log email attempts and support retries without duplicating invoice creation.

## Audit trail

Record immutable audit events for important invoice actions, including actor, timestamp, action, and relevant reason or metadata. Restrict access to internal notes and operational details to authorized users.


