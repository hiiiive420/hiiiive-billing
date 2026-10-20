# Architecture

## Repository and initialized stack

The repository has a minimal Next.js App Router foundation under `src/app`. The initialized stack is **Next.js 16.4.2 + React 19.3.1 + TypeScript 5.9.3 (strict) + Tailwind CSS 4.3.3 + ESLint 9.39.5**, managed with npm and Node.js 24 (`engines.node: ">=24 <25"`). The package lock records the resolved dependency tree.

PostgreSQL access is configured with **Prisma ORM 7.10.1**, `@prisma/client`, the `@prisma/adapter-pg` driver adapter, and `pg`. The schema is at `prisma/schema.prisma`; the generated client is at `src/generated/prisma` and is regenerated with `npm run prisma:generate`. The schema currently has no business models. No migrations or database instances have been created or provisioned.

The server-only reusable client is exposed through `getPrismaClient()` in `src/lib/prisma.ts`. It is initialized lazily when called, checks for `DATABASE_URL`, and does not connect during module import. Store the URL only in the server environment or an ignored `.env` file; never expose it to client code. `.env.example` contains only an empty `DATABASE_URL=` placeholder.

The application currently contains only a neutral `Hiiiive Billing` placeholder home page and root layout.

## Architectural guardrails

- MVP1 serves one organization, Hiiiive. Model organization ownership with `organizationId` so future multi-tenant SaaS use is possible.
- Enforce authentication, authorization, and organization scoping on the server. Every organization-owned lookup and mutation must be scoped to the authorized organization.
- Keep financial calculations, invoice number allocation, approval transitions, and email-send authorization in deterministic server-side code. AI may assist with non-authoritative tasks but never controls these operations.
- Treat issued financial data as immutable. Represent payments and corrections as linked records/events; preserve history.
- Make recurring draft generation idempotent. Separate invoice creation from retryable email delivery.
- Record important actions in immutable audit events.

## Main conceptual flow

A recurring template or an authorized user can create an editable draft. Internal approval and issuance are required before a client invoice can be emailed. Issuance assigns a never-reused invoice number. Payments, supersession/rework, voiding, and write-off are recorded through authorized, auditable transitions without silently rewriting issued financial data. See `BUSINESS-RULES.md` and `DATABASE.md`.