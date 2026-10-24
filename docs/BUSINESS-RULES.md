# Business Rules

These rules are authoritative for MVP1. If a requirement conflicts with them or does not define a financial outcome, stop and raise the conflict for a decision; do not infer a new financial rule.

## Organizations

- MVP1 has one organization: Hiiiive.
- Organization-owned data must include `organizationId` to support a future multi-tenant SaaS product.

## Invoice lifecycle and numbering

- Draft invoices are editable and have no final invoice number.
- Invoice lifecycle (`DRAFT`, `ISSUED`, `SUPERSEDED`, `VOID`, `WRITTEN_OFF`) is stored separately from payment state (`UNPAID`, `PARTIALLY_PAID`, `PAID`).
- Hiiiive MVP invoice numbers use `I` + `YYYYMMDD` + the issued sequence, with no separators; for example, `I2026100922`.
- `I` is the invoice prefix. `YYYYMMDD` comes from the `invoiceDate` locked at issuance. If `invoiceDate` is absent when issued, future issue logic uses the Asia/Colombo local date.
- The numeric suffix is one organization-wide monotonically increasing sequence. It does not reset by day, month, or year.
- Drafts consume no invoice number. Assign the number only when the invoice is approved and issued. Issued numbers are never reused, including for invoices later marked VOID, SUPERSEDED, or WRITTEN_OFF.
- Draft creation requires an active client in the same organization and at least one item. Drafts have no client snapshots or template-version binding; issuance captures client snapshots and resolves the template version.
- Draft line items require a nonblank description and use an explicit billing mode. `QUANTITY` requires positive quantity and nonnegative unit price; its line total is quantity × unit price. `FLAT_FEE` requires a nonnegative amount and is stored canonically as quantity 1, unit price equal to amount, and line total equal to amount. The server computes line totals, subtotal, discount validation, and grand total. Flat-fee quantity and unit-price storage values are internal and are hidden from customer-facing documents. A service default price is used only when explicitly requested and only when its currency matches the invoice; an explicit entered amount/unit price always takes precedence.
- Full invoice-form draft edits must use the atomic full-draft update service. The UI must not chain header and item update transactions; the complete header, client, currency, discount, notes, payment terms, item list, and server-derived totals change together or not at all.
- After issuance, `invoiceDate` and `invoiceNumber` are immutable.
- Draft preview is informational and read-only. Before issue it may use the current client record and current active default template; it is not a promise of the frozen issued document. Only issuance binds the immutable template version and client snapshots.
- Future SaaS may support configurable numbering formats; Hiiiive MVP uses the format above.
- Issued financial data must not be silently edited.
- An issued invoice may be Paid, Partially Paid, Superseded/Reworked, Void, or Written Off where an authorized process permits it.
- Preserve the original invoice and its audit history when it is superseded, voided, or written off. Record the reason and relevant actor.

## Issued invoice email

- Issuing an invoice does not send email. Email sending is a separate authorized human action after issuance.
- Email can be sent only for an `ISSUED` invoice and by an organization member authorized for `INVOICE_SEND` (`ADMIN` or `BILLING`). Sending does not issue, edit, supersede, or change payment state.
- The suggested recipient is the frozen `clientEmailSnapshot`; do not fall back to the current Client email. The user may edit recipients for an individual send. No recipient profile is persisted.
- To is required. To/CC/BCC accept comma, semicolon, or newline separators, normalize addresses to lowercase, deduplicate within each category, validate server-side, and allow at most 50 total recipients. The configured sender is server-only and cannot be overridden by form input. BCC is never included in To/CC headers or client-visible history.
- Subject and body are editable for each attempt. Defaults use the issued invoice's trusted frozen details; absent due date or payment terms are omitted. Subject line breaks are rejected.
- Every send and retry creates its own immutable recipient/content/actor snapshot. Attempts transition once from `PENDING` to `SENT` or `FAILED`. PDF generation and SMTP happen outside a database transaction; failures do not alter invoice, payment, or numbering state. A retry creates a new attempt.
- Attach only the official server-generated issued PDF. SMTP configuration and credentials come from server environment variables; if sender or SMTP settings are missing/invalid, sending fails safely.
- Permanent per-client To/CC/BCC defaults are a future enhancement; recipients are selected per send.

