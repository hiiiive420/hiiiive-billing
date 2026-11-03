# Codex Handoff

## Task
INV-031 — Invo Conversational Billing Assistant

## Status
Implemented and verified with automated checks. The normal Turbopack build failed in its CSS worker; the permitted webpack fallback build passed. Built-in browser acceptance could not be completed because the browser UI bridge failed to initialize. No commit was created.

## Repository Baseline
Repository: `D:\Billing_Hive\hiiiive-billing`. Task start was clean at `ed8f82c feat: add recurring invoices and draft autosave`, with `main`, `origin/main`, and `origin/HEAD` on the accepted baseline.

## Existing AI Foundation Reused
Reused the existing OpenAI package, `OPENAI_API_KEY`, `OPENAI_INVOICE_MODEL`, Responses API, model selection, Asia/Colombo date handling, `store: false`, 18-second timeout, zero retries, Zod, and server-only security boundary. Replaced the production one-shot Quick Invoice UI with Invo.

## Invo Architecture
A shared `InvoAssistant` supports INVOICE and RECURRING modes on both create routes. The server action authenticates every turn, checks `INVO_USE` plus the target permission, bounds the conversation, loads limited tenant-safe candidate context, parses a strict structured result, resolves trusted IDs, and performs deterministic readiness validation. Its Prisma access is read-only.

## OpenAI / Structured Output
The schema returns `ASK_USER` or `READY_PROPOSAL`, assistant message, fixed target, missing fields, ambiguities, and typed proposal fields. Money and quantities are strings. It has no totals, invoice numbers, lifecycle values, or trusted record IDs. The server calculates exact line/subtotal/discount validation with the shared Decimal helpers and decides readiness independently.

## Conversation State
Client state holds at most 14 messages, each up to 2,000 characters and a combined maximum of 8,000. It is page-scoped and transient; Start over clears only the chat. OpenAI response IDs are not persisted.

## Manual Acceptance Boundary
Only the structured review card offers Apply. The form is unchanged before the click. Applying hides the proposal card; the normal form then owns state. Start over has no form/database effect.

## Invoice Flow
Apply populates the existing invoice form with a server-resolved active Client, supported fields, and trusted optional Service IDs. Existing autosave may then create one ordinary unnumbered DRAFT. Invo does not create drafts, issue, number, email, or record payment.

## Recurring Flow
Apply populates the existing recurring form, including Client, plan name, currency, frequency, schedule date, terms, and items. It creates no plan. The user must still review the form and click Create plan.

## Client Matching
Matching uses normalized exact names on active Clients within the trusted organization. Missing/ambiguous matches are not trusted. Similar same-tenant candidates are bounded to five; unknown clients remain for manual selection or creation.

## Service Matching
Only exact active same-tenant matches resolve to trusted Service IDs. Unmatched service hints can remain free-form descriptions. A matching default price requires user confirmation carried with a short-lived server-signed offer token; forged browser assistant history cannot accept it. Confirmed defaults are canonicalized and used only when currency matches.

## Currency / Money Safety
Money/quantity are decimal strings; valid grouping commas are normalized and malformed grouping fails readiness. Values are bounded to Decimal(19,4) shape. Shared Decimal math validates subtotal and discount bounds. Currency is uppercase three-letter ASCII; `$` is clarified unless an explicit currency code accompanies the symbol. No FX or model-calculated totals are used.

## RBAC / Tenant Isolation
Central `INVO_USE` is granted to ADMIN and BILLING, not VIEWER. Each turn also requires `INVOICE_CREATE` or `RECURRING_INVOICE_MANAGE`. The server resolves tenant scope only through the authenticated membership and route slug. Browser/model IDs are never trusted.

## Security
OpenAI receives no organization ID, JWT, user email, secrets, invoice/payment rows, or SMTP data. Candidate context is bounded and tenant scoped. No AI response writes the database or calls billing side-effect services. Safe failures preserve manual form access.

## Cost Controls
Conversation, text, and candidate data are bounded. No tools or web search are enabled. The model is called only when the user sends a message; no token accounting infrastructure was added.

## Responsive UI
Composer and review actions stack on narrow screens; chat history has a bounded scroll area. Responsive visual acceptance at 1440/1024/768/390 was unavailable.

## Browser Acceptance
Built-in browser could not complete this acceptance step. The Codex CUA bridge failed twice during initialization with `failed to write kernel assets: The system cannot find the path specified`. I opened the `/app/hiiiive/invoices/new` target in the Codex panel, but the bridge did not allow interaction. No invoice, plan, or other app side effect was created. Invoice, recurring, autosave, `$` interaction, and viewport checks remain unverified.

