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
import path from "node:path";
import vm from "node:vm";

const ROOT = process.argv[2] || process.cwd();
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
    "tablet: the split-payment button it copies still refuses out loud too",
    /goBtn\.onclick[\s\S]{0,600}?toast\(/.test(src),
    `In ${TABLET}, the split "Take payment" button is the pattern #payBill now follows — if it ever\n    ` +
    `goes back to being disabled, the two controls disagree about the same situation again.`,
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

// ── report ───────────────────────────────────────────────────────────────────────────────────
for (const c of checks) console.log(`${c.ok ? "  ok  " : " FAIL "} ${c.name}`);
if (fails.length) {
  console.error(`\n${fails.length} of ${checks.length} waiter-tablet checks FAILED:\n\n  - ${fails.join("\n\n  - ")}\n`);
  console.error("Background: scripts/verify-tablet-taps.mjs header (sweep #6, T7).");
  process.exit(1);
}
console.log(`\nAll ${checks.length} checks passed — no waiter tap on this panel dies in silence, and no picker lies about where a thing can go.`);
