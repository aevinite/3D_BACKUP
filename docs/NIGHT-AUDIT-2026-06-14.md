# Overnight bulletproof audit — 2026-06-14

Ran a 30-phase functional sweep + 4 deep audit agents (security, data-integrity,
competitive, RBAC). This is the full list: what I fixed, what needs your
permission, what I recommend, and what to build. Nothing in sections 🔴/🟠/🟡 was
changed without you — I left billing/auth logic for your approval since you were
asleep and this is a live money system.

---

## ✅ Already fixed tonight (done, committed, verified)
1. **Waiter-call spam hole (you approved).** The "call waiter" bell inserted
   straight into the DB, and an always-true rule let *anyone* with the public key
   flood staff with fake calls. Now it goes through a guarded function that
   refuses blocked tables, throttles repeats (6s), and caps pile-up (6/table); the
   open insert rule is removed. Verified: direct insert → blocked (401), bell →
   works, spam repeat → throttled. (commit `5fc0c28`, migration 050)
2. **ESLint build-cleanliness** — an apostrophe in the "Chef's Special" label.
   (commit `18ad63b`)

## ✅ Verified healthy (no action needed)
TypeScript 0 errors · production build passes · no secrets committed · admin gate
redirects correctly · money math server↔client to the cent (INR base) · 0 orphan
orders · every order has a KOT # · **zero console errors** on menu/item/editor/
kitchen/tablet · backend-only feature switches correctly off · the menu header /
filters / editor floor+log / device-block work (verified this week).

---

## 🔴 CRITICAL — needs your decision (the #1 thing)
**Your staff panels are open on the public internet.** `/api/editor`, `/api/tablet`,
`/api/kitchen` run on the all-powerful service key and have **no password check**
(only `/admin` is gated). Because the site is live at infiniteif.com, anyone who
finds the URL can, with no login, using plain web requests:
- **Mark any table's bill "paid" without taking money** (revenue fraud).
- **Download your entire customer list** — names + phone numbers + spend (PII breach).
- **Rewrite any dish's price** or delete dishes / wipe categories.
- **Mark dishes sold-out** (kill items off the live menu) or flip feature settings.

Your own note said "re-lock these before public hosting" — and it's now hosted.
**This is a launch-blocker.** I did NOT lock it because that changes your workflow
(staff would need the password to open editor/kitchen/tablet) and could lock you
out mid-test.

**Your call — reply with one:**
- **(A) Lock all three panels** behind the same staff password as admin (recommended; ~30 min, I reuse the existing gate). Staff log in once per device.
- **(B) Lock only the dangerous actions** (mark-paid, delete, price edit, customer-data, settings) and leave the read-only boards open.
- **(C) Leave open** (only OK if the site isn't really reachable / you accept the risk).

---

## 🟠 Logic & money bugs — recommend fixing (a couple need a decision)
1. **Discounted bills show the wrong tax.** A discount lowers the total, but the
   tax line is still computed on the *pre-discount* amount, so the printed bill /
   future GST invoice won't add up. **Decision needed:** should a discount apply
   *before* tax (tax on the reduced amount — standard) or after? Tell me and I'll
   make the bill + tax consistent.
2. **"Pay table" can settle a previous party's leftover bill.** The tablet's pay
   button marks *all* unpaid orders for that table number paid, ignoring which
   session is current. Rare (tables usually get freed), but a real correctness
   bug. Fix ready: scope payment to the table's current open session. *(I can do
   this on your OK — it touches billing, so I held it.)*
3. **My orphan-order fix over-reaches when "sessions" mode is OFF.** Migration 049
   auto-opens a session for every waiter order; if you ever run sessions-off
   (simple) mode, that flips tables into session semantics. Only matters if you
   use sessions-off. Fix ready: only auto-open when sessions are enabled.
4. **Price format split** — old orders store "550", new ones "550.00" (cosmetic,
   no money error). Low priority.
5. **Bill-number can skip a number** under two simultaneous "move order" taps
   (rare). Low priority.

## 🟡 Security hardening (lower urgency, after the 🔴 above)
- **Anyone can reassign any order to any table** (`set_order_table_number` is open
  to the public, unscoped). Recommend scoping to the guest's own session.
- **Customer-name leak:** the "recognise returning customer" lookup returns a
  person's *name* for any phone number entered (a privacy oracle). Recommend
  returning yes/no only.
