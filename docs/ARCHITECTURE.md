# Architecture

## Repository and initialized stack

The repository has a minimal Next.js App Router foundation under `src/app`. The initialized stack is **Next.js 16.4.2 + React 19.3.1 + TypeScript 5.9.3 (strict) + Tailwind CSS 4.3.3 + ESLint 9.39.5**, managed with npm and Node.js 24 (`engines.node: ">=24 <25"`). The package lock records the resolved dependency tree.

The application currently contains only a neutral `Hiiiive Billing` placeholder home page and root layout. No database or ORM is installed. PostgreSQL and Prisma remain future options described conceptually in `DATABASE.md`; they are not part of this foundation.

## Architectural guardrails

- MVP1 serves one organization, Hiiiive. Model organization ownership with `organizationId` so future multi-tenant SaaS use is possible.
- Enforce authentication, authorization, and organization scoping on the server. Every organization-owned lookup and mutation must be scoped to the authorized organization.
- Keep financial calculations, invoice number allocation, approval transitions, and email-send authorization in deterministic server-side code. AI may assist with non-authoritative tasks but never controls these operations.
- Treat issued financial data as immutable. Represent payments and corrections as linked records/events; preserve history.
- Make recurring draft generation idempotent. Separate invoice creation from retryable email delivery.
- Record important actions in immutable audit events.

## Main conceptual flow

A recurring template or an authorized user can create an editable draft. Internal approval and issuance are required before a client invoice can be emailed. Issuance assigns a never-reused invoice number. Payments, supersession/rework, voiding, and write-off are recorded through authorized, auditable transitions without silently rewriting issued financial data. See `BUSINESS-RULES.md` and `DATABASE.md`.