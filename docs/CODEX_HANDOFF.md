# Codex Handoff

- **Task ID:** INV-003A — Prisma Build Reproducibility
- **Status:** Complete

## What changed

Added an npm `prebuild` hook that generates Prisma Client before production builds. Verified that a build recreates the intentionally ignored generated client directory after it is removed.

## Files changed

- `package.json` — added `prebuild: prisma generate`.
- `docs/CODEX_HANDOFF.md` — this task record.

## Packages/framework actually installed

No packages or versions changed. Prisma CLI, client, and PostgreSQL adapter remain at 7.10.1.

## Commands/checks and results

- Read `AGENTS.md` and all `docs/*` before changes.
- Verified `src/generated/prisma/client.ts` is ignored by Git.
- Removed only the verified `src/generated/prisma` directory.
- `npm run build` — passed; npm ran `prebuild` first, Prisma Client 7.10.1 regenerated into `src/generated/prisma`, and Next.js production build completed.
- Confirmed the regenerated `src/generated/prisma/client.ts` exists after the build.
- `npm run typecheck` — passed.
- `npm run lint` — passed.

## Security considerations

The generated client remains Git-ignored. No environment files, credentials, database configuration, or application features were changed. No `postinstall` hook was added.

## Decisions made

- Used `prebuild` because it generates the ignored client at the point a production build needs it without changing install behavior.
- Left Prisma versions, schema, database configuration, and architecture documentation unchanged.

## Known issues

None identified for this task.

## Explicitly not implemented

No models, migrations, database configuration changes, application features, or package/version changes.