- **Request spam:** the "ask to open/join a table" flow has a weak throttle;
  recommend a tighter cap.
- **OTP (currently OFF):** if you ever turn on phone verification, first remove the
  dev code from the response, add a send rate-limit, and lock out after N wrong
  tries — today it would be bypassable.
- **Minor DB hygiene:** 8 functions miss a `search_path` guard; 5 foreign keys lack
  an index (perf). I'm holding these only to avoid another duplicate-migration
  clash like the 048 one — say go and I'll batch them.
- **Auth hardening:** single shared staff password, 7-day cookie, non-constant-time
  compare. Fine for now; consider per-staff PINs (see RBAC below).

---

## 🧑‍🍳 Role-based access (who should see/do what) — proposal
Today everything shares ONE password and the tablet/kitchen/editor are wide open.
Proposed 5-role model (matches Petpooja/Posist norms):

| Action | Waiter | Kitchen | Cashier | Manager | Owner |
|---|---|---|---|---|---|
| Take orders / serve / call-attend | ✅ | — | ✅ | ✅ | view |
| Advance ticket / set sold-out | — | ✅ | partial | ✅ | — |
| Apply discount / void / comp | ⛔ PIN | — | PIN | ✅ | ✅ |
| Mark paid / reopen bill | ⛔ | — | ✅ | ✅ | ✅ |
| Free/close table · shift | PIN | — | ✅ | ✅ | ✅ |
| Edit dishes / **prices** | — | — | — | ✅ | — |
| **Dashboard revenue · customer PII** | ⛔ | ⛔ | ⛔ | ✅ | ✅ |
| Feature toggles / maintenance | — | — | — | — | ✅ |

"PIN" = needs a manager's 4-digit PIN on the spot (theft control). Key point:
**the waiter tablet and kitchen should NOT see the customer database or revenue
dashboard** — today they could (the APIs are open). Cheap phased rollout: tag each
device with a role (you already have a per-device id + action log), then add
per-staff PINs for the money actions. Enforce in the backend, never the UI.

---

## 🚀 Features competitors have that we don't (build order)
**Do first (the money/kitchen basics every Indian restaurant expects):**
1. **Thermal KOT/bill printing** (ESC/POS 58/80mm) — kitchens run on paper. (M)
2. **Real GST invoice** — CGST/SGST split, GSTIN, HSN, tax on discounted value. (M)
3. **UPI dynamic-QR pay-at-table** with auto-reconcile. (M)
4. **Split bill** (by guest/item/evenly) — our session model is a head-start. (S)
5. **Modifiers / variants / combos** (half-full, add-ons, mandatory groups). (M)
6. **Staff roles + manager PIN + void/discount audit** (theft control). (M)
7. **Cash drawer / shift X-Z reports** (opening float, over/short, who closed). (M)
8. **Inventory + recipe deduction** (auto stock decrement, low-stock alerts). (L)

**Later (scale/differentiation):** Swiggy/Zomato aggregator ingestion · loyalty/
points/coupons · WhatsApp campaigns on our CRM data · reservations + waitlist ·
multi-outlet/central kitchen · cost-vs-actual & menu-engineering analytics ·
offline mode · e-invoice (IRN).

**Where we already LEAD (keep):** 3D dish models · true 6-language menu · the
head/partner dining-session model with approval · allergy capture · per-device
operation logging. These are ahead of the mainstream Indian POS pack.

---

## The 60 audit areas covered (grouped)
Code (types, lint, build, deps, migration integrity, secret scan) · Backend
(advisors security+perf, money parity, order lifecycle, sessions, blocking,
counters, feature flags, oplog, RLS, RPC grants, SECURITY DEFINER surface, input
validation, injection, IDOR, PII oracles, OTP, request throttle, concurrency/races,
day-boundary, currency rounding, discount/tax, state machine, orphan orders, pay
scoping) · Frontend (menu browse/filters/search, frosted header/scroll, item page,
3D viewer+cache, cart, order+tracker+feedback, theme/lang/currency, responsive,
console errors, network errors) · Panels (editor CRUD/orders/floor/log, kitchen
KDS, tablet, admin) · Cross-cutting (auth/routing, cross-panel sync, RBAC/access
per role, competitive feature gaps). The deep agent audits (security, data, RBAC,
competitive) extended well beyond the original 30 functional checks.
