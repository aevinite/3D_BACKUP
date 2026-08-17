# T12 findings — owner home screen, Audit & logs, who's online, marketing

Phases P05501–P06000. 12 real problems, all fixed in `sweep6/t12-owner-home-activity`,
**one commit per numbered item** so a single veto can be reverted cleanly.
Restaurant used: **My Little French House** (the diag owner `diago1` owns exactly one, so the
single-restaurant dashboard is the live path). **Aangan was never written to and never read.**
No row was created in any table, so there was nothing to clean up.

| # | severity | where | what | evidence | commit |
|---|---|---|---|---|---|
| 1 | low | owner → Dashboard → hero shortcut row | said "Staff & powers"; the sidebar and the page say "Team" | confirmed, both sizes, one frame | `a3e867f8` |
| 2 | med | owner → Dashboard → Recent activity → "See all" | gated on `entitlements.activity`, a key the server has never sent | confirmed: overview sends 33 keys, no `activity` | `b8efc9c2` |
| 3 | high | owner → Dashboard → Recent activity card | sat on "Loading…" for ever when the admin has switched Audit & logs off | confirmed by replaying the server's own 403 | `3180c9b5` |
| 4 | med | owner → Dashboard → Recent activity card | never refreshed itself; frozen at page load while every other card was 60s fresh | confirmed: over 88s analytics 3→5, oplog stayed at 1 | `c890e0fe` |
| 5 | high | owner → Dashboard, whole screen | a switched-off Reports section read as a broken dashboard: red "Couldn't load.", six cards stuck loading, three blank tiles, five dead links | confirmed by replaying the server's own 403 | `e96096c2` |
| 6 | med | owner → Audit & logs → Audit · removals → the line under the chips | "200 records · ₹91,337 in total" described page 1 of 442 | confirmed on screen | `1b5033c9` |
| 7 | high | owner → Audit & logs → Activity log → type chips + sort | both were dead controls — the filtered, sorted list was computed and thrown away. He asked for this on 2026-08-14 | confirmed: chip lit, list unchanged at 200 rows; sort changed nothing | `beb469b7` |
| 8 | HIGH | owner → Dashboard → Every dish → a dish | on a phone there was NO way back to the dashboard: BACK left the panel, the crumb is hidden at 360px, the drawer's Dashboard link did nothing, and a reload restores the drill. The scroll memory also addressed the wrong element at ≤900px | confirmed on a 360×780 A35 | `d72cc926` |
| 9 | low | owner → Manager mode → the "Manager mode" breadcrumb segment | silent dead tap: it dispatches an event Manager mode does not listen for | code-read + measured listeners | `b4c4b892` |
| 10 | med | owner → any page → ☰ → the section you are already in | dead tap; on the dashboard with a dish open it was the only control visible on a phone | confirmed, both sizes | `1d9d0058` |
| 11 | med | owner → Dashboard → "Today so far" tile → the "● live" pill | 1.92:1 on a white card once a tile is not a link (which fix 5 makes happen) | measured in all four states | `dab7fdb0` |
| 12 | med | owner → Dashboard, switched-off state | the instant-paint snapshot still leaked real delta chips, sparklines, a full revenue chart and payroll money under a note saying figures were not shown | confirmed in both skins with a real snapshot present | `f1fa43fd` |

Found by the **second pass**: 7 (a false green on the first pass), 11 and 12.

## 🔗 HANDOFF — the fix lives in another terminal's file, so I did not touch it

* **H1 — `components/owner/OwnerManagerMode.tsx`.** Its `lfh:owner-crumb` broadcast fires once in a
  child effect, before `OwnerShell`'s listener is attached (parent effects run after child effects).
  On a HARD load of `/owner/manager` the cockpit's top pill therefore does not name the restaurant
  whose floor is on screen — measured: the crumb read "Owner › Manager mode" with the floor iframe
  loaded. Needed change: give that effect a dependency that makes it re-run after mount, or re-emit
  on a microtask. The dashboard and the reports hub survive this only because their emitters re-run
  when their data lands. Visible to a multi-restaurant owner. (Ledger P05846, P05945.)
* **H2 — `app/owner/reports/page.tsx` (T11).** `scroller()` reads `.adm-main` only. At ≤900px
  globals.css makes that `overflow-y: visible` and `.adm` the 100dvh scroller, so the reports hub's
  scroll save/restore silently does nothing on a phone — the same fault this PR fixes on the
  dashboard. Copy the `scrollPort()` helper added to `app/owner/page.tsx`. (Ledger P05948.)
* **H3 — `components/owner/Charts.tsx` → `LeaderBar` / `CatTick` (T11).** The category axis is a
  fixed 110px and `CatTick` draws the full label with no truncation, so a long dish name overflows
  and is cut by the SVG edge. Measured on the dish view, **both sizes**: "Truffle & Wild Mushroom
  Pizza" loses 57px off its left, and 5 of the 6 visible names lose between 6 and 57px. The existing
  mitigation is an SVG `<title>` for hover — which does not exist on a phone, so on the A35 the name
  is simply gone. Needed change: truncate with an ellipsis at the axis width (so the loss is
  visible), widen the axis, or make the label tappable.
