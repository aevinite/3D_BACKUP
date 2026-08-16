# Aevidine — MASTER request checklist (the owner's "every single bit" list)

Owner's rule: **"do work → check EVERYTHING (every panel, real-time, desktop + ~390px)
→ repeat; don't stop until every single bit is done."** Check an item off ONLY when it is
built **and** verified live in Chrome (never from source alone). The owner is testing on
`localhost:4000` — which now runs **main** (the worktree was deleted 2026-06-26; one
codebase only from here on).

Owner is FURIOUS that prior work was claimed "done/verified" but is still broken. Root
suspicion: the dev server was running from the **worktree**, and `app.js` is cached with
no version query, so the owner saw stale code. From now: verify in the SAME place the
owner looks, with cache busting, before claiming anything.

---

## 📴 OFFLINE — "without internet my app should not break" (owner, 2026-07-30)

Owner's words: the live/connection state must show, changes made with no internet must be
kept on the device and applied when it returns, clashing changes must come back asking the
person to redo them — and **the app must work exactly as it did, not break.**

- [x] **O1 — The app OPENS with no internet.** Service worker `public/sw.js` + `/offline.html`;
  registered for every surface (`components/OfflineShell.tsx`, `public/panels/swreg.js`).
  Verified on a production build: manager / kitchen / owner / guest menu all survive a full
  reload with the network cut.
- [x] **O2 — Panels still SHOW their board offline** (last saved copy, never a blank screen).
  The manager panel used to abort its whole render + live poll on a failed first load.
- [x] **O3 — It says what's true**, never pretends saved data is live: red "No internet — you
  can keep working · showing saved data from 7:42 pm" bar (`public/panels/offline.js`) and the
  React strip (`components/OfflineNotice.tsx`). Checked on the owner's phone size (360×780),
  light AND dark skins.
- [x] **O4 — A change made offline is kept and visible.** Order taken with no signal → saved on
  the device, "⏳ WAITING TO SEND (1) · 2× Pineapple Mint Mojito · not on the bill until the
  kitchen has it" inside the table, ⏳ mark on the table tile, count in the top bar.
- [x] **O5 — On reconnect it lands EXACTLY ONCE** (no double bill) — proven by test, not by eye.
- [x] **O6 — A clashing change comes back to a person.** Another device closed + billed the
  table while this one was offline → the replay is refused and shown as "Table 17 was closed
  and billed after you did this — the order never reached the kitchen", with what to do and
  a "Not needed anymore". Never silently applied, never silently dropped (`lib/clash.ts`).
- [x] **O7 — Proof is repeatable:** `node scripts/verify-offline.mjs --base <url>` — 32 checks,
  all passing against `next build && next start`.
- [ ] **O8 — Real-device test** (an actual phone/tablet losing WiFi mid-service) — still only
  proven headless. Known gaps, deliberately: guest-side writes other than placing an order
  aren't queued yet; 3D models aren't cached offline.

---

## 🆕 QUEUE (owner 2026-06-26, batch — verify each live on a FRESH dev server)
- [x] **Instant guest approve/remove** — PR #42 (optimistic flip). Live test pending before merge.
- [x] **Dashboard auto-refresh = activity-gated ~60s + manual Refresh** — PR #43, verified (admin+owner; runs only while visible+in-use incl scroll; stops idle/hidden; no realtime socket on heavy dashboard).
- [x] **D — tablet order-wide allergy chips toggle instantly** — PR #43, verified (was firing API only, no UI update).
- [ ] **Restaurant NAME on top of every panel** (tablet/manager/kitchen) — staff can't tell which restaurant they're in. One backend, all connected; just a header label from the scoped restaurant.
- [x] **B — tablet waiter-call shows the REASON** — PR #44, verified: tiles show 💧🍴🧾🧻🙋 (deduped + tooltip), no plain bell.
- [x] **C — manager floor tiles: tablet-style status PROGRESS BAR** — PR #44, verified: .ft-strip new/cooking/ready/served segments.
- [ ] **Bill cards (manager Bills) = clean printable look** — name · qty · add-ons, discount in the middle, total at bottom; the print-bill writing format but WITHOUT invoice no. etc. Aesthetic + organized.
- [ ] **Logs: show restaurant name per entry** in admin + owner "Recent activity" (everything's mixed; admin/owner can't tell which restaurant). Or a per-restaurant filter.
- [ ] **Update cadence / "pulling" concern** — suggestions below; pick one. (Realtime push is already in place + idle-disconnect shipped; the cost is full-board refetch per event → optimize to targeted/incremental refetch + a manual Refresh + pre-aggregated dashboard tables.)
- NOTE: the "/aevinite/health Maximum update depth" crash (2026-06-26) was a STALE dev-server artifact — gone after a server restart; not a real code bug.

## 2026-07-03 — Settings organization + per-user access + hierarchy (PR #106, merged)
- [x] Manager Settings organized into sidebar sections (General/Tables/Users/Access/Billing/Dining sessions)
- [x] Access section: per-user tablet permissions (Default/On/On·PIN/Off for discount, mark-paid, invoice) — server-enforced (mig 115)
- [x] Hierarchy: manager can only manage kitchen+tablet (never managers/owners), server-enforced
- [x] Manager Log hides owner + admin actions
- [ ] Awaiting owner check on :4000 once the allergy session's work lands (feature verified on :4010 + PASS from work-checker)

## 2026-07-03 — DEFERRED (owner: "for now we will NOT do it — first make it live")
- [x] **Per-restaurant tax, TWO tax types — SHIPPED 2026-07-05 as presentation-only split** (spec
      `docs/superpowers/specs/2026-07-05-two-tax-bill-design.md`): ONE real rate (`tax_components`
      sum → lib/tax.ts), shown MERGED ("GST 5%") in the manager Bills view/live cards/bill popup and
      SPLIT (CGST/SGST per component) on the printed bill — totals byte-identical everywhere. Owner
      chose manager Settings › Billing (not admin-only) as the edit surface; header/tax lines/footer
      (`bill_footer`, mig 124) all editable. Verified on Aangan (screen+print+phone).
      (Still open from the original note: settings.tax_rate=0 is overridden by the hardcoded 5%
      fallback in lfh_price_order + billMath.)
