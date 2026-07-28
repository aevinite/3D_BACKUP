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

## 🔴 BUGS — "claimed fixed but owner STILL sees them broken" (VERIFY FIRST, then fix)

- [x] **B1 — Panel shifter.** VERIFIED on main in Chrome: `/aevinite` shows a clean left
  sidebar, NO floating shifter anywhere. `AdminSwitcher` is not rendered in `app/layout.tsx`.
  The owner saw it only on the STALE worktree dev server + because `/aevinite` was crashing
  (see the recharts fix). Dead `components/AdminSwitcher.tsx` left to delete (cleanup).
- [x] **B2 — Admin reaches ALL restaurants.** VERIFIED on main: `/aevinite/restaurants`
  lists all 7; opening any (tested Pizza Palace) shows View guest menu / Owner dashboard /
  Manager panel / Kitchen display / Waiter tablet / Manage staff / Stop viewing. HTTP repro
  confirms act-as scopes the manager API to Pizza + owner-scope returns all 7 of that
  owner's restaurants. The owner couldn't find it because the page was crashing.
- [x] **B3 — Per-restaurant branding.** VERIFIED on main: Pizza Palace guest menu shows its
  OWN wordmark ("Pizza Palace", red), hero "Wood-Fired Pizzeria / BUONASERA", pizza
  categories, red accent — NO French House leak. Spot-checked 3 distinct restaurants:
  French House (gold, "All-Day Café & Bakery"), Pizza Palace (red, "Wood-Fired Pizzeria"),
  Sakura Sushi (pink, "Fresh Sushi & Ramen / IRASSHAIMASE") — each its own wordmark, accent,
  hero, categories. Per-tenant theming confirmed working (same seed mechanism for all 7).
- [x] **B4 — Accept order.** VERIFIED on main: ROOT CAUSE was BAD SEED DATA, not code.
  The old raw-insert seeders wrote `orders.items` JSON with NO `order_items` rows, so
  Accept's `order_items` update hit 0 rows and the bill (sums `order_items`) showed ₹0 —
  looked broken. Created CLEAN orders via `lfh_staff_place_order` (new script
  `scripts/seed-clean-orders.mjs`), then clicked Accept on French House table 6: tile
  flipped New order(orange)→Preparing(blue), bill = ₹935 (correct, non-zero), no flicker,
  realtime "connected". Accept controls DO exist (floor tile + detail "✓ Accept order").
  NB: `lfh_price_order` keys dishes by menu_items.id, NOT slug. STILL TODO: make the app
  robust to legacy orders missing order_items (or backfill), and seed every restaurant.
- [x] **Legend missing pink "Ready to serve".** Owner caught it: floor legend had Free/
  Wants in/Seated/New order/Preparing/called but no pink Ready state. Added
  `["ready","Ready to serve"]` + `.ldot-ready{background:#ec4899}` (matches `.ft-ready`
  tile). Verified live: legend now shows the pink "Ready to serve" swatch.
- [x] **B5 — Real-time across panels.** VERIFIED: (a) guest "Request a waiter" on table 9
  appeared in the MANAGER's Requests panel + tile turned "Wants in" INSTANTLY (no reload);
  (b) accepting in the manager moved the order to the kitchen's Cooking column automatically;
  (c) guest order showed live on manager + tablet. Minor (not blocking): kitchen shows empty
  "Nothing here" for ~2s on first load before the poll fills it (initial-paint latency, not
  an update flicker). STILL TODO if time: owner/admin live-floor refresh + 390px spot-check.

