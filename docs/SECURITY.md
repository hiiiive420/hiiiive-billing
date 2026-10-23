# Security

## Trust boundaries

The browser is an untrusted client. Never accept browser-supplied totals, invoice statuses, final invoice numbers, or organization IDs as authoritative. Derive or validate sensitive values on the server using authorized records and deterministic business logic.

## Authentication and user identities

Production request identity is established by Cloudflare Access. Cloudflare Access must enforce the deployment's required MFA policy and protect the application origin. The application reads only `Cf-Access-Jwt-Assertion`, verifies it with `jose` against the public JWKS endpoint derived from `CLOUDFLARE_ACCESS_TEAM_DOMAIN`, and requires the configured issuer, `CLOUDFLARE_ACCESS_AUD`, an RS256 signature, expiration, subject, and email. A present `nbf` is validated by JWT verification. Missing configuration or an invalid token fails closed. No private Cloudflare signing key is required or stored.

The trust chain is: Internet → Cloudflare → Cloudflare Access and mandatory MFA → verified Access JWT at the origin → existing active `User` → active `OrganizationMembership` → centralized role permission → organization-scoped service. A Cloudflare-authenticated identity does not automatically receive application access; its normalized lowercase email must match a provisioned active `User`, and the user must have an active membership in the requested organization. Users are never auto-provisioned during authentication. Plain `Cf-Access-Authenticated-User-Email` or any other unsigned identity header is not authentication evidence. The origin must be configured so requests cannot bypass Cloudflare Access.

Outside production, `DEV_AUTH_EMAIL` provides a deliberately explicit server-only local identity. It has no default and is always rejected in production. Production identity always requires a verified Access JWT. The application does not implement passwords, sessions, or application MFA; MFA is an infrastructure requirement enforced by Cloudflare Access.

## Authorization, RBAC, and tenant isolation

- RBAC is organization-scoped through `OrganizationMembership`; a user's role applies within that organization.
- UI visibility is not authorization. Hiding controls or pages does not protect data or operations.
- `src/lib/auth/authorization.ts` centralizes the server-side permission matrix. Every protected operation must enforce permission and organization scope on the server; UI visibility is not authorization.
- MVP1 intends one dedicated account with `ADMIN`; Krishna and working team members use `BILLING`; `VIEWER` is reserved for future read-only use.
- The schema does not limit the number of ADMIN memberships. Future application/service logic must prevent removing or demoting the last active ADMIN in an organization.
- No membership mutation service exists yet. Any future membership role/deactivation service must enforce the last-active-ADMIN invariant transactionally.
- Production invoice URLs use `organizationSlug` only as a selector. The application resolves it by inspecting the current user's active memberships; it never looks up a global organization first. Unknown, foreign, and inactive membership slugs return the same inaccessible/not-found behavior. The trusted `organizationId` comes from the resolved persisted membership.
- Every production invoice search and save Server Action independently authenticates and resolves the organization slug through membership, then checks `INVOICE_CREATE` or `INVOICE_EDIT_DRAFT`. Production actions accept no trusted organization ID, role, user ID, or membership ID from form/client state. Draft editing calls `updateFullDraftInvoice()` so header, items, and server-calculated totals update atomically.
- Production draft preview requires `INVOICE_EDIT_DRAFT`, scopes by the resolved membership organization, accepts no client organization ID, and performs only reads. It rejects non-DRAFT, numbered, or issued-at rows. The current active default template and current client record are explicitly presented as an unfrozen preview; preview does not assign a version or number.
- Production issue Server Actions independently require `INVOICE_ISSUE`, resolve tenant scope from active membership, and call `issueInvoice()` with only the trusted organization and route invoice ID. The service revalidates state and financial data under the invoice row lock; it allocates the permanent number and freezes client/template data atomically. Browser state cannot set status, date, number, snapshots, totals, template version, or organization.
- The issued invoice page and PDF Route Handler require `INVOICE_READ`. Both use `loadIssuedInvoiceDocument()` and render allowed issued/closed states from saved snapshots, persisted totals/items, and the invoice's frozen template version. A missing or invalid frozen version fails explicitly. PDF responses are attachments with `private, no-store`; renderer, template, HTML, CSS, filesystem paths, and invoice data are never supplied by the browser.
- `/app` lists only active organizations from the authenticated user's memberships. It does not persist an organization selection in a client cookie. `VIEWER` cannot use create or edit pages or their directly invoked actions.

