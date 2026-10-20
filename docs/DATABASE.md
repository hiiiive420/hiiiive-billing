# Database

This document describes conceptual entities and relationships only. It does not define a physical schema, migrations, field types, indexes, constraints, or database technology implementation. No database changes are part of INV-001.

## Conceptual entities

- **Organization** — the tenant boundary. MVP1 contains Hiiiive. Organization-owned business records are associated with an `organizationId`.
- **Client** — belongs to an organization and is the customer billed by invoices.
- **Invoice** — belongs to an organization and a client; stores its draft/issued financial snapshot and lifecycle state. Drafts have no final invoice number. A final number is allocated at approved issuance and is never reused. Issued financial data is preserved.
- **Invoice line** — belongs to an invoice and captures the historical description, quantity, and price used for that invoice. Later template or price changes do not rewrite historical lines.
- **Payment** — separate record associated with an invoice; captures amount, payment date, method, and optional reference/internal note. An invoice may have multiple payments.
- **Recurring invoice template** — belongs to an organization and client, defines recurring draft inputs and cadence. It generates drafts idempotently; changes affect future generation only.
- **Approval** — records internal approval required before a client invoice can be sent, associated with the invoice and the responsible actor/time/outcome.
- **Invoice replacement link** — relates a superseded original invoice to one or more replacement invoices and records the reason. Preserve both original and replacement records; one original may relate to multiple replacements.
- **Email send attempt** — belongs to an issued, approved invoice and records delivery attempts/status for retry. A retry does not create an invoice.
- **Audit event** — append-only conceptual record of important actions, with actor, timestamp, action, and relevant reason/metadata, associated with the affected organization and record.
- **Actor/User** — identity for authorized internal users and actions; access is constrained by server-side authorization and organization scope.

## Relationship outline

- Organization has clients, invoices, recurring templates, users/actors, and organization-scoped audit activity.
- Client has invoices and recurring templates.
- Invoice has line items, zero or more payments, approval activity, email attempts, and audit events.
- An invoice can be the original in one or more replacement links, and a replacement in a link from an original.
- A recurring template can generate multiple draft invoices; generation identity must prevent duplicates for the same intended occurrence.

The exact persistence model and accounting treatment for exceptional transitions remain implementation decisions and must not weaken the business rules in `BUSINESS-RULES.md`.
