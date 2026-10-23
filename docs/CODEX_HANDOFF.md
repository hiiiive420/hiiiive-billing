# Codex Handoff

## Task
INV-022 — Preview, Issue & PDF Workflow

## Status
Complete. Authenticated DRAFT preview, invoice issuance, issued invoice viewing, and PDF download are implemented.

## Routes / Actions Added
- `/app/[organizationSlug]/invoices/[invoiceId]/preview` — read-only DRAFT preview.
- `/app/[organizationSlug]/invoices/[invoiceId]` — read-only issued/closed invoice document.
- `/app/[organizationSlug]/invoices/[invoiceId]/pdf` — authenticated PDF attachment download.
- `issueOrganizationInvoiceAction()` — `INVOICE_ISSUE` protected server action calling `issueInvoice()`.

## Preview / Issue Behavior
Preview requires `INVOICE_EDIT_DRAFT`, rejects issued or otherwise non-editable records, and performs no writes or sequence allocation. It uses the current active default template and current client data, labels the result `DRAFT PREVIEW`, and uses server Decimal arithmetic for displayed totals. This preview is not frozen. The edit form enables Preview and Issue only for saved drafts without unsaved changes. Issuance requires an explicit confirmation; the UI explains that numbering, invoice date, client details, and template version become permanent. Successful issue navigates to the read-only issued invoice page.

## Issued Document / PDF Integrity
The issued page and PDF route use `loadIssuedInvoiceDocument()` and therefore render persisted amounts, client snapshots, and the invoice's frozen template version. Only ISSUED, SUPERSEDED, VOID, and WRITTEN_OFF invoices render. Missing or invalid historical template data fails explicitly. PDF responses use `application/pdf`, a validated invoice-number filename, attachment disposition, `private, no-store`, and `nosniff`.

## Authorization / Concurrency
Preview requires `INVOICE_EDIT_DRAFT`; issuance requires `INVOICE_ISSUE`; issued page and PDF require `INVOICE_READ`. Each operation resolves its organization from the authenticated user's active membership, never client organization input. `issueInvoice()` retains its row lock, conditional DRAFT transition, and transactional sequence reservation. Existing integration tests cover edit/issue serialization and concurrent double issuance.

## Files Changed
Production invoice action/form controls, draft preview loader, issued document metadata, preview/issued/PDF routes, focused authorization coverage, and Architecture, Business Rules, Security, and this handoff documentation.

## Tests and Checks
- `npm test` — passed: 120 unit/integration tests and 8 PDF tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run build` — passed; production routes are dynamic and present at the intended paths.
- `npm run db:migrate:status` — passed; all 10 migrations are applied. No migration was required.
- `npm audit --omit=dev` — passed; 0 production dependency vulnerabilities.

## Blockers / Next Step
Production deployment needs Cloudflare Access team/audience configuration, enforced MFA, origin protection, and a configured Chromium executable. Next task: INV-023 — OpenAI Natural-Language Quick Invoice.
