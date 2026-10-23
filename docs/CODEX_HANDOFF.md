# Codex Handoff

## Task
INV-020 — Authentication Context & Server-Side RBAC Foundation

## Status
Complete. Production Cloudflare Access identity verification and server-side organization RBAC helpers are implemented. No production invoice workspace or login UI was added.

## Summary
Production requests authenticate only through a verified `Cf-Access-Jwt-Assertion`. The normalized verified email must map to an existing active `User`; organization access requires an active persisted membership. `ADMIN`, `BILLING`, and `VIEWER` permissions are centralized in a typed server-only authorization module. Local development can use an explicit `DEV_AUTH_EMAIL`; production cannot.

## Files Changed
- `src/lib/auth/identity.ts` — development identity, Cloudflare Access configuration and JWT verification, request identity.
- `src/lib/auth/authorization.ts` — current user, memberships, organization permission checks, typed role matrix.
- `src/lib/auth/identity.test.ts`, `src/lib/auth/authorization.test.ts` — offline JWT/unit and PostgreSQL authorization coverage.
- `package.json`, `package-lock.json` — `jose` dependency and auth tests.
- `.env.example` — placeholders for the three auth settings.
- `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/DATABASE.md` — current trust chain, authorization and email normalization behavior.

## Authentication Flow
Cloudflare Access (with deployment-enforced MFA) → `Cf-Access-Jwt-Assertion` → JOSE RS256/JWKS verification with configured issuer and audience → normalized email → existing active `User` → active organization membership → centralized permission → tenant-scoped service. No user auto-provisioning, password auth, or production invoice routes were added. The origin must not be reachable around Cloudflare Access.

## RBAC / Permission Behavior
- `ADMIN`: all defined permissions.
- `BILLING`: invoice read/create/draft edit/issue and payment read/record.
- `VIEWER`: invoice read and payment read only.
- Unknown roles fail closed. Missing, foreign, and inactive memberships share the same denial behavior.
- No membership mutation service exists; future membership changes must transactionally prevent removing or demoting the last active ADMIN.

## Development Authentication
`DEV_AUTH_EMAIL` is required for local identity and normalized with the same email rules. There is no default; missing configuration fails clearly. The production request path never reads it and requires the Access JWT. Existing development invoice routes keep their fixed dev organization context.

## Tests and Checks
- `npm test` — passed: 117 unit/integration tests and 8 PDF tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; no production invoice workspace route was added.
- `npm run db:migrate:status` — passed; all 10 migrations are applied, no migration was needed.
- `npm audit --omit=dev` — passed; 0 production dependency vulnerabilities.

JWT tests use generated local RSA keys and local JWKS data; they do not contact Cloudflare. PostgreSQL integration tests cover provisioned/unknown/inactive users, active/inactive and cross-organization memberships, persisted roles, and authorization.

## Security Notes
Plain `Cf-Access-Authenticated-User-Email` is ignored. JWT content is not returned as identity or logged. Unknown/inactive application users are not provisioned. Authorization derives roles only from persisted memberships, never from client input.

## Blockers / Next Step
Configure `CLOUDFLARE_ACCESS_TEAM_DOMAIN` and `CLOUDFLARE_ACCESS_AUD` in the production server environment, enforce MFA and origin protection in Cloudflare, then use these helpers when the production workspace is introduced. No last-active-admin mutation service exists yet.
