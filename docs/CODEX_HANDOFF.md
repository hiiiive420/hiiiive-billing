# Codex Handoff

- **Task ID:** INV-012B — Deterministic DM Sans Loading for Preview & PDF
- **Status:** Complete

## Summary

Bundled DM Sans through `@fontsource/dm-sans` for weights 400, 500, 600, and 700. Browser preview imports only those four weight styles. PDF HTML reads the corresponding fixed Latin WOFF2 package files and embeds them as trusted `@font-face` data URLs, so PDF typography does not depend on an OS-installed DM Sans or external network access. DejaVu Serif behavior remains unchanged. The existing trusted invoice renderer remains shared by preview and PDF.

## Files changed

- `AGENTS.md` (Next.js 16 dev server generated its agent-rules block)
- `package.json`
- `package-lock.json`
- `src/app/globals.css`
- `src/app/invoice-print.css`
- `src/app/dev/invoice-preview/page.tsx`
- `src/app/dev/invoice-preview/pdf/route.ts`
- `src/lib/invoice-templates/dev-sample.ts`
- `src/lib/invoice-templates/hiiiive-default.tsx`
- `src/lib/invoice-templates/registry.tsx`
- `src/lib/invoice-templates/generate-pdf.ts`
- `src/lib/invoice-templates/generate-pdf-core.tsx`
- `src/lib/invoice-templates/browser-executable.ts`
- `src/lib/invoice-templates/generate-pdf.test.ts`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `src/lib/invoice-templates/renderer.test.tsx`
- `docs/CODEX_HANDOFF.md`

## PDF generation and security

- `hiiiive-default` now builds one trusted invoice tree for both React preview and the PDF HTML serializer. The renderer registry rejects unknown keys; template configuration is validated and user text is HTML-escaped.
- The PDF service embeds the shared `src/app/invoice-print.css` and fixed letterhead asset, disables browser JavaScript, blocks non-data network requests, and prints A4 portrait with zero margins and backgrounds. It rejects output that is not valid PDF data or is not one page.
- `/dev/invoice-preview/pdf` downloads the shared static sample as `Invoice-I2026101923.pdf`; it has no database dependency and returns 404 in production.
- `puppeteer-core` neither downloads nor manages Chromium. `PUPPETEER_EXECUTABLE_PATH` is trusted server configuration; production requires an absolute configured path, for example `/usr/bin/chromium`. Development/test resolve only fixed local Chrome/Edge locations when no path is configured.
- Chromium's sandbox remains enabled; no `--no-sandbox` flags are used. Production must run the application/browser as an appropriate non-root OS user with Chromium's sandbox usable. Any alternate flags require an explicit deployment decision.
- Production hosts still need DejaVu Serif for the existing heading typography. DM Sans is application-bundled. No font binaries were manually added to the repository.

## Tests and checks

- `npm test` — passed, 54 tests total including the focused font HTML test and the existing PDF signature/A4/one-page assertions.
- `npm run typecheck` — passed.
- `npm run db:migrate:status` — passed; database schema is up to date.
- `npm run lint` — passed after removing one unused variable.
- `npm run build` — passed; optimized production build completed.

## Blockers

Production runtime must configure an installed Chromium executable and usable sandbox under a non-root OS account. DejaVu Serif retains its prior host font requirement.
