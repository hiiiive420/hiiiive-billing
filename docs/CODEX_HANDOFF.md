# Codex Handoff

- **Task ID:** INV-002A — Runtime Baseline & Dependency Audit
- **Status:** Complete

## What changed

Verified the active Node 24 runtime, declared the supported Node range, added `.nvmrc`, inspected the npm audit report, and documented the remaining development-only advisory. No dependency updates were applied because the available npm fix is a breaking downgrade.

## Files changed

- `package.json` — added Node engine range `>=24 <25`.
- `package-lock.json` — synchronized root package metadata.
- `.nvmrc` — selects Node 24.
- `docs/ARCHITECTURE.md` — records the Node 24 runtime baseline.
- `docs/CODEX_HANDOFF.md` — this task record.

## Runtime and dependencies

- Node.js: v24.20.0
- npm: 11.19.0
- Dependency versions were not changed.

## Commands/checks and results

- Read `AGENTS.md` and all files under `docs/` before changes.
- `node --version` — v24.20.0; satisfies `>=24 <25`.
- `npm --version` — 11.19.0.
- `npm pkg set 'engines.node=>=24 <25'` — completed.
- `npm install --package-lock-only` — completed; lockfile synchronized; npm noted five high-severity audit findings.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; production build prerendered `/` and `/_not-found`.
- `npm audit` — five high-severity findings, all propagating from one `braces` advisory in a development-only dependency path; zero critical, moderate, or low findings.

## Audit findings

All five reported package entries are **high severity** and **development-only** because they are within `eslint-config-next`, a dev dependency. They trace to the same advisory: `braces` is vulnerable to stack-exhaustion denial of service through deeply nested patterns (GHSA-vfj7-8cjw-p6xm).

| Reported package | Dependency path from direct dev dependency | Exposure | Severity | Why it remains |
| --- | --- | --- | --- | --- |
| `eslint-config-next` | direct dev dependency | Development | High | Advisory is inherited through its Next ESLint plugin; npm only offers a breaking downgrade to 14.2.35. |
| `@next/eslint-plugin-next` | `eslint-config-next > @next/eslint-plugin-next` | Development | High | Depends on affected `fast-glob`; no compatible patched chain was available. |
| `fast-glob` | `eslint-config-next > @next/eslint-plugin-next > fast-glob` | Development | High | Depends on affected `micromatch`; no compatible patched chain was available. |
| `micromatch` | `eslint-config-next > @next/eslint-plugin-next > fast-glob > micromatch` | Development | High | Depends on affected `braces`; registry reports `braces@3.0.3` as latest. |
| `braces` | `eslint-config-next > @next/eslint-plugin-next > fast-glob > micromatch > braces` | Development | High | The advisory affects the available 3.0.3 version. No patched semver-compatible braces version was available. |

No `npm audit fix --force` was run. The audit's proposed fix downgrades `eslint-config-next` to 14.2.35, a breaking major downgrade inconsistent with Next.js 16. No safe, non-breaking dependency update was found or applied.

## Security considerations

The remaining advisory is in tooling used during development/linting, not a production dependency path. It concerns a denial-of-service risk from deeply nested patterns. Keep the development tooling environment trusted and update when a compatible patched dependency chain becomes available. No secrets or application security controls were changed.

## Decisions made

- Kept the Next.js 16-compatible ESLint dependency chain rather than applying npm's breaking downgrade suggestion.
- Added the Node 24 range to `package.json`, selected major version 24 in `.nvmrc`, and documented the baseline in architecture.
- Left dependency versions unchanged because there was no safe, non-breaking update resolving the advisory.

## Known issues

- The five npm audit findings described above remain until a compatible patched `braces` dependency chain is published or the compatible Next.js ESLint dependency chain updates.

## Explicitly not implemented

No application features, database, authentication, APIs, invoice logic, UI changes, or unrelated dependency updates.