# Database

## Local development and migration

Local development uses the locally installed PostgreSQL server at `localhost:5432`. The database name is `hiiiive_billing`; connection details are kept in the ignored local `.env` file and are not documented here. Production database strategy remains undecided until deployment.

The initial Prisma migration is `20261020151624_init_master_data` (`init_master_data`). It creates Organization, Client, ClientContact, and Service. Later migrations add the RBAC foundation (`add_user_rbac_foundation`), invoice core (`add_invoice_core`), payments/reworked invoice relations (`add_payments_and_invoice_relations`), replacement lineage enforcement (`enforce_replacement_lineage`), and invoice template versioning (`add_invoice_template_versioning`). Use `npm run db:migrate -- --name <migration_name>` to create and apply future development migrations, and `npm run db:migrate:status` to inspect migration state. Never commit `.env` or document local passwords.

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

### Invoice lifecycle and payment state

`InvoiceLifecycleStatus` (`DRAFT`, `ISSUED`, `SUPERSEDED`, `VOID`, `WRITTEN_OFF`) is independent of `InvoicePaymentStatus` (`UNPAID`, `PARTIALLY_PAID`, `PAID`). Drafts default to DRAFT/UNPAID and keep `invoiceNumber` nullable. `(organizationId, invoiceNumber)` is unique; PostgreSQL permits multiple NULL values, so drafts do not reserve numbers. Hiiiive MVP's confirmed format is `I` + `YYYYMMDD` + the organization-wide monotonically increasing issued sequence, with no separators (example: `I2026100922`). The date uses the invoice date locked at issuance, or the Asia/Colombo local date if no invoice date is present then. Sequence values do not reset by date period. Issue logic will assign numbers only on issuance and must never reuse them; issued invoice date and number are immutable. Future SaaS may add configurable formats.

### Invoice

- UUID primary key, required organization and client IDs, lifecycle/payment statuses, currency (`LKR` by default), optional invoice/due dates and issue timestamp.
- Optional `templateVersionId` references a version through `(organizationId, templateVersionId)` to `(organizationId, id)`. Existing invoices may keep it null. Future issuance logic will set the version used for the historical invoice; issuance behavior is not changed by this schema task.
- Optional client name, billing address, email, and phone snapshots preserve the details used by the invoice if the Client record later changes.
- Subtotal, discount amount, and grand total use `Decimal(19,4)` with zero defaults. No floating point money fields are used.
- A compound unique key on `(organizationId, id)` supports tenant-safe child foreign keys. The client relation references `(organizationId, id)` on Client, enforcing same-organization ownership. Invoice number uniqueness is scoped to organization.
- Indexes support organization scoped lifecycle, payment, client, invoice-date, and due-date lookups. Financial relations use Restrict deletion.

### InvoiceItem

- UUID primary key with required organization/invoice IDs, optional service ID, description, decimal quantity/unit price/line total (`Decimal(19,4)`), position, and timestamps.
- Composite foreign keys `(organizationId, invoiceId)` and `(organizationId, serviceId)` enforce matching tenants. Invoice and Service have compound `(organizationId, id)` keys to support those relationships.
- `lineTotal` is persisted as a snapshot; future server logic must calculate it authoritatively and never trust browser-supplied totals. Deletion is restricted.

### InvoiceSequence

- Organization-scoped sequence row with key (`DEFAULT`), prefix (`I`), and `nextValue` (1) defaults; `(organizationId, key)` is unique.
- This stores the next available organization-wide sequence number. The server-only issuance service atomically reserves and increments it in the same transaction as issuance; drafts do not consume sequence values. The Hiiiive MVP format is defined in `BUSINESS-RULES.md`.

### Payment

- Organization- and invoice-scoped payment record with positive amount (`Decimal(19,4)`), paid timestamp, `PaymentMethod`, optional reference/internal note, and timestamps.
- A composite FK `(organizationId, invoiceId)` enforces tenant matching with Invoice. Deletion is restricted. Multiple payment rows per invoice are supported.
- The server-only payment service inserts a payment and recalculates `Invoice.paymentStatus` from the recorded amount total under a transaction and invoice row lock. It does not change `grandTotal`. Overpayments remain recorded and marked PAID; refunds and credit handling are not implemented.

### InvoiceRelation

- Organization-scoped historical relation with source and target invoice IDs, `InvoiceRelationType` (`REPLACED_BY`), reason, and creation timestamp.
- Composite FKs enforce that both source and target invoices belong to the relation's organization. Deletes are restricted. A source can have multiple target replacements, but `(organizationId, targetInvoiceId, relationType)` is unique so one replacement target cannot point back to multiple sources.
- The supersede service atomically changes an ISSUED source to SUPERSEDED and adds relations to DRAFT replacements. It leaves replacement drafts unnumbered and preserves source payments without moving or reversing them.

### InvoiceTemplate

- Organization-scoped template identity with `name`, organization-unique `key`, `active`, `isDefault`, and timestamps. Names need not be unique.
- `(organizationId, id)` supports the tenant-safe version relation. `(organizationId, key)` is unique. The schema permits default selection but does not enforce exactly one default; future service logic must manage default changes atomically.
- Deletion is restricted when versions exist.

### InvoiceTemplateVersion

- Version record with organization/template IDs, version number, trusted `rendererKey`, structured `Json` config, and `createdAt` only. A PostgreSQL trigger rejects every UPDATE and DELETE, preserving history even when no invoice references the version.
- `(organizationId, templateId, version)` is unique, and its composite FK enforces that the parent template belongs to the same organization. `(organizationId, id)` supports tenant-safe invoice references.
- Version positivity is a future domain validation rule. The database does not store executable JavaScript or arbitrary renderer code in config; it is structured presentation/branding data.
- Invoices can reference a version using a nullable tenant-safe composite FK. Restrict deletion protects referenced versions, and the database trigger prevents deletion of all versions, including unreferenced ones.

### Money representation

`Service.defaultUnitPrice` uses PostgreSQL `Decimal(19,4)`, not floating point. This allows up to 15 digits before the decimal point and four fractional digits, accommodating monetary unit rates that may need sub-cent precision. Currency-specific rounding and invoice-total behavior are not defined by this schema.

### Tenant and deletion behavior

Every business record in this schema belongs to an organization. Tenant identifiers are included in relation keys and indexes where appropriate. All foreign-key relations use restrictive deletion behavior; deleting an organization or client cannot cascade-delete related records. No uniqueness rule is imposed on client or service names.

## Future conceptual entities

The following entities and relationships remain design guidance only; they are not implemented in the Prisma schema yet:

- **Invoice** â€” organization/client-owned financial snapshot with draft/issued lifecycle.
- **Recurring invoice template** â€” organization/client-owned source for idempotently generated drafts.
- **Approval** â€” records internal approval before an invoice can be sent.
- **Email send attempt** â€” logs retryable delivery attempts for an approved and issued invoice.
- **Audit event** â€” immutable record of important actions, actor, timestamp, action, and relevant reason/metadata.

These future entities must follow the business and security requirements in `BUSINESS-RULES.md` and `SECURITY.md`. Their exact persistence and accounting treatment remain future implementation decisions. Approval, audit events, recurring templates, and email attempts are not implemented.


