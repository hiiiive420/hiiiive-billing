# AGENTS.md

## Project rules

- Keep changes small and scoped to the requested task.
- Read `docs/ARCHITECTURE.md`, `docs/BUSINESS-RULES.md`, `docs/SECURITY.md`, and `docs/DATABASE.md` before implementation.
- Do not make unrelated refactors.
- Do not silently change documented business rules. If a requirement conflicts or leaves a financial rule undefined, stop and report the conflict instead of inventing a rule.
- Validate financial calculations and security-sensitive operations on the server. Never trust browser-supplied totals, statuses, invoice numbers, or organization IDs.
- Run relevant tests and checks before completion, and report their results. Do not add or run unrelated checks.
- Update `docs/CODEX_HANDOFF.md` after every task.
