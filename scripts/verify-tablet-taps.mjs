// verify-tablet-taps.mjs — the waiter tablet's own regression guard.
//
//   node scripts/verify-tablet-taps.mjs            # check this checkout
//   node scripts/verify-tablet-taps.mjs <root>     # check another checkout (a worktree)
//
// WHY THIS EXISTS. Sweep #6 (T7, 2026-08-17) found five faults on this panel that every existing
// guard passed clean through, because each one lives in a shape none of them knows:
//
//   1 · A BULK ACTION HANDED AN EMPTY LIST. `optimisticAccept`, `optimisticServeAll` and the
//       "Attend all" handler each began `if (!list.length) return;`. The tile still shows the ✓ /
//       🍽️ / 🔔 that produced the list, so the waiter taps a control that is visibly there and
//       nothing happens and nothing is said. Reachable two ways nobody can see: the forced slice
//       re-read failed (ensureTableSlice swallows a fetch blip ON PURPOSE), or another device
//       accepted/served/attended it in the seconds between the paint and the finger. This is the
//       exact fault sweep #5 reported as "the little green ✓ doing nothing and saying nothing".
//       verify-tap-guard.mjs cannot see it: its rule looks for a `state.…find()` lookup, and these
//       three are `.filter().map()` results passed one hop away.
//
//   2 · A ROW ENABLED ONTO AN EMPTY PICKER. The KOT ▾ menu's "🪢 Merge tables" row counted its
//       destinations with `canHostAParty(i)` while the picker it opens ALSO applies `inMySection(i)`.
//       A waiter with a section therefore got an enabled row that opened "No other open tables to
//       merge with." The row's own comment says this must not happen; the code had drifted from it.
//
//   3 · A DESTINATION THAT IS THE SAME BILL. `renderMoveItemTarget` offered a merged party MATE as
//       somewhere to send a dish. The server resolves a merged destination to the party head and
//       refuses with 'same_table', so the only possible outcome of that button was a confusing
//       refusal. Its sibling `renderMoveOrderTarget` has excluded mates since 2026-08-11.
//
//   4 · A DISABLED BUTTON ON A TOUCH PANEL. "💳 Mark bill paid" was `disabled` while an order was
//       still un-accepted, with the reason in a `title`. A title needs a hover; a waiter carrying
//       plates has no mouse. The split-payment button in the same file already answers this exact
//       situation the right way — "stays ENABLED and says WHY it won't go".
//
//   5 · A PICKER WITH NOTHING IN IT AND NOTHING SAID. ⚡ Quick order is on the top bar at all times,
//       so a waiter holding no section could build a whole order, tap SEND, and land on an empty
//       grid. Every other picker in the file has an empty state; this was the last one without.
//
// These checks are STATIC (no browser, no DB, no writes), so they are safe to run anywhere and
// cost nothing. Add a check here whenever a new bulk action or destination picker is added to the
// waiter tablet.
import fs from "node:fs";
import { repoRootFrom } from "./sweep/repoRoot.mjs";
import path from "node:path";
import vm from "node:vm";

// The repo to scan: the first argument that really IS one, else the repo this file lives in.
// It used to be plain `process.argv[2]`, so `-- --base http://localhost:4228` — which every
// sweep lane passes to every guard — made this scan a folder called "--base" and exit 1.
// (T28, sweep #7, 2026-08-29; the same fault as verify:test-safety's, in eight more guards.)
const ROOT = repoRootFrom(import.meta.url);
const TABLET = "public/panels/tablet/app.js";
const src = fs.readFileSync(path.join(ROOT, TABLET), "utf8");
const HTML = "public/panels/tablet/index.html";
const CSS = "public/panels/tablet/style.css";

const checks = [];
const fails = [];
const check = (name, ok, detail) => { checks.push({ name, ok }); if (!ok) fails.push(`${name}\n    ${detail}`); };

