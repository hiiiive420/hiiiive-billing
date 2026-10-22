# AGENTS.md

## Project rules

- Keep changes small and scoped to the requested task.
- Read `docs/ARCHITECTURE.md`, `docs/BUSINESS-RULES.md`, `docs/SECURITY.md`, and `docs/DATABASE.md` before implementation.
- Do not make unrelated refactors.
- Do not silently change documented business rules. If a requirement conflicts or leaves a financial rule undefined, stop and report the conflict instead of inventing a rule.
- Validate financial calculations and security-sensitive operations on the server. Never trust browser-supplied totals, statuses, invoice numbers, or organization IDs.
- Run relevant tests and checks before completion, and report their results. Do not add or run unrelated checks.
- Update `docs/CODEX_HANDOFF.md` after every task.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
