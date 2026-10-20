# Architecture

## Repository baseline

The repository currently contains only `README.md` and Git metadata. No application source, framework, package manifest, or existing runtime stack was found during INV-001 inspection. No application foundation has been initialized.

## Proposed future MVP stack

If implementation begins, the proposed stack is **Next.js + TypeScript + PostgreSQL + Prisma**. This is a proposal, not an installed or initialized stack. INV-001 does not install packages or initialize a framework.

## Architectural guardrails

- MVP1 serves one organization, Hiiiive. Model organization ownership with `organizationId` so future multi-tenant SaaS use is possible.
- Enforce authentication, authorization, and organization scoping on the server. Every organization-owned lookup and mutation must be scoped to the authorized organization.
- Keep financial calculations, invoice number allocation, approval transitions, and email-send authorization in deterministic server-side code. AI may assist with non-authoritative tasks but never controls these operations.
- Treat issued financial data as immutable. Represent payments and corrections as linked records/events; preserve history.
- Make recurring draft generation idempotent. Separate invoice creation from retryable email delivery.
- Record important actions in immutable audit events.

## Main conceptual flow

A recurring template or an authorized user can create an editable draft. Internal approval and issuance are required before a client invoice can be emailed. Issuance assigns a never-reused invoice number. Payments, supersession/rework, voiding, and write-off are recorded through authorized, auditable transitions without silently rewriting issued financial data. See `BUSINESS-RULES.md` and `DATABASE.md`.
