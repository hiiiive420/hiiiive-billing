# Architecture

## Repository and initialized stack

The repository has a minimal Next.js App Router foundation under `src/app`. The initialized stack is **Next.js 16.4.2 + React 19.3.1 + TypeScript 5.9.3 (strict) + Tailwind CSS 4.3.3 + ESLint 9.39.5**, managed with npm and Node.js 24 (`engines.node: ">=24 <25"`). The package lock records the resolved dependency tree.

PostgreSQL access is configured with **Prisma ORM 7.10.1**, `@prisma/client`, the `@prisma/adapter-pg` driver adapter, and `pg`. Local development uses the locally installed native PostgreSQL server. The schema is at `prisma/schema.prisma`; the generated client is at `src/generated/prisma` and is regenerated with `npm run prisma:generate`. The schema implements Organization, Client, ClientContact, and Service. The initial migration is `20261020151624_init_master_data`.

The production database strategy remains undecided until deployment. The server-only reusable client is exposed through `getPrismaClient()` in `src/lib/prisma.ts`. It is initialized lazily when called, checks for `DATABASE_URL`, and does not connect during module import. Store the URL only in the server environment or an ignored `.env` file; never expose it to client code. `.env.example` contains only an empty `DATABASE_URL=` placeholder.

Invoice issuance is implemented in the server-only domain module `src/lib/invoices/issue-invoice.ts`. It loads and validates a draft within its organization, recalculates line and invoice totals, snapshots current client details, reserves the organization's next number atomically, and commits the invoice and sequence update in one PostgreSQL transaction. Future server actions or API handlers must supply organization scope from trusted authorization context.

Payment recording and invoice supersession are implemented in `src/lib/invoices/record-payment.ts` and `src/lib/invoices/rework-invoice.ts`. Both are server-only transaction services with PostgreSQL integration coverage. Payment records and replacement relations preserve financial history; supersession does not transfer or reverse payments.

Invoice template identities and immutable versions are represented in the database. Invoices may reference the exact template version used, while existing invoices retain a nullable reference. The trusted renderer registry maps known keys such as `hiiiive-default` to application components and rejects unknown keys. The Hiiiive renderer validates structured configuration and formats decimal strings without recalculating accounting values. Preview and PDF HTML are generated from the same renderer tree and share `src/app/invoice-print.css`; the PDF service prints that output through headless Chromium on A4. The development sample PDF download uses static data only, performs no database reads, and returns 404 in production. Current PDF output is constrained to one page.

Server-side PDF generation is isolated in `src/lib/invoice-templates/generate-pdf.ts` and uses `puppeteer-core`, which does not download or manage Chromium. Production must install Chromium and configure `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` (or the installed executable's absolute path). Run the application as a non-root OS user with Chromium's sandbox usable. DM Sans weights 400, 500, 600, and 700 come from `@fontsource/dm-sans`: the browser preview loads the corresponding bundled weight styles, and PDF HTML embeds the matching fixed Latin WOFF2 files as data URLs. DejaVu Serif continues using the existing host font behavior.

The application has a neutral `Hiiiive Billing` placeholder home page and root layout, plus the development-only invoice preview route.

## Architectural guardrails

- MVP1 serves one organization, Hiiiive. Model organization ownership with `organizationId` so future multi-tenant SaaS use is possible.
- Enforce authentication, authorization, and organization scoping on the server. Every organization-owned lookup and mutation must be scoped to the authorized organization.
- Keep financial calculations, invoice number allocation, approval transitions, and email-send authorization in deterministic server-side code. AI may assist with non-authoritative tasks but never controls these operations.
- Treat issued financial data as immutable. Represent payments and corrections as linked records/events; preserve history.
- Make recurring draft generation idempotent. Separate invoice creation from retryable email delivery.
- Record important actions in immutable audit events.

## Main conceptual flow

A recurring template or an authorized user can create an editable draft. Internal approval and issuance are required before a client invoice can be emailed. Issuance assigns a never-reused invoice number. Payments, supersession/rework, voiding, and write-off are recorded through authorized, auditable transitions without silently rewriting issued financial data. See `BUSINESS-RULES.md` and `DATABASE.md`.


