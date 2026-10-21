# Codex Handoff

- **Task ID:** INV-011A — Hiiiive Invoice Visual Parity & Mobile Preview
- **Status:** Complete

## Summary

Refined the existing Hiiiive invoice renderer and mobile browser preview without changing the invoice content structure or adding PDF support.

## Files changed

- `src/lib/invoice-templates/config.ts`
- `src/lib/invoice-templates/hiiiive-default.tsx`
- `src/lib/invoice-templates/renderer.test.tsx`
- `src/app/dev/invoice-preview/invoice-preview-scale.tsx`
- `src/app/dev/invoice-preview/page.tsx`
- `src/app/globals.css`
- `docs/CODEX_HANDOFF.md`

## Visual and typography changes

- Darkened the invoice title and party headings; the title and Amount Payable row use DejaVu Serif. Project/date, party information, table headings/body, subtotal/discount, and notes use DM Sans with fallbacks.
- Item indices display as `1.`, `2.`, etc. The project line is omitted when no title exists. Currency values are plain amounts with separators and two display decimals; the final currency note remains.
- Discount rows remain hidden at zero. Totals use a narrower right-aligned block, Amount Payable retains Hiiiive blue with white text, and notes follow totals with natural spacing.
- The supplied letterhead remains the full-page background; no waves, logo, or footer were recreated.

## Mobile preview approach

The invoice remains a fixed 210 × 297 mm A4 sheet with unchanged columns. A client-side `ResizeObserver` scales the complete sheet proportionally to the available preview width. Print CSS removes that scale, preserves A4 dimensions, and hides the preview banner. The development-only route behavior is unchanged.

## Tests and checks

- `npm test` — 42 tests passed, including seven renderer/config tests for plain amount formatting, item numbering, absent project title, zero discount, renderer allowlisting/config validation, and financial-data immutability.
- `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run db:migrate:status` — passed; database schema is up to date.

## Blockers

The Word invoice source was not present in the workspace, so exact spacing parity against that file could not be independently verified. The requested refinements were applied to the existing A4 layout.
