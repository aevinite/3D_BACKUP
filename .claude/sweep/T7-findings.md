# T7 findings — the waiter tablet (sweep #6)

Territory: `app/tablet/**` · `public/panels/tablet/app.js` · `public/panels/tablet/index.html` ·
`public/panels/tablet/style.css`. 500 phases (P03001–P03500). Everything below was FIXED in this
PR and is held by `npm run verify:tablet-taps` (26 checks, new in this PR — every one of them
proven to FAIL against the re-introduced bug before it was accepted).

---

## F1 · The floor's ✓ Accept, ✓ Accept all, 🍽️ Serve all and Attend-all could vanish in silence
**confirmed** (watched it happen) · severity **HIGH** — the busiest controls on a waiter's floor

**Where:** waiter tablet → the floor → a tile's little green **✓**, and the table popup's
**✓ Accept all** / **🍽️ Serve all** / **Attend all**. What he would SEE: he taps the green tick, the
tile does not change, and nothing at all appears on screen.

**What happens.** Each of these four handlers builds a list of order (or call) ids from the table's
cached slice a moment before firing, and then began `if (!list.length) return;`. The list comes back
EMPTY in two situations a person cannot see:

* the forced slice re-read failed — `ensureTableSlice` swallows a fetch blip **on purpose** ("the
  action then no-ops rather than throwing"), which is exactly how the tap became invisible;
* someone else — the kitchen screen, the manager panel, another waiter's tablet — accepted, served
  or attended it in the seconds between the tile being painted and the finger landing.

The control is still on screen in both cases, so the waiter taps something visibly there and nothing
happens and nothing is said. This is the same fault sweep #5 reported as *"the little green ✓ that
accepts a new order doing nothing and saying nothing"*, and `verify:taps` could not see it: its rule
looks for a `state.…find()` lookup, and these four are `.filter().map()` results one hop away.

**Proved live** (`scripts/sweep/t7-live.mjs`, P03360) by failing that one slice read the way a
restaurant's wifi does — in a context with the service worker blocked, because a request the panel's
service worker answers never reaches the fault injection at all. Before: nothing. After:
*"Nothing left to accept here — refreshing this table."*

**Fixed:** all four now toast what happened and refresh, exactly like `bumpItemQty` and the allergy
chip already did.

---

## F2 · A waiter with a section got a "🪢 Merge tables" row that opened an empty picker
**code-read**, then confirmed live · severity **LOW**

**Where:** waiter tablet → tap a table → **🧾 KOT ▾** → the row **Merge tables**. What he would SEE:
the row looks available, he taps it, and the screen says *"No other open tables to merge with."*

**What happens.** The row's own comment says it counts what the picker will actually offer *"so the
row is never enabled onto an empty picker"* — but the count asked only `canHostAParty(i)`, while
`renderMergePicker` offers `inMySection(i) && canHostAParty(i)`. A waiter whose section does not
include the restaurant's other open tables therefore got an enabled row that leads nowhere. Waiter
sections are live on both stacks, so this is a normal restaurant, not an edge case.

**Fixed:** the count now asks the picker's exact two questions — the same rule the "Split the bill"
row was fixed to on 2026-08-04.

---

## F3 · The dish-move picker offered a table that already shares the same bill
**confirmed** (built a merged party and looked at the picker) · severity **LOW**

**Where:** waiter tablet → a merged table → **🧾 KOT ▾ → 🍛 Move a single dish** → the destination
grid. What he would SEE: while T26 and T27 are served as one party, T27's picker listed **T26** as
somewhere to send the dish — labelled with the party's own state, so it reads like a different bill.

**What happens.** The server resolves a merged destination to the party head and then refuses with
reason `same_table` (*"That dish is already on that table."*), so the only possible outcome of that
button was a confusing refusal. Its sibling `renderMoveOrderTarget` has excluded party mates since
2026-08-11 for exactly this reason and says so in its own comment; the dish picker never got it.

**Fixed:** the dish picker now skips every table in `partyTablesOf(t)`, like its sibling. Measured
after the fix: 28 destinations offered on a 30-table floor, with T26 and T27 both absent.

---

## Not a finding, recorded so the next sweep does not chase it again

* **`verify:tablet`'s merged-tile check failed once, then passed.** *"…and from there the party's
  bill controls are reachable"* failed on T11 during the first run of the walk. Re-run: 103/103. The
  merge rows on T11–T14 were created at 03:45:5x — during that run — by another sweep terminal
  working the same demo restaurant. Reproduced deliberately on a party of my own (T26+T27, built and
  closed by id in the same run): the child's popup carries the party label, the whole party's
  tickets, KOT ▾, ＋ Take order, − Discount whole bill, 🖨 Print bill, 💳 Mark bill paid, ✕ Close
  table and the bill bar — measured at 1.6s and again at 5s. **The product is right; the failure was
  another terminal's live fixture.** (SWEEP-RULES §4.)
* **`verify:merged-floor` and `verify:skin-ink` are not this territory** — the first drives the
  MANAGER's floating tables (`[data-floating-table]`), the second the owner console's pill.

---

## 🔗 HANDOFF — the fix lives in another terminal's file

### H1 · There is no way to UNMERGE from the waiter tablet
**File:** `app/api/tablet/[...path]/route.ts` (whoever owns the tablet's server routes).

A waiter can MERGE two tables from the tablet (🧾 KOT ▾ → 🪢 Merge tables), and the KOT menu then
tells them *"Change table — unmerge first"* — an instruction they cannot follow on that device.
`tables/:t/unmerge` exists only on `/api/editor/*` (the manager panel), so undoing a mis-tapped merge
means finding a manager. **Exact change needed:** add a `tables/:t/unmerge` branch to the tablet route,
gated exactly like `sessions/:id/merge` (the `tableOpsTabletAllowed` module check plus
`tabletPerm("tablet_table_ops", …)`), calling the same `lfh_staff_unmerge_table` RPC and emitting the
same breadcrumb. The panel side (an "Unmerge from T…" row on a merged CHILD's KOT ▾ sheet, matching
the manager's "you can only unmerge by clicking on the child table" rule) is ~15 lines inside my own
territory and I will add it the moment that route exists.

### H2 · The manager panel has the same hover-only refusal this PR removed from the tablet
**File:** `public/panels/editor/app.js` (T5 — manager panel).

`openBillPreview`'s **💳 Mark paid** is rendered `disabled` with its reason in a `title` attribute
(*"Accept the order first — a bill can only be paid once the order is accepted."*). A title needs a
hover; the manager panel is used on touch screens too. **Exact change needed:** the same shape this
PR gave the tablet — keep the button enabled, dim it, mark it `data-needs-accept="1"`, and toast the
reason from the click handler. About 5 lines. Not urgent, and nothing is broken today for a mouse.
