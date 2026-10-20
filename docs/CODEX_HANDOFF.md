# Codex Handoff

- **Task ID:** INV-001 — Repository Baseline & Project Guardrails
- **Status:** Complete

## What changed

Added repository contribution guardrails and baseline architecture, business rules, security guidance, conceptual database relationships, and this handoff record. No application code was changed.

## Files changed

- `AGENTS.md` — implementation and workflow rules.
- `docs/ARCHITECTURE.md` — repository observations, proposed stack, and architecture guardrails.
- `docs/BUSINESS-RULES.md` — permanent invoice, payment, recurring, approval, calculation, and audit rules.
- `docs/SECURITY.md` — server-side trust, authorization, tenant isolation, financial integrity, and audit guidance.
- `docs/DATABASE.md` — conceptual entities and relationships only.
- `docs/CODEX_HANDOFF.md` — this task record.

## Existing repo/stack observations

Repository path: `D:\Billing_Hive\hiiiive-billing`. Inspection found only `README.md` (`# hiiiive-billing`) and Git metadata. No application source, framework, package manifest, or existing stack was detected. Proposed future stack: Next.js + TypeScript + PostgreSQL + Prisma. Nothing was installed or initialized.

## Database changes

None. Conceptual entities and relationships only; no schema or migrations created.

## Commands/checks run and results

- `Get-ChildItem -Force` — inspected repository root; found `.git` and `README.md`.
- `Get-Content -Raw README.md` — read README.
- `rg --files` and targeted `rg --files -g ...` — found only README; no app/framework manifests or existing docs.
- `git status --short --branch` — repository was clean on `main` tracking `origin/main` before documentation changes.
- No tests or application checks were run; no application code exists to test.

## Security considerations

Documented server-side authorization and organization scoping, untrusted browser inputs, server-side financial operations, secret handling, approved-and-issued email gate, and immutable audit events. No runtime security controls were implemented in this documentation task.

## Decisions made

- Marked the proposed stack as Next.js + TypeScript + PostgreSQL + Prisma because no application foundation is present.
- Treated the supplied permanent business rules as authoritative; left undefined accounting treatment to an explicit future decision.
- Kept database documentation conceptual only.

## Known issues

- No application foundation or runtime checks exist yet.
- No detailed authorization roles or exceptional accounting treatment were specified; implementation must obtain decisions instead of inferring them.

## Explicitly not implemented

No package installation, framework initialization, migrations, UI, APIs, authentication, invoice functionality, or application-code refactoring.
