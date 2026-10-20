# Security

## Trust boundaries

The browser is an untrusted client. Never accept browser-supplied totals, invoice statuses, final invoice numbers, or organization IDs as authoritative. Derive or validate sensitive values on the server using authorized records and deterministic business logic.

## Authorization and tenant isolation

- Enforce authentication and authorization on the server for every protected operation.
- Enforce organization scoping server-side for every organization-owned read and write. MVP1 has Hiiiive as its sole organization, but `organizationId` is required for future tenant isolation.
- Do not rely on hidden UI controls or client-side checks as access control.

## Financial integrity

- Calculate totals and assign invoice numbers on the server only. Never reuse an assigned invoice number.
- Validate state transitions and approval authority on the server.
- Issued financial data must not be silently edited; preserve changes and important actions through authorized, auditable workflows.
- AI output is non-authoritative and cannot determine totals, numbering, approval, or sending.

## Secrets and delivery

- Never expose secrets, credentials, or privileged service keys in client code or client-visible responses.
- Send client invoice email only after server-side confirmation that the invoice is approved and issued.
- Log email attempts and support retries without duplicating invoice creation.

## Audit trail

Record immutable audit events for important invoice actions, including actor, timestamp, action, and relevant reason or metadata. Restrict access to internal notes and operational details to authorized users.