## Financial integrity

- Calculate totals and assign invoice numbers on the server only. Never reuse an assigned invoice number.
- Draft creation and edits run through a server-only service scoped by organization. Client and service IDs are resolved within that tenant, inactive records are rejected, and caller-supplied lifecycle, numbering, snapshots, template binding, and financial totals are not accepted. Item billing mode is validated; quantity line totals and flat-fee line totals are computed from decimal inputs, with flat fees normalized to quantity `1` and unit price equal to amount.
- Invoice entry lookup functions require organization scope, select only fields needed by the form, filter inactive clients/services, bound search terms and result limits, and use parameterized Prisma query filters. The draft editing read model rejects non-DRAFT and cross-tenant invoices and returns no organization identifier.
- Draft mutation and issuance lock the invoice row in a transaction so an issuance cannot proceed from stale draft data while a concurrent edit is in progress. Item replacement and recalculated totals commit or roll back together.
- Invoice issuance loads records by authorized `organizationId` and invoice ID, accepts no browser-supplied totals, status, date, or invoice number, and commits the conditional DRAFT transition and sequence reservation in one PostgreSQL transaction. Callers must derive organization scope from trusted server-side authorization context.
- Issuance recalculates line totals, subtotal, and grand total, validates billing modes, quantities, prices, and discounts, and snapshots client details from the database. Flat-fee issuance requires quantity `1` and line total equal to stored unit price, and rejects inconsistent state before sequence reservation. Only DRAFT invoices may be issued; issued invoice dates and numbers are thereafter immutable.
- Payment recording accepts only positive amounts for organization-scoped ISSUED invoices. It inserts the payment and recalculates payment status from recorded payment rows while holding the invoice row lock in one transaction; caller-supplied payment status is not accepted.
- Supersession validates organization-scoped source and replacement states, then changes the source to SUPERSEDED and records REPLACED_BY relations atomically. It preserves source payment records and does not redistribute funds.
- Treat persisted line totals and invoice totals as non-authoritative inputs until computed or verified by server logic. The invoice schema stores them as decimal values; browser-supplied totals must never be trusted.
- Scope invoice, client, service, and invoice-item relations by organization. Composite foreign keys enforce tenant matching in the database.
- Validate state transitions and approval authority on the server.
- Issued financial data must not be silently edited; preserve changes and important actions through authorized, auditable workflows.
- AI output is non-authoritative and cannot determine totals, numbering, approval, or sending.

- Use the invoice's currency code as the sole authority for its amounts. Validate and uppercase exactly three ASCII letters before issue; never convert currencies or trust an ambiguous AI-inferred symbol such as `$`. Request clarification when currency cannot be determined safely.
## Invoice template security

- Template configuration is structured JSON presentation/branding data only. `rendererKey` selects a trusted application renderer; do not execute code from template data.
- PostgreSQL rejects UPDATE and DELETE on template versions; changes must create a new version, preserving historical configurations even when unreferenced.
- Issuance selects the active default template only within the supplied organization and validates its trusted renderer/config before reserving a number. A partial unique index prevents ambiguous active defaults; a tenant-safe composite foreign key prevents cross-organization version bindings.
- The invoice template version binding is written atomically with issuance. A database trigger requires a non-null binding for new DRAFT-to-ISSUED transitions and prevents changing or clearing it after issuance, including after supersession, voiding, or write-off. Existing historical/manual invoices may remain unbound.
- Issued-invoice rendering must load the renderer key and config through the invoice's frozen `templateVersionId`; it must not select the current default template.
- Issued invoice items carry their persisted `billingMode` into rendering. The trusted renderer hides canonical quantity `1` and unit price from flat-fee rows, using a simplified table for all-flat-fee invoices and neutral dashes for flat-fee rows in mixed invoices. Rendering never infers mode from monetary values.
- The server-only issued document loader scopes invoice access by `organizationId`, rejects DRAFT invoices, and validates the stored renderer key/config before rendering. It reads historical client snapshots and persisted financial values only; it never uses the current Client record. Missing frozen versions fail explicitly rather than falling back.
- The renderer registry maps only trusted application renderer keys and rejects unknown keys. The development preview uses static sample data, performs no database reads, and returns 404 in production.
- MVP1 does not support arbitrary user HTML/CSS uploads. Future SaaS custom templates require a separate security design covering sanitization and isolation before any such feature is implemented.

