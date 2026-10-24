# Codex Handoff

## Task
INV-023 / INV-023A / INV-023B / INV-023C — Issued Invoice Email Sending and Delivery Audit Safety

## Status
Implementation is complete and remains uncommitted. Authorized users can send or resend already-issued invoices with the official frozen PDF attached. Mixed SMTP outcomes are recorded as terminal partial delivery, and no automatic retry occurs. The requester email audit snapshot uses the authenticated user's email; the friendly display label remains available for UI use.

## Current Behavior
A PENDING attempt snapshot is recorded before PDF and SMTP work, then transitions once to SENT, PARTIALLY_SENT, or FAILED. SMTP delivery-result snapshots are persisted for partial delivery and for failed SMTP results when the provider returned recipient outcomes. PDF failures and network errors without a provider result retain empty accepted/rejected arrays. Partial delivery includes the provider message ID, sentAt and failedAt completion timestamps, and a safe review message. Resending creates a separate attempt. Email sending does not modify invoice/payment data or numbering.

Recent history labels partial attempts “Partially sent”. BCC recipients and delivery-result recipient lists are not exposed in the normal UI.

Authenticated organization context exposes both `userLabel` (display name with email fallback) and `userEmail`. The invoice email action derives both user ID and audit email from that server context; browser input cannot supply either identity value.

## Migration
`20261024100000_partial_invoice_email_delivery` adds PARTIALLY_SENT, accepted/rejected result snapshots, and updated PostgreSQL terminal-state checks and immutability protection. Earlier INV-023 migrations were not rewritten.

## Existing INV-023 Behavior
The composer supports per-send To/CC/BCC, subject, and plain-text message edits, attaches the official PDF generated from frozen issued data, and defaults To from the frozen client email snapshot. BCC is stored only in the internal attempt audit. `INVOICE_SEND` allows ADMIN and BILLING; VIEWER is denied. SMTP credentials remain server-only.

## Validation
- `npm exec prisma format` — passed.
- `npm run prisma:validate` — passed.
- `npm run prisma:generate` — passed.
- `npm test` — passed: 133 unit/integration tests and 8 PDF tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed.
- INV-023B identity coverage proves the audit stores `person@example.com` when the display name is `Krishna`.
- INV-023C coverage proves zero accepted recipients with a known rejection records FAILED and preserves the rejected address.
- `npm run db:migrate:status` — passed; all 13 migrations are applied to the configured local database.
- `npm audit --omit=dev` — passed; 0 production dependency vulnerabilities.
