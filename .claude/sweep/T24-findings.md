# Sweep 6 · T24 findings — the money and safety libraries

Territory: `lib/clash.ts` · `lib/paySplit.ts` · `lib/tax.ts` · `lib/taxFiling.ts` ·
`lib/idempotency.ts` · `lib/idempotencyRule.ts` · `lib/logTrail.ts` · `lib/userAuth.ts` ·
`lib/rateLimit.ts` · `docs/COMPLIANCE-GUARDRAILS.md` · `docs/SAAS-EFFICIENCY-PLAYBOOK.md`.

500 phases (`LEDGER/T24.md`, P11501–P12000). **Five real problems, all fixed in this branch.**
Every one passed the four-test gate before a line of working code was touched.

---

## 1 · A settle that half-failed left the money trail claiming money nobody took — FIXED

- **Where:** manager panel → a table → Settle the bill → pay in parts (and the same drawer on the
  waiter tablet). Also admin → Bills, and the owner's payment mix, which read the same rows.
- **Who is worse off:** the owner and the manager. "How did table 6 pay?" answered
  "₹200 UPI + ₹200 Cash" for a bill still sitting there UNPAID, and the day's payment mix counted
  money that was never collected.
- **Reachable when:** the parts insert succeeds and the paid stamp that follows it fails — a DB blip
  between two writes with no transaction across them. The code already handled `upd.error`, so the
  author expected it; it just left the legs standing.