## Invoice currency

- `Invoice.currencyCode` is authoritative for the amounts on that invoice. Draft invoices default to `LKR` and may change currency while they remain DRAFT.
- Normalize currency codes to uppercase and accept only exactly three ASCII letters. Reject malformed values; do not infer or convert another currency.
- Issuance locks the normalized invoice currency. Treat currency as immutable after issuance; no exchange-rate or currency-conversion behavior is implemented.
- `Service.currencyCode` describes the currency of `defaultUnitPrice`. Do not auto-fill or convert a service default price when it differs from the invoice currency; require an explicit invoice unit price in the invoice currency.
- A future conventional invoice form will expose a Currency selector defaulting to LKR. Example choices include LKR, USD, CAD, GBP, EUR, and AUD.
## Invoice templates

- MVP1 uses the Hiiiive invoice template. Template records are organization-scoped; future SaaS may support multiple templates per organization.
- Template versions are immutable after creation: updates and deletes are rejected by PostgreSQL. Any change to renderer, config, version, template, or organization requires creating a new version. An issued invoice must retain the exact template version used so its presentation can be reproduced historically.
- Template version numbers are positive and unique within their template. Issuance resolves the organization's one active default template and freezes its latest version; that version is never changed on the issued invoice.
- The Hiiiive MVP invoice presentation uses the trusted `hiiiive-default` renderer and structured presentation/branding config only. Template data cannot execute code or supply HTML/CSS. Financial values are rendered from persisted decimal/string values; rendering does not recalculate accounting values.
- At most one active default template is permitted per organization. Inactive templates do not participate in default selection.
- Issued invoice documents use the frozen `templateVersionId`, immutable persisted totals/items, and client snapshots. Rendering must not read the current Client record, recompute invoice totals, or fall back to a current template. Historical/manual issued invoices with a null template version require explicit historical handling.

## Payments

- Payments are separate records, not a boolean on the invoice.
- Support multiple and partial payments. Record amount, payment date, and method; reference and internal note are optional.
- Payment status is derived from recorded payments: zero paid is UNPAID; a positive total below grandTotal is PARTIALLY_PAID; a total equal to or above grandTotal is PAID.
- Only ISSUED invoices may receive payments. Payment amount must be positive. Record payment and recalculate payment status atomically; never change grandTotal because of a payment.
- Overpayments remain recorded and leave status PAID. Refund and credit treatment are not implemented; overpayments require later accounting handling.

## Reworked and replacement invoices

- An issued invoice may be superseded by one or multiple replacement invoices.
- Preserve links from the original invoice to its replacements and from replacements to the original, with the reason and audit history.
- Superseding an ISSUED invoice records one or more REPLACED_BY relations and changes the source lifecycle to SUPERSEDED in one transaction. Replacement invoices remain drafts until separately issued.
- A replacement invoice may be the target of REPLACED_BY for only one source invoice within an organization. One source may still have multiple replacement targets.
- Preserve any payments on the superseded source. Do not reverse, move, or redistribute them automatically; a human must determine the accounting treatment.
- For example, one LKR 150,000 invoice may be replaced by three LKR 50,000 invoices. The relationship does not itself decide accounting treatment; follow an explicitly approved process.

## Recurring invoices

- Recurring templates generate drafts, not issued invoices.
- Client invoices require internal approval before sending in MVP1.
- Draft generation must be idempotent: retrying a generation period must not create duplicate drafts.
- Price changes apply prospectively and must not modify historical invoices.

## Approval and email

- Never send a client invoice email unless the invoice is approved and issued.
- Notify the internal team when approval is required.
- Log email send attempts and make delivery retryable without generating another invoice.

## Calculations and auditability

- Calculate financial totals using deterministic server-side code.
- AI must never control totals, invoice numbering, approval, or sending.
- Important invoice actions create immutable audit events recording actor, timestamp, action, and relevant reason/metadata.


