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

// ── report ───────────────────────────────────────────────────────────────────────────────────
for (const c of checks) console.log(`${c.ok ? "  ok  " : " FAIL "} ${c.name}`);
if (fails.length) {
  console.error(`\n${fails.length} of ${checks.length} waiter-tablet checks FAILED:\n\n  - ${fails.join("\n\n  - ")}\n`);
  console.error("Background: scripts/verify-tablet-taps.mjs header (sweep #6, T7).");
  process.exit(1);
}
console.log(`\nAll ${checks.length} checks passed — no waiter tap on this panel dies in silence, and no picker lies about where a thing can go.`);