- **Confidence:** code-read. Severity: the money trail says something untrue.
- **Fix:** the insert now returns the leg ids, and a failed paid-stamp STAMPS them reversed
  (mig 285's rule — a money record is corrected, never deleted) before answering 500, so the person
  knows to retry and the trail never claims the settle happened.
- **Guarded by:** `verify:t24-money-rules` — four checks on the compensating reversal.

## 2 · The parts were checked as sent and stored rounded — two numbers for one settle — FIXED

- **Where:** same screen. The waiter sees nothing wrong; the difference shows up in the money trail.
- **Who is worse off:** the owner, reading a payment record whose parts do not add up to the bill
  they settled.
- **Reachable when:** a client sends an amount with more than two decimals. The ±2 paise gate was
  measured on the raw amounts, then each leg was rounded to the paise on the way into
  `session_payments` — so up to 6 paise of drift could pass the gate and be recorded.
- **Confidence:** code-read. Severity: small, but it is money and it is silent.
- **Fix:** each part is rounded ONCE, before the gate, and the same rounded parts feed the gate, the
  stored legs and the note. Every panel already sends whole rupees, so nothing normal moves.
- **Guarded by:** `verify:t24-money-rules`, plus the live round trip, which asserts the recorded
  parts add up to exactly the due that was accepted.

## 3 · A credit note issued from the console said it happened on a screen the console doesn't have — FIXED

- **Where:** admin console → Logs (and owner → Audit & logs) → open a row → the detail card's
  trail. The row read `… › Aevidine console › Orders & bills › Reopen the bill`.
- **Who is worse off:** the admin and the owner. "Reopen the bill" is a manager-panel button;
  "Orders & bills" is not a console area. The admin was on the console's **Bills** page.
- **Reachable when:** an admin issues a credit note, or deletes an order, from `/aevinite/bill-audit`.
  Those are the only two action codes written from BOTH the console and the manager panel, and one
  code could only have one home.
- **Confidence:** confirmed by reading both write sites and the page's own heading. Severity: the
  standing rule (owner, 2026-08-12) is that every row says where it happened; this one lied.
- **Fix:** `placeOf(action, panel?)` takes the panel, `trailOf` passes it, and a tiny explicit
  `PANEL_PLACE` maps those two codes to `Aevidine console › Bills` when the console did it. The
  manager panel's own rows are unchanged, and a caller that only holds the code still works.
- **Guarded by:** `verify:t24-money-rules` — fails if a THIRD dual-written code ever appears without
  a place, which is exactly how the last two were found by hand.

## 4 · The retention promise in the compliance doc guarded a superseded migration — FIXED

- **Where:** backend only, nothing on screen — `docs/COMPLIANCE-GUARDRAILS.md` §3, the retention
  paragraph, and the guard it names.
- **Who is worse off:** whoever next relies on it. The doc says the purge is "guarded by
  `verify:admin-restaurants`, which fails if migration 342 ever deletes a money table" — but the
  purge has been rewritten twice since (345, 346), and that guard only reads 342's text. So from
  345 onwards the promise printed in the doc was not the promise being enforced.
- **Reachable when:** any future rewrite of `admin_purge_restaurant`. Checked today: 346 (the one
  that ships) and the installed function both keep every money table, so nothing is wrong right now.
- **Confidence:** confirmed against the migrations and the installed function.
- **Fix:** the doc now names the live purge and its six rewrites, and `verify:t24-money-rules`
  asserts that the SHIPPING definition — and, with `--db`, the INSTALLED function — deletes no money
  table. `bill_chain`'s append-only trigger is named too.
- **Handoff:** `scripts/verify-admin-restaurants.mjs` should follow the newest purge definition
  instead of migration 342's text.

## 5 · The efficiency playbook sent people to redo work that was finished — FIXED

- **Where:** backend only, nothing on screen — `docs/SAAS-EFFICIENCY-PLAYBOOK.md` §5 and its banner.
- **Who is worse off:** the owner and any future session. Its **High** list still asked for a
  "pre-aggregated per-restaurant summary" to fix a "~147s freeze" that migration 190 closed (the
  function reads `orders_daily_agg`) and migration 266 scoped. Its "still open" list called the
  blocklist limits open (both capped), and pointed at "editor route ~505-511" for the allergen loop,
  which is now line 3440. Its own banner had said "three later lessons are NOT in this file yet"
  since 2026-08-04, while CLAUDE.md points here as "the full pattern".
- **Confidence:** confirmed line by line against the code.
- **Fix:** the three later lessons are now §0 of the playbook; the finished High items are marked
  done with the migrations that closed them; every "still open" item was re-checked and either
  ticked or given a correct line reference; §4 points at `docs/SECURITY-CHECKLIST.md`.
- **Guarded by:** `verify:t24-money-rules` — five doc-vs-code checks, including "§3a lists every live
  `revalidateTag(tag, { expire: 0 })` call site and there is no fourth".

---

## 🔗 HANDOFF — the real fix lives in someone else's file

1. **`app/api/owner/reports/route.ts` (~lines 430–440)** re-implements `lib/taxFiling.ts`'s
   `splitTax` inline: the same "round every line except the last, give the last the remainder" loop,
   with an identical `num()`/`p2()`. A money rule that exists twice is a money rule that drifts.
   **Change:** replace the loop with `splitTax(effective.map((c) => c.rate), totals.tax)`.
2. **`scripts/verify-admin-restaurants.mjs` (~line 281)** reads migration 342's TEXT to prove the
   purge deletes no money table. 345 and 346 have rewritten that function since. **Change:** resolve
   the highest-numbered migration defining `admin_purge_restaurant` (or read the installed
   definition) instead of naming 342.
3. **`app/api/panel-login/route.ts` (line 92), `app/api/owner/settings/route.ts` (248) and
   `app/api/panel-profile/route.ts` (207)** call `rateResetOnSuccess(key, subject)`. It now takes an
   optional third argument that scopes the reset to one restaurant. **Change:** pass the restaurant
   id where the caller has one. Nothing breaks without it — today's subjects already carry their own
   restaurant — but a future caller with a bare subject would clear another restaurant's wall.
4. **Manager panel header, dark skin** (`public/panels/editor/`): the restaurant name beside
   "Manager" is dark brown on a dark background and is barely legible. Seen at 1280×800 with
   `lfh_panel_theme=dark`; screenshot read, not inferred. Cosmetic, but it is the one word that tells
   a person which restaurant they are about to change.