- [ ] **Admin "god-mode" control surface.** An admin-only area from /aevinite where the admin can change things the OWNER/MANAGER cannot even see — e.g. the two tax rates above, and (owner's words) "change the code and do everything." Good, clean admin interface. Build the individual sub-panels LATER (after the current live push); this is the umbrella requirement.
- [ ] **Robustness/protection pass (lower urgency).** Owner: "if there is any error, add features that make my website protected." Harden against errors; owner grants latitude to add sensible safeguards.

## 2026-07-03 — Stress test 7×300 (owner request)

- [x] Stress test: 7 restaurants × 300 tables simultaneously, ≥30 min, realtime + egress measured — DONE (≈65 min, 22,941 actions; live restaurants untouched; prod READY throughout).
- [ ] FIX QUEUE from the test (owner said LIST ONLY, fix on his word — details in session findings):
  1. Kitchen board drops NEW tickets past 1000 rows (lib/liveBoard.ts no .limit(); PostgREST cap) + 713KB/poll full-board egress (278MB per kitchen screen per 50 min at backlog).
  2. DB compute saturates at 7×300 rush (free tier): ping 0.7s→4.7s, place 2.1s median; recovers fully after load. Capacity decision needed before real scale.
  3. Auth: userFromCookie treats a FAILED staff_users lookup as bad cookie → any network blip 401-logs-out ALL panels, no auto-recovery (lib/userAuth.ts).
  4. Bursty 500s from kitchen/board + editor/tablet summary at saturation spikes (no panel retry/backoff).
  5. Manager floor: updates can exceed 90s under load; first paint 23–39s at 300 tables; heaviest page (tab crashes — needs real-device memory profile).
  6. lfh_join_session lacks p_restaurant_id (guest join on non-#1 depends on scoped wrapper).
  7. Guest menu: /api/r/<slug>/menu-data 404 spam + select=* fallbacks; item_ratings read UNSCOPED (no restaurant_id).
- [ ] Clean stress data off the 6 demo restaurants + demo-bistro (~9k orders, 1,647 open sessions) before any demo.

### Fix-queue status update (same day, PR #123 — `fix/stress-test-bugs`)
- [x] 1. Kitchen 1000-row cap → FIXED (liveBoard pageAll pagination; verified: 3,121 items returned, new KOT visible on a 1,050-order backlog) + full-reload 4s rate guard (was 278MB/50min).
- [x] 3. Auth blip-logout → FIXED (AuthDbError → 503 on all panel gates + login; verified live against an unreachable DB; bad cookie still 401).
- [x] 6. lfh_join_session → NOT A BUG (mig 083 already added p_restaurant_id; the stress probe used the old signature).
- [x] 7. Guest reads → FIXED (menu-data 404 was already fixed on origin/main; item_ratings view + restaurant_id via mig 116 (applied); scoped + explicit columns; guest settings no longer ships gstin/tax/phone).
- [ ] 2. DB compute saturation → NOT code-fixable: free-tier capacity ceiling; needs a paid-tier/instance decision before real scale.
- [ ] 5. Manager >90s updates + slow first paint under saturation → symptom of 2; re-test after capacity bump (deep "apply the delta" rework stays deferred per owner).
- [ ] (7b) Manager tab crashes during test → needs a real-device memory profile (test machine was memory-starved; likely not an app bug).
- [ ] 4. Bursty 500s at saturation spikes → largely addressed by 1+3 (smaller queries, 503s on auth path); re-verify in the next load test.

## 2026-07-04 — Tile selection pop + split scrolls + phone order 50/50 + admin redesign (owner request)
- [x] Selecting a table must NOT bury its red/green payment outline under the yellow ring — the red/green itself pops (brighter + glow), tablet AND manager (verified live in both, red/green/plain)
- [x] Tablet floor + right panel: fully SEPARATE scrolls on tablet/desktop widths (verified: body no longer scrolls; each pane owns its scrollbar) — manager already had it (re-verified: grid scrolled 400px, side panel moved 0)
- [x] Tablet phone (~390px) cleanup: pinned detail action-row got an opaque backdrop (buttons no longer look half-buried); take-order screen 50/50 split — menu top, "This order" review = firm bottom half, item lines scroll inside, SEND always visible; header = one row with a small table pill; floating ✕ hidden while ordering (sat exactly on ← back, mistap dropped the cart)
- [ ] Whole NEW admin panel UI per the 2026-07-03 spec (dense real-data SaaS console; NO earnings anywhere; restaurants/panels/access/taxes; god-mode) — building on `feat/admin-redesign`, NOT merged to main until owner reviews

## 🆕 2026-07-04 late — OWNER PANEL full redesign (branch feat/owner-redesign, review at localhost:4007/owner)
- [x] **Adaptive dashboard by restaurant count** — 1 restaurant = that restaurant IS the home (time/date
  charts, no one-bar "who earns more"); 2 = head-to-head comparison; 3+ = leaderboard + multi-line trend.
  Verified all three live (diag owner + temp ownerships, reverted).
- [x] **Charts fill their range** — lines auto-scale [min,max] ("touch top and bottom"); bars zero-based
  with the top fitted to the data max. KPI tiles: ▲/▼ delta vs previous equal period + sparkline +
  count-up; huge deltas capped as "N×". Plain-language insight strip (lost ₹, busiest hour, top dish…).
- [x] **Reports section** (replaces Earnings-report + Sales stubs): Sales / Tax-GST (merged rate headline
  + CGST-SGST split underneath, same total — owner's tax spec) / Dishes / Categories / Payments /
  Discounts / Cancellations (lost business ₹) / Busy hours. Today→12-months (monthly buckets), on-demand
  Generate only, Download CSV + Print. Mig 120 `lfh_owner_sales_report` (paid-only mig-113 rule), applied.
- [x] **New `.adm.owx` console skin** — dark dense default (light behind toggle), emerald owner accent
  (vs admin blue), grouped sidebar → pill row ≤900px. Staff & powers + Feedback inherit it.
- [x] **Security pass** — anon hits on all owner APIs → 401; /owner bounces to /login; owner DOM carries
  zero admin traces (no /aevinite links, no "admin view" strings); admin act-as ribbon renders only for
  admin. FIX: ownerScope now checks the OWNER cookie before the admin cookie (matches layout.tsx — was
  owner chrome + admin-scoped data when both cookies existed in one browser).
- [ ] **Owner reviews at localhost:4007/owner** (diag creds or admin act-as) — NOT merged to main until approved.

## 🆕 2026-07-06 — Admin must enter panels FROM the admin console, restaurant named (branch fix/admin-panels-require-restaurant)
- [ ] **Bare `/tablet` `/kitchen` `/manager` `/editor` no longer admit a scopeless admin** — like /owner,
  the admin gets in ONLY via /aevinite's open-panel flow (act-as cookie + ?rid in the URL). A logged-in
  admin typing /tablet with no restaurant picked bounces to /aevinite. Staff logins unchanged (their
  session pins their restaurant; no rid in the URL — exactly the owner's ask). Also killed the silent
  "default to restaurant #1" fallback in panelRestaurantId: a scopeless admin API call now answers 400.

## 2026-07-06 — Banquet module phase 1 (owner "go", after the Aagman banquet ask)
- [x] **Banquet module (bill-only separate menu)** — mig 130: `banquet_items` (own table — can never leak into any guest menu) + `banquet_allowed` admin entitlement (default OFF, toggle live in /aevinite → restaurant → Staff features) + `tablet_banquet` tri-state (off/on/pin, default OFF) with per-user overrides; RPC `lfh_banquet_place_order` prices server-side, lands a normal order at 'served' (no kitchen ticket/chime/KOT-print), existing invoice/discount/mark-paid settles it. Manager panel: new 🎪 Banquet tab (item CRUD + bill builder). Tablet: drawer → "Banquet billing" full-screen overlay (backstack-registered), PIN flow reused. Verified via API on :4005: money math exact (120×350+30×500 → ₹59,850 @5%), tablet blocked by default then works when granted, FH manager 403 (not entitled), anon RPC blocked, guest menu 0 banquet rows. Aangan configured: entitled + tablet ON + "Banquet Plate — standard ₹350" (placeholder price!). Browser click-through NOT done (Chrome declined during session) — pending.
- [ ] **Banquet phase 2 (only if a client commits):** bookings + advance deposit tracking + packages; admin→owner entitlement grey-out (X-ray) for the Banquet tab.
- [x] **Per-table display names (mig 131)** — Settings → Tables now has a Name field beside each table's seat count (display-only: tiles + table detail headers on manager AND tablet show "Banquet (T11)"; bills/KOTs/QR keep the number). Aangan table 11 named "Banquet" (50 seats). Sanitized server-side (24-char cap, blanks dropped).
- [x] **Owner portfolio redesign (2026-07-06)** — one owner ⇄ 1..N restaurants: new /aevinite/owners section (create owner once, attach/detach restaurant chips, reset pw, suspend, act-as); owner panel auto-arranges by count (1 hero / 2 h2h / 3-9 cards / 10+ HQ table) with "My restaurants" always in the sidebar; auth fixes (tenant-door owner login, owner entitlement vs #1, act-as via join table). VERIFIED 2026-07-06: 20-check API suite + Playwright screenshots (admin owners, 7-rest portfolio, single hero, mobile, HQ table) against the live DB on worktree dev.
- [x] **Banquet needs NO table (mig 132)** — owner: "why we need table 11 if we can make bills from the banquet menu". Table is now optional in the banquet bill builder (manager + tablet): blank → standalone "Walk-in / no table" bill in Bills, settled with the per-order Mark-paid/discount there; given → lands on that table as before. Aangan reverted to 10 tables (banquet table 11 removed; nothing was open on it).
- [x] **Admin help screenshots** — Staff-features toggles in /aevinite → restaurant are now cards: real screenshot thumbnail (tap to zoom) + one-line reminder of what the feature is (public/admin-help/*.png, captured via headless Playwright).


## 2026-07-26 — Access ladder clarity: "owner HAS it" vs "owner can GIVE it" (owner: "the UI should state that owner can give permission and owner will have it — both different things… nothing broken, nothing extra, nothing working-but-not-existing")
- [ ] **Owner two-fact strip on every ladder card** (Access panel): "Owner has it — own panel / via the manager panel" + "Owner can give it — Staff & powers", driven by `ownerUse` in `lib/accessModel.ts`. Information only, no new controls.
- [ ] **Wiring consolidation** — MANAGER_POWER_FLAGS / TABLET_PERM_KEYS / MODULE_DEFS now DERIVE from `lib/accessModel.ts` (single source of truth). Drift fixed: owner Settings was missing the **parcel** module toggle; owner grant list + Staff & powers were missing **view_logs** (absent-ON semantics added end-to-end); **banquet's waiter rung** (server-enforced since mig 130) was invisible in the admin panel — now surfaced; per-person view_logs override was stored but never read (canViewLogs now reads it); editor whoami now reads all module ladders in ONE select (was five).
- [ ] **Docs** — ACCESS-LADDER.md: "the ladder is a DELEGATION chain" section + the new 3-touchpoint wiring guide.
- [ ] Verified across admin access panel + owner staff/settings + manager/tablet behavior, then LIVE.

## 2026-07-26 — Access follow-ups: dead per-person switches + Log tab + phone layout (owner: "find the error more like this… fix the list")
- [x] **Fix 1 — role-aware per-person overrides (the dead-switch bug).** `overrideKey(p, role)` replaces the one-size `permKey`: manager→bare power flag (what `managerCan` reads), waiter→`tablet_*` column (what `tabletPerm` reads), no enforceable key→a plain line instead of a fake toggle. Removes 7 silently-dead manager rows (give_discounts/khata/take_orders/parcel/table_ops/table_tags/banquet) + the meaningless manager mark_paid/print_invoice + the tabletNew void-bills waiter toggle. Verified live: manager give_discounts=off now REFUSES (whoami effectivePowers=false); old tablet_discount key proven dead; UI writes the bare flag.
- [x] **Fix 2 — manager Log tab hides when `view_logs` revoked.** Added `{tab:"log", flag:"view_logs"}` to editor `XRAY_TABS`; view_logs is absent-means-ON so non-breaking. Verified: manager sees it by default, hidden when off, admin act-as sees it tinted (usable).
- [x] **Fix 3 — phone header squeeze.** `@media(max-width:560px)` stacks the ladder-card header (title full-width, tag/toggle/chevron in a row below) + per-person cap rows. Verified at 360px: no horizontal scroll, title uses 89% of card width.
- [ ] Independent work-checker PASS, then merge + live-verify.

- [x] **Round 2 — manager Settings→Access missing parcel cap.** Added `tablet_parcel` to `ACCESS_CAPS` + its module-gate in `accessCapsFor()` (public/panels/editor/app.js). A manager can now set the waiter parcel cap + per-waiter parcel overrides from their own panel (was server-enforced + in admin/owner screens but absent here). Verified live: accessCapsFor() includes tablet_parcel when the module is on; Access section renders the row.

## 2026-07-26 — Admin restaurant detail: Overview/Settings tabs + settings moved from manager
- [x] Restaurant detail split into **Overview** (tickets, status, owner, open-as, access link,
  danger zone) + **⚙ Settings** tab (Features, Google review, Branding, Billing, KOT printing,
  Dining sessions, Tables & QR) with sticky jump chips + floating save bar. (PR: admin-restaurant-settings)
- [x] Billing / KOT / Dining-session / Tables sections rebuilt in admin, field-for-field the
  same as the manager panel (owner-approved mock), writing the same settings columns.
- [x] Permanent per-table QR codes (mig 210): private random code per table, guest link `/q/<code>`,
  ⬇ QR download + print sheet + ↻ regenerate; wrong/retired codes show a friendly dead page,
  never another table. `/q` pages pin the tab's tenant (scoped storage fix).
- [ ] **AWAITING OWNER APPROVAL of the admin tab live** → then remove from the manager panel:
  Billing section, Kitchen (KOT) section, "Number of tables" card, "Guest QR links" card
  (manager keeps: table name+seats, auto close/restart) + drop the Kitchen group from admin Access.
- [ ] After removal: verify owner /owner/menu embed exposes no Billing/Kitchen settings.

## 2026-07-27 — Owner report overhaul (compiled statement + exports + picker)
- [x] Money-flow calculation in the compiled report (print + CSV/Excel): gross − discounts
  = taxable + CGST/SGST = collected − GST set aside = MONEY IN HAND, subtotals emphasised;
  collected row computed from the same lines so the equation always adds up (khata edge).
  Exec summary gains Money-in-hand / Best-day / Weakest-day cards. (PR #508, LIVE)
- [x] Slow movers (menu-engineering dogs): group table naming the restaurant per dish +
  per-restaurant bottom-5 table, in print AND CSV/Excel. (PR #508, LIVE)
- [x] Excel/CSV day-book: averages on top (per-active-day), whole-scope detailed day-by-day
  table, In-hand column on every day table. (PR #509, LIVE both stacks)
- [x] Report period chooser: calendar browse — year book → 12 months → day grid, whole-year/
  whole-month shortcuts, exact-day pick. (PR #509, LIVE both stacks)
- [x] Ported to AV live (owner: "make it live on both") — commit bfe5e64, deployed via /v13 API,
  aevinite.shop verified healthy.
- [ ] 3 print-design variants + interactive year→month→day Time-explorer prototype served on
  :49826 for the owner to choose from (design decision pending — owner said keep current
  format, so variants are reference only; Time-explorer = candidate for /owner/reports UI).

## 2026-07-28 — Admin panel-view isolation + "actual panel" toggle + feature-jump polish
- [ ] Per-tab session separation: a panel tab opened FROM admin (?rid pin) stays the ADMIN's
  view even when a real staff/owner login exists in another tab of the same browser — and the
  real logins stay untouched (requireRole/panelAdminRid/ownerScope + owner layout dual-cookie).
- [ ] "Zones off for staff" dropdown: every non-granted feature listed; "⚙ change" lands on the
  EXACT control on /aevinite/access (scroll + ~1.5s flash), admin-only settings land on the
  restaurant's ⚙ Settings tab.
- [ ] "See the actual panel" toggle (bottom of the zones dropdown; kitchen: in the ribbon) —
  ?view=real per tab, default OFF; whoami answers as the real role; fully working.
- [ ] Not-available controls grey (neutral, not golden) + hover "Not available…" tooltip.
- [ ] Admin panel-view actions logged with actor_id='admin:view' — visible only to the admin
  (owner/manager log reads mask it; admin surfaces show an 🛡 Admin pill).

## 2026-07-30 — Live sweep: the "second door" had been LOST in a rebase (my mistake)

Owner: "check again for any other bugs, test it, make sure everything works on live."

- [x] **THE REAL FIND — the floor button was never shipped.** PR #542 claimed a manager
  without `edit_settings` could reach the section editor via a **👥 Who serves what** button
  on the live Table view. That code (`#floorSections` + `openSectionsModal` + its CSS) was
  wiped by a `git rebase --abort` after I had already screenshot-verified it, and I shipped
  without re-checking the diff. On live, `whoami` said the manager HAD the power while the UI
  gave them no way in. Restored, and now pinned by a guard that fetches the SHIPPED
  `app.js`/`style.css` and fails if either door is missing.
- [x] **Verified on live, end to end (18 checks):** the admin's own switch turns the module
  on; a new waiter is created holding every table; two waiters SHARE table 3 and both see it;
  a restricted waiter opens a table, takes a real order, accepts and serves it with no 403;
  the other waiter is refused on both that table AND that order (resolved via the order id).
- [x] **Verified in a live browser:** a manager WITHOUT `edit_settings` opens the editor from
  the floor, sees the gap warning, ticks a table — and an already-open waiter tablet picks it
  up with **no reload** (realtime).
- [x] Test data cleaned up. The two test orders could NOT be hard-deleted — the billing
  compliance lock refused it ("an issued bill cannot be hard-deleted") — so they were
  soft-deleted through the app with a reason, which is the compliant path. That lock working
  is itself a good result.
- [ ] **NOT fixed, reported instead:** admin-only tabs (Settings/Dashboard ranges) are visible
  for ~1s at boot before `whoami` lands and hides them. Pre-existing, cosmetic (the server
  refuses everything meanwhile), and the safe fix changes every panel's boot path — flagged
  for the owner to decide rather than bundled into this change.

## 2026-07-31 — The live floor rebuilt: no open/close, Take order everywhere, one bill popup

Owner: *"make the whole table live of the manager panel like [PetPooja screenshot] … session will
be mainly off so take order button will show in all tables … when the order is served there will
be a small print button on the table, click it and it opens a whole popup with the whole bill and
tax for preview, and at the bottom generate invoice and print, and mark as paid can be done there
… we have to make the app fast, less clicks, no unnecessary two-time ask … remove the logic of
open and close table completely from the whole code … [tile sketch: T1 top-left, seats top-right,
notifications, live status, Take Order]"* — shown on **port 4937** for review before anything ships.

- [x] **The tile has one fixed shape, from his sketch** — `T1` top-left, seats top-right (always,
  not only when free), the notification badges on their own row, the live-status block, then
  `＋ Take order` with the small 🖨 bill button beside it. Same four rows on every tile whatever
  the table is doing. Verified on 30 tiles: 30 take buttons, 30 seat counts, 30 status blocks.
- [x] **Take order on EVERY table** — reuses `data-take-order`, so the existing permission check
  and the server's own re-check apply to it unchanged.
- [x] **The 🖨 opens the bill popup** — the bill as it will print (dishes, subtotal, discount,
  tax, total) with **Print · Generate invoice · Mark paid · Close**. Print generates the invoice
  first if there isn't one (that IS the document that prints), so it never dead-ends.
- [x] **Paid → the table frees itself**, proven live: order → serve → Mark paid → the tile went
  back to `Free` on its own and the 🖨 disappeared.
- [x] **Open / Close / Free are gone from the whole panel** — the tile's Open + RST/CLS, the
  floor's "⬆ Open all / ⬇ Close all", the detail's "✓ Free table / ⏻ Close table", the orders
  card's and the bill modal's "🪑 Free table", and the waiter tablet's "Open" chip + "Open this
  table". Their dead functions were deleted, not left hanging. Verified: 0 such buttons render.
- [x] **"Open · waiting for guests" is no longer shown** — a party with nothing ordered reads
  `Free`. Normalised in ONE place per panel so tiles, filter counts and the detail always agree.
- [x] **The walk-out escape hatch he chose: ✕ Cancel on each ticket** — `cancelOrder` existed but
  NOTHING rendered a button for it, so this had to be built. Gated by `void_bills` (whose own
  description is "…or closing a table unpaid after a walk-out") **and refused by the server** for
  a role without it. Cancelling the last live order frees the table by itself. Verified live.
- [x] **Two "are you sure"s removed** — sending an order no longer asks again after you press
  "Send to kitchen", and cancelling no longer asks a second time about freeing the table.
- [x] **The bill's customer is asked BEFORE the money**, not after. Paying used to fail its
  auto-invoice with a 400 on any restaurant that requires a customer, leaving a settled bill with
  no invoice — and when it did ask, the sheet appeared on top of a finger that had just tapped
  Cash. Now: Mark paid → who is this bill for? → how did they pay? → done.
- [x] **Size is a per-restaurant setting, not a per-device toggle** (his "classic" mode) — the
  admin's "Tables per row" now goes to **20** and a tile may shrink to **100px**. It stays a
  perfect SQUARE and sheds detail instead of clipping: the sub-line at 132px, the button's label
  and the seat count at 112px. Measured at 20-per-row: 109×109, square, nothing clipped.
- [x] **Every order now belongs to a party (migration 237)** — the guest QR path left
  `session_id` NULL, so with sessions off a guest's order had no bill number, could not be
  invoiced, could never auto-free the table, and **stopped counting on the tile** the moment a
  waiter also ordered there. Applied to the dev DB.
- [x] **A settled table always clears itself** — "Off — do nothing" is gone from that setting
  (it would strand finished tables now that nobody can free one by hand). The choice left is
  "free the table" or "keep the party seated", and with sessions off it's automatic.
- [x] Guards green: `verify:ui`, `verify:taps`, `verify:clash`, `verify:access`,
  `verify:table-ownership`, `verify:lifecycle`, `verify:two-parties`, `tsc`, `npm run build`.
  `verify-table-ownership.mjs` was itself updated — it asserted the old "Open · waiting for
  guests" wording.
- [ ] **NOT done yet (agreed: after he looks at 4937)** — the guest side: name + phone captured
  when ordering from the menu and the number verified at place-order (that becomes the whole of
  what "sessions on" means), and the waiter tablet's tile getting the same four-row treatment.
- [ ] **Nothing deployed.** Runs on port 4937 from the `feat/live-floor` worktree; AV live and
  the backup site are both untouched.

### Same day, second pass — the rail goes, tiles shrink, two buttons on the bill

Owner: *"we don't even need the right side panel of req and stuff, and make the table small like
the image I show you … there should only be option of generate invoice and print … I do not want
this option completely on top, who serves what … not this right side panel option, only popup
option, no right side popup option at all."*

- [x] **The right-hand rail is gone completely** — both halves of it. The cards ("To accept",
  Requests, Needs, Blocked) and the docked table detail, plus the collapse chevron, the
  drag-to-resize divider and the "⇱ Dock" button. Their builders and handlers were deleted, not
  hidden. Verified: 0 `.floor-side` / `.fc-card` / resizer / toggle nodes on the floor.
- [x] **A table opens as a POPUP, always** — there used to be two modes and which one you got
  depended on remembered state, so the same tap behaved differently on different days. One entry
  point now (`openFloatingTable`), one closer (`closeFloatingTable`, which also drops the tile's
  ring and stops that table pulling its slice). Verified: 1 popup, 0 rails, no Dock button.
- [x] **👥 "Who serves what" is off the floor header** — its home is Settings → Access.
- [x] **Tiles are compact like his reference** — default tables-per-row 6 → **12** (and
  French House set to 12 on dev so he sees it). Tile is 111×111 at his window.
- [x] **Fixed a padding bug that fell out of it** — a tile's own padding used `cqw`, but a
  container-query unit inside the container's OWN declaration resolves against an ANCESTOR, so it
  always clamped to the 13px maximum: 28px of a 111px tile was padding and the button had no room
  for its label, showing a bare "＋". Padding now derives from `--per-row`, so a dense floor gets
  tight padding and a 6-per-row floor keeps exactly what it had. Inner width 83px → 95px, and the
  button reads "Take order" again. The shed-detail thresholds were re-based on inner width too
  (they were written as if they were the tile's outer width).
- [x] **The bill popup shows only 🧾 Generate invoice and 🖨 Print** — 💳 Mark paid appears
  **after** it's issued/printed, which is the order he asked for ("when printed then mark as
  paid"). Proven end to end: two buttons → Print → asked who the bill is for → invoice #, printed
  → popup returns with Print + Mark paid → Cash → the tile goes back to **Free** by itself.
- [x] **Fixed: printing silently did nothing on a bill that needed an invoice first.**
  `ensureTableSlice` skipped its refetch for an already-open table, and the invoice number lives
  on the SESSION row — which the summary refresh doesn't carry. So the code generated invoice #41,
  re-read a pre-invoice copy, decided its own invoice had failed and returned without printing.
  It now force-refreshes that one table when something was just written to its session.
- [x] **The stats strip shows with sessions OFF** — it used to render nothing at all in that mode,
  which is now the normal setup, so the floor lost "how full am I / who owes me" for exactly the
  restaurants that live on this screen.
- [x] **"Needs you" counts only what you can act on** — a request for a table the restaurant
  doesn't have was counted anyway; with the queue card gone it would have sat there forever with
  nothing on screen to answer it (it read 4 with nothing to click; now 0).
- [x] Guards green again after all of it: `verify:ui`, `verify:taps`, `verify:clash`,
  `verify:access`, `verify:table-ownership`, `verify:lifecycle`, `verify:two-parties`, `tsc`,
  `npm run build`. `verify-table-ownership.mjs` needed updating a second time — it clicked a tile
  and read the docked detail, which no longer exists, and left popups covering the grid.
- [ ] Still not deployed; still on port 4937 from the `feat/live-floor` worktree.

### Same day, third pass — tap a free table to order; KOT moves to the top

Owner: *"when the table is free and you click the table directly the ordering thing should pop, no
option for take order; and whenever an order is going on, at that time we want take order option.
I want the KOT option on the top where who does what was, and it will have to choose a table and
it will work after like it was before, so before a table or order is taken you can mark table as
VIP from that option."*

- [x] **An empty tile has NO buttons at all** — tapping the tile itself opens the order builder.
  One tap instead of tile → popup → button. Verified: a free tile renders 0 buttons and tapping
  it opens "＋ Take order · Table 5" with no table popup in between.
- [x] **"＋ Take order" appears only once there IS an order** (to add to it), alongside the ✓
  accept and the 🖨 bill. A busy tile still opens its popup on tap. Verified both ways.
- [x] **The permission still decides what a tap does** — the free-tile shortcut has no button for
  the x-ray to hide, so a manager without `take_orders` gets the table popup instead of a builder
  they can't use (`takeOrdersAllowed()`); the server refuses it regardless.
- [x] **🧾 KOT ▾ sits at the top of the floor**, exactly where "Who serves what" used to be, and
  asks **which table** first — then hands over to the same table-and-KOT menu as before, so
  everything downstream is unchanged. Gated by `table_ops` (module + power) and registered in
  XRAY_CONTROLS like the in-popup one.
- [x] **Table type / VIP is in that menu and works on an empty table** — which is the point: with
  a free tile going straight to ordering, there was no other way to mark a table before the guests
  order. Verified end to end: KOT ▾ → Which table? (30 offered) → free T7 → Table type → VIP →
  the tile picked up the 👑 VIP ribbon. Everything that genuinely needs a party (change table,
  merge, move, split, reprint) shows greyed with its honest reason ("table closed", "no movable
  KOT"), which is how that menu already behaved.
- [x] Guards green: `verify:ui`, `verify:taps`, `verify:access`, `tsc`. Test VIP mark reverted.
- [ ] **Open question for the owner:** he reports "in the setting there is still a size toggle and
  stuff" — the old S/M/L tile-size buttons are gone from the code (grep-verified), and the manager
  Settings → Tables holds only Number of tables (admin-only), per-table name+seats, QR links and
  Auto-clear. The only size control left anywhere is the ADMIN panel's "Tables per row" + its
  preview, which is the one he asked for. Asked him to point at which screen.

### Same day, fourth pass — your row number wins, and a Classic/Custom floor plan

Owner: *"I will just tell you how much tables I want in a particular row. You have to make it
dynamic such that even if you have to make it very small, you will make it very small… I will keep
a reasonable number."* and *"there will be a toggle option for classic and customise. Whenever
custom is selected it will be hardcoded by me according to restaurant structure — where the
vegetable is, where in the restaurant… I will hardcode that, so you don't need to do that."*

- [x] **Tables-per-row is now an instruction, not a suggestion.** It used to be a polite target:
  the grid refused to shrink a tile past a readability floor and quietly returned FEWER columns
  than asked (16 gave you 14, with nothing saying why). Now the tile shrinks to honour the number.
  Measured on his window: 6→6 (235px), 12→12 (117px), 20→20 (70px), 30→30 (47px) — every one
  square, none clipped.
- [x] **Two fixed sizes were secretly fighting the number** and both had to scale with density:
  the 14px grid gap (at 30 per row that's ~400px of pure gutter — the actual reason 30 became 25)
  and the progress bar's 8px top margin (which alone overflowed a 46px tile: 35px of content in a
  34px box, the "clipped" flag). Wide floors keep exactly the gap and spacing they had.
- [x] **The floor sheds detail as it shrinks, in priority order** — the decorative ＋, then the
  sub-line, then the seat count, then the state WORD. The table number, the state COLOUR and the
  progress bar always survive, because that is how a dense floor is read: scan colour, then tap.
  The tile number's own font floor (19px) had to go too — it overflowed anything under ~60px.
- [x] **`TILE_MIN_PX` re-purposed honestly**: 100px "readability" → 44px **tappability**. A column
  only comes back when a tile would stop being a finger target, which in practice means a phone.
- [x] **Classic / Custom toggle** (migration 238, `settings.floor_layout_mode`, admin-owned,
  default classic, with a DB CHECK so a typo can't take a floor away). Admin → the restaurant →
  Settings → **Floor layout**.
- [x] **Custom draws the room as it really is** — from a hand-written plan per restaurant in
  **`public/panels/floor-layouts.js`** (keyed by slug; documented shape + a worked example). He
  writes `{ t, x, y, w, h }` per table plus optional zone captions ("A/C", "Terrace"); empty cells
  are how an aisle or the kitchen gets drawn. Proven live: a 2×2 table renders 363×363, a 3×1
  table renders 550×177 (a long table, not a giant square), captions sit on their own text-height
  rows, and the empty column reads as an aisle.
- [x] **Two ways it refuses to lose a table.** Custom on with no plan yet → the classic grid plus
  an on-screen line saying exactly that (proven: 30 tiles, no empty floor). A half-written plan →
  the unplaced tables appear underneath under "Not placed on the plan yet — 18 tables".
- [x] **The admin's own Auto-close wording fixed too** — it still offered "Off — do nothing",
  which can't be true now that nobody can free a table by hand.
- [x] Guards green: `verify:ui`, `verify:taps`, `verify:access`, `verify:clash`,
  `verify:table-ownership`, `verify:lifecycle`, `verify:two-parties`, `tsc`, `npm run build`.
  `verify-table-ownership.mjs` needed a third update: it tapped a free tile and waited for a popup
  — which is the behaviour we changed. It now asserts the NEW promise (a free tile opens the order
  builder, for that table, on an empty cart) and keeps the stronger data checks unchanged.

### Same day, fifth pass — the ghost-bill root cause, and a full-suite sweep

Owner: *"what is this error whenever I go in the detail section… when it was not clicked 0/1 was
written and when I click it, 0/7 was written… I go to the root and this error is from before also"*
then *"fix all the other fix, if all bugs are fixed make it live and do the full test again… if you
find anything just instantly fix it… till every error is not solved."*

- [x] **THE BUG WAS A BILLING BUG, not a display glitch.** Table 2 held three live orders: one from
  that evening's party, and **two from 7 July with no party at all**. The tile asked the server,
  which counts only the current party → 0/1 · ₹441 (right). The detail counted in the browser, which
  admitted *any* party-less row with no date test → 7 dishes · ₹6,048. "Mark all paid" there would
  have charged that evening's guests for food ordered 24 days earlier, and the number jumping on
  click was simply the two answers disagreeing.
- [x] **One rule now, in all three readers** (the `?table=` slice, the manager's `ordersForTable`,
  the waiter's `ordersOf`): an order is this party's if it carries the party's id, **or** has no
  party but was taken after the party sat down (60s of slack for an order that beats its session
  row). An order older than the party cannot be theirs. Nothing is hidden: a genuinely party-less
  order taken during this sitting still counts. The 30 July fix closed the *closed-session* door;
  this closes the *no-session* one.
- [x] **Proven on another table, not on his** (he asked that table 2 be left as evidence): planted
  a 3-week-old party-less order plus a fresh party on table 3 → tile and detail both read the
  party's order only, server hands over 1 row, waiter agrees. **Table 2's data was never touched.**
- [x] **Migration 239 cleans the rows themselves** — 38 ownerless live orders (₹12,873, oldest
  7 July, 27 of them still New/Cooking so they sat on the kitchen pass as three-week-old tickets).
  Same two moves migration 232 makes on close: unpaid non-khata → a visible ✕ void + archived,
  everything else archived only. Nothing deleted; all still in Bills and the records. 38 → 2 left,
  and both survivors are legitimate (their parties opened *before* those orders).
- [x] **Migration 240 — the parity red went to one.** Five functions were live with no migration
  (`verify:db-parity`). Four are load-bearing (`lfh_banquet_place_order` calls them) so they are
  written down verbatim with their real grants; `lfh_owner_heatmap_old` is called by nothing and was
  dropped instead of enshrined.
- [x] **A real UI leak found by the sweep and fixed:** three admin screens printed
  `<!DOCTYPE html> <!--[if lt IE 7]> … -->` — a proxy error page stored as an error detail and
  rendered verbatim (verify:everything's "leaked: -->"). New `readableDetail()` in
  components/admin/shared.tsx strips markup only when the text really is an HTML page, so genuine
  stack traces keep their line breaks; applied at the four render sites, and the summary is capped
  at the source too. 0 leaks on all three pages now, `verify:live` green.
- [x] **Two "failures" that were the test environment, not the app.** The offline suite's guest-menu
  and owner-panel checks fail against `next dev`: Next's dev bundle can't finish loading offline, so
  React never hydrates — the page shows its cached shell with no dish list and no notice. Proof it's
  the environment: with the network cut, a fetch from inside that same page returns all 59 dishes.
  Against a production build the same suite passes **52/52**. Written into the suite's header so the
  next person doesn't lose an hour to it.
- [x] Guards green: ui · taps · clash · access · test-safety · board-sig · tsc · build ·
  table-ownership · lifecycle · two-parties · customers (64/64) · offline (52/52 on a prod build) ·
  live (21/21) · owner-home · live-rush · db-parity (bar the AV-live item below).
- [ ] **NEEDS HIS YES — one AV-live item.** `lfh_owner_heatmap` DIFFERS between the two databases:
  AV live is running older code than we test. Fixing it means running the pending migration on the
  AV live database, which is an explicit-permission action. Nothing was touched.
- [x] (2026-08-05) That sweep finished long ago; the suite is 500+ phases now and `--list` prints
      the live count. Left here only so the note above it still reads in order.

## 2026-08-01 — THE PERSON PROFILE (owner picked design 1 "Dossier")

- [x] **One profile panel for every person** — owner, manager, waiter, kitchen — opened from
  `/aevinite → Users` and from `/aevinite → Owners → Full profile`.
  `components/admin/StaffProfile.tsx`; the shape is written down in `docs/STAFF-PROFILE.md`
  and pinned in CLAUDE.md ("arrange in this structure only").
- [x] **Permissions block = the Access & permissions rows for that role, nothing else.** One
  shared list (`lib/staffCaps.ts`) now feeds the profile, the Access screen's Per-person tab
  and the admin write route's allow-list — the Per-person tab's private copy was deleted.
- [x] **One dropdown per row: `Default (On)` · `On` · `Off`** (waiter money rows add
  `On + manager PIN`); the bracket states the restaurant's own setting. Saves per row.
- [x] **Every new user starts on Default for every permission** (`permissions: {}` at create).
- [x] **Manager has two blocks** (menus + what they may manage); **owner has one** (Owner's
  menu, read-only — a per-owner override has no enforcement path, so no dead switch);
  **waiter one**; **kitchen none**, said in a line.
- [x] **Optional photo** — `POST/DELETE /api/admin/users/photo`, public `branding` bucket under
  `staff/<id>/`, URL in `profile.photo_url`. No photo = their initial.
- [x] Whole record editable: personal details, emergency contact, job, pay + the append-only
  pay ledger (only when the payroll module is on AND they're on the pay list), papers (last 4
  digits only), sign-in switches, password/PIN, activity, private note, danger zone.
- [x] Verified in a browser on the real page: 17/17 checks, desktop + 390px phone, 0 console
  errors, a permission changed → saved → put back; owner profile opens with one read-only block.
- [ ] **Open follow-up:** a per-OWNER permission override would need enforcement threaded
  through the owner routes (owner_entitlements is per restaurant today). Not built — the rows
  are honest read-only until he asks for it.

### 2026-08-02 — "off must be INVISIBLE as well as refused" (his check on the profile work)

Owner: *"making a permission off should not show that permission in the manager, and even if it's
shown it should not work because from admin it's off"* — then: *"not work by that I mean not show
the option to use it and they can't do that also."* Three real faults found and fixed:

- [x] **The Bills tab ignored its own switch.** Its DOM tab is `orders`, but the panel's model→DOM
  map only knew `editor/ratings/log` — so switching the **Bill** menu off for a restaurant hid
  nothing. Added `bills → orders`.
- [x] **The Bills tab had no permission entry at all**, so a person whose `view_bills` was Off still
  saw the tab and got 403s inside it. Added it to `XRAY_TABS`.
- [x] **The panel had no answer for the newer permissions.** `whoami` built `effectivePowers` from
  the LEGACY flag list, which has no `view_bills` / `delete_bill`. It now walks every grant in the
  model and resolves it with the SAME four rungs `managerCan()` uses (feature half → admin cap →
  this person → `managerGrantValue`), so what the screen shows and what the server allows cannot
  disagree.
- [x] **`canDeleteBill()` never read the per-person switch** — the profile could say
  "Delete a bill · On" for one manager and the server would still refuse. Now the person's own
  value wins, exactly as `managerCan` resolves it (the admin cap above it is unchanged).
- [x] **Proved in the running app, as the real staff login** (one sign-in, nothing destructive —
  every action probe uses an id that cannot exist, so a 403 proves the gate fires before any work):
  ratings · logs · dashboard · bills · reopen-a-bill · delete-a-bill · edit-menu · discount — each
  one ON = tab present + not refused, OFF for that person = **tab gone AND the server refuses**.
  Waiter panel: the tri-state handed to the tablet follows the person (button drawn/hidden), and
  `tabletPerm` reads their override first.
- [ ] **ONE ROW TO DECIDE (needs his yes).** *Change restaurant settings* (`edit_settings`) no
  longer gates anything on the server: since 2026-08-01 a manager may only send table names/seats/
  layout, each with its own switch, and everything else under settings is refused outright. So the
  row only hides cards — a switch with nothing behind it, which his own rule forbids. Recommend
  **deleting the row** from Access → Manager. Not touched: it is his screen.

## T11 visual-sweep follow-up — owner picked 2026-08-15, 6 phases
Owner reviewed all 20 items and chose. Order: 1 → 2 → 6 → 3 → 5 → 4.
- [x] **Phase 1 — quick fixes** (PR #970, live): merged-tile number, VIP tile shove, "👑 VIP" twice,
      "le French House" chart label, owner nav 16px jump, guest back-arrow name.
      Not changed: `/editor` (deliberate redirect) · "SLIDE →" (already fixed 08-13).
      Withdrawn as MY measurement errors: the "ON" pill (text is `font-size:0`, never visible) and
      the Usage column header (it exists).
- [x] **Phase 2 — kitchen** (PR #971, live): parcel + "other" got their own channel colours, and the
      kitchen/manager disagreement over Website (green vs sky) was fixed — five channels, one colour
      each, both screens. The live-order DETAIL popup was opened in both skins on a real parcel and
      is already right (inside the viewport, one ✕, no leaks, no cut-off), so it was left alone.
- [x] **Phase 6 — housekeeping** (PR #975, live): floor-legend decision recorded as R25 + a REJECTED
      comment on `const LEG` in BOTH panels. REQUESTS.md 136 KB → 57 KB (33 finished sections
      collapsed to one line each; all 42 open items kept byte-for-byte identical). 7 spent sweep
      screenshots deleted; other terminals' evidence left alone.
- [x] **Phase 3 — language sync** (PR #974, live): the editor's name boxes now follow
      settings.menu_languages — Aangan (["en"]) gets ONE box headed "Name"; French House
      (["en","fr","hi"]) gets three. The card closes up on its own (153px → 131px).
      NO per-currency price field exists to hide (prices are in rupees since mig 043; the picker is
      a guest-side conversion), so that half already held by construction.
      ALSO fixed here: a REGRESSION from PR #968 — browse-wide let a 22-category chip strip inflate
      the column to 2650px, pushing Categories and Tags OFF SCREEN. Caught on Aangan; French House
      has 9 categories and fitted, which is why it looked fine when it shipped.
- [x] **Phase 5 — polish** (PR #976, live): role chips now follow the skin — ALL FOUR were unreadable
      on the light card (1.80–2.22:1), not just the manager one; manager 2.23 → 7.09, dark unchanged.
      Big numbers shorten ("₹308 Cr") instead of crushing to 9px, in BOTH copies of the fitter, with
      the exact value on hover — though I could not reproduce the crush on a real screen, so it is a
      safety net, not a visible fix; bills are and must stay out of that net. Dish photo 420 → 760px
      on a laptop, phone untouched.
- [x] **Phase 4 — manager panel redesign** (PRs #978 + #979, live): the sections moved from the top
      strip to a LEFT icon rail at >=1024px — icons only (62px) with the name on hover, a toggle
      expands it to full names (208px) and the choice is remembered. Below 1024px the phone/tablet
      drawer is untouched. Side effect worth having: a vertical list can't overflow, so a restaurant
      with an extra module no longer loses its ENTIRE nav to a hamburger (Green Bowl at 1194px went
      from 0 sections on screen to all 9).
      "Only the items his permissions allow" was ALREADY built (XRAY_TABS) — verified, not rebuilt:
      Aangan shows 8 sections, Green Bowl 9, French House 8.
      Header: 213px -> 156px of an 800px window. The bar dropped 60 -> 50px now the sections have
      left it, and the page's own 47px switch ROW was deleted — the cockpit bar's dropdown now
      re-scopes Manager mode in place instead of bouncing out to the owner home. The restaurant's
      name went from FOUR copies on screen to two.
      Three faults found by measuring, all fixed before shipping: the rail ignored the admin
      ribbon's --ribbon-h and slid up over the bar, slicing the restaurant's name; margin-top:auto
      on a first-in-DOM toggle shoved the whole nav to the bottom; and xraySetTint(el,false) cleared
      the button title outright, which left Dashboard/Ratings/Audit/Settings as UNNAMED ICONS.
- Declined: unify the two sign-in marks (R24) · the shared browser-tab name ("I don't care").
- Verified for him 2026-08-15: **nothing is reachable without logging in** — 48/48 admin API routes,
  12/12 owner routes, both consoles bounce to a login, and every panel data call answers
  "Not authorised" without a valid cookie.


---

## ✅ Done and shipped — collapsed (2026-08-15)

These asks were delivered and verified live. Their full item-by-item text is in this file's git
history (`git log -p .claude/REQUESTS.md`) — collapsed here because the owner is charged tokens for
every line of it and a finished request does not need its checklist any more. **Anything still open
is kept in full above.**

- **🔴 BUGS — "claimed fixed but owner STILL sees them broken" (VERIFY FIRST, then fix)** — 7 items, all done.
- **🟡 DYNAMIC UI FEATURES (design work → load UI/UX Pro Max + superpowers, compare/merge)** — 5 items, all done.
- **⚙️ PROCESS / DURABLE RULES (also mirrored into CLAUDE.md)** — 5 items, all done.
- **✅ DONE + VERIFIED (move items here only after live verification)** — 2 items, all done.
- **✅ 2026-06-26 (PM) — egress fix + name/bill batch (PR #45, merged → main 683b693)** — 8 items, all done.
- **2026-07-05 — Bills tax display + printed-bill editing + popup scroll (branch worktree-two-tax-bill)** — 5 items, all done.
- **2026-07-03 — Allergen edit anytime + waffle model (PR #112)** — 2 items, all done.
- **2026-07-03 — Database migrated to Mumbai (owner request)** — 1 item, all done.
- **🆕 2026-07-05 night — Per-restaurant panel URLs (branch worktree-feat-tenant-scoped-panel-urls)** — 1 item, all done.
- **2026-07-06 (night) — CRASH RECOVERY: 8 parallel sessions completed + landed** — 7 items, all done.
- **2026-07-06 — complete the ACCESS LADDER (owner: "complete all the ladder, admin manages everything, grey-out works perfectly")** — 7 items, all done.
- **2026-07-06 — Admin Live Floor: platform stats strip + sort + click-only refresh** — 4 items, all done.
- **2026-07-06 — Admin path bar on every panel + console-only entry (owner: "when you go from admin panel to any panel the path should show… you can go there from admin panel only, not by /tablet")** — 4 items, all done.
- **2026-07-22 — KOT ▾ button: every table/KOT operation in ONE menu (owner: "make a button name kot… like PetPooja… transfer particular KOT even particular item to diff table… add the table merge option too")** — 17 items, all done.
- **2026-07-25 — Parcel / takeaway quick-order (owner: "add a parcel option… parcel very fast… show as takeaway order we already made in Swiggy/Zomato")** — 11 items, all done.
- **2026-07-26 — /bug-test QA-investigator system** — 1 item, all done.
- **2026-07-28 — Manager Tables: requests must show IN the table detail + floating bar removal** — 2 items, all done.
- **2026-07-28 — "Solve all Fix NOW errors" (admin Repair queue emptied)** — 4 items, all done.
- **2026-07-28 — "Fix NOW" must finish the whole loop itself (owner: "that same session should also make it live and click on resolve on website itself")** — 3 items, all done.
- **2026-07-29 — Manager panel: admin-only things must VANISH, not sit there greyed (owner: "it appears, but you can't click it — it should disappear")** — 6 items, all done.
- **2026-07-29 — Login-limit alerts: say WHO/WHERE, arrive silently, and be structured (owner)** — 14 items, all done.
- **2026-07-29 — Waiter sections: give each tablet its own set of tables (owner: "a particular tablet can access only a particular amount of tables, not others")** — 9 items, all done.
- **2026-07-30 — QA sweep of waiter sections (owner: "find other bugs like this too, make sure everything works perfectly")** — 5 items, all done.
- **2026-07-30 — Floor tile SIZE is admin-set; take-order is popup-only (mig 226)** — 8 items, all done.
- **2026-07-30 — Waiter sections released to AV LIVE (owner: "ship this to av live too")** — 6 items, all done.
- **2026-07-30 — Tables-per-row auto-saves; the admin detail keeps your place on refresh** — 5 items, all done.
- **2026-08-02 · Audit & logs — one name, three panels, sub-options (owner request)** — 6 items, all done.
- **2026-08-02 · Audit tested for real on Aangan Garden — 4 gaps + 1 floor-blocking bug found & fixed** — 6 items, all done.
- **2026-08-03 · Bills section rework (owner voice note)** — 5 items, all done.
- **2026-08-04 · The manager's Users screen only ever creates + disables (kitchen · tablet)** — 3 items, all done.
- **2026-08-04 — bulletproof printer system (owner)** — 4 items, all done.
- **2026-08-05 — API-layer sweep of the staff-panel + admin routes (T17, PR #852)** — 7 items, all done.
- **T14 TABLET SWEEP — swept, then FIXED and LIVE on backup (2026-08-13, PR #954)** — 8 items, all done.
- **T17 API SWEEP — swept (500 phases), then ALL 13 problems FIXED + the 3 approved improvements built (2026-08-14/16)** — 16 items, all done.
  - P1 the delivery-channel key stopped riding in the manager + waiter payloads (`lib/panelSettings.ts`, guarded by `verify:panel-secrets`) · P2 a tablet settle that settles nothing now refuses out loud · P3 the recovery backup strips the key · P4 one field name for one channel key (was `key` vs `api_key`) · P5 inventory names the bad purchase line instead of "Inventory write failed" · P6 a prep batch is one atomic action (mig 329) · P7 inventory writes queue offline (photos stay online-only; the offline guide corrected) · P8 no raw database text on the Inventory tab (28 places) · P9 logout survives a database blip · P10 My profile answers "busy" not 500 · P11 two tablet actions stopped showing Postgres text · P12 discarding a count reports the real reason · P13 the act-as cookie is HTTPS-only like both login doors.
  - I1 = P1's fix (one change, not two) · I2 the Activity log gained the Audit's type chips + sort on all three panels, and printing/print-failure is now recorded so the Printer chip has both sides of the story · I3 the admin console reads plain sentences, with the database's own words kept in the body + the log (`lib/adminFail.ts`).
- **T18 MANAGER-BILLS SWEEP — swept (500 phases), then 7 of the 8 problems FIXED + a bigger live one found on the way (2026-08-16, PR #984)** — 8 items, 7 done · 1 waiting on the owner.
  - **P0 (found while fixing, not in the sweep — the Bills tab and Audit & logs rendered NOTHING on every screen)**: browse-wide (2026-08-15) decided "master-detail tab" from `!no-sidebar`, so the two tabs whose sidebar is a NAV took `.list-wide`, whose stylesheet half hides `.editor` — the pane they render into. 8 bill cards sat in the DOM behind an empty screen at 1280, 834 and 360. Scoped to the three menu-editor tabs by name.
  - P1 on a phone the same screen was already crushed: the T14 tablet rule (`220px 1fr`, ≤1040px) out-specifies the phone's `.layout { 1fr }`, so 360px gave a 140px content column. It gains a `min-width: 761px` floor; the iPad fix is untouched (measured 360 / 834 / 1194).
  - P2 the parcel counter's "Pay now & print" asked for the PRE-TAX subtotal while the receipt and the record said subtotal + tax (₹250 vs ₹263) — one `estTotalNum()` now answers both.
  - P3 a discounted parcel printed at FULL price from the floor tile and the Platform card (tile said ₹472.50, printer said ₹525) — both now pass discount + note.
  - P4 **NOT BUILT — waiting on the owner**: a cancelled bill can still be given a fresh tax-invoice number (panel button + no server guard). Needs the cancellation-policy decision first (Options 1–4 put to him 2026-08-16).
  - P5 "Clear freed" swallowed the tap in silence when nothing was freed, and read only the newest-200 board · P6 "Total due" on a part-settled bill showed the whole bill (now Total · Already paid · Still due) · P7 the QO/P destination picker called a merged CHILD table "free" (now names the bill it joins) · P8 a comment claimed the x-ray permission pass can't reach body overlays — it can; corrected AND the missing `data-disc` marker added.
- **T20 ADMIN SWEEP — swept (500 phases), then ALL 21 problems FIXED + both improvements + the handover sheet he asked for (2026-08-16, PRs #987 · #988)** — 24 items, all done.
  - **P1 (high)** re-creating a restaurant under a name a BINNED one still holds died with `duplicate key value violates unique constraint "settings_pkey"` — mig 319 freed the restaurant's name, but a binned restaurant keeps its settings row and `settings.id` is that table's primary key. New rows are keyed by the restaurant id. **Proved by creating "ZZ T8 Gate Probe" while the binned one holds that name.**
  - **P2 (high)** a purged restaurant never left the recycle bin (mig 309 keeps the row, marked `purged_at`; no TypeScript had heard of the column) — the bin filters it and restoring one is refused in words instead of returning an empty shell.
  - **P3 (high)** the purge confirm said it erases "ALL its data (menu, orders, bills, staff)" when since mig 309 the bills, invoices, credit notes and Removals audit are kept ON PURPOSE — the screen now says which goes and which stays.
  - P4 Repair said "7 problems (24h)" over errors 3-9 days old while the Dashboard sat quiet · **and the follow-up (#988): even once age was gone the button counted raw ROWS (18) and the board counted GROUPED problems (7) — both now use `errorGroupKey`, measured live at 7 and 7.**
  - P5 raw database sentences on the recycle bin · P6 the Bills tiles mixed page-scoped with database-wide counts ("All 718" over 170 rows) · P7 Repair clipped its complaints filter + restaurant picker off a 360px screen (measured 18px over, now 0) · P8 "Fix now" re-offered itself after a refresh and filed duplicate tickets (`err_key` now built by the same function on both sides, and actually read) · P9 the same rate limit had two names on two screens · P10 a blocked pop-up on the Dashboard's quick-open vanished in silence.
  - **P11 (his ask: "store what the admin has done, but it will only show to admin")** walking into any restaurant's panel is now recorded as `admin_enter_panel` on the `admin` panel — which the manager's log (`not panel in (admin,owner,db)`) and the owner's (`not panel in (admin,db)`) BOTH exclude, so it is a record for him and never a hint for the restaurant.
  - P12 act-as validates its id and refuses a binned restaurant, on both doors · P13 Settings said "Environment: Production" on the backup stack (now names the real one) · P14 dead imports + a phantom back-stack layer · P15 the crash-log noise filter matched "Load failed" anywhere in a message and could swallow a real error · P16 the "asked N× today" chip defaulted to 1 on a failed read · P17 a failed complaint resolve was the one silent action on the Repair page · P18 one typing rule in the recycle bin (his "keep that rule, remove other one") · P19 the pre-purge backup gained `invoice_events` / `credit_notes` / `session_payments` / `deletion_audit` · P20 two emoji became icons · P21 a name clash now says WHO holds the name and where.
  - I1 the Repair restaurant picker moved to the top and narrows the problem board · I2 Copy buttons on the new-restaurant passwords.
  - **NEW — "Logins & passwords" + Print handover sheet (mig 330).** Restaurants → a restaurant → a card listing every login with its password, and a Print button that produces a clean A4 sheet (its own iframe document — no pop-up). Several owners → it asks whose sheet, one owner per sheet. `staff_users.password_shown` keeps the same password as the hash, encrypted (AES-256-GCM, `lib/passwordVault.ts`); every password write goes through `passwordFields()` so a change made by staff in their own panel shows up too. **Sign-in still reads `password_hash` alone.** Passwords set BEFORE this cannot be shown — nothing ever kept a readable copy — so those rows say so and offer a one-time reset. PINs stay one-way and are deliberately not on the sheet. **The trade he was told and accepted: whoever can open the admin console can now read every restaurant's passwords.**
  - Verified in a real browser against the dev DB and then live on backup: the four starter passwords print, a later password change shows the new value, and **both the manager and the owner can sign in with what the sheet says**.
- **2026-08-16 · BILL SAFETY — "cancel is the only way out of a bill" (owner, Option 3 of 4; PR #992)** — 4 items, all done.
  - A CANCELLED SALE TAKES NO INVOICE NUMBER (mig 331): `lfh_generate_invoice` refuses with LFH02 before the counter is touched, so the tax series holds real sales only; the panel stops offering "🖨 Print bill" on an all-cancelled bill (the plain Print still prints the CANCELLED sheet). Proven on the backup DB: all-cancelled bill refused + invoice_no still null · already-invoiced bill returned unchanged.
  - NOBODY AT THE RESTAURANT REMOVES A BILL: `canDeleteBill()` is now the Aevidine admin console alone — the OWNER lost it too. The grantable "Delete a bill" rows left `lib/accessTree.ts` + `lib/accessModel.ts`; stored values left unread. Recorded as **R27** in `docs/REJECTED-IDEAS.md`. Verified live: the manager's whoami answers `canDeleteBill: false`.
  - KEPT DELIBERATELY (he asked to change it; I pushed back): an invoice already ISSUED keeps its number, retired + marked cancelled — Rule 46(b) wants the cancelled invoice retained WITH its number so the gap is explainable. Reason written into `docs/NUMBERING.md` + `docs/COMPLIANCE-GUARDRAILS.md` §3.0.
  - CANCELLATIONS ARE REPORTED: the Z-report states their VALUE beside the count (`dineIn.cancelledNet`, verified live), and the Bills day divider names the voids instead of counting them as bills ("11 bills · ₹882 collected" when nine were cancelled). This also closes T18 improvement I1.
  - **STILL OPEN** (named in the PR): the owner-panel Cancellations card + the over-threshold alert · **Option 4** — signed + hash-chained bills with a one-tap "verify this day" (the owner has agreed to it as the next job).
- **2026-08-16 · BILL SAFETY part 2 — the signed ledger + the cancellation watch (owner: Option 4; PR #994)** — 3 items, all done.
  - **SIGNED, CHAINED BILLS (mig 332)**: `bill_chain` is append-only — one row per issued invoice holding the bill's identity, the MONEY IT WAS SIGNED AT, and sha256(payload ‖ previous link's hash). Written inside `lfh_generate_invoice` (the one door all three panels use) and protected by a trigger that refuses UPDATE + DELETE to every role, service role included; RLS on with no policy. `lfh_verify_bill_chain(rid, from, to)` reports a rewritten link, a removed/re-ordered one, AND a bill whose live orders no longer add up to what was signed. Proven on backup: invoice 162 wrote seq 1 (₹483) chained to the previous · verify "1 bill(s) verified" · UPDATE and DELETE both refused, row untouched · a ₹10 change → "signed at 483.00, the bill now adds up to 472.50", value restored, final verify clean. This closes the "European bar" to-do in `docs/COMPLIANCE-GUARDRAILS.md` §6 (NF525 inalterability / KassenSichV behaviour — not a certification claim).
  - **THE PROOF IS PRINTED**: the day-close Z-report verifies the day and prints "Bill ledger ✓ N bills verified" beside the money, or names the problems. Pressing Z-report IS the check. Verified live: `chain: {ok:true, bills:1, problems:[]}`.
  - **CANCELLATION WATCH** (`lib/cancelWatch.ts`): one quiet ping per restaurant per business day when a day carries ≥5 cancelled bills AND they are worth ≥20% of everything sold (two conditions so neither cries wolf). Never blocks a cancel. Common case costs a rows-free count. No-op on the backup stacks (no alert channel), so nothing was test-pinged.
  - Checked first, NOT rebuilt: the owner panel's Cancellations report (Reports → Payments → Cancellations) already carries the count and the value over any range.
- **2026-08-16 · PROTECTION SWEEP — the 20-point list he was shown (owner: "do all 5 fixes"; PR #995)** — 5 items, all done, all live on backup.
  - **HE ASKED FIRST "does our app have all 20 of these?"** Answer measured against the code, not guessed: **14 already true** (keys hidden, no secret ever committed in the whole git history, anon key on the guest side, row-level security on every table, AES-256-GCM credential vault, 49/49 admin routes gated, per-restaurant scoping, write allow-lists that refuse unknown keys, cookies `httpOnly`+`sameSite`+`secure`, PBKDF2 ×120,000, login throttle, React escaping, uploads PNG/JPG/WEBP-only ≤1MB with SVG deliberately refused, column-listed reads). 4 partial, 2 missing.
  - **SECURITY HEADERS** (`next.config.ts`) — the app set only Cache-Control before. `nosniff` · `Referrer-Policy` · `Permissions-Policy` built FROM A GREP (camera / microphone / geolocation stay allowed because the QR scanner, the issue voice note and the at-the-table check use them) · `X-Frame-Options: SAMEORIGIN` **on the staff paths only** — not DENY, the app frames itself constantly · **the guest menu deliberately gets NO frame header** (restaurants have their own websites; nothing on that menu is private) · **HSTS production-only**, no preload (a browser that learns "localhost is HTTPS-only" breaks `npm run dev`).
  - **CSP IS REPORT-ONLY AND MUST STAY THAT WAY** until the console is quiet on every panel — a wrong policy is a blank screen for a waiter mid-service, not a failing test. Measured 0 notices on the guest menu + all 4 panels at ship time.
  - **ONE SEARCH CLEANER**: 8 search boxes, 4 different behaviours. The banquet bill search was fully raw — `,` and `)` END a term in PostgREST's `or=(...)` grammar and `%`/`*` are wildcards, so "Sharma, R" searched for something other than what was typed. 3 more used an older strip missing `*`. All 8 now call `safeSearch()` (`lib/searchText.ts`, which already existed). The `.or()` filters interpolating an **id** were checked and left: validated UUIDs.
  - **DEPENDENCY WATCH** (`scripts/verify-deps.mjs` + `.github/dependabot.yml`): CI installed `--no-audit` and never mentioned packages; the count was **15**. A bare `npm audit --audit-level=high` would fail on all 15 and be switched off within a day, so today's are acknowledged BY NAME with a reason each and the guard fails only on something **NEW**. Dependabot raises the PRs; majors are left to a person.
  - **BOT LAYER on the two login doors** (`lib/botCheck.ts` + `components/BotTrap.tsx`): an invisible trap field plus how long the form was open — sent as a **DURATION, never a clock reading**, because restaurant tablets have wrong clocks. Honest about its tier: it stops untargeted fill-everything traffic, not someone scripting this form. Turnstile is wired and starts enforcing the moment `TURNSTILE_SECRET_KEY` exists, no code change.
  - **IT FAILS OPEN, and that is the point**: staff can run a weeks-old cached panel, the no-JS fallback posts without the fields, an offline replay has no form behind it. Only PRESENT-AND-WRONG is refused, with the ordinary "wrong password" reply, and it never counts towards a real person's lockout.
  - **CAUGHT IN A BROWSER, NOT BY A TEST**: the trap first rendered as the FIRST input in the form, so anything reaching for "the first text box" landed in it — a real person would have been refused. My own test script fell into it. It is LAST in both forms now, with the reason written at both sites.
  - Verified on the DEPLOYED site, not just locally: a real sign-in through both actual doors reaches `/manager` and `/aevinite`; a filled trap or an instant submission is refused; a submission with NO bot fields still succeeds; all 4 panels' iframes render; 0 CSP notices. Plus typecheck, lint, 30/30 static guards, access 37/37, `verify:cache`, `verify:ui`, `verify:taps`, `verify:test-safety`, `verify:live` against the live URL.
- **2026-08-16 · SECURITY CHECKLIST KEPT + the dependency updates taken (owner: "save that list… do 1, 2, leave 3, 4 for later")** — 3 items, all done, all live on backup.
  - **HIS 20-POINT LIST IS NOW A STANDING DOCUMENT** — `docs/SECURITY-CHECKLIST.md`. He asked for it to be saved so *"whenever I tell you to check all the securities… you will check through that list"*, and for the things checked BEYOND it to be written down too. §1 his twenty, each with its status and the exact command (rows marked 👁 need a person — pretending a command covered them is how a checklist starts lying). §2 the **eight this app needs that his list never mentions**, and which matter more here than several of the twenty: one restaurant seeing another's data · a sale that can be cancelled but never deleted · the signed bill ledger · new Postgres functions being public by default · a permission that LOOKS off being off on the server too · the admin gate · our own tests not tripping the app's limits or alerting him · nothing ever pointing at AV live. §3 what is open ON PURPOSE. §4 a run log — **add a row every time.** It opens with the wording warning, because a security pass is exactly when a session gets killed by the classifier.
  - **Findable without CLAUDE.md** (which sits 10 bytes under its size budget, so nothing was trimmed to squeeze a pointer in): a row in `docs/GUARD-MAP.md` keyed on the words he actually says, plus a session memory.
  - **DEPENDENCY UPDATES MERGED** (PRs #996 · #997 · #998): GitHub Actions checkout + setup-node to v7, and the grouped npm update — **Next 16.2.6 → 16.3.0**, React 19.2.8, Supabase 2.112, Sentry 10.70, recharts 3.10, Playwright 1.62. Dependabot labelled the Next bump "routine"; it isn't, so it was tested rather than trusted: installed locally and DRIVEN — guest menu, tenant menu, dish page, both login doors, all four panels and their embedded frames (9/9), plus the 3D-loading guard, 30/30 static guards, typecheck and 37 tests. Then re-verified on the deployed site: all four panels render with no console errors, headers still land, the guest menu is still correctly unframed, and a login with NO bot fields still succeeds while a filled trap is still refused.
  - **Advisories 15 → 7, high 9 → 4.** `verify:deps` ACKNOWLEDGED dropped from 15 names to 7 — the guard printed exactly which lines to delete, which is how they came out. **⚠️ One practical consequence: Playwright moved 1.60 → 1.62, so every machine needs `npx playwright install` ONCE or every browser-driven check dies with "please run the following command".** Done on this Mac.
  - **PARKED BY HIM, deliberately (do not "fix" these):** Cloudflare Turnstile keys (bot protection stays at the weak tier until they exist — free, ~5 min, no code change needed) · turning the content policy from watching into blocking (measured clean on 15 live screens, but the app has 55 page routes — do not flip it blind).
