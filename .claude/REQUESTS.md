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
- [x] Shipped via PR #173 (merged). Server-side behaviour fully verified via API twice (incl. work-checker round: admin act-as 200 / real owner 403, restore clean). ⚠️ Browser click-through of the tint VISUALS never happened — Chrome MCP kept hanging; owner said push live anyway. If a tint/ribbon looks off at ~390px, it is presentation-only (server enforcement is proven).
