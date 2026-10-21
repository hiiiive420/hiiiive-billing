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
- Invoice issuance loads records by authorized `organizationId` and invoice ID, accepts no browser-supplied totals, status, date, or invoice number, and commits the conditional DRAFT transition and sequence reservation in one PostgreSQL transaction. Callers must derive organization scope from trusted server-side authorization context.
- Issuance recalculates line totals, subtotal, and grand total, validates quantities, prices, and discounts, and snapshots client details from the database. Only DRAFT invoices may be issued; issued invoice dates and numbers are thereafter immutable.
- Payment recording accepts only positive amounts for organization-scoped ISSUED invoices. It inserts the payment and recalculates payment status from recorded payment rows while holding the invoice row lock in one transaction; caller-supplied payment status is not accepted.
- Supersession validates organization-scoped source and replacement states, then changes the source to SUPERSEDED and records REPLACED_BY relations atomically. It preserves source payment records and does not redistribute funds.
- Treat persisted line totals and invoice totals as non-authoritative inputs until computed or verified by server logic. The invoice schema stores them as decimal values; browser-supplied totals must never be trusted.
- Scope invoice, client, service, and invoice-item relations by organization. Composite foreign keys enforce tenant matching in the database.
- Validate state transitions and approval authority on the server.
- Issued financial data must not be silently edited; preserve changes and important actions through authorized, auditable workflows.
- AI output is non-authoritative and cannot determine totals, numbering, approval, or sending.

## Invoice template security

- Template configuration is structured JSON presentation/branding data only. `rendererKey` selects a trusted application renderer; do not execute code from template data.
- PostgreSQL rejects UPDATE and DELETE on template versions; changes must create a new version, preserving historical configurations even when unreferenced.
- MVP1 does not support arbitrary user HTML/CSS uploads. Future SaaS custom templates require a separate security design covering sanitization and isolation before any such feature is implemented.

## Secrets and delivery

- Never expose secrets, credentials, or privileged service keys in client code or client-visible responses.
- Send client invoice email only after server-side confirmation that the invoice is approved and issued.
- Log email attempts and support retries without duplicating invoice creation.

## Audit trail

Record immutable audit events for important invoice actions, including actor, timestamp, action, and relevant reason or metadata. Restrict access to internal notes and operational details to authorized users.

