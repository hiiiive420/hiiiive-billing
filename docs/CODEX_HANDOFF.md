# Codex Handoff

- **Task ID:** INV-007A — Lock Hiiiive Invoice Number Convention
- **Status:** Complete

## Summary

Documented the confirmed Hiiiive MVP invoice number convention. No schema, migration, package, or application code changes were made.

## Files changed

- `docs/BUSINESS-RULES.md`
- `docs/DATABASE.md`
- `docs/CODEX_HANDOFF.md`

## Confirmed convention

- Format: `I` + `YYYYMMDD` + issued sequence, with no separators (example: `I2026100922`).
- The date is the invoice date locked at issuance, or the Asia/Colombo local date if no invoice date is present.
- One organization-wide monotonically increasing sequence is used; it does not reset by day, month, or year.
- Drafts consume no number. A number is assigned only on issuance and never reused, including after VOID, SUPERSEDED, or WRITTEN_OFF.
- Issued `invoiceDate` and `invoiceNumber` are immutable.
- Future SaaS may support configurable numbering formats; Hiiiive MVP uses this format.

## Scope

Documentation only. Invoice issuing, sequence allocation, and application enforcement of immutability remain future work.