## PDF generation

- PDF creation runs server-side through the trusted renderer registry. Unknown renderer keys fail; template config is schema-validated and is never interpreted as executable content.
- The PDF service renders the same approved renderer tree and stylesheet used by browser preview. Invoice text is HTML-escaped, the letterhead is loaded from a fixed application asset, and no browser-supplied HTML, CSS, renderer key, or filesystem path is accepted.
- Headless Chromium JavaScript is disabled and all non-data requests are blocked, so rendering cannot fetch arbitrary URLs. The letterhead and four fixed application-controlled Fontsource DM Sans WOFF2 files are inlined as data URLs. The PDF service reads those fonts from fixed paths under `node_modules/@fontsource/dm-sans/files`; it accepts no font URL or filesystem path from request data.
- The development sample PDF route uses static sample data only and returns 404 in production. The production PDF route requires `INVOICE_READ`, resolves tenant scope from membership, and supplies `generateIssuedInvoicePdf()` with trusted server-side records only.
- `puppeteer-core` does not download or manage a browser. The executable path is trusted deployment configuration only; for example, set `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`. Production requires a configured executable, while development/test may resolve only fixed local Chrome/Edge paths. Never accept a binary path from request data.
- Run the application and Chromium as an appropriate non-root OS user with Chromium's sandbox usable. Do not disable the sandbox by default. If deployment requires different Chromium flags, decide that explicitly during deployment.
- DejaVu Serif retains its existing host font behavior. DM Sans is bundled through `@fontsource/dm-sans`; no font binaries are committed manually.

## Development invoice entry

- `/dev/invoices/new` and `/dev/invoices/[invoiceId]/edit` are available only outside production and return not-found in production. Their Server Actions repeat the environment guard because Server Actions can be invoked directly by POST requests.
- An isolated development helper upserts a fixed `hiiiive` organization plus deterministic sample client/service records. It is guarded against production use. No URL, query, form, hidden field, or client state can choose an organization. Search, draft loading, creation, and update always use this resolved ID.
- Search actions call `searchInvoiceClients()` and `searchInvoiceServices()`; the browser does not implement tenant search. Draft save whitelists editable form fields and calls `createDraftInvoice()`. The draft service validates tenant ownership and recalculates all persisted totals. The UI sends no status, invoice number, issue timestamp, template version, subtotal, grand total, or line total.
- Full invoice-form draft edits must use `updateFullDraftInvoice()` with organization scope from trusted server context. It locks the invoice row, validates the complete replacement form, and commits header/client/currency/discount/notes/payment terms, all replacement items, and recalculated totals in one transaction. The UI must not chain `updateDraftInvoice()` and `replaceDraftInvoiceItems()`. The targeted update services remain available for narrower internal workflows.
- These routes have no production invoice mutation API. Preview and Issue Invoice controls remain disabled in development-only forms. The development edit form loads only tenant-scoped, unissued DRAFT records and saves through the atomic `updateFullDraftInvoice()` service. Production operations are available only through the authenticated membership-checked workspace routes above.

## Secrets and delivery

- Never expose secrets, credentials, or privileged service keys in client code or client-visible responses.
- Send client invoice email only after server-side confirmation that the invoice is approved and issued.
- Log email attempts and support retries without duplicating invoice creation.

## Audit trail

Record immutable audit events for important invoice actions, including actor, timestamp, action, and relevant reason or metadata. Restrict access to internal notes and operational details to authorized users.


