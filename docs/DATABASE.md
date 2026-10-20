# Database

## Implemented Prisma models

The PostgreSQL schema in `prisma/schema.prisma` currently implements only `Organization`, `Client`, `ClientContact`, and `Service`. No migration has been created because no PostgreSQL instance is configured. These models are the schema foundation; server-side authorization and tenant scoping are still required in application code.

### Organization

- UUID primary key, name, slug, `createdAt`, and `updatedAt`.
- `slug` is unique.
- Has clients, client contacts, and services.

### Client

- UUID primary key and required `organizationId` foreign key.
- Name, optional business registration/tax identifier, phone, email, billing address, and notes.
- `active` defaults to true; includes `createdAt` and `updatedAt`.
- Has a compound unique key on `(organizationId, id)` so related records can enforce same-organization references.
- Has an organization-scoped name index; client names are not globally unique.
- Organization deletion is restricted while clients exist.

### ClientContact

- UUID primary key and required `organizationId` and `clientId` foreign keys.
- Name, optional email and phone, `billingContact` and `primaryContact` defaults false, `active` defaults true, and timestamps.
- Its composite foreign key `(organizationId, clientId)` references `(organizationId, id)` on Client. The separate `organizationId` foreign key explicitly scopes the contact to an organization and the composite relationship prevents linking it to a client from another organization.
- Indexed by `(organizationId, clientId)`. Client and organization deletion are restricted while contacts exist.

### Service

- UUID primary key and required `organizationId` foreign key.
- Name, optional description, optional `defaultUnitPrice`, `currencyCode` defaulting to `LKR`, `active` defaulting to true, and timestamps.
- Indexed by `(organizationId, name)`; service names are not globally unique.
- Organization deletion is restricted while services exist.

### Money representation

`Service.defaultUnitPrice` uses PostgreSQL `Decimal(19,4)`, not floating point. This allows up to 15 digits before the decimal point and four fractional digits, accommodating monetary unit rates that may need sub-cent precision. Currency-specific rounding and invoice-total behavior are not defined by this schema.

### Tenant and deletion behavior

Every business record in this schema belongs to an organization. Tenant identifiers are included in relation keys and indexes where appropriate. All foreign-key relations use restrictive deletion behavior; deleting an organization or client cannot cascade-delete related records. No uniqueness rule is imposed on client or service names.

## Future conceptual entities

The following entities and relationships remain design guidance only; they are not implemented in the Prisma schema yet:

- **Invoice** — organization/client-owned financial snapshot with draft/issued lifecycle.
- **Invoice line** — preserves the historical description, quantity, and price used on an invoice.
- **Payment** — separate record associated with an invoice, allowing multiple and partial payments.
- **Recurring invoice template** — organization/client-owned source for idempotently generated drafts.
- **Approval** — records internal approval before an invoice can be sent.
- **Invoice replacement link** — links an original invoice to one or more replacements with a reason.
- **Email send attempt** — logs retryable delivery attempts for an approved and issued invoice.
- **Audit event** — immutable record of important actions, actor, timestamp, action, and relevant reason/metadata.
- **Actor/User** — identity for future authorized internal users.

These future entities must follow the business and security requirements in `BUSINESS-RULES.md` and `SECURITY.md`. Their exact persistence and accounting treatment remain future implementation decisions.