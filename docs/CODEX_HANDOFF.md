# Codex Handoff

## Task
INV-024 — OpenAI Natural-Language Quick Invoice

## Status
Implementation is complete and uncommitted. Quick Invoice with AI is advisory only; the existing invoice form and deterministic draft workflow remain authoritative.

## Summary
Added a one-shot natural-language parser using the official OpenAI Node SDK Responses API and strict Zod Structured Outputs. Suggestions are transient. No OpenAI request or suggestion writes to the database.

## Route / UI
`/app/[organizationSlug]/invoices/new` shows Quick Invoice with AI above the normal production invoice form. Generate returns a reviewable client/project/currency/items/due/discount summary, ambiguities, and missing information. Apply explicitly copies supported values into the editable form. It never saves, previews, or issues automatically. Existing values remain unchanged until Apply.

## Structured Intent Contract
The required strict schema contains nullable client/service hints, project/date/due-day/currency/discount/payment-terms/notes fields, item billing mode and decimal-string quantity/prices, plus ambiguities and missing information. It contains no database IDs, totals, lifecycle/payment state, invoice number, template, or sequence fields. Money and quantities are decimal strings; percentage discounts and ambiguous currency symbols are not calculated or guessed.

## OpenAI Integration
Uses `openai` 7.43.0 and direct dependency `zod` 4.6.7. The parser lazily checks `OPENAI_API_KEY`, uses `OPENAI_INVOICE_MODEL` or the single default `gpt-6-luna`, passes current Asia/Colombo date context, uses `store: false`, no tools/history, an 18-second timeout, and zero automatic retries. The real `.env` was not changed; `.env.example` contains blank key and model placeholders.

## Tenant-Safe Resolution
After parsing, only active same-organization records are queried using trusted organization context. A client or service is proposed only for one normalized exact match. Missing or ambiguous matches remain unresolved. A resolved service does not apply its default price.

## Apply-to-Form Behavior
Generation does not modify form state or write to the database. The explicit Apply button maps only supported fields, links IDs only from resolved same-tenant records, and leaves unresolved hints as ordinary search text. Null currency stays unresolved in the suggestion and Apply patch; it does not represent an AI choice of LKR. The ordinary new form has its deterministic LKR default, while applying an unresolved suggestion leaves currency blank for the user to choose. Resolved services never activate default pricing; extracted prices remain explicit proposals. Explicit invoice and due dates are used as supplied after validation. If only dueInDays is supplied, application code adds calendar days to the explicit invoice date or supplied current Asia/Colombo date using timezone-independent YYYY-MM-DD arithmetic. If both dueDate and dueInDays are present, explicit dueDate wins and the suggestion includes a review ambiguity. Apply only replaces local form state; it does not save, preview, or issue. Save Draft remains a separate user action.

## Authorization
The Server Action resolves the organization slug from authenticated active membership and requires existing `INVOICE_CREATE` permission before parsing. ADMIN and BILLING are allowed; VIEWER and foreign organizations are denied before OpenAI is called. Browser input contains only natural-language text, capped at 2,000 characters.

## Privacy / Security
Only the user's typed text, extraction instructions, and current date/timezone are sent to OpenAI. No identity, JWT, tenant/database IDs, client/service lists, invoices, payment history, or other business data is sent. The API key is server-only. Raw prompt/response and provider metadata are not persisted or returned. Safe errors leave the ordinary form usable.

## Environment
Set `OPENAI_API_KEY` and optionally `OPENAI_INVOICE_MODEL` in the server environment after review. No real key is present in `.env.example` or code changes.

## Tests and Checks
- `npm test` — passed: 159 unit/integration tests and 8 PDF tests; OpenAI calls are mocked.
- `npm run typecheck` — passed.
- `npm run lint` — passed without warnings.
- `npm run build` — passed without requiring a live OpenAI API key.
- `npm run db:migrate:status` — passed; database up to date, 13 migrations. No migration added.
- `npm audit --omit=dev` — passed; 0 production vulnerabilities.

## Blockers / Next Step
No implementation blocker. Configure the real API key after review, then perform an operator-approved live parsing check.
