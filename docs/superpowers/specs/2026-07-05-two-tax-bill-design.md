# Two-tax bill presentation + table-popup scroll fix — design (2026-07-05)

Owner request (2026-07-05, screenshots of manager panel on Aangan):
1. Printed bill splits the tax into CGST/SGST-style lines; on-screen bills keep ONE merged
   "GST 5%" line. Everything written on the printed bill must be editable from settings.
2. The live bill card (Bills → Live) must also show the tax % and amount, not just Total.
3. The floating table-detail popup (Tables view) cannot be scrolled.

## Core rule (owner agreed)

**One real tax rate, one total — the split is presentation-only.** The effective rate comes
from `lib/tax.ts` / `lfh_effective_tax_rate` (sum of `settings.tax_components`, else
`tax_rate`, else 5%). Screen shows the merged line; print itemises the components. The grand
total is byte-identical everywhere. We never let the printed amount diverge from the charged
amount.

## Decisions (AskUserQuestion, 2026-07-05)

- Tax split: **CGST + SGST, editable** — already exactly what `settings.tax_components`
  (mig 117) is; labels + rates editable, must sum to the total rate. No new tax model.
- Editable printed-bill parts: **header (name/address/phone/GSTIN), tax lines, footer
  message**. Header + tax lines already editable in Settings → Billing; footer is NEW.
- Where editable: **manager Settings → Billing** (existing section, admin reaches it via
  admin view; gated by the existing `edit_settings` manager power).

## Changes

### 1. Live bill cards show Subtotal + merged GST line
`public/panels/editor/app.js`:
- `orderCardHtml` (~:1269): add `Subtotal` and `GST <pct>% <amt>` rows above Total using the
  stored `o.subtotal` / `o.tax` (orders columns written by mig 119 RPCs). Hide GST row when
  tax is 0. Keep the existing discount handling/total math unchanged.
- `mergedOrderCardHtml` (~:1392): same two rows from `billMath(g)` (`m.subtotal`, `m.tax`,
  `m.rate`), matching the bill-popup's presentation.

### 2. Printed bill footer becomes editable
- New additive migration: `settings.bill_footer text` (nullable). No backfill needed —
  `printBill` falls back to the current default (restaurant #1 keeps its "Merci" behaviour).
- `printBill` (~:2134): render `settings.bill_footer` when set; existing per-component tax
  itemisation (with 50/50 CGST/SGST fallback) stays as-is.
- Settings → Billing UI (~:1059): add a "Bill footer message" input bound to `bill_footer`.
- `app/api/editor/[...path]/route.ts` settings sanitizer (~:986): accept `bill_footer`,
  trim + cap length (200 chars).

### 3. Floating table popup scroll fix
`public/panels/editor/style.css` (~:1304): `.tp-detail-floating` has `height:auto` +
`max-height:calc(100vh - 92px)` while the child `.tp-detail` asks `height:100%` — a
percentage against an auto-height parent collapses, so `.tp-detail-body`'s `flex:1;
overflow-y:auto` never gets a bounded height and `.tp-detail { overflow:hidden }` clips
instead of scrolling. Fix: make `.tp-detail-floating` a flex column (`display:flex;
flex-direction:column`) so the card is bounded by the max-height cap. Docked (`.floor-side`)
and collapsed-modal (`.tbl-modal`) variants already scroll — untouched. ≤1040px static mode
untouched.

## Non-goals
- No second independent tax rate (rejected: printed total would diverge from charged total).
- No admin-console duplicate of these settings (owner chose manager Settings only).
- No "extra lines" (FSSAI etc.) on the print — owner didn't select it.

## Verification
Browser (Chrome MCP), Aangan restaurant, desktop + ~390px:
- Live card shows Subtotal / GST x% / Total; totals match the bill popup and the print.
- Print preview shows split CGST/SGST rows + the new footer text after editing it in
  Settings; restaurant #1 print unchanged.
- Floating table popup scrolls with a long KOT list; dock/modal variants still fine.
- `npm run lint` passes. Cache-bust app.js when verifying (it's served without a version
  query and iframes cache it).
