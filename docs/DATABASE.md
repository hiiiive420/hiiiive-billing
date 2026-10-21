# Database

## Local development and migration

Local development uses the locally installed PostgreSQL server at `localhost:5432`. The database name is `hiiiive_billing`; connection details are kept in the ignored local `.env` file and are not documented here. Production database strategy remains undecided until deployment.

The initial Prisma migration is `20261020151624_init_master_data` (`init_master_data`). It creates Organization, Client, ClientContact, and Service. The RBAC foundation migration is `20261020153112_add_user_rbac_foundation` (`add_user_rbac_foundation`). Both are applied to the local development database. Use `npm run db:migrate -- --name <migration_name>` to create and apply future development migrations, and `npm run db:migrate:status` to inspect migration state. Never commit `.env` or document local passwords.

## Implemented Prisma models

### Organization

- UUID primary key, name, slug, `createdAt`, and `updatedAt`.
- `slug` is unique.
- Has clients, client contacts, services, and organization memberships.

### User

- Represents an authenticated human identity; UUID primary key, globally unique email, optional `displayName`, `active` defaulting true, and timestamps.
- Email is the primary login identity. Future application logic must normalize email to lowercase before storing or looking it up. The database uniqueness constraint is global; normalization is an application responsibility.
- No password or authentication-provider data is implemented.

### OrganizationMembership

- UUID primary key with required `organizationId` and `userId`, explicit `OrganizationRole`, `active` defaulting true, and timestamps.
- Links one user to one organization. A unique constraint on `(organizationId, userId)` permits at most one membership per user per organization.
- Organization and user deletions are restricted while memberships exist.
- Indexed by `(organizationId, role)` and by `userId`; the unique `(organizationId, userId)` constraint also indexes organization membership lookup.

### OrganizationRole and MVP1 use

`OrganizationRole` has three values: `ADMIN`, `BILLING`, and `VIEWER`. A role must be assigned explicitly; there is no default. MVP1 intends one dedicated email/account to hold `ADMIN`. Krishna and working team members use `BILLING`. `VIEWER` is reserved for future read-only use.

The schema does not enforce that there is only one ADMIN. Future application/service logic must prevent removal or demotion of the last active ADMIN in an organization.

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
- Its composite foreign key `(organizationId, clientId)` references `(organizationId, id)` on Client. The separate `organizationId` foreign key scopes the contact to an organization and the composite relationship prevents linking to a client from another organization.
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

These future entities must follow the business and security requirements in `BUSINESS-RULES.md` and `SECURITY.md`. Their exact persistence and accounting treatment remain future implementation decisions.