## Tests and Checks
- `npm test`: 188 passed; PDF suite 8 passed. Invo integration coverage includes read-only ASK_USER/READY_PROPOSAL, tenant-resolved IDs, forged default-price confirmation rejection, recurring readiness, and ambiguous `$`.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npx prisma validate`: passed.
- `npm run build`: failed in Turbopack CSS worker while parsing `src/app/globals.css`; exact error: `Failed to write app endpoint /page`; CSS child Node process exited before connecting (exit code 0).
- `npx next build --webpack`: passed on the final version and included both `/app/[organizationSlug]/invoices/new` and `/app/[organizationSlug]/recurring/new`.
- `npm run db:migrate:status`: all 14 migrations are up to date.
- `npm audit --omit=dev`: found 0 vulnerabilities.
- `git diff --check`: passed (only Git LF-to-CRLF working-copy notices).

## Migration Status
No schema changes or migrations were created. `DATABASE.md` records that INV-031 uses transient state only. Migration status is up to date.

## Known Limitations
At completion of INV-031 / INV-031A, live OpenAI behavior had not been exercised. INV-031B's live trace and failure are recorded below. The required built-in browser acceptance could not be completed because its UI bridge was unavailable. The normal Turbopack build remains environment-blocked, while webpack build passes.

## Suggested Next Step
QA-001 — Production Readiness / Security / End-to-End Acceptance

## INV-031A — Interactive Invo Assistant UX

The shared assistant is now a fixed floating control on invoice and recurring creation pages only. It starts collapsed with a target-specific deterministic greeting that dismisses on open or after 14 seconds. The greeting and mascot trigger open the same right-side desktop panel; mobile uses a nearly full-screen panel with a safe-area-aware composer. Minimize and Escape return focus to the mascot trigger while preserving page-scoped conversation, proposal, and signed offers. Start over clears only chat/proposal state and does not close the panel.

The supplied mascot artwork is integrated from `/branding/invo-mascot.webp` using `next/image`, with responsive trigger sizing and a small rounded chat avatar. The image contains no embedded UI text; the visible greeting and assistant labels remain HTML.

The panel includes a labeled avatar/header, low-emphasis Powered by OpenAI text, contextual starter chips, bounded conversation, composer, structured proposal review, and target-specific post-Apply confirmation. Opening, greeting, minimize/reopen, Start over, and Apply make no OpenAI calls. Only Send invokes the existing action; Try again only repopulates the composer for a deliberate resend. The existing manual Apply callback still populates the normal form; invoice autosave and recurring Create plan behavior remain unchanged.

Keyboard trigger semantics, Escape minimize, focus movement/restoration, accessible avatar label, polite conversation announcements, and status messages are implemented. Layout CSS supports floating desktop, tablet, safe-area mobile sheet, and responsive proposal actions. Built-in browser could not complete this acceptance step: the Codex CUA bridge failed with `failed to write kernel assets: The system cannot find the path specified`. Visual acceptance at 1440/1024/768/390 is unverified. Automated view-state tests cover initial collapse/greeting, greeting dismissal, open, minimize/reopen preservation, target-specific apply confirmation, Change details, and Start over.

### INV-031A Checks

After mascot integration, `npm test` passed all 195 tests and all 8 PDF tests; `npm run typecheck`, `npm run lint`, and `git diff --check` passed. `npx prisma validate`, migration status (14 up to date), and `npm audit --omit=dev` (0 vulnerabilities) passed earlier; the asset/UI integration did not change schema or dependencies. `npm run build` still fails in the Turbopack CSS worker (`Failed to write app endpoint /page`); `npx next build --webpack` passed after mascot integration and included both create routes. Built-in browser visual acceptance remains unavailable because its UI bridge failed to initialize.

## INV-031B — Live Invo Acceptance Fixes

### Live OpenAI trace and root cause

Reproduced through the actual `sendInvoMessage` server action using the requested invoice prompt and local `hiiiive` organization. The action passed its auth/permission and tenant context stages and reached the configured Responses API request. OpenAI rejected the credential before structured output generation: HTTP `401`, code `expired_secret_key`. `OPENAI_API_KEY` is present server-side but is expired/invalid. `OPENAI_INVOICE_MODEL` resolves to `gpt-6-luna`; it was not changed. The actual configured model therefore remains unverified for this request because authentication failed before model processing.

The INV-031 parser uses the same OpenAI SDK `responses.parse()`, `zodTextFormat`, strict Zod output, `store: false`, 18-second timeout, and zero retries as the previously working invoice intent parser. The observed error is an expired API credential, not a Structured Outputs/Zod error, wrong target schema, message-shape error, candidate serialization error, deterministic validation error, timeout, or signed Service offer failure. No response was generated, so successful live ASK_USER/READY_PROPOSAL behavior remains unverified until a valid key is configured. The key value was never logged or displayed.

Development-only parser diagnostics now emit safe stage/model/error-class fields plus OpenAI status and sanitized code; they never log the key, headers, prompt, candidate context, or raw model output. Production continues to return the generic safe UI message. No model, schema, authority, or financial rule was weakened to mask the credential failure.

### Page integration and interaction fixes

Both production new pages are wired to the same floating `InvoAssistant`: invoice uses `INVOICE`, recurring uses `RECURRING`. Their exact greetings and composer placeholders are preserved. The open panel now labels the active workflow as Invoice assistant or Recurring assistant.

Explicit wrong-mode requests are handled locally before the server action: recurring mode identifies an invoice request and offers Open New Invoice; invoice mode identifies a recurring/monthly/yearly plan request and offers Open Recurring Plan. The destination is a normal link, and navigation happens only after the user clicks it.

The duplicate-submit cause was that the client relied on React's asynchronously rendered `useTransition` pending flag as its only send guard. Two closely spaced submit events could run before it updated. A synchronous request ref now serializes submissions and prevents duplicate bubbles/API calls. Failed messages stay in history; Try again only restores the last failed text to the composer. A deliberate Send reuses that failed user bubble instead of adding a duplicate. Network exceptions preserve the generic safe failure state. The signed Service default-price offer, manual Apply boundary, and normal invoice/recurring form authority remain unchanged.

### Live and browser acceptance

The direct invoice server-action request returned the safe generic error after the terminal recorded HTTP `401` / `expired_secret_key`. No successful live OpenAI turn was possible, so invoice clarification/READY_PROPOSAL, recurring date clarification/READY_PROPOSAL, Apply/autosave, and manual Create plan were not live-tested. Automated mocked service coverage verifies ASK_USER and READY_PROPOSAL remain read-only, unknown Clients cannot resolve, ambiguous `$` remains unassumed, and default Service prices require the existing signed-offer confirmation.

Invoice and recurring page wiring is covered by a route integration regression asserting the shared component, page target, greeting, and composer copy. Built-in browser acceptance was attempted through the Codex browser bridge, which failed during kernel initialization. **Built-in browser could not complete this acceptance step.** No Chrome fallback was used. No invoice, plan, issue, send, or payment action was executed.

### Regression checks and migration status

Added regression coverage for one in-flight request, one user bubble per send, failed-message reuse, Try again restoring text without invoking a send, deterministic wrong-mode handling, production page wiring, safe OpenAI error diagnostics, and no database writes on mocked AI failure. Existing read-only ASK_USER/READY_PROPOSAL, ambiguous currency, and signed Service-price tests remain in place.

- `npm test`: 201 passed; PDF suite 8 passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npx prisma validate`: passed.
- `npm run db:migrate:status`: all 14 migrations up to date; no migration added.
- `npm audit --omit=dev`: 0 vulnerabilities.
- `git diff --check`: passed (Git reports existing LF-to-CRLF working-copy notices).
- `npm run build`: blocked by the existing Turbopack CSS worker error (`Failed to write app endpoint /page`).
- `npx next build --webpack`: passed and included both new invoice and recurring routes.