// The source of ONE function, from its name to the next top-level `function` / `async function`.
const fnBody = (name) => {
  const at = src.search(new RegExp(`\\n(?:async )?function ${name}\\s*\\(`));
  if (at < 0) return "";
  const rest = src.slice(at + 1);
  const end = rest.search(/\n(?:async )?function [A-Za-z_]/);
  return end < 0 ? rest : rest.slice(0, end);
};
// Does this snippet SAY something on its way out? Same vocabulary verify-tap-guard.mjs uses.
const SPEAKS = /toast\(|load\(|render|confirm|LFH_/;

// ── 0 · THE FILE HAS TO PARSE AT ALL ─────────────────────────────────────────────────────────
// Learned the hard way while WRITING this guard (T7, 2026-08-17). A comment added inside one of
// renderPanel's template literals contained two backticks; they ended the string, the whole panel
// stopped parsing, and the tablet rendered a blank floor. Every static check in the repo — this one
// included — passed clean, because a regex over the text cannot tell a broken file from a working
// one. Only the live walk caught it, thirty minutes later. `vm.Script` COMPILES without running, so
// this costs a few milliseconds and can never be fooled the same way again.
// (The panel is a classic script, not a module — compiled as one here for the same reason.)
{
  let err = "";
  try { new vm.Script(src, { filename: TABLET }); } catch (e) { err = e.message; }
  check(
    "tablet: app.js parses (a stray backtick inside a template literal blanks the whole panel)",
    !err,
    `${TABLET} does not compile: ${err}\n    ` +
    `Almost always a backtick, a ${"$"}{ or an unescaped quote inside one of the render functions'\n    ` +
    `template literals — including inside an HTML comment, which is where it happened.`,
  );
}
// The two files app.js is served with must exist and be non-empty; a panel is all three or none.
for (const rel of [HTML, CSS]) {
  let size = -1;
  try { size = fs.statSync(path.join(ROOT, rel)).size; } catch { /* stays -1 */ }
  check(`tablet: ${rel} is present and not empty`, size > 0, `${rel} is missing or empty (${size} bytes).`);
}
// index.html must still load app.js with a ?v= cache-buster (verify:panel-cache keeps it honest).
{
  const html = (() => { try { return fs.readFileSync(path.join(ROOT, HTML), "utf8"); } catch { return ""; } })();
  check(
    "tablet: index.html loads app.js with a ?v= content hash",
    /src="app\.js\?v=[0-9a-f]{8}"/.test(html),
    `${HTML} must load app.js as app.js?v=<8 hex chars>, or staff keep running a weeks-old panel.`,
  );
}

// ── 1 · the three bulk actions must never return in silence on an empty list ────────────────
for (const [fn, what] of [
  ["optimisticAccept", "the tile's ✓ Accept and the detail's ✓ Accept all"],
  ["optimisticServeAll", "the detail's 🍽️ Serve all"],
]) {
  const body = fnBody(fn);
  check(
    `tablet: ${fn} exists`,
    !!body,
    `${TABLET} no longer defines ${fn}(). ${what} has nothing to call.`,
  );
  const guard = body.match(/if \(!orderIds\.length\)[^\n]*/);
  check(
    `tablet: ${fn} says something when the list comes back empty (${what})`,
    !!guard && SPEAKS.test(guard[0]),
    `In ${TABLET}, ${fn}()'s empty-list guard is "${guard ? guard[0].trim() : "missing"}".\n    ` +
    `A bare return there is a tap that vanishes: the tile that produced the list is still on screen,\n    ` +
    `so the waiter taps a control that is visibly there and nothing happens and nothing is said.\n    ` +
    `Toast what happened and refresh — see the note above optimisticAccept.`,
  );
}
{
  // Anchor on the HANDLER, not on the first mention: the markup that renders the button sits
  // hundreds of lines above the binding, and a window measured from there caught neither.
  const at = src.indexOf('querySelectorAll("[data-attend-all-calls]")');
  const body = at < 0 ? "" : src.slice(at, at + 1400);
  const guard = body.match(/if \(!ids\.length\)[^\n]*/);
  check(
    "tablet: \"Attend all\" says something when every call has already been attended",
    !!guard && SPEAKS.test(guard[0]),
    `In ${TABLET}, the attend-all handler's empty-list guard is "${guard ? guard[0].trim() : "missing"}".\n    ` +
    `A dropped bell is the worst of the three to lose in silence.`,
  );
}

// ── 2 · a KOT ▾ row is enabled only when the picker it opens will have something in it ───────
{
  const menu = fnBody("renderKotMenu");
  const count = menu.match(/for \(let i = 1, n = tableCount\(\); i <= n; i\+\+\)[^\n]*occupiedOthers\+\+/);
  check(
    "tablet: the merge row counts destinations through the SECTION rule, like the picker it opens",
    !!count && /inMySection\(i\)/.test(count[0]) && /canHostAParty\(i\)/.test(count[0]),
    `In ${TABLET}, renderKotMenu's destination count is "${count ? count[0].trim().slice(0, 120) : "missing"}".\n    ` +
    `renderMergePicker offers "inMySection(i) && canHostAParty(i)"; this count must ask the SAME two\n    ` +
    `questions, or a waiter with a section gets an enabled "🪢 Merge tables" row that opens\n    ` +
    `"No other open tables to merge with." The row's own comment says that must never happen.`,
  );
  check(
    "tablet: the split row is still gated on the whole PARTY's bill",
    /const splittable = partyOrders\(t\)/.test(menu),
    `In ${TABLET}, renderKotMenu's "Split the bill" row must count partyOrders(t) — gating it on\n    ` +
    `ordersOf(t) greys it out on a merged child whose party bill is listed right behind the menu.`,
  );
}

// ── 3 · no destination picker may offer a table that already shares this bill ────────────────
for (const fn of ["renderMoveItemTarget", "renderMoveOrderTarget"]) {
  const body = fnBody(fn);
  check(
    `tablet: ${fn} never offers a merged party MATE as a destination`,
    /partyTablesOf\(t\)/.test(body) && /mates\.has\(String\(i\)\)/.test(body),
    `In ${TABLET}, ${fn}() must skip every table in partyTablesOf(t). The server resolves a merged\n    ` +
    `destination to the party head and then refuses with reason 'same_table', so such a button can\n    ` +
    `only ever produce a confusing refusal. (partyTablesOf includes t itself, so it also covers the\n    ` +
    `plain "not this table" test.)`,
  );
  check(
    `tablet: ${fn} still filters by the waiter's section`,
    /inMySection\(i\)/.test(body),
    `In ${TABLET}, ${fn}() must skip tables outside this waiter's section — the server checks BOTH\n    ` +
    `ends of a move, so offering one is a button that exists only to fail.`,
  );
}

// ── 4 · no money control may be a disabled button whose only explanation is a hover ──────────
{
  const markup = src.match(/id="payBill"[^`]*?>💳 Mark bill paid/);
  check(
    "tablet: 💳 Mark bill paid is never rendered `disabled`",
    !!markup && !/\bdisabled\b/.test(markup[0]),
    `In ${TABLET}, the #payBill button renders as "${markup ? markup[0].slice(0, 130) : "missing"}".\n    ` +
    `A disabled button swallows the tap, and this is a TOUCH panel — the reason lives in a title\n    ` +
    `attribute that needs a hover a waiter carrying plates does not have. Keep it enabled, dim it,\n    ` +
    `and refuse out loud in the handler (the split-payment button already works this way).`,
  );
  check(
    "tablet: 💳 Mark bill paid carries the un-accepted marker its handler reads",
    !!markup && /data-needs-accept/.test(markup[0]),
    `In ${TABLET}, #payBill must carry data-needs-accept="1" while an order on the table is still\n    ` +
    `un-accepted, so the click handler can name the thing the waiter must do next.`,
  );
  check(
    "tablet: the #payBill handler refuses OUT LOUD when the order is not accepted yet",
    /#payBill[\s\S]{0,400}?dataset\.needsAccept[\s\S]{0,200}?toast\(/.test(src),
    `In ${TABLET}, the #payBill click handler must read dataset.needsAccept and toast the reason\n    ` +
    `before returning. Without it the marker above is decoration and the tap is silent again.`,
  );
  check(
    "tablet: the one split screen's Take-payment button refuses out loud too",
    /p\.querySelector\("\.sb-go"\)\.onclick = \(\) => \{/.test(src)
      && /Every part needs an amount above zero/.test(src)
      && !/sb-go[^>]*disabled/.test(src),
    `${TABLET}: the pattern the money buttons on this panel all copy — stay ENABLED and say WHY it\n    ` +
    `will not go. A disabled button that swallows the tap is indistinguishable from a broken one, and\n    ` +
    `this is the most repeated money control in a service.`,
  );
}

// ── 5 · every picker in this panel has an empty state ────────────────────────────────────────
{
  const qd = fnBody("openQuickDest");
  // The GRID itself must be the conditional bit. A looser test ("does `tiles.length ?` appear
  // anywhere in here") passed while the grid had been put back to an unconditional `tiles.join("")`
  // — proven by re-introducing the bug, which is the only way to know a check works at all.
  check(
    "tablet: the ⚡ quick-order table picker explains an empty grid instead of showing nothing",
    /qdest-grid">\$\{tiles\.length \?/.test(qd) && /No tables assigned to you yet/.test(qd),
    `In ${TABLET}, openQuickDest() renders .qdest-grid unconditionally from \`tiles\`. A waiter who\n    ` +
    `holds no section can still reach ⚡ Quick order (it is on the top bar at all times), build a\n    ` +
    `whole order, tap SEND — and land on an empty box with no words. Say it, and say the order is\n    ` +
    `safe; the floor behind already explains this state in the same sentence.`,
  );
  for (const [fn, phrase] of [
    ["renderShiftPicker", "No free tables"],
    ["renderMergePicker", "No other open tables"],
    ["renderMoveOrderPicker", "No movable orders"],
    ["renderMoveItemPicker", "No movable dishes"],
    ["renderMoveOrderTarget", "No other table"],
    ["renderMoveItemTarget", "No other table"],
  ]) {
    check(
      `tablet: ${fn} has an empty state`,
      fnBody(fn).includes(phrase),
      `In ${TABLET}, ${fn}() must say something when it has nothing to offer — an empty picker with\n    ` +
      `no words reads as a broken screen.`,
    );
  }
}

// ── 6 · JOINING TABLES IS A DOOR THAT OPENS BOTH WAYS (owner, 2026-08-17) ───────────────────
// Merging used to be one-way on this panel: it could join two tables and never separate them, while
// its own KOT menu said "Change table — unmerge first" about a thing this device could not do. The
// way back is now a ⇹ button at the bottom of a joined table's detail plus a 15-second undo bar, and
// all of it runs through ONE function so there is only one place to forget the confirm.
{
  const un = fnBody("unmergeTable");
  check(
    "tablet: unmergeTable() exists — the one path both the ⇹ button and the undo bar use",
    !!un,
    `${TABLET} no longer defines unmergeTable(). A second copy of the split would be a second place\n    to forget the confirm, which is exactly why closeTableAndFree() is shared too.`,
  );
  const ask = un.search(/await confirmDialog\(/);
  const post = un.search(/api\("POST", `\/tables\/\$\{child\}\/unmerge`/);
  check(
    "tablet: splitting a party asks BEFORE it posts",
    ask >= 0 && post >= 0 && ask < post,
    `${TABLET}: unmergeTable() must await confirmDialog() before POSTing /tables/:t/unmerge (ask at\n    ${ask}, post at ${post}). Splitting moves money between two bills.`,
  );
  for (const [phrase, why] of [
    ["Back to", "what comes BACK to the table — its own KOTs and their total"],
    ["Stays on", "what STAYS on the bill it is leaving"],
    ["Does NOT move", "the whole-bill discount and the guest count, which cannot be divided"],
  ]) {
    check(
      `tablet: the split confirm says ${why}`,
      un.includes(phrase),
      `${TABLET}: unmergeTable()'s confirm must include "${phrase}". The manager's identical confirm\n    lists all three, and a waiter needs the truth before the tap at least as much.`,
    );
  }
  {
    const eps = fnBody("ensurePartySlices");
    check(
      "tablet: a party's slices are MERGED one at a time, never all at once",
      /await Promise\.all\(tables\.map/.test(eps) && /for \(const \[i, x\] of tables\.entries\(\)\)/.test(eps) && !/Promise\.all\([^)]*ensureTableSlice/.test(eps),
      `${TABLET}: ensurePartySlices must fetch the members' slices together and then merge them in a\n    ` +
      `LOOP, the way loadImpl and loadTables already do. With the members run concurrently, a party of\n    ` +
      `THREE opened from the table holding the bill announced "gets nothing back — nothing was ordered\n    ` +
      `at it" about a table holding a ₹483 ticket, and partyOrders() — the BILL — reads the same rows.\n    ` +
      `The mechanism was never pinned down; the symptom and its cure both were. Re-run a three-table\n    ` +
      `party opened from the bill-holding table if you change this.`,
    );
    check(
      "tablet: …and the close path reads that answer rather than catching a throw",
      /const readOk = await ensurePartySlices\(t\);/.test(fnBody("closeTableAndFree")),
      `${TABLET}: closeTableAndFree must READ ensurePartySlices' answer. It used to wrap it in a\n    ` +
      `try/catch, and the function no longer throws — so every failed read would look like a good one\n    ` +
      `and a table nobody could check would be reported as "already free".`,
    );
  }
  check(
    "tablet: the split confirm refuses to guess when the party's rows could not be read",
    /const readOk = await ensurePartySlices\(child, true\)/.test(un) && /if \(!readOk\)[\s\S]{0,200}?toast\(/.test(un),
    `${TABLET}: unmergeTable() must know whether the slices actually landed. ensureTableSlice swallows\n    a fetch blip on purpose, so without this the confirm reads an empty cache and announces "nothing\n    was ordered at it" about a table that is holding food — talking someone into a split by\n    understating it. Same rule closeTableAndFree already follows for "already free" vs "couldn't ask".`,
  );
  check(
    "tablet: a ⇹ tap on a merge that already ended says so instead of vanishing",
    /if \(!parent\) \{[^}]*toast\(/.test(un),
    `${TABLET}: unmergeTable() must toast when mergeParentOf() finds nothing — the button is drawn\n    from the merge list, which a poll or another device can empty between the paint and the finger.`,
  );
  check(
    "tablet: a joined table's detail carries the ⇹ unmerge row",
    /const unmergeKids = mergeParentOf\(t\) \? \[String\(t\)\] : mergeChildrenOf\(t\)/.test(src) && /data-unmerge=/.test(src),
    `${TABLET}: renderPanel() must offer ⇹ Unmerge — one button on a joined CHILD (for itself), one\n    per child on the table that HOLDS the bill. That is the manager's shape and the owner's words.`,
  );
  check(
    "tablet: the ⇹ row sits under the actions, in its own row",
    /\$\{unmergeRow\}\s*\n\s*\$\{foot\}/.test(src),
    `${TABLET}: the unmerge row belongs between the action buttons and the bill bar — not shoulder to\n    shoulder with ＋ Take order, where a thumb finds it by accident.`,
  );
  const mp = fnBody("renderMergePicker");
  check(
    "tablet: the merge undo bar lasts FIFTEEN seconds",
    /seconds: 15/.test(mp),
    `${TABLET}: renderMergePicker()'s undo bar must pass seconds: 15 (owner, 2026-08-17). Joining two\n    bills is a bigger thing to notice than serving a dish, which is why it is not the usual 5.`,
  );
  check(
    "tablet: …and its UNDO really separates them, through the same shared path",
    /onUndo: \(\) => unmergeTable\(/.test(mp),
    `${TABLET}: the merge undo must call unmergeTable(), not a second inline split.`,
  );
  check(
    "tablet: the merge follows the table the SERVER kept, never the one that was tapped",
    /onSuccess: \(r\)/.test(mp) && /r\.parent_table/.test(mp) && /r\.child_table/.test(mp),
    `${TABLET}: lfh_staff_merge_tables keeps the LOWEST table number and moves the other party onto\n    it — "if the caller merged 6 into 7, we keep 6". Guessing from the tapped table named the wrong\n    table in the toast and pointed UNDO at a table that was never joined, so the undo did nothing.`,
  );
  check(
    "tablet: the merge confirm names the table that will actually hold the bill",
    /held by \$\{tableLabel\(keeps\)\}/.test(mp),
    `${TABLET}: the merge confirm must name the surviving table (the lowest number), like the manager's\n    does. Promising "ONE bill on T25" while the bill lands on T24 sends the waiter to the wrong table.`,
  );
  check(
    "tablet: actGated hands the server's answer to onSuccess",
    /opts\.onSuccess\(r\)/.test(src),
    `${TABLET}: actGated() must call opts.onSuccess(r). A merge decides which table keeps the bill, and\n    without the response the screen can only guess.`,
  );
  check(
    "tablet: a dish on a JOINED bill is labelled with the table it was ordered at",
    /const partySpread = partyTablesOf\(t\)\.length > 1/.test(src) && /fromChip\(o\)/.test(src),
    `${TABLET}: on a merged bill every dish must carry its own table (owner, 2026-08-17: "keep a track\n    [of which] table has ordered which") — that is what makes a split readable before it happens. It\n    must render ONLY when the party spans more than one table, so an ordinary bill is untouched.`,
  );
}

// ── 7 · THE SERVER DOOR, AND THE GUEST'S SIDE OF THE SAME RULE ───────────────────────────────
{
  const routeRel = "app/api/tablet/[...path]/route.ts";
  const route = (() => { try { return fs.readFileSync(path.join(ROOT, routeRel), "utf8"); } catch { return ""; } })();
  const at = route.indexOf('a === "tables" && c === "unmerge"');
  const body = at < 0 ? "" : route.slice(at, at + 2200);
  check(
    "tablet route: /tables/:t/unmerge exists",
    at >= 0,
    `${routeRel} has no unmerge branch — the panel's ⇹ button would 404, and merging is a one-way door\n    on this device again.`,
  );
  check(
    "tablet route: it carries the SAME gate as merge (module rung + tri-state)",
    /tableOpsTabletAllowed\(rid\)/.test(body) && /tabletPerm\("tablet_table_ops"/.test(body),
    `${routeRel}: unmerge must check tableOpsTabletAllowed AND tabletPerm("tablet_table_ops"), exactly\n    like sessions/:id/merge. Splitting and joining are the same feature and must answer to the same\n    switch — the manager route was fixed for precisely this on 2026-08-05.`,
  );
  check(
    "tablet route: it calls the SAME RPC the manager calls",
    /lfh_staff_unmerge_table/.test(body),
    `${routeRel}: unmerge must go through lfh_staff_unmerge_table, so the two panels can never split a\n    party two different ways.`,
  );
  check(
    "tablet route: it drops the shared floor snapshot",
    /invalidateFloor\(rid\)/.test(body),
    `${routeRel}: every write handler calls invalidateFloor(rid), or a device keeps a stale tile.`,
  );

  // THE GUEST'S SIDE. A diner sitting at a joined table used to be told "this table isn't open" and
  // left polling forever, could never join, and rang a bell that reached no panel at all (measured
  // with the anon key, 2026-08-17). The three doors they touch must each hop to the party's table.
  const migDir = path.join(ROOT, "supabase", "migrations");
  const files = (() => { try { return fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort(); } catch { return []; } })();
  for (const [fn, why] of [
    ["lfh_table_status", 'a joined table must read as OPEN, or the diner is told to "ask staff" forever'],
    ["lfh_join_session", "a diner at a joined table must be able to join the party they are sitting in"],
    ["lfh_call_waiter_table", "the floor gathers calls BY SESSION — a bell with none is invisible to every panel"],
  ]) {
    // The NEWEST migration that defines it is the one that is live.
    const owner = files.filter((f) => {
      try { return new RegExp(`FUNCTION (public\\.)?${fn}\\s*\\(`).test(fs.readFileSync(path.join(migDir, f), "utf8")); }
      catch { return false; }
    }).pop();
    const text = owner ? fs.readFileSync(path.join(migDir, owner), "utf8") : "";
    // Only the block for THIS function — a migration may define several.
    const start = text.search(new RegExp(`FUNCTION (public\\.)?${fn}\\s*\\(`));
    const block = start < 0 ? "" : text.slice(start, start + 4000);
    check(
      `guest: ${fn} resolves through the merge parent (${why})`,
      /lfh_merge_parent_table/.test(block),
      `The newest migration defining ${fn} is ${owner || "(none found)"}, and its body never calls\n    lfh_merge_parent_table. A diner at a table that has been joined to another then falls through\n    the "no open session" branch, which is the stranding this was fixed for in migration 333.`,
    );
  }
}

// ── 8 · A SMALL TILE MUST NOT CUT OFF THE ROW YOU TAP (T7, 2026-08-19) ───────────────────────
// A tile with BOTH a badge row and an action row has four rows, which needs 104px inside a 95px
// square. `min-height: fit-content` does not save it (the box has a definite height from its 1/1
// aspect-ratio), so the overflow was hidden — and what hung off the bottom was ＋ Take order and
// ✓ Accept: 11px of a 34px row gone at 12-per-row on a desktop, 5px at 6-per-row on an iPad upright.
// Measured, and identical on a clean checkout, so it long predates this guard.
{
  const css = (() => { try { return fs.readFileSync(path.join(ROOT, CSS), "utf8"); } catch { return ""; } })();
  check(
    "tablet: a small tile carrying badges AND actions sheds the served WORDS, not the buttons",
    /@container \(max-width: 104px\)[\s\S]{0,240}?\.tile:has\(\.tbadges\):has\(\.t-act\) \.t-linenum \{ display: none/.test(css),
    `${CSS}: the tile's "shed detail on the way down" ladder needs its four-row step. Without it the\n    ` +
    `action row is clipped on exactly the tables that need attending — the ones that have rung the\n    ` +
    `bell AND placed a new order.`,
  );
  check(
    "tablet: …and the action row's own height is never shrunk to make that room",
    /\.t-act \{[^}]*min-height: clamp\(26px, 44cqw, 40px\)/.test(css),
    `${CSS}: .t-act's min-height IS the tap target (T14 sweep, 2026-08-05 — it was raised from 19px\n    ` +
    `precisely because a waiter could not hit it). Take the space from the wording, never from this.`,
  );
}

// ── 9 · A FIGURE THE WAITER HAS TO MATCH IS NEVER ROUNDED (T7 sweep #7, 2026-08-22) ─────────
// Measured on the running panel: a 40-paise shortfall in the split-payment panel came out of the
// refusal as "₹0 of the bill is still uncovered." — a refusal that names nothing, on a button that
// then refuses again, and again, with no way to tell from the screen what is wrong. The running
// line twelve pixels above it already used inrExact and said "₹0.40 still to cover", so the two
// halves of the same sentence disagreed about the same number.
//
// This panel declares BOTH helpers on purpose (see the note above inrExact): `inr` rounds to whole
// rupees and is right for a heading, `inrExact` keeps the paise and is the only correct one for a
// figure a person has to MATCH, because the server recomputes the due to the paise. So the rule is
// narrow and checkable: inside the two split screens, every refusal that quotes a gap or a target
// uses inrExact.
{
  // ONE SCREEN NOW (owner, 2026-08-28) — the KOT-menu split and the payment-sheet split were
  // merged into renderSplitBill(), so its two refusals are the whole list. The third entry that
  // used to be here ("the shares must add up to exactly …") belonged to the screen that is gone.
  const shortfall = [
    ["the split screen's shortfall refusal", /of the bill is still uncovered/],
    ["the split screen's over-collect refusal", /more than the bill/],
  ];
  // Searched in the CODE, not in the comments (2026-08-30). The first version searched raw `src`
  // and took the FIRST match — so writing a comment that QUOTES the refusal ("…refused with '₹0.25
  // more than the bill'") pointed the check at a sentence in English and failed it. A guard must
  // accuse the line that runs, never the line that explains it.
  const codeSrc = src
    .replace(/<!--[\s\S]*?-->/g, "")            // HTML comments inside the template literals
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
  for (const [what, re] of shortfall) {
    const at = codeSrc.search(re);
    const line = at < 0 ? "" : codeSrc.slice(codeSrc.lastIndexOf("\n", at) + 1, codeSrc.indexOf("\n", at));
    check(
      `tablet: ${what} quotes the gap to the PAISE (inrExact, never inr)`,
      at >= 0 && /inrExact\(/.test(line) && !/[^a-zA-Z]inr\(/.test(line),
      `${TABLET}: ${at < 0 ? "the refusal is gone — if it moved, move this check with it." : `this line rounds a figure the waiter must match:\n    ${line.trim().slice(0, 160)}`}\n    ` +
      `inr() turns a 40-paise gap into "₹0", which refuses forever and names nothing. Use inrExact.`,
    );
  }
  check(
    "tablet: the split screen's running total line still uses inrExact too",
    /const refreshSum = \(\) => \{[\s\S]{0,420}?inrExact\(left\)/.test(src),
    `${TABLET}: the running total is the line the refusal has to AGREE with — the original fault was\n    ` +
    `the two halves of one sentence quoting the same number differently ("₹0.40 still to cover" over\n    ` +
    `"₹0 of the bill is still uncovered"). If either side starts rounding, that comes back.`,
  );
  check(
    "tablet: the split's running line names an EMPTY part before it talks about the arithmetic",
    /const refreshSum = \(\) => \{\s*\n\s*const blank = legs\.filter\(\(l\) => !\(Number\(l\.amount\) > 0\)\)\.length;\s*\n\s*if \(blank\)/.test(src),
    `${TABLET}: an empty part contributes 0, so the arithmetic still balances and the line goes GREEN\n    ` +
    `while Take payment refuses "Every part needs an amount above zero". One tap reaches it —\n    ` +
    `＋ Add another part seeds "" when the bill is already covered. The line and the button under it\n    ` +
    `must never disagree about the same state; that is the ₹0-shortfall fault wearing a different hat.`,
  );
  check(
    "tablet: …and that check runs BEFORE the shortfall arithmetic, not after it",
    src.indexOf("const blank = legs.filter") < src.indexOf("const left = legLeft();\n    sumEl.textContent = left === 0"),
    `${TABLET}: if the arithmetic answers first, a balanced-but-empty split still reports ✓.`,
  );
  check(
    "tablet: there is exactly ONE split screen, and both doors open it",
    (src.match(/function renderSplitBill\(/g) || []).length === 1
      && !/function renderSplitSettle\(/.test(src)
      && /kotop === "split"\) renderSplitBill\(/.test(src)
      // ANCHORED ON THE RULE, NOT THE PUNCTUATION (T28, 2026-08-30). This read `\) \{
      // renderSplitBill\(` — the call had to be the very first thing inside the branch. The tip
      // work landed `await recordTip(t, picked.tip);` in front of it, the door still opened the one
      // split screen exactly as required, and this guard went red on a space. What the row is
      // actually promising is that the pay sheet's split door reaches renderSplitBill, so that is
      // what it now looks for, anywhere in that branch.
      && /picked\.special === "split"\)[\s\S]{0,160}?renderSplitBill\(/.test(src),
    `${TABLET}: splitting a bill must exist ONCE (owner, 2026-08-28: "both have same interface as the\n    ` +
    `kot one"). It used to exist twice, with different abilities and different endpoints, so a waiter\n    ` +
    `learned one and met the other. Both 🧾 KOT ▾ and the payment sheet's bottom line must call\n    ` +
    `renderSplitBill(), and renderSplitSettle must not come back.`,
  );
  check(
    "tablet: the one split screen offers all four ways to divide a bill",
    ["equal", "custom", "dish", "ticket"].every((m) => new RegExp(`data-mode="${m}"`).test(src)),
    `${TABLET}: he asked for "equally split custom amount by dish by Kitchen ticket" — all four tabs,\n    ` +
    `on the one screen. Dropping one silently takes a way of dividing a bill away from a restaurant.`,
  );
  check(
    "tablet: …and every part still pays its own way, pay-later included",
    /const WAYS = \["UPI", "Cash", "Card", "Other"\]\.concat\(tabletKhataOn\(\) && tshow\("tablet_khata"\) \? \[PAY_LATER\] : \[\]\)/.test(src)
      && /khataCustomerId: l\.khata\.customer_id/.test(src),
    `${TABLET}: "by each part, pays its own way. One part on somebody's tab pay later like everything"\n    ` +
    `(owner, 2026-08-28). Pay later is offered only where the restaurant HAS it and this waiter may\n    ` +
    `use it — otherwise the screen offers a part the server will refuse.`,
  );
  check(
    "tablet: the split posts to /pay-split, never the older /pay+splits",
    /actGated\("POST", `\/tables\/\$\{t\}\/pay-split`/.test(src) && !/\/pay`, \{ splits \}/.test(src),
    `${TABLET}: only /pay-split carries a pay-later part (mig 352 — it checks the khata module and\n    ` +
    `tablet_khata on top of mark_paid, and parks the tab). The older /pay+splits route refuses one,\n    ` +
    `so sending there would make "one part on somebody's tab" fail at the server.`,
  );
}

// ── 10 · ONE DIM FOR EVERY FULL-SCREEN OVERLAY (owner, 2026-08-22 — completed T7 sweep #7) ───
// `--scrim` was added to this panel's stylesheet on 2026-08-22 so that "every full-screen overlay
// dims the page by the same amount", because two overlays on one screen dimming differently is what
// makes one product feel like several. It reached the four overlays written in CSS and none of the
// ten built in app.js, nor the table-detail backdrop — so, measured on the running panel, opening a
// table (rgba(4,8,18,.5)) then its Discount (rgba(4,8,18,.66)) then a confirm (the token's
// rgba(3,7,16,.6)) dimmed the floor by THREE different amounts inside one action.
//
// Every overlay this panel builds by hand sets its dim in an inline style, so the check is exact:
// no hardcoded rgba() may sit in a `background:` beside `position: "fixed"`. The BLUR is deliberately
// NOT unified — a heavier blur is how a stacked layer says it is on top.
{
  const css = (() => { try { return fs.readFileSync(path.join(ROOT, CSS), "utf8"); } catch { return ""; } })();
  check(
    "tablet: the --scrim token is declared",
    /--scrim:\s*rgba\([\d\s,.]+\)/.test(css),
    `${CSS}: the one dim every overlay reads. Do not inline it back into each overlay.`,
  );
  const inline = [...src.matchAll(/position: "fixed"[^}]*?background: "(rgba\([^"]+\))"/g)].map((m) => m[1]);
  check(
    "tablet: no hand-built overlay hardcodes its own dim",
    inline.length === 0,
    `${TABLET}: ${inline.length} overlay(s) still set their own dim (${[...new Set(inline)].join(", ")}).\n    ` +
    `Use background: "var(--scrim)" so a sheet opened over another sheet dims by the same amount.`,
  );
  // Read the whole declaration BLOCK, never a fixed character window: these rules carry long
  // explanatory comments between the selector and the declaration, so a window is a guard that
  // fails on a comment someone added rather than on the thing it is watching.
  const ruleBlock = (sel) => {
    const at = css.indexOf(sel + " {");
    if (at < 0) return null;
    const open = css.indexOf("{", at);
    const close = css.indexOf("}", open);
    return close < 0 ? null : css.slice(open + 1, close);
  };
  const backdrop = ruleBlock("#panel:has(.detail-pop)");
  check(
    "tablet: the table-detail backdrop reads the token, not a value of its own",
    !!backdrop && /background:\s*var\(--scrim\)/.test(backdrop),
    `${CSS}: #panel:has(.detail-pop) is the backdrop a waiter sees more than any other. It read\n    ` +
    `rgba(4,8,18,.5) while the sheets above it read something else.` +
    (backdrop === null ? "\n    (the rule itself was not found — if the selector moved, move this check with it.)" : ""),
  );
  const cssDims = [...css.matchAll(/^\.(confirm-overlay|opt-overlay|qdest-overlay|tbl-drawer-backdrop)[^{]*\{[^}]*background:\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()]);
  const strays = cssDims.filter(([, v]) => v !== "var(--scrim)");
  check(
    "tablet: the four CSS overlays still read the token",
    strays.length === 0,
    `${CSS}: ${strays.map(([k, v]) => `.${k} = ${v}`).join(", ")} — these were the ones the token\n    ` +
    `already covered; a regression here undoes the whole point of it.`,
  );
}

// ── 11 · A MONEY FIGURE A FINGER TYPES GETS NO SPINNER ARROWS (owner picked, 2026-08-28) ─────
// The discount screen's three boxes are `type="number"`, so a browser draws its own ▲▼ pair inside
// each one — measured on the A35 at dpr 3, about 7px per arrow inside a 41px box, and inside the
// gold "They pay" field they were eating room from the one figure a manager reads and retypes.
// `type="number"` and `inputmode="decimal"` STAY (that is what gives a phone the numeric keypad);
// only the arrows go, and a spinner is a pseudo-element so it has to be done in the stylesheet.
{
  const css = (() => { try { return fs.readFileSync(path.join(ROOT, CSS), "utf8"); } catch { return ""; } })();
  const boxes = ["disc-pct-input", "disc-amt-input", "disc-pay-input"];
  for (const b of boxes) {
    check(
      `tablet: .${b} hides the browser's spinner arrows`,
      new RegExp(`\\.${b}::-webkit-(?:outer|inner)-spin-button`).test(css)
        && new RegExp(`\\.${b}[^{]*\\{[^}]*appearance: textfield`).test(css),
      `${CSS}: the box needs BOTH halves — the WebKit pseudo-element rule and \`appearance: textfield\`\n    ` +
      `for Firefox, which draws the arrows from the input itself. One without the other leaves them\n    ` +
      `on half the devices in a restaurant.`,
    );
  }
  check(
    "tablet: …and those boxes keep type=number + inputmode=decimal (the numeric keypad)",
    boxes.every((b) => new RegExp(`type="number"[^>]*inputmode="decimal"[^>]*class="${b}"|class="${b}"[^>]*type="number"|type="number" inputmode="decimal"[^>]*${b}`).test(src)),
    `${TABLET}: dropping the arrows must not drop the keypad. A waiter on a phone typing a discount\n    ` +
    `into a plain text box gets the full QWERTY keyboard.`,
  );
}

// ── 12 · NO FUNCTION IN THIS PANEL IS DECLARED AND NEVER USED (T7 sweep #7, 2026-08-28) ──────
// `ensureTableSlice()` sat here for weeks after `ensurePartySlices()` replaced it: ~35 lines with
// no caller, and THREE comments still sending the next reader to it. That is worse than clutter in
// the part of the panel that handles money — a caller who reached for it would have refreshed one
// table of a merged party and under-counted the bill, which is the exact fault its replacement
// exists to prevent. The ledger rows that check such a function's LOGIC keep passing while it is
// dead, so nothing else catches this.
//
// Counting rule: a function is USED if it is called `name(` OR passed by reference (`setTimeout(fn,
// 0)`, `.map(fn)`, `onclick = fn`, `LFH_BACK.layer("x", fn)`). Missing the reference case is what
// made the first version of this check flag four healthy functions — a guard that cries wolf is
// worse than no guard.
{
  const bare = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
  const declared = [...bare.matchAll(/^(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]);
  // EMPTY, AND IT SHOULD STAY EMPTY. It briefly held resolveTaxMode and taxableBaseOf, raised with
  // the owner on 2026-08-28 because each was a deliberate MIRROR of a rule living in two other
  // places; he said delete them, and they are gone. An entry here is an admission that dead code
  // was kept on purpose — add one only with the reason, and only when somebody decided it.
  const ALLOWED_DEAD = new Set([]);
  const orphans = [];
  for (const n of new Set(declared)) {
    if (ALLOWED_DEAD.has(n)) continue;
    const calls = (bare.match(new RegExp(String.raw`(?<![\w$.])` + n + String.raw`\s*\(`, "g")) || []).length;
    const refs = (bare.match(new RegExp(String.raw`(?<![\w$.])` + n + String.raw`(?!\s*\()(?![\w$])`, "g")) || []).length;
    if (calls <= 1 && refs === 0) orphans.push(n);
  }
  check(
    "tablet: no function is declared here and never called or referenced",
    orphans.length === 0,
    `${TABLET}: ${orphans.join(", ")} — declared and used nowhere.\n    ` +
    `Delete it, or give it a caller. If it is a deliberate mirror of a rule that lives elsewhere,\n    ` +
    `add it to ALLOWED_DEAD above WITH the reason, so the next reader is not sent to dead code.`,
  );
  check(
    "tablet: …and the allowance list has not quietly grown",
    ALLOWED_DEAD.size === 0,
    `scripts/verify-tablet-taps.mjs: ALLOWED_DEAD holds ${ALLOWED_DEAD.size} entr(ies). It was emptied\n    ` +
    `on 2026-08-28 and should stay empty — every entry is dead code somebody decided to keep, so a\n    ` +
    `new one needs a written reason and the owner's word, not a quiet addition to get green.`,
  );
  check(
    "tablet: ensureTableSlice specifically has not come back",
    !/^(?:async )?function ensureTableSlice\s*\(/m.test(src),
    `${TABLET}: ensureTableSlice() is back. It refreshes ONE table; a merged party needs every\n    ` +
    `member's slice or partyOrders() sees half the bill. Use ensurePartySlices().`,
  );
}

// ── 13 · ONE SWITCH, EVERY DOOR TO SPLITTING ─────────────────────────────────────────────────
//
// Splitting a bill is a per-restaurant switch that starts OFF (mig 248). It has TWO doors on this
// panel — 🧾 KOT ▾ → "Split the bill", and the small line at the bottom of the payment sheet —
// and on 2026-08-30 only the first one asked the switch: a restaurant with splitting off still had
// a waiter one tap from the whole split screen, and nothing on the server refuses a /pay-split, so
// the panel is the only gate there is. Both doors and the screen itself now read one splitBillOn().
{
  check(
    "tablet: the split switch is read through ONE splitBillOn(), not re-derived",
    /function splitBillOn\s*\(\)/.test(src),
    `${TABLET}: splitBillOn() is gone. Every door to splitting must ask the SAME function —\n    ` +
    `re-deriving state.data.settings.split_bill_enabled at each door is how one of them was missed.`,
  );
  const rederived = (src.match(/settings\s*\|\|\s*\{\}\)\.split_bill_enabled/g) || []).length;
  check(
    "tablet: …and only that function reads the raw setting",
    rederived <= 1,
    `${TABLET}: split_bill_enabled is read raw in ${rederived} places. Read it once, inside\n    ` +
    `splitBillOn(), and call that everywhere — a door that asks the setting itself is a door that\n    ` +
    `can be added without asking it at all.`,
  );
  check(
    "tablet: the KOT menu's split row asks the switch",
    /\(splitBillOn\(\)\s*\n?\s*\?\s*row\("split"/.test(src),
    `${TABLET}: the 🧾 KOT ▾ split row no longer asks splitBillOn().`,
  );
  check(
    "tablet: the payment sheet's split line asks the same switch",
    /split:\s*splitBillOn\(\)/.test(src),
    `${TABLET}: payBillWithMethod() passes split: true. The small line at the bottom of the\n    ` +
    `payment sheet is the SECOND door to the same screen — it must obey the same switch as the\n    ` +
    `first, or turning splitting off does nothing for the waiter who uses that door.`,
  );
  check(
    "tablet: and the split screen refuses to open when the switch is off",
    /if \(!splitBillOn\(\)\) \{ toast\(/.test(src),
    `${TABLET}: renderSplitBill() opens without asking splitBillOn(). Every door checks, and the\n    ` +
    `screen checks too — a third door added later must not be able to reopen this hole.`,
  );
}

// ── 14 · THE SPLIT SCREEN'S OWN TOTAL IS A FIGURE SOMEBODY MUST MATCH ────────────────────────
//
// inr() rounds to whole rupees; inrExact() keeps the paise and prints whole rupees when there are
// none. The rule (2026-08-22) is that every figure a person has to MATCH uses inrExact — and on
// 2026-08-30 the split screen was obeying it in its running line and its refusals while its own
// TITLE and its Collect button still rounded. On a ₹1,065.75 bill both said ₹1,066, so a waiter
// typing custom amounts to reach the number in front of them was refused by 25 paise they could
// not see anywhere.
{
  // The WHOLE function, not a fixed number of characters: the first version of this check sliced
  // 12,000 chars and stopped two lines before the Take-payment refusal, so it counted five figures
  // and demanded six. A guard that measures an arbitrary window is a guard that will lie later.
  const sbStart = src.indexOf("function renderSplitBill");
  const sbEnd = src.indexOf("\nfunction ", sbStart + 10);
  const sb = src.slice(sbStart, sbEnd > 0 ? sbEnd : src.length);
  check(
    "tablet: the split screen's Collect button names the bill to the paise",
    /class="btn primary big sb-go"[^`]*\$\{inrExact\(due\)\}/.test(sb),
    `${TABLET}: the split screen's Collect button uses inr(due). It is the figure the waiter types\n    ` +
    `custom amounts to match, so it must be inrExact(due) — a rounded total refuses by paise that\n    ` +
    `appear nowhere on screen.`,
  );
  check(
    "tablet: …and so does its title",
    /Split \$\{esc\(tableLabel\(t\)\)\}'s bill · \$\{inrExact\(due\)\}/.test(sb),
    `${TABLET}: the split screen's title rounds the bill. Title, button and running line are three\n    ` +
    `views of ONE number — if they disagree the waiter is asked to match a total that is not the total.`,
  );
  check(
    "tablet: the split screen's running line and refusals still keep their paise",
    (sb.match(/inrExact\(/g) || []).length >= 6,
    `${TABLET}: renderSplitBill now has fewer than six inrExact() figures — something that a person\n    ` +
    `must match has gone back to whole rupees.`,
  );
}

// ── 15 · A MONEY BOX MUST ACCEPT THE NUMBER THE SCREEN PUTS IN IT ────────────────────────────
//
// The owner ruled on this for the split screen's amount box (2026-08-29) and it holds wherever the
// panel fills a number box in itself: `step="1"` on a box the code writes 12.5 or 153.29 into is a
// box refusing its own contents — a hardware ↑/↓ snaps it to a whole number and a waiter correcting
// a figure by hand is pushed to whole rupees on a bill that carries paise. The discount sheet had
// all three (2026-08-30): paint() writes the percent to one decimal and the amount with round2.
{
  for (const cls of ["disc-pct-input", "disc-amt-input", "disc-pay-input", "sb-amt"]) {
    const line = (src.split("\n").find((l) => l.includes(`class="${cls}"`)) || "");
    check(
      `tablet: .${cls} steps in paise, not whole rupees`,
      /step="0\.01"/.test(line),
      `${TABLET}: .${cls} declares ${(line.match(/step="[^"]*"/) || ["no step"])[0]}. This screen writes\n    ` +
      `fractional figures into that box itself, so step="1" makes it refuse its own contents.`,
    );
    check(
      `tablet: .${cls} still asks for the numeric keypad`,
      /inputmode="decimal"/.test(line) && /type="number"/.test(line),
      `${TABLET}: .${cls} lost type="number" / inputmode="decimal" — a waiter on a tablet gets the\n    ` +
      `letter keyboard for a money field.`,
    );
  }
}

// ── 16 · A MOVE THAT WORKED SAYS SO ──────────────────────────────────────────────────────────
//
// Moving a dish has always ended with "Dish moved to table N (new KOT)". Moving a KOT ended with
// nothing at all (found 2026-08-30): the picker closed and the waiter was left to spot one missing
// ticket on a bill that may have four. The manager panel's twin says "KOT moved to <table>", so
// this was also two panels answering the same tap two different ways.
{
  const target = fnBody("renderMoveOrderTarget");
  check(
    "tablet: moving a kitchen ticket tells the waiter it happened",
    /toast\(`KOT moved to \$\{tableLabel\(to\)\}`\)/.test(target),
    `${TABLET}: renderMoveOrderTarget()'s runOptimistic has no success hook. A move that only\n    ` +
    `repaints is indistinguishable from a tap that did nothing — its sibling (move a dish) and the\n    ` +
    `manager panel both say it out loud.`,
  );
  check(
    "tablet: …and names the table the way the waiter knows it",
    /tableLabel\(to\)/.test(target) && !/moved to T\$\{to\}/.test(target),
    `${TABLET}: that message names a bare table number. A renamed table (mig 131) must read by its\n    ` +
    `name here, exactly as it does on the tile and on the paper.`,
  );
  check(
    "tablet: moving a dish still says so too",
    /toast: `Dish moved to table \$\{to\} \(new KOT\)`/.test(src),
    `${TABLET}: the dish move lost its success message.`,
  );
}

// ── 17 · THE ADMIN RIBBON ONLY LISTS CONTROLS THAT ARE ON THIS PANEL ─────────────────────────
//
// The ribbon counts "N controls off for waiters" and every one is meant to be a thing the admin can
// see tinted cyan on the screen in front of them. Two keys have had to be removed for the same
// reason: tablet_invoice (a waiter can never issue one) and, on 2026-08-30, tablet_parcel — 🥡
// Parcel left this panel on 2026-08-03, so that switch takes nothing away here. Both inflated the
// count with an invisible item and deep-linked the admin to a switch that changes nothing.
{
  const caps = (src.match(/const XRAY_CAPS = \[([\s\S]*?)\];/) || [])[1] || "";
  const keys = [...caps.matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);
  check(
    "tablet: the admin ribbon lists only waiter controls this panel actually has",
    keys.length > 0 && keys.every((k) => k === "tablet_table_ops" || (src.match(new RegExp(k, "g")) || []).length >= 2),
    `${TABLET}: XRAY_CAPS lists ${keys.join(", ")} — one of them is mentioned nowhere else in this\n    ` +
    `file, so nothing on this panel changes when it is off and the ribbon is counting a control the\n    ` +
    `admin cannot see.`,
  );
  for (const dead of ["tablet_invoice", "tablet_parcel"]) {
    check(
      `tablet: …and ${dead} specifically has not come back to it`,
      !keys.includes(dead),
      `${TABLET}: XRAY_CAPS lists ${dead} again. ${dead === "tablet_invoice" ? "A waiter can never issue an invoice" : "🥡 Parcel left this panel on 2026-08-03"},\n    ` +
      `so the row sends the admin to a switch that changes nothing here.`,
    );
  }
  check(
    "tablet: the ribbon still lists the controls that ARE here",
    ["tablet_take_orders", "tablet_discount", "tablet_mark_paid", "tablet_table_ops", "tablet_khata"].every((k) => keys.includes(k)),
    `${TABLET}: XRAY_CAPS has lost a control the panel really has — the admin would see it tinted\n    ` +
    `with nothing in the list explaining why.`,
  );
}

// ── 18 · EVERY CONTROL ON THIS PANEL IS 44px, INCLUDING THE ONES THAT ARE NOT `.btn` ─────────
//
// style.css line ~960 says `.panel .btn, .floor-nav button { min-height: 44px }`. ✓ Accept is its
// own class (`.accept`), so the rule never reached it and it rendered 38px — the one control on the
// table detail below the size the rest of the panel holds itself to, and the one a waiter hits most
// often with a tray in the other hand (measured on an iPad, 2026-08-30).
{
  const css = (() => { try { return fs.readFileSync(path.join(ROOT, CSS), "utf8"); } catch { return ""; } })();
  for (const cls of ["accept", "qo-top"]) {
    const rule = (css.match(new RegExp(`\\.${cls}\\s*\\{[^}]*\\}`)) || [])[0] || "";
    check(
      `tablet: .${cls} is at least 44px tall, like every other control here`,
      /min-height:\s*44px/.test(rule),
      `${CSS}: .${cls} declares no min-height of 44px. Every other button on this panel gets one\n    ` +
      `from \`.panel .btn\`; a control with its own class has to say it itself, or it silently ends\n    ` +
      `up smaller than the rule the panel holds itself to.`,
    );
  }
  check(
    "tablet: …and the panel-wide 44px rule is still there for the ones that ARE .btn",
    /\.panel \.btn[^{]*\{[^}]*min-height:\s*44px/.test(css),
    `${CSS}: the panel-wide \`min-height: 44px\` for .btn is gone. Every control on this panel is\n    ` +
    `sized by that one line; without it they each drift on their own.`,
  );
}

// ── 19 · A CLASH IS TWO SENTENCES, AND THE SECOND ONE IS THE USEFUL ONE ──────────────────────
//
// lib/clash.ts sends `plain` (what happened) and `todo` (what to do about it — "Your change was NOT
// saved. Look at what it says now and redo yours if it's still right."). Two of the four places
// this panel handles a clash showed only `plain`, so a waiter learned another device had changed
// the order and never learned their own change had been dropped. Found 2026-08-30 by replaying the
// server's own clash payload.
{
  // A STATEMENT, NOT A LINE. errText() is written across two lines — the condition tests
  // `clash.plain` on one and the `+ clash.todo` is on the next — so a per-line regex accused the
  // one place that has always been right. Read a small window from each mention instead.
  const shows = [...src.matchAll(/clash\.plain/g)].map((m) => src.slice(m.index, m.index + 160).split("\n").slice(0, 2).join(" "));
  check(
    "tablet: every clash message shows the TODO as well as the plain sentence",
    shows.length > 0 && shows.every((line) => /clash\.todo|\.todo/.test(line)),
    `${TABLET}: ${shows.filter((l) => !/todo/.test(l)).length} of ${shows.length} clash messages show only\n    ` +
    `clash.plain:\n    ${(shows.find((l) => !/todo/.test(l)) || "").trim().slice(0, 140)}\n    ` +
    `\`todo\` is the half that says the change was NOT saved — without it the waiter does not know\n    ` +
    `whether to do it again.`,
  );
  check(
    "tablet: …and a clash is given longer on screen than an ordinary note",
    shows.filter((l) => /toast\(/.test(l)).every((l) => /9000|\d{4}/.test(l)),
    `${TABLET}: a clash message uses the default 2.6s. Two sentences about somebody else's edit\n    ` +
    `need longer than a glance.`,
  );
}

// ── 20 · NOTHING ON A TILE IS SMALLER THAN 9px, AND THE WORDS ARE 10px ───────────────────────
//
// The tile's text scales with the TILE (cqw) between a floor and a ceiling. On a 10-inch tablet
// held upright at 6 per row the tiles come out 116px and the cqw term bottoms out, so what a waiter
// actually reads is the FLOOR. Thirty-four strings sat at exactly 9px — "Free", "＋", "Take order"
// (measured on five devices, 2026-08-30). The owner asked for it raised: the floors moved, the
// scaling and the maxima did not, so nothing changed on a tile that was already big enough.
// Re-measured at 360, 430, 834, 1024 and 1194px in both skins: nothing clips, nothing overflows.
{
  const css = (() => { try { return fs.readFileSync(path.join(ROOT, CSS), "utf8"); } catch { return ""; } })();
  // Every clamp() that sets a font-size inside the tile block, with its floor.
  const tileBlock = css.slice(css.indexOf(".t-top {"), css.indexOf("/* ── SHED DETAIL ON THE WAY DOWN"));
  const floors = [...tileBlock.matchAll(/font-size:\s*clamp\(\s*([\d.]+)px/g)].map((m) => Number(m[1]));
  check(
    "tablet: no text on a floor tile can fall below 9px",
    floors.length > 0 && floors.every((f) => f >= 9),
    `${CSS}: ${floors.filter((f) => f < 9).length} tile font-size clamp(s) have a floor under 9px ` +
    `(${floors.filter((f) => f < 9).join(", ")}).\n    ` +
    `The floor is what a waiter actually reads on a dense floor — the cqw term has already bottomed ` +
    `out there.`,
  );
  check(
    "tablet: …and the WORDS on it are at least 10px",
    /\.t-take \{[\s\S]{0,400}?font-size:\s*clamp\(\s*10px/.test(css) && /\.t-line-plain \.t-linenum \{ font-size: clamp\(10px/.test(css),
    `${CSS}: ＋ Take order or the served line has dropped below a 10px floor. Those two are the ` +
    `words on the tile;\n    the served line's two halves share one floor on purpose.`,
  );
  check(
    "tablet: …and the table number keeps its own 10px floor",
    /\.tnum \{ font-size: clamp\(10px/.test(css),
    `${CSS}: .tnum's floor is no longer 10px. It is the biggest thing on the tile and the first ` +
    `thing read.`,
  );
  // The destructive control on a dish row is at least as big as the harmless ones beside it.
  const idel = (css.match(/\.idel \{[^}]*\}/) || [""])[0];
  const qbtn = (css.match(/\.qbtn \{[^}]*\}/) || [""])[0];
  const px = (rule, prop) => Number(((rule.match(new RegExp(prop + ":\\s*([\\d.]+)px")) || [])[1]) || 0);
  check(
    "tablet: 🗑 is at least as big as the − and + beside it",
    px(idel, "height") >= px(qbtn, "height") && px(idel, "height") >= 40,
    `${CSS}: .idel is ${px(idel, "height") || "auto"}px tall against .qbtn's ${px(qbtn, "height")}px. ` +
    `It was 37px —\n    the smallest control on the panel and the only DESTRUCTIVE one, between two ` +
    `40px buttons that merely change a number.`,
  );
  // …AND SO IS EVERY OTHER CONTROL ON THAT ROW. The first version of this check named .idel and
  // .qbtn only, and missed ✓ Serve one line over at 29px — the button that does the actual job on
  // a dish row, two-thirds the height of the − and + beside it (found by the fifth pass, hours
  // after item 25 shipped). A rule written for two of the three controls on a row is half a rule.
  {
    const serve = (css.match(/\.ist-serve \{[^}]*\}/) || [""])[0];
    check(
      "tablet: ✓ Serve is as tall as the rest of its dish row",
      Number(((serve.match(/min-height:\s*([\d.]+)px/) || [])[1]) || 0) >= 40,
      `${CSS}: .ist-serve is ${(serve.match(/min-height:[^;]*/) || ["sized by padding"])[0]} against ` +
      `.qbtn's 40px square.\n    It is the control that marks a dish delivered — the one thing on ` +
      `that row a waiter taps on purpose.`,
    );
  }
  check(
    "tablet: …and 🗑 is a square, not a padded glyph that shrinks with its font",
    /width:\s*40px/.test(idel) && /height:\s*40px/.test(idel),
    `${CSS}: .idel is sized by padding again. A padded glyph changes size with its font; the − and + ` +
    `beside it are a fixed square, and a delete should not be the odd one out.`,
  );
}

// ── report ───────────────────────────────────────────────────────────────────────────────────
for (const c of checks) console.log(`${c.ok ? "  ok  " : " FAIL "} ${c.name}`);
if (fails.length) {
  console.error(`\n${fails.length} of ${checks.length} waiter-tablet checks FAILED:\n\n  - ${fails.join("\n\n  - ")}\n`);
  console.error("Background: scripts/verify-tablet-taps.mjs header (sweep #6, T7).");
  process.exit(1);
}
console.log(`\nAll ${checks.length} checks passed — no waiter tap on this panel dies in silence, and no picker lies about where a thing can go.`);