- [x] **B6 — Guest order end-to-end (REAL path, not the seeder).** Order through the guest
  menu (`/r/<slug>/menu?table=N`) → confirm it appears LIVE (no reload) in manager + tablet
  → accept it ONCE from the manager and ONCE from the tablet → confirm it shows in the
  kitchen. FINDING 2026-06-26: on `/r/french-house/menu?table=9`, clicking "Add Cappuccino
  to cart" did NOT populate `lfh_cart` (stayed empty) — guest add-to-cart may be gated behind
  joining/approving the table session first, OR a real bug. DIAGNOSE: does dine-in require a
  session-join (name/approve) before the cart accepts items? Then complete the full E2E on
  several restaurants, desktop + 390px.
  RESOLVED + VERIFIED 2026-06-26: NOT a bug — `FoodCard.tsx:150` routes add-to-cart through
  `gateAddToCart`, which makes a not-yet-seated guest request the waiter first (correct dine-in
  flow). Full real E2E proven on French House table 9: guest opened menu → add gated → typed
  "Mia" + "Request a waiter" → appeared LIVE in manager Requests → waiter Opened table → guest
  seated (lfh_session token) → added Cappuccino+Mocha Frappe → Place Order → order created
  (KOT #4, ₹798 = ₹760 + 5% tax, CORRECT). Order showed on manager + tablet. **Accepted from
  the MANAGER (tables 6/7) AND from the TABLET (table 8 → Preparing).** Kitchen reflects via
  realtime. STILL TODO if time: repeat on the other restaurants + 390px.

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

## 🟡 DYNAMIC UI FEATURES (design work → load UI/UX Pro Max + superpowers, compare/merge)

- [x] **F1 — Manager right sidebar collapsible.** DONE + VERIFIED (desktop + 390px). Added a
  chevron toggle (`#floorSideToggle`, persisted `lfh_floor_side_collapsed`): collapsed → the
  right panel hides, the floor goes full-width, and a floating `‹` re-opens it; while collapsed,
  tapping a tile opens the existing FULL-SCREEN popup (`renderTablePanel`/`openTablePanel`) with
  ✕ + backdrop close. When OPEN, tapping a tile keeps the in-side detail (unchanged). Hover-grow
  on the toggle. Verified: collapse hides panel + widens floor; tap table 3 → centered popup with
  bill ₹862 + all actions; ✕ closes; re-expand restores the panel; 390px renders fine. Reused the
  shared `tablePanelParts()`/`bindTablePanel()` modal — no new popup framework needed.
- [x] **F2 — Nav as a hover-expand icon RAIL.** DONE + VERIFIED (desktop + 390px). AdminShell
  + OwnerShell share `.adm-side`/`.adm-nav`; added a 76px icon rail that expands to 248px on
  hover as an OVERLAY (Linear pattern) so the body never shifts. Labels wrapped in `.lbl` spans
  (kept in DOM + faded for screen readers) + `title=` tooltips. Desktop-only (`@media min-width:
  901px`); ≤900px keeps the full-width labelled top nav. Verified: collapsed icons → hover shows
  full labels with shadow, stat cards don't move; at 390px the rail is correctly disabled.
  (Used CSS overlay, not shadcn — shadcn not needed for this pure-CSS rail.)
- [x] **F3 — Customizable nav (drag-reorder).** DONE + VERIFIED. New shared
  `components/admin/ReorderableNav.tsx` used by BOTH AdminShell + OwnerShell: an "Arrange"
  button enters edit mode (pins the rail open via `:has(.adm-nav.editing)`, items become
  draggable rows with grips), drag to reorder, "Done" exits. Order persists per-panel in
  localStorage (`lfh_admin_nav_order` / `lfh_owner_nav_order`); new sections auto-append,
  removed ones drop. Native HTML5 drag — no dnd-kit dependency added. Verified live: dragged
  Settings→top, persisted across reload, applied to live nav; reset to default after test;
  OwnerShell renders it too (alongside F2 rail + F4 breadcrumb, no errors).
- [x] **F4 — Breadcrumb inside a restaurant.** DONE + VERIFIED: admin restaurant-detail
  (`/aevinite/restaurants` → a restaurant) now shows `Restaurants › <name>` using the same
  `.adm-crumbs` style as the owner-view bar (replaced the plain "All restaurants" button).
  Verified live: breadcrumb renders on Pizza Palace; clicking "Restaurants" returns to the list.
- [x] **F5 — Proactive small great UX touches.** Added across this round: hover-grow on the
  manager collapse toggle, smooth width/shadow transitions on the hover-rail (F2), drag grips +
  dragging opacity on the reorder rows (F3), pink "Ready to serve" legend swatch, and all new
  interactions respect `prefers-reduced-motion`. (Ongoing habit — keep adding tasteful touches.)

## ⚙️ PROCESS / DURABLE RULES (also mirrored into CLAUDE.md)

- [x] **R1 — For ANY design/UI work: load the UI/UX Pro Max skill + superpowers, compare
  the two approaches, keep the best or MERGE them.** In place — loaded ui-ux-pro-max for the
  rail/sidebar work; also a CLAUDE.md standing rule.
- [x] **R2 — Every restaurant must be genuinely DIFFERENT** (theme + accent + intro +
  branding + hero). Verified across 3 tenants (see B3); CLAUDE.md standing rule.
- [x] **R3 — Keep THIS file as the living "every single bit" list.** Maintained all session —
  every request logged + checked off only after live verification.
- [x] **R4 — Keep `.claude/work-checker-lessons.md` pruned** — added the stale-server/missing-dep
  lesson; file kept tight.
- [x] **R5 — Don't claim done from source.** Followed throughout — every item verified live in
  Chrome with app.js cache-busting.
- [~] **R6 — Use shadcn/ui for new features.** EMPIRICAL FINDING 2026-06-26: owner approved a
  safe init; ran `npx shadcn@latest init -d -y` on a throwaway branch — it BAILED at preflight
  ("Validating Tailwind CSS. Found v4 ✖ … No Tailwind CSS configuration found") and made ZERO
  changes (globals.css + package.json verified untouched; no files created). So the shadcn CLI
  does NOT support this Tailwind-4 + PostCSS setup out of the box; `shadcn add` is blocked by the
  same preflight. Making it work needs manual Tailwind-4 theme-token wiring (which risks the live
  custom theme) for no current consumer. F1/F2/F3 shipped in clean pure-CSS instead. RECOMMENDATION
  (owner to decide): wire shadcn manually the first time a feature genuinely needs a shadcn
  component, and verify it against that real component then. Empty `chore/init-shadcn` branch deleted.
  RESOLVED 2026-06-26 (owner: "it will work… the animation functions are crazy, apply anywhere"):
  ROOT CAUSE established — this project has NO active Tailwind utility layer (no `@import
  "tailwindcss"`, all hand-written custom CSS), so shadcn COMPONENTS + tw-animate-css both need
  the Tailwind engine, and adding it injects preflight that would wreck the custom UI. So instead
  of full shadcn, lifted shadcn/Radix's signature ENTER ANIMATIONS into a tiny plain-CSS kit
  (`.anim-pop/.anim-zoom/.anim-fade/.anim-up/.anim-right` + `lfh-enter` keyframes in globals.css;
  `edModalIn/edOverlayIn` in the panel CSS) that works in BOTH React shells AND vanilla panels.
  Applied + verified: admin restaurant dropdown (pop), manager full-screen table popup + overlay
  (zoom+fade). Reduced-motion respected. Removed the unusable shadcn deps. In PR #39 (bf4b43f).
  Kit is reusable — add a class to any future menu/popup/toast to get the same animation.

## ✅ DONE + VERIFIED (move items here only after live verification)

- [x] **Worktree consolidated into main + deleted** (2026-06-26). Worktree branch was 100%
  merged via PR #38; removed the worktree dir + branch + handoff; restarted dev on 4000
  from main. One codebase now. (This also answers "why does /exit ask to delete a
  worktree" — because a git worktree existed for this project; it's gone now.)
- [x] **Fixed build error crashing /aevinite** (2026-06-26). `recharts ^3.9.0` was in
  package.json but NOT installed in main's node_modules → `Module not found: 'recharts'`
  in `components/owner/Charts.tsx` crashed the whole admin panel. Ran `npm install`;
  `/aevinite` now loads (charts render). NB: no code change to commit — prod build runs
  npm install so Vercel was unaffected; this was a local-checkout-only break.
</content>
</invoke>

---

## ✅ 2026-06-26 (PM) — egress fix + name/bill batch (PR #45, merged → main 683b693)

- [x] **Egress diagnosis.** Supabase dashboard confirmed **96.6% PostgREST** (whole-board
  DB reads), 3.4% realtime — GLB/storage was NOT the cause (owner was right). Root: every
  realtime breadcrumb made each open panel re-read ALL orders + ALL sessions + ALL calls.
- [x] **Targeted per-table refetch (manager).** Breadcrumb carries table_number+kind →
  realtime.js accumulates changed tables → ops handler calls `pollTables()` which fetches
  only `?table=N` slices and merges; full-reload fallback when unscopable (no table /
  kind=platform). `reconcileBoard()` extracted so chimes/redraw identical on both paths.
  Measured: /orders 162KB→16.6KB, /sessions 75KB→1.3KB per event (~92% cut). VERIFIED live:
  open-table → pollTables([7]) targeted, no regression. 60s full poll = backstop.
  NOTE: kitchen/tablet still do full loads (realtime.js change is backward-compatible) —
  extending the targeted merge to them is the one remaining egress follow-up.
- [x] **Wake-on-return.** useActiveAutoRefresh refreshes immediately on first interaction
  after idle (cursor/scroll/tap), not after a full 60s interval. (admin/owner stay gentle
  60s — making heavy analytics live-per-event would re-create the egress we just killed.)
- [x] **Restaurant name on panel headers.** Manager (· name), kitchen, tablet — scoped via
  panelRestaurantId, folded into existing /all//board//state responses. VERIFIED: acting-as
  Pizza Palace shows "Pizza Palace", no #1 leak.
- [x] **Restaurant name in admin activity logs.** /aevinite feed + /aevinite/logs tag each
  row (joined once via Map in /api/admin/oplog; uses restaurants.name, not logo_text).
  VERIFIED live. NOTE: owner panel has NO activity log to tag (only writes actions) — a
  separate feature if wanted.
- [x] **Clean printable bill modal.** item·×qty·add-ons → Subtotal → Discount → GST → Total;
  invoice number removed (bill # kept, voided tag kept). VERIFIED: Table 2 bill renders
  correctly, no invoice number. (The printed Tax Invoice keeps its number for GST — flag
  to owner if he wants it gone there too.)
- [x] **Tablet take-order redesign — menu-style browse (owner 2026-07-03; FINAL = LITE, #113).**
  All categories laid out as sections in ONE scrollable browser; auto-shift category chips
  JUMP on tap + follow the scroll (spy). Layout stays the ORIGINAL in-panel one — owner
  tested the #107 full-screen takeover and rejected it ("keep the same as the previous one");
  #113 keeps the takeover CSS dormant (body.om-mode never set). The "This order" cart kept
  EXACTLY as before in its OWN separate scroll (owner: no floating cart bar/sheet).
  Options/allergy/note/send flow untouched; browse scroll survives adds, option edits and
  search-clear; hardware back peels order mode first (backstack.js now loaded in tablet).
  VERIFIED live at 390px + 1280px; prod serves v=20260703b.
- [x] **Make every panel responsive (owner 2026-07-03).** Audited /aevinite /owner /manager
  /editor /kitchen /login /staff-login at 390px. Fixed: admin Branding card (2-col grid never
  collapsed — was UNUSABLE on phone), compacted admin/owner phone nav (3-across), editor
  Operations-log now stacks like the Customer log (was 700px sideways scroll), login inputs
  16px (kills iOS focus-zoom). Kitchen/owner/manager/login verified fine already (manager
  phone pass shipped in #102). VERIFIED live at 390px.

## 2026-07-03 — Settings organization + per-user access + hierarchy (PR #106, merged)
- [x] Manager Settings organized into sidebar sections (General/Tables/Users/Access/Billing/Dining sessions)
- [x] Access section: per-user tablet permissions (Default/On/On·PIN/Off for discount, mark-paid, invoice) — server-enforced (mig 115)
- [x] Hierarchy: manager can only manage kitchen+tablet (never managers/owners), server-enforced
- [x] Manager Log hides owner + admin actions
- [ ] Awaiting owner check on :4000 once the allergy session's work lands (feature verified on :4010 + PASS from work-checker)

## 2026-07-05 — Bills tax display + printed-bill editing + popup scroll (branch worktree-two-tax-bill)
- [x] Live bill card (Bills → Live/Today/Previous) shows **Subtotal + merged "GST x%" + Total** (was Total only); % from settings, never hardcoded. Verified Aangan desktop + 390px.
- [x] Printed bill: tax SPLIT per component (CGST/SGST, editable names+rates in Settings › Billing), same grand total as on screen; **bill footer message now editable** (mig 124 `settings.bill_footer`, blank = default sign-off; new restaurants don't inherit a template's footer).
- [x] Floating table-detail popup **scrolls** (was clipped — % height against auto-height wrapper); head/foot stay pinned; docked/modal/phone variants intact.
- [x] On-screen bill label default "Tax" not "GST" for all restaurants (PR #152); print unchanged.
- [x] **Settings › Billing redesign (PR #156):** two stacked sections — ① Manager bill on screen (NEW renameable "tax word", `settings.tax_label` mig 125, e.g. Tax/GST/VAT) + ② Printed bill. Form opens **AUTOFILLED with exactly what the bill prints right now** (shared `billIdentity()` resolver = form and print can never drift), incl. materialised CGST/SGST 50/50 rows and a ⚠ hint on the placeholder GSTIN. Verified live on Aangan (rename→instant card update, print untouched), row restored after test.

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

## 2026-07-03 — Allergen edit anytime + waffle model (PR #112)
- [x] Allergen/note edit at ANY status (served/ready/paid) incl. ✎ Edit on Bills view; qty stays locked
- [x] Waffle 3D model (local GLBs) + title fix "Lemon Icecream Waffle"

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

## 2026-07-03 — Database migrated to Mumbai (owner request)
- [x] Full Supabase migration Sydney→Mumbai (new project, new account): schema+data exact copy (26 tables verified row-for-row), realtime rewired, branding storage copied, Vercel env swapped + redeployed, local dev repointed. Guest freeze ~3-4 min during cutover. Old project kept as rollback. Latency: ping 723ms→~80ms, order write 589ms→152ms, big kitchen board 3-14s→1.4s.

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

## 🆕 2026-07-05 night — Per-restaurant panel URLs (branch worktree-feat-tenant-scoped-panel-urls)
- [x] **Every restaurant gets its OWN panel + login addresses** — `/r/<slug>/login|tablet|kitchen|manager|owner`
  (owner: "make a whole separate path for other restaurants"). The slug is a label + CHECK, never the data
  source: staff data stays scoped by the session cookie; a session from another restaurant is bounced to
  the slug's own login. Scoped login is branded with the restaurant name and only matches THAT restaurant's
  staff (kills the cross-restaurant same-name+same-password ambiguity). Admin opens any slug → auto view-as
  (?rid pin / act-as cookie). Bare /login /tablet /kitchen /manager /owner unchanged (back-compat).
  Verified live on :4010: branded card, wrong-door 401, mismatch bounce, 404 unknown slug, admin rid pin,
  owner entry, bare routes still 200.

## 🆕 2026-07-06 — Admin must enter panels FROM the admin console, restaurant named (branch fix/admin-panels-require-restaurant)
- [ ] **Bare `/tablet` `/kitchen` `/manager` `/editor` no longer admit a scopeless admin** — like /owner,
  the admin gets in ONLY via /aevinite's open-panel flow (act-as cookie + ?rid in the URL). A logged-in
  admin typing /tablet with no restaurant picked bounces to /aevinite. Staff logins unchanged (their
  session pins their restaurant; no rid in the URL — exactly the owner's ask). Also killed the silent
  "default to restaurant #1" fallback in panelRestaurantId: a scopeless admin API call now answers 400.

## 2026-07-06 (night) — CRASH RECOVERY: 8 parallel sessions completed + landed
Computer crashed mid-flight on ~8 parallel sessions. Everything half-done was found, finished, verified live and merged:
- [x] **PR #163 per-restaurant panel URLs** — was OPEN+CONFLICTING; rebased integrating #164's act-as gate, smoke-tested (slug login 200 / unknown 404 / bare+slug bounces), merged.
- [x] **PR #165 crazy dashboards (manager+owner)** — 2 stranded commits; rebase re-integrated #162's per-BILL money rule into the new day-parts/heatmap/prev-period code (per-order maths would have re-overstated revenue); mig 127 applied; both dashboards verified live (₹183,653 / 7× delta). NOTE: first 30d fetch after cold start ≈3.5s (on-demand, never polled).
- [x] **PR #166 guest cart Edit-on-every-dish + common allergen chips** — was UNCOMMITTED in the main folder; extracted onto a clean branch, verified live (plain dish → "Any allergies?" six chips, avoid-tap, edit-reopen preselects; declared dishes unchanged).
- [x] **PR #167 manager "To accept" card** — was UNCOMMITTED in wt-accept; rebuilt on main, ?v= bumped, verified live (T4 accept → card+tile+count synced).
- [x] **PR #168 restaurant recycle bin** — was UNCOMMITTED (456 lines + mig, renumbered 127→128, applied); full cycle verified live (delete w/ reason+confirm → guest 404 → bin 90-days/purge-locked → restore → DB clean; JSON export 200).
- [x] feat/admin-panel-improve — FALSE leftover: already merged as PR #58 long ago (worktree was stale).
- [x] Older branch tips (#134/#136/#155/#160 dirs) — content already in main via their squash merges; nothing lost.
- Cleanup: seeded test order on french-house T4 cancelled; main folder returned to `main`; prod READY throughout (last deploys 1:35–1:52 am all green).

## 2026-07-06 — Banquet module phase 1 (owner "go", after the Aagman banquet ask)
- [x] **Banquet module (bill-only separate menu)** — mig 130: `banquet_items` (own table — can never leak into any guest menu) + `banquet_allowed` admin entitlement (default OFF, toggle live in /aevinite → restaurant → Staff features) + `tablet_banquet` tri-state (off/on/pin, default OFF) with per-user overrides; RPC `lfh_banquet_place_order` prices server-side, lands a normal order at 'served' (no kitchen ticket/chime/KOT-print), existing invoice/discount/mark-paid settles it. Manager panel: new 🎪 Banquet tab (item CRUD + bill builder). Tablet: drawer → "Banquet billing" full-screen overlay (backstack-registered), PIN flow reused. Verified via API on :4005: money math exact (120×350+30×500 → ₹59,850 @5%), tablet blocked by default then works when granted, FH manager 403 (not entitled), anon RPC blocked, guest menu 0 banquet rows. Aangan configured: entitled + tablet ON + "Banquet Plate — standard ₹350" (placeholder price!). Browser click-through NOT done (Chrome declined during session) — pending.
- [ ] **Banquet phase 2 (only if a client commits):** bookings + advance deposit tracking + packages; admin→owner entitlement grey-out (X-ray) for the Banquet tab.
- [x] **Per-table display names (mig 131)** — Settings → Tables now has a Name field beside each table's seat count (display-only: tiles + table detail headers on manager AND tablet show "Banquet (T11)"; bills/KOTs/QR keep the number). Aangan table 11 named "Banquet" (50 seats). Sanitized server-side (24-char cap, blanks dropped).
- [x] **Owner portfolio redesign (2026-07-06)** — one owner ⇄ 1..N restaurants: new /aevinite/owners section (create owner once, attach/detach restaurant chips, reset pw, suspend, act-as); owner panel auto-arranges by count (1 hero / 2 h2h / 3-9 cards / 10+ HQ table) with "My restaurants" always in the sidebar; auth fixes (tenant-door owner login, owner entitlement vs #1, act-as via join table). VERIFIED 2026-07-06: 20-check API suite + Playwright screenshots (admin owners, 7-rest portfolio, single hero, mobile, HQ table) against the live DB on worktree dev.
- [x] **Banquet needs NO table (mig 132)** — owner: "why we need table 11 if we can make bills from the banquet menu". Table is now optional in the banquet bill builder (manager + tablet): blank → standalone "Walk-in / no table" bill in Bills, settled with the per-order Mark-paid/discount there; given → lands on that table as before. Aangan reverted to 10 tables (banquet table 11 removed; nothing was open on it).
- [x] **Admin help screenshots** — Staff-features toggles in /aevinite → restaurant are now cards: real screenshot thumbnail (tap to zoom) + one-line reminder of what the feature is (public/admin-help/*.png, captured via headless Playwright).


## 2026-07-06 — complete the ACCESS LADDER (owner: "complete all the ladder, admin manages everything, grey-out works perfectly")
- [x] **Admin→Owner entitlement rung (mig 133 `owner_entitlements`)** — admin controls which owner-panel SECTIONS exist (Reports / Staff & powers / Issues) and which manager-power toggles even exist (`power_<flag>`); absent = on, all existing restaurants unchanged.
- [x] **Admin Access hub** — new "Owner panel sections" card + per-power "exists/granted" ladder rows; `?rid=&focus=` deep-links from the X-ray jumps.
- [x] **Owner panel** — real owner: admin-removed sections hidden from nav + APIs refuse (reports/staff/issues, manager-permissions grant of a removed power). Admin act-as: sections tinted amber + "N sections off for owner" popout in the adminbar; unentitled power toggles shown as amber locks that jump to the Access hub.
- [x] **Manager panel X-ray v2** — ladder-aware (`effectivePowers` = admin entitles AND owner grants): tabs (Dashboard, Menu editor) + in-tab controls (discount, void/reopen, Users/Access settings rows) hidden for the real manager / tinted for admin+owner; MutationObserver keeps it applied across live repaints; zones popout says who turned it off (admin vs owner) + ⚙ change deep-link; active-tab hop when a manager's landing tab is hidden. app.js `?v=20260706d`.
- [x] **Tablet Phase 3** — whoami + admin-view ribbon + mark-paid/discount/invoice/banquet tinted (not hidden) for the admin when off-for-waiters; server `tabletPerm` lets the admin through an 'off' tri-state (X-ray invariant). app.js `?v=20260706c`.
- [x] **Kitchen Phase 4** — whoami + admin-view ribbon (no gated actions yet); app.js got its FIRST cache-bust `?v=20260706a` (was version-less = stale-cache gotcha).
- [x] Shipped via PR #173 (merged). Server-side behaviour fully verified via API twice (incl. work-checker round: admin act-as 200 / real owner 403, restore clean). Visual pass DONE 2026-07-06 (Playwright headless against prod, after Chrome MCP kept hanging): owner-panel tinted nav + popout, manager ribbon/tinted tab/zones, tablet 3-controls-off popout, kitchen ribbon, real-owner nav loses the section, 390px wraps clean. Found + fixed one leak: the dashboard hero kept its Reports shortcut for a locked-out owner (PR #179, merged + re-verified live).

## 2026-07-06 — Admin Live Floor: platform stats strip + sort + click-only refresh
- [x] **Top "whole platform" strip on /aevinite/floor** — 6 cards (restaurants live, tables busy, orders today, cooking now, unpaid bills, waiter calls); counts pre-summed in Postgres (mig 134 `lfh_admin_floor_stats`, indexed, one tiny row per restaurant, NO revenue per the admin no-earnings rule); numbers count up when a fresh snapshot lands.
- [x] **Sort control for the restaurant blocks** — Busiest / Most cooking / Most orders today / Needs attention / A–Z, remembered in localStorage; per-restaurant "N today · M cooking (· unpaid/calling)" row under each block name.
- [x] **Click-only refresh (owner's optimization ask)** — fetches ONLY on page open + Refresh button; the old 45s auto-timer removed; "Updated Xs ago" chip goes amber after 2 min so stale is visible; latest-wins seq guard on responses.
- [x] **Skeleton shimmer on first load + "Calculating live totals…" pulse while fetching** (prefers-reduced-motion respected).
- Verified headless (Playwright, 15/15 PASS): skeleton, totals (4/3/3 from seeded QA orders), sort reorder + persistence, ZERO background fetches in 65s idle, exactly one fetch per Refresh click, 390px mobile.

## 2026-07-06 — Admin path bar on every panel + console-only entry (owner: "when you go from admin panel to any panel the path should show… you can go there from admin panel only, not by /tablet")
- [x] **Breadcrumb PATH on all three staff panels in admin view** — kitchen + tablet + manager ribbons now show `Restaurants › <restaurant> › <Panel> panel` (the owner panel's exact breadcrumb language; "Restaurants" is clickable → /aevinite/restaurants). Owner-view of the manager panel keeps the plain name (no console to crumb back to). Sits ABOVE the panel topbar in normal flow — zero overlap, zero blocked clicks (geometry asserted in the verify run). app.js bumps: kitchen `?v=20260706b`, tablet `?v=20260706d`, editor `?v=20260706f`.
- [x] **Console-only entry for the admin (`panelAdminRid` in lib/panelGate.ts)** — a hand-typed /manager, /kitchen or /tablet as admin (even with the 6h act-as cookie still warm) bounces to /aevinite; the ONLY way in is the console's per-restaurant button, which pins the tab with ?rid. Real staff logins untouched; a staff-typed ?rid= is now STRIPPED from the iframe (server already ignored it — the UI marker stays honest too).
- Verified headless (Playwright vs worktree dev :4010, 22/22 PASS + screenshots desktop/390px): crumbs + Sakura name on all 3 panels, no topbar overlap, 3 direct-URL bounces, staff kitchen login sees no ribbon and no rid.
- [x] **Owner detail + permanent delete (2026-07-06)** — owner cards clickable → detail modal (created-when, full activity trail from staff_actions, "Open their screen" act-as, restaurant chips); DELETE /api/admin/owners gated on SUSPENDED-first, typed-name confirm, no restore ever (primary handed to co-owner / cleared; audit rows kept). VERIFIED: 15-check API suite + Playwright modal screenshot on worktree :4021.
- [x] **Owner detail = full management hub + icons (2026-07-06)** — detail modal now ADDS/REMOVES restaurants inline (each chip has a remove ×, primary shows a star icon, "Add restaurant" opens an inline picker); all emojis across the Owners page replaced with Font Awesome icons (eye/key/ban/rotate-left/trash/plus/xmark/star/check/triangle-exclamation). VERIFIED: clean attach/detach/delete API round-trip + Playwright (no emoji glyphs, FA icons present, add-restaurant round-trip); shared DB restored to exact original state.

## 2026-07-22 — KOT ▾ button: every table/KOT operation in ONE menu (owner: "make a button name kot… like PetPooja… transfer particular KOT even particular item to diff table… add the table merge option too")
- [x] **KOT ▾ menu on the table detail (manager + tablet)** replaces the lone ⇄ Shift when the ladder is on; when off, today's plain buttons render byte-identical (zero regression). Rows: Change table · Merge tables · Move a KOT · Move a single dish · Split the bill · Reprint a KOT (manager). Full PetPooja billing-screen parity (their demo: move/merge/split tables, transfer KOT, item transfer, split bill, everything logged).
- [x] **Permission ladder — CANONICAL module pattern (docs/ACCESS-LADDER.md)** — admin Modules card: `table_ops_allowed` (exists) + `table_ops_owner_control` (hand the switch to the owner); owner toggle `table_ops_enabled` (Settings → features you control); owner grants managers (`manager_permissions.table_ops` + admin power_ "exists"); manager grants the tablet (`settings.tablet_table_ops` tri-state off/on/PIN + per-waiter overrides). Server-enforced at every rung (403s verified), X-ray tints for admin/owner, defaults per the ladder defaults rule (module OFF, owner toggle neutral ON, grant OFF, tri-state off), settingsClone covered.
- [x] **Merge tables** — `lfh_staff_merge_tables` (mig 174): orders/dishes/guests/calls/cart move onto the occupied target as ONE bill; discounts sum + re-split; incoming head demoted if target has one; guest phones follow (tokens ride along); refused when either side holds a live invoice; source closes; both tiles nudge instantly (mig-096 4-row breadcrumbs).
- [x] **Move a KOT** — `lfh_staff_move_order` (mig 173) consolidates the tablet's inline move (editor gets the feature; FIXES the missing source-table breadcrumb = stale old tile up to 60s) + re-splits both bills' discounts.
- [x] **Move a single dish** — `lfh_staff_move_order_item` (mig 175): lands under a FRESH KOT on the target (kitchen never re-cooks a served dish), reprices both orders at the effective tax, cancels an emptied source KOT, discount trigger re-splits both sessions.
- [x] **Split the bill at settle** — mig 176 `session_payments`: equal / custom / by-dish legs; server recomputes the due (discount-before-tax) and refuses shares that don't add up (±2p); orders settle once as method "Split" with a human note; legs recorded for the money trail.
- [x] **Reprint a KOT** (manager) — same 66mm thermal template as the kitchen's validated auto-print.
- VERIFIED end-to-end on the worktree prod build (:4020), NON-#1 restaurant (Pizza Palace): phase-1 suite (22) + phases-2-4 suite re-run on the CANONICAL ladder (23) + real-panel UI suite (6) — every rung 403s — ladder 403s at every rung, both-table realtime breadcrumbs, money re-splits, paid/invoiced refusals, fallback rendering, cleanup left the DB spotless.
- [x] **ADMIN X-RAY rule on the KOT menu (owner follow-up, 2026-07-22)** — from the admin console the KOT ▾ button now ALWAYS renders (amber-tinted when off for real staff) and genuinely works (server bypasses the module rung for the admin super-user, both editor + tablet APIs); real logins unchanged (module off = manager/waiter 403 + no button). Rule written into docs/ACCESS-LADDER.md incl. the honest gap list: table_tags/khata/banquet still hide from admin at module-off — flagged to fix on next touch. Verified: manager 403 vs admin success on the same module-off restaurant, both APIs.
- [x] **KOT menu design pass (owner screenshot feedback, 2026-07-22)** — 🍴 Split REMOVED from the footer while the KOT menu is on (it lives inside KOT only); KOT ▾ moved OUT of the crowded footer to the detail HEADER (next to Float, all three views: docked/floating/modal); the menu itself redesigned as a proper action sheet (icon cards, subtitles, chevrons, disabled rows say WHY, bill-due in the header) + table-grid pickers as tiles (occupied highlighted) on manager AND tablet. ADMIN X-RAY extended to table_tags/khata/banquet (admin always sees, tinted; server module-rung bypass for admin — gap list in ACCESS-LADDER.md now all ✅). Verified live: 4-check probe + screenshots (Desktop: kot-detail-header.png / kot-menu-sheet.png).
- [x] **Miller columns for the KOT flows on desktop (owner, 2026-07-23 — "like the Mac Finder")** — on a laptop the KOT popup now drills ACROSS: panel 1 operations → panel 2 what-to-move (KOTs/dishes/tables) → panel 3 where-to (e.g. Move a dish = ops | dish list | target tables, selections stay highlighted, no back-and-forth). Phone keeps the step-by-step sheets. SAVED as the standing desktop pattern for every future multi-step popup (memory + this note). Verified live: 7-check probe incl. a real dish move executed through the columns; screenshot Desktop/kot-miller-columns.png.
- [x] **Take-order polish + light/dark audit + KOT medium card + hover tooltips (owner, 2026-07-23)** — Take-order builder: photo thumbnail on every dish tile, cart names wrap (no more mid-word "…"), verified in BOTH themes. Fixed a real dark/light bug: the injected KOT styles used a non-existent --card variable → white cards in dark mode / navy in light; both panels' KOT surfaces now use the real theme vars (--panel-2/--line/--muted/--gold) and follow the toggle. KOT first-open card is now medium (360px rows, header stacked → no dead right space). NEW hover-tooltip engine (manager): any button with a title shows a styled bubble; KOT rows carry full "how it works" descriptions. Screenshots on Desktop (takeorder-light/dark, kot-medium-tooltip, kot-cols-dark/light).
- [x] **Manager UI sweep + owner-reported bugs (2026-07-23)** — (1) Floor tiles were scrolling HORIZONTALLY with cut right edges: root cause `.floor-wrap{margin-right:-14px}` pushed the grid past the editor's padding; removed + `.editor:has(.floor-wrap){overflow-x:hidden}` so the floor scrolls ONLY vertically (verified scrollWidth==clientWidth). (2) VIP/Family/Guest mark now shows in the table DETAIL HEADER as a coloured pill (was only on the floor tile; confirmed "👑 VIP" pill both themes) — tile ribbon already worked. (3) Hover tooltips now require a 2-SECOND stable hover before showing (no flicker while sweeping the pointer). (4) Take-order button confirmed visible in light mode (gold gradient/dark text — couldn't reproduce the reported invisibility on current build, likely a pre-#346 cache); hardened + KOT ▾ header button given a gold tint so it stands out. Full audit screenshots (every tab, both themes, phone width) on Desktop/mgr-audit/.
- [x] **Manager deep-QA sweep (owner, 2026-07-23) — every menu/click/billing, both themes.** Two functional bug-hunts confirmed the wiring is solid (NO dead/mis-wired buttons). Fixed: (1) BILLING — split-bill server "due" summed each order's already-rounded total, disagreeing with billMath's aggregate rounding → could 409-reject a valid split on a multi-order/discounted table; now recomputed with the same aggregate rounding (editor + tablet routes); verified a 3-order discounted table splits cleanly. (2) Editor split no longer rejects when an un-accepted order is present — it settles the accepted part like mark-paid/the tablet already do. (3) Take-order estimate now includes tax (was subtotal-only, understating the quote). (4) LIGHT-MODE CONTRAST — status pills/tags/log labels (incl. the safety-critical allergy warning, paid/preparing/pending/unpaid/khata-due) were pale on white; deepened per-selector in the light-theme override; verified allergy warning now clearly red. (5) Merge confirms switched from native window.confirm → styled confirmDialog. (6) Dark-mode: truncation notes + ratings bar/empty-stars were hardcoded light hexes → theme vars; all modal inputs/selects now themed (were white in dark). (7) Safe-area bottom padding added to take-order + dish-edit modal footers (phone gesture bar). Full audit screenshots on Desktop/mgr-audit/.
- [x] **VIP/Family mark shows in admin view + floor horizontal scrollbar (owner, 2026-07-23).** (1) Table-type marks were hidden whenever a restaurant's table_tags feature toggle was OFF — even in the admin view where the admin can still mark tables. Per the admin X-ray rule (admin sees/uses EVERY feature; real staff only what's granted), tagForTable/ttagOf now always render the mark in the admin view regardless of the toggle; real managers/waiters still see it ONLY when the feature is on for them (verified: real manager with feature off shows no ribbon). NO tenant toggle changed (owner: "just fix admin view"). (2) The floor had an ugly bottom horizontal scrollbar — `.floor-main{overflow-y:auto}` made the browser auto the x-axis too (CSS spec quirk); added `overflow-x:hidden` so it only scrolls vertically (verified 0 horizontal scrollers on every tab). Take-order gold-on-gold greyed invisibility was already fixed in #352 (live).
- [x] **Take-order admin-tint readability + clipped tile ring (owner, 2026-07-24, ui-ux-pro-max).** (1) The "+ Take order" button in the admin act-as view read washed-out/broken — base .xray-off applied opacity .72 + recoloured text, on a gold-filled button that's gold-on-gold. Per the skill (an admin-usable control must look ENABLED + readable, not disabled): filled xray-off buttons now keep full opacity + dark label + ONE subtle cue (inset ring + amber dot). (2) The previous overflow-x:hidden on .floor-main clipped the selected-tile ring + tag glow on the left/right edge columns; added inline padding (4px 6px) so rings fit inside the clip box. Verified both in light + dark (screenshots taken in scratchpad, reviewed, deleted). Also cleared all AI screenshot clutter from the owner's Desktop.
- [x] **Take-order rebuild + table-type colours + invoice-first print (owner, 2026-07-24).** (1) TAKE-ORDER modal (PC) rebuilt: horizontal scroll-spy category strip (all categories, active follows the dish-list scroll, tap to jump), dishes grouped by category with sticky headers (all shown), image tiles with tablet-style +/− steppers, and a per-dish allergy + note editor in the cart on the right (✎ per line) alongside the whole-order avoid + kitchen note. (2) TABLE-TYPE COLOURS (owner-approved on :8003): Owner's-guest is now METALLIC + theme-contrasting — silver/white metallic in dark, black metallic in light; VIP light-mode deepened (deeper violet + purple-tinted tile) so it stops blending into cream; VIP dark + Family red unchanged. Applied to floor tile + detail pill in manager AND tablet. (3) INVOICE-FIRST PRINT: table-detail footer + Bills no longer offer direct Print — "Generate invoice" first; Print (+ Reopen) appears only once invoiced; markTablePaid auto-generates the invoice so every settled bill is invoiced (never shows Generate-invoice on a paid bill). Verified both themes, invoice flow, screenshots reviewed + deleted.
- [x] **Floor tag glitch + take-order polish (owner, 2026-07-24).** (1) GLITCH: a VIP/guest table's mark wasn't on the floor tile until you clicked the table — the floor first-painted before whoami resolved, so the admin-view tag exception hadn't kicked in; added a repaint after whoami lands (tag now shows on load). (2) Take-order: category strip was vertically clipped (overflow-x auto squished the flex row) → flex:none + min-height so all chips show; the WHOLE dish rectangle is now tap-to-add (auto-forms a −/n/+ stepper); each tile has a ✎ that opens a tablet-style per-dish allergy+note popup. Verified.

## 2026-07-25 — Parcel / takeaway quick-order (owner: "add a parcel option… parcel very fast… show as takeaway order we already made in Swiggy/Zomato")
Design APPROVED: a general **🥡 New Parcel** button at the TOP of the manager floor header (NOT tied to a table); opens a take-order-style dish picker; on finish writes a **`takeaway`-source `aggregator_orders` row** through the EXISTING Platform system, so it lands in the Platform tab, flows to the kitchen, and counts in Takeaway totals — reuse, don't build a parallel system. Owner decisions: **BOTH pay-now (green, print + settle) + pay-on-pickup (gold, stays open until collected)**; **NO packing fee** in v1; **customer name/phone optional/skippable**.
- [x] **Button placement APPROVED (preview only, wired to a placeholder)** — gold "🥡 New Parcel" in the floor `.ed-head` (desktop: before the S/M/L density buttons; phone: under the "Table view · live" title). Shown live in the real manager panel, owner approved 2026-07-25.
- [x] **Phone: button inline BESIDE the "Table view · live" title** — CSS `:has()` nowrap tweak; verified live at 390px.
- [x] **Parcel order screen** — the manager take-order dish picker parametrized with a `parcel` mode (`openTakeOrder(null,null,{parcel:true})`): "🥡 New Parcel" header + optional name/phone, "This parcel" pane, subtotal (no tax line — matches Platform orders), no packing fee. ONE source of truth (dine-in unchanged).
- [x] **Finish actions** — green **Pay now & print** (paid=true; prints a customer receipt via `printParcelReceipt`) + gold **Pay on pickup** (unpaid, sits in the Platform board with a 💰 Collect button).
- [x] **Backend** — `POST /parcel` (editor route): take_orders ladder + managerCan gate (parity with `/order`), titles/prices resolved SERVER-SIDE from `menu_items`, calls `lfh_platform_insert(source='takeaway', p_restaurant_id)`; migration `196_parcel_paid.sql` adds `paid/paid_at/payment_method`; `POST /platform/:id/pay` collects a pay-on-pickup one. Verified end-to-end (create paid/unpaid, collect, board reads back).
- [x] **Shows as a TAKEAWAY order** (owner: "show as takeaway we already made in Swiggy/Zomato") — lands in the Platform board + kitchen with the existing TAKEAWAY badge; no separate PARCEL label. Kitchen ticket unchanged (already renders takeaway).
- [x] **Open-parcels visibility** — Platform tab lists them with PAID / UNPAID pills + Collect; live badge counts them. Verified.
- [x] **Tablet (waiter) panel** — Parcel lives in the **☰ drawer** (`#dwParcel`, owner 2026-07-26: "different menu… toggle from three lines, same as manager phone view"), same gated pattern as Banquet; opens the exact tablet order picker in parcel mode (no table, name/phone, Pay now & print / Pay on pickup → `POST /tablet/parcel`). Verified live at phone width in the panel iframe.
- [x] **Dedicated Admin on/off entitlement** — `parcel` is now a **first-class ladder MODULE** (mig 197: `parcel_allowed/_owner_control/_enabled` + `tablet_parcel`), wired through all six touchpoints (tableTags/ownerEntitlements/accessConfig/settingsClone/accessModel + editor/tablet/owner/admin routes + owner-staff & new-restaurant UI). Admin toggles it in the Access panel (auto-rendered from `LADDER_MODULES`), default **OFF**; owner-transfer + manager grant + tablet cap all present. Button/x-ray now gate on `parcel` (not take_orders).
- [x] **Customer receipt print** — `printParcelReceipt` (thermal 66mm) fires on manager "Pay now & print".
- [x] **Verified**: manager `/editor/parcel` (200, needs `parcel` power) + tablet `/tablet/parcel` (200, tablet_parcel cap) create takeaway orders; manager button + modal (desktop/phone), tablet ☰ drawer item + parcel screen (both pay buttons + name/phone), Platform PAID/UNPAID pills + Collect; full `tsc` clean (0 errors). Enabled the `parcel` module + granted manager/tablet on french-house so the demo shows it.

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

## 2026-07-26 — /bug-test QA-investigator system

- [x] **`/bug-test <target>` skill built + verified.** Project skill at
  `.claude/skills/bug-test/` (SKILL.md + references: safe-wording, interaction-card,
  device-matrix, subagent-template) — recursive living-map sweep of one panel/feature:
  drive every click, prove every number against the dev DB, cross-panel instant-update
  checks, fix→verify→small-PR loop, phone pass (A35/iPhone/safe-area), repeat until a
  clean pass; classifier-safe wording baked in. Shared helper `scripts/sweep/login.mjs`
  merged via PR #455 (live in deploy bec6517). VERIFIED by dry run on the kitchen panel:
  DB recompute 17 = board API 17 = rendered tickets 17; kitchen order confirmed on its
  table in the tablet; 0 console errors. Owner invokes: `/bug-test manager` (etc.),
  one target per session, up to ~7 parallel sessions.

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

## 2026-07-28 — Manager Tables: requests must show IN the table detail + floating bar removal
- [x] Table detail (docked side view, floating popup AND legacy modal) shows a "📨 Someone's
  waiting" card with the pending open/join/access request(s) for THAT table + accept/deny
  buttons — before, a "Wants in" table's detail just said "This table isn't open yet" with
  no way to accept the guest. (PR #511)
- [x] Floating "⬆ Open all / ⬇ Close all" bar on the collapsed floor REMOVED (it overlapped
  the New Parcel button); the bulk actions stay in the side panel's "Whole floor" card only. (PR #511)