No commit was created. To finish the required live model and browser interaction, update the local `OPENAI_API_KEY` with a valid key without sharing it in chat; then retry the requested test sequence.

## INV-031C — Isolate and Fix Live Invo OpenAI Failure

### Layer 1: minimal Responses API smoke test

Ran `client.responses.create({ model, input: "Reply with only OK", store: false })` with the installed OpenAI SDK, 18-second timeout, and zero retries. Environment was loaded with Next.js's `@next/env` loader. Safe result: `OPENAI_API_KEY` configured `true`; `OPENAI_INVOICE_MODEL` is `gpt-6-luna`; stage `API_CALL`; HTTP `401`; code `expired_secret_key`; type `invalid_request_error`; safe message: the configured OpenAI API key has expired. The key itself was never printed.

This isolates the live failure to API authentication. The minimal request had no Invo schema, conversation, candidate context, tools, or database access. Per the task's stop rule, minimal Structured Output and full Invo schema tests were not run. The configured model was not changed. A Next.js dev process was not listening on local port 3000 in this workspace; the smoke process used Next's environment loader to confirm the values available from the local environment.

### Development diagnostics

The shared parser now logs only `apiKeyConfigured`, model, stage, error class/type, HTTP status, sanitized error code, and a mapped safe error message in non-production. API errors are classified as `API_CALL`; non-transport parse errors as `STRUCTURED_PARSE`; schema/target checks as `POST_VALIDATION`. No prompt, context, credential, authorization header, or raw error message is logged. The browser failure remains generic. This change does not alter UI, accounting rules, model selection, or API request content.

### Remaining live validation

The confirmed root cause matches INV-031B's real server-action trace: expired API key. No successful live call is possible until the local key is replaced with a valid OpenAI API key. Layer 2, Layer 3, live invoice/recurring conversations, and post-validation trace are therefore unverified and intentionally not attempted. Invoice and recurring UI visibility was manually confirmed by the user; no browser run was attempted in this turn after Layer 1 failed.

### Checks

`npm test` passed 201 tests plus 8 PDF tests, including safe mapping for `expired_secret_key`; typecheck and lint passed. `npx prisma validate` passed; `npm run db:migrate:status` reports all 14 migrations up to date; `npm audit --omit=dev` found 0 vulnerabilities; `git diff --check` passed. `npm run build` still fails in the Turbopack CSS worker (`Failed to write app endpoint /page`); `npx next build --webpack` passed after this diagnostics change. No migration was added and no commit was created.
