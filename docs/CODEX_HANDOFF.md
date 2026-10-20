# Codex Handoff

- **Task ID:** INV-004 — Core Master Data Schema
- **Status:** Complete

## What changed

Implemented the Prisma schema models for Organization, Client, ClientContact, and Service. Documented their fields, tenant relationships, indexes, delete behavior, and monetary precision. No migration or database instance was created.

## Files changed

- `prisma/schema.prisma` — added the four requested master-data models and tenant-scoped constraints.
- `docs/DATABASE.md` — documents implemented models and distinguishes future conceptual entities.
- `docs/CODEX_HANDOFF.md` — this task record.

## Packages/framework actually installed

No package or version changes. Prisma CLI, `@prisma/client`, and `@prisma/adapter-pg` remain at 7.10.1.

## Commands/checks and results

- Read `AGENTS.md` and all `docs/*` before implementation.
- `npm exec prisma format` — passed; formatted `prisma/schema.prisma`.
- `npm run prisma:validate` — passed; Prisma schema is valid.
- `npm run prisma:generate` — passed; Prisma Client 7.10.1 generated successfully.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; prebuild regenerated Prisma Client and the Next.js production build completed.

## Security considerations

Business records carry `organizationId`. ClientContact has both an organization foreign key and a composite `(organizationId, clientId)` reference to Client, preventing cross-tenant client association at the schema level. All relations use restrictive deletion behavior. Server-side authorization and organization scoping remain required. No credentials or database connection were used.

## Decisions made

- UUID primary keys use PostgreSQL UUID columns.
- Organization slug is unique. Client and Service names are not unique globally or tenant-wide; organization-scoped indexes support lookups without inventing name uniqueness rules.
- Client has a compound unique `(organizationId, id)` key to support an explicitly tenant-scoped ClientContact foreign key.
- Service default unit price uses PostgreSQL `Decimal(19,4)` (15 integer digits and 4 fractional digits), never Float. Currency-specific rounding and invoice totals remain undefined.
- All foreign-key delete behavior is `Restrict` to prevent indirect deletion of historical or future related records.
- No migration was created because no PostgreSQL instance is configured.

## Known issues

No PostgreSQL database is configured, so the schema has not been applied to a live database. No migration exists yet.

## Explicitly not implemented

No User/Auth, Invoice, InvoiceItem, InvoiceSequence, Payment, InvoiceRelation, recurring billing, approvals, audit events, email, APIs, UI, seed data, or migrations.