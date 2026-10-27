# Codex Handoff

## Task
INV-027A — Client & Service RBAC Foundation

## Status
Complete and uncommitted. No client or service UI was added.

## Permissions Added
Added `CLIENT_READ`, `CLIENT_CREATE`, `CLIENT_EDIT`, `SERVICE_READ`, `SERVICE_CREATE`, and `SERVICE_EDIT` to the centralized permission type.

## Role Matrix
ADMIN and BILLING may read, create, and edit Client and Service master data. VIEWER has none of the six permissions.

## Security Impact
Master-data access is separate from invoice visibility. Existing authorization helpers continue to enforce the centralized role matrix.

## Tests and Checks
- `npm test` — passed: 165 unit/integration tests and 8 PDF tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed.
- `npm run db:migrate:status` — passed; all 13 migrations are applied.
- `git diff --check` — passed.

## Migration Status
No schema change or migration was added.

## Next Step
INV-027 — Client & Service Management UI
