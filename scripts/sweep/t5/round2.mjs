// Sweep #8 · terminal 5 · ROUND 2 — P94701–P95200, a fresh 500.
//
// The owner's word after round 1 was merged and deployed (2026-09-02): "plan 500 phases test
// within your boundaries make sure it cover everthing within your boundries and test everything
// again if any error left".
//
// PLANNED FROM A MEASUREMENT, NOT A FRESH IDEA. Round 1 filed 691 rows and they were mostly
// "does the code say X" — which found four real faults, and cannot tell you what a function DOES
// with a hostile input. Counting every named thing in the 40 files against every round-1 row:
// 623 of 967 were never mentioned at all. So round 2 is aimed at those, and is a different KIND
// of check:
//
//   R1  P94701–P94900  200  BEHAVIOUR, EXECUTED — the territory's own functions lifted out and RUN
//   R2  P94901–P94990   90  THE WIRING — every event, class, storage key has both ends
//   R3  P94991–P95060   70  THE BRANCHES round 1 read but never ran
//   R4  P95061–P95150   90  DRIVEN LIVE — the surfaces round 1 never opened (round2-live.mjs)
//   R5  P95151–P95200   50  SABOTAGE — break each fix and each guard, prove it goes red
//
//   node scripts/sweep/t5/round2.mjs        # R1, R2, R3, R5
//   node scripts/sweep/t5/round2-live.mjs   # R4
import { read, exists, check, skip, report, has, hasNot, countOf, eq, codeOf, ROOT } from "./lib.mjs";
import { lift, renderedClasses } from "./lib2.mjs";
import fs from "node:fs";
import path from "node:path";

const C = (n) => read(`components/${n}.tsx`);
const SW = read("public/sw.js"), OFF = read("public/offline.html"), I18N = read("lib/i18n.ts");
const CSS = read("app/globals.css");

/* ══════════ R1 · BEHAVIOUR, EXECUTED (P94701–P94900) ══════════ */

// ── R1a · FitNumber.shortIndian — the figure a dashboard falls back to ──
const shortIndian = lift("components/FitNumber.tsx", "shortIndian");
const SI = [
  ["P94701", "₹84,45,067", "₹84.5 L", "lakhs, one decimal"],
  ["P94702", "₹3,08,00,000", "₹3.1 Cr", "crores, one decimal"],
  ["P94703", "₹12,500", "₹12.5K", "thousands"],
  ["P94704", "₹999", null, "under a thousand is left exactly as it is"],
  ["P94705", "₹1,000", "₹1K", "the boundary at a thousand"],
  ["P94706", "₹1,00,000", "₹1 L", "the boundary at a lakh"],
  ["P94707", "₹1,00,00,000", "₹1 Cr", "the boundary at a crore"],
  ["P94708", "₹99,999", "₹100K", "just under a lakh stays in thousands"],
  ["P94709", "₹1,50,00,00,000", "₹150 Cr", "past a hundred crore it drops the decimal"],
  ["P94710", "84,45,067", "84.5 L", "no currency mark at all"],
  ["P94711", "₹84,45,067.50", "₹84.5 L", "paise are dropped by the scale, not by rounding twice"],
  ["P94712", "$1,234,567", "$12.3 L", "a non-rupee mark is kept, and the SCALE is still Indian"],
  ["P94713", "", null, "an empty string is not a number"],
  ["P94714", "—", null, "an em-dash placeholder is not a number"],
  ["P94715", "₹0", null, "zero is under a thousand, so it is left alone"],
];
for (const [id, input, want, why] of SI)
  check(id, `shortIndian(${JSON.stringify(input)}) → ${JSON.stringify(want)} — ${why}`, () =>
    eq(shortIndian(input), want));
check("P94716", "shortIndian keeps a trailing suffix on the number it shortens", () =>
  eq(shortIndian("₹84,45,067 total"), "₹84.5 L total"));
check("P94717", "shortIndian never returns something LONGER than it was given", () => {
  const bad = ["₹1,000", "₹84,45,067", "₹3,08,00,000", "₹99,999", "₹1,50,00,00,000"]
    .map((s) => [s, shortIndian(s)]).filter(([s, r]) => r && r.length >= s.length);
  return bad.length === 0 || bad.map(([s, r]) => `${s}→${r}`).join(", ");
});
check("P94718", "shortIndian cannot throw on any shape a tile might hold", () => {
  for (const s of ["", " ", "abc", "₹", "1e9", "NaN", "Infinity", "₹-4,500", "₹1,2,3", "٤٥٠٠", "₹1,000,000"])
    shortIndian(s);
  return true;
});
// EXPECTATION CORRECTED on the first run: I assumed a negative was refused, and it is not — the
// prefix group takes "-₹" and hands it back. That is the RIGHT behaviour; the fault worth guarding
// is the opposite one, a minus that goes missing and turns a refund into a charge.
check("P94719", "a negative figure keeps its minus when it is shortened", () =>
  eq(shortIndian("-₹84,45,067"), "-₹84.5 L"));

// ── R1b · ToastHost.splitMessage — how a notice reads ──
const splitMessage = lift("components/ToastHost.tsx", "splitMessage");
const SM = [
  ["P94720", ["Espresso added"], { title: "Espresso", subtitle: "added to order" }],
  ["P94721", ["Table 4 updated"], { title: "Table 4", subtitle: "updated" }],
  ["P94722", ["Hello"], { title: "Hello", subtitle: "" }],
  ["P94723", ["Espresso added", "on the house"], { title: "Espresso added", subtitle: "on the house" }],
  ["P94724", ["Espresso added", ""], { title: "Espresso added", subtitle: "" }],
  ["P94725", ["ADDED"], { title: "ADDED", subtitle: "" }],
  ["P94726", ["Extra shot ADDED"], { title: "Extra shot", subtitle: "added to order" }],
  ["P94727", [""], { title: "", subtitle: "" }],
];
for (const [id, args, want] of SM)
  check(id, `splitMessage(${args.map((a) => JSON.stringify(a)).join(", ")}) reads as "${want.title}" / "${want.subtitle}"`,
    () => eq(JSON.stringify(splitMessage(...args)), JSON.stringify(want)));
check("P94728", "a caller's own subtitle always wins, even when the message looks like a pattern", () =>
  eq(splitMessage("Espresso added", "twice").subtitle, "twice"));
check("P94729", "splitMessage never invents a subtitle for a sentence that is not one of the two shapes", () =>
  eq(splitMessage("We couldn't reach the kitchen").subtitle, ""));

// ── R1c · BackQuitDialog.isHomePath — one back press must never leave the site ──
const isHomePath = lift("components/BackQuitDialog.tsx", "isHomePath", {
  HOME_PATHS: ["/", "/menu"],
  TENANT_MENU: new RegExp(C("BackQuitDialog").match(/const TENANT_MENU = \/(.+?)\/;/)[1]),
  QR_MENU: new RegExp(C("BackQuitDialog").match(/const QR_MENU = \/(.+?)\/;/)[1]),
});
const HP = [
  ["P94730", "/", true], ["P94731", "/menu", true],
  ["P94732", "/r/aangan-garden-restaurant/menu", true],
  ["P94733", "/r/aangan-garden-restaurant/menu/", true],
  ["P94734", "/q/W5QRFWZU", true], ["P94735", "/q/W5QRFWZU/", true],
  ["P94736", "/r/a/item/soup", false], ["P94737", "/item/soup", false],
  ["P94738", "/view/soup", false], ["P94739", "/manager", false],
  ["P94740", "/r/a/menu/extra", false], ["P94741", "/q/A/B", false],
  ["P94742", "/menu2", false], ["P94743", "/menux", false],
  ["P94744", "/r//menu", false],
];
for (const [id, p, want] of HP)
  check(id, `the exit guard ${want ? "arms" : "stays off"} on ${p}`, () => eq(isHomePath(p), want));

// ── R1d · GuestOutboxChip — the words a diner reads about their own saved work ──
const OB = "components/GuestOutboxChip.tsx";
const isCall = lift(OB, "isCall"), isLeave = lift(OB, "isLeave");
const callText = lift(OB, "callText");
const itemsText = lift(OB, "itemsText", { isLeave, isCall, callText });
check("P94745", "a saved ORDER with a summary names its dishes", () =>
  eq(itemsText({ kind: "order", track: { items: [{ qty: 2, title: "Espresso" }, { qty: 1, title: "Croissant" }] } }),
     "2 × Espresso, 1 × Croissant"));
check("P94746", "a saved order with only a count says '1 item'", () =>
  eq(itemsText({ kind: "order", track: { itemCount: 1 } }), "1 item"));
check("P94747", "…and '3 items' for more than one", () =>
  eq(itemsText({ kind: "order", track: { itemCount: 3 } }), "3 items"));
check("P94748", "a saved WATER request says water, never '0 items'", () =>
  eq(itemsText({ kind: "call", reason: "Water" }), "Water"));
check("P94749", "a saved request with no reason still says what it is", () =>
  eq(itemsText({ kind: "call" }), "A request for staff"));
check("P94750", "a saved 'I've left this table' says so", () =>
  eq(itemsText({ kind: "leave" }), "Leaving your table"));
check("P94751", "a leave is never mistaken for a call", () => eq(isCall({ kind: "leave" }), false));
check("P94752", "…nor a call for a leave", () => eq(isLeave({ kind: "call" }), false));
check("P94753", "an order with NOTHING on it still never prints '0 items' as a lie about a call", () =>
  eq(itemsText({ kind: "order", items: [] }), "0 items"));
check("P94754", "a blank reason falls back rather than printing an empty line", () =>
  eq(itemsText({ kind: "call", reason: "   " }), "A request for staff"));
const whenText = lift(OB, "whenText");
check("P94755", "whenText(0) says 'just now' rather than 1970", () => eq(whenText(0), "just now"));
check("P94756", "something seconds old reads 'a moment ago'", () => eq(whenText(Date.now() - 5_000), "a moment ago"));
check("P94757", "something 12 minutes old reads '12 min ago'", () => eq(whenText(Date.now() - 12 * 60_000), "12 min ago"));
check("P94758", "past an hour it switches to a clock time, not '75 min ago'", () =>
  /\d{1,2}:\d\d (am|pm)/.test(whenText(Date.now() - 75 * 60_000)) || whenText(Date.now() - 75 * 60_000));
check("P94759", "midnight reads as 12:xx am, never 0:xx", () => {
  const d = new Date(); d.setHours(0, 7, 0, 0);
  return /^12:07 am$/.test(whenText(d.getTime() - 3 * 3600_000 + 3 * 3600_000 - 0)) || whenText(d.getTime());
});
// YESTERDAY, not today: a time later than "now" is in the FUTURE, so the minutes are negative and
// the helper correctly says "a moment ago" — which is the check being wrong, not the code.
const atClock = (h, m) => { const d = new Date(Date.now() - 86_400_000); d.setHours(h, m, 0, 0); return d.getTime(); };
check("P94874", "midnight reads as 12:xx am, never 0:xx", () => eq(whenText(atClock(0, 7)), "12:07 am"));
check("P94760", "noon reads as 12:xx pm, never 0:xx", () => eq(whenText(atClock(12, 5)), "12:05 pm"));
check("P94761", "a single-digit minute keeps its leading zero", () => eq(whenText(atClock(19, 4)), "7:04 pm"));
const count2 = lift(OB, "count2", { isLeave, isCall });
check("P94762", "one saved order is counted as '1 order'", () => eq(count2([{ kind: "order" }]), "1 order"));
check("P94763", "two saved orders are '2 orders'", () => eq(count2([{ kind: "order" }, { kind: "order" }]), "2 orders"));
check("P94764", "one saved request is '1 request for staff', never an order", () =>
  eq(count2([{ kind: "call" }]), "1 request for staff"));
check("P94765", "two saved requests are '2 requests for staff'", () =>
  eq(count2([{ kind: "call" }, { kind: "call" }]), "2 requests for staff"));
check("P94766", "a saved leave is '1 message to the restaurant'", () =>
  eq(count2([{ kind: "leave" }]), "1 message to the restaurant"));
check("P94767", "a MIXED queue drops the noun rather than calling water an order", () =>
  eq(count2([{ kind: "order" }, { kind: "call" }]), "2"));
check("P94768", "…including an order mixed with a leave", () =>
  eq(count2([{ kind: "order" }, { kind: "leave" }]), "2"));
// ✅ NOT a finding, and worth writing down so nobody files it. count2([]) says "0 messages to the
// restaurant", because `[].every(...)` is vacuously TRUE and the leave branch is tested first. It
// can never reach a screen: the chip returns null at count === 0, and the only two callers pass a
// list that is non-empty by the test right in front of them (`failed.length ? … : …`). Asserting
// the guard is the honest check; asserting a string nobody can see would be theatre.
check("P94769", "an empty queue can never reach the label, so its vacuous wording is unreachable", () =>
  has(C("GuestOutboxChip"), /if \(count === 0\) return null;/) === true &&
  has(C("GuestOutboxChip"), /failed\.length\n?\s*\? `\$\{count2\(failed\)\} couldn’t send`/) === true);

// ── R1e · ConnectionBadge.computeView — the light every screen trusts ──
const CBF = "components/ConnectionBadge.tsx";
// Lifted, not hand-sliced: the first attempt cut the source by hand and shipped its TypeScript
// return type into `new Function`, which is a check failing on its own parser.
const latencyTier = lift("lib/connectionStatus.ts", "latencyTier");
const computeView = lift(CBF, "computeView", { latencyTier, LATENCY_FRESH_MS: 90_000 });
const statusLine = lift(CBF, "statusLine");
check("P94770", "offline shows no bars and the word Offline", () => {
  const v = computeView("offline", true, 42, Date.now(), false);
  return (v.bars === 0 && v.label === "Offline" && v.ms === null) || JSON.stringify(v);
});
check("P94771", "a first connect that has not happened reads 'Connecting…', never 'Reconnecting'", () =>
  eq(computeView("weak", false, null, 0, false).label, "Connecting…"));
check("P94772", "…and is calm grey, not alarming amber", () =>
  eq(computeView("weak", false, null, 0, false).color, "#94a3b8"));
check("P94773", "a drop AFTER we were connected does read 'Reconnecting'", () =>
  eq(computeView("weak", true, null, 0, false).label, "Reconnecting"));
check("P94774", "the poll-only owner panel says 'Retrying' instead", () =>
  eq(computeView("weak", true, null, 0, true).label, "Retrying"));
check("P94775", "online with a FRESH reading shows the millisecond figure", () =>
  eq(computeView("online", true, 42, Date.now(), false).ms, 42));
check("P94776", "online with a STALE reading shows a calm 'Live' and no number", () => {
  const v = computeView("online", true, 42, Date.now() - 200_000, false);
  return (v.label === "Live" && v.ms === null) || JSON.stringify(v);
});
check("P94777", "online with NO reading ever taken is still 'Live', not an error", () =>
  eq(computeView("online", true, null, 0, false).label, "Live"));
check("P94778", "the poll-only panel never shows a millisecond figure, however fresh", () =>
  eq(computeView("online", true, 42, Date.now(), true).ms, null));
check("P94779", "…and says 'Connected' rather than 'Live', because it is not live", () =>
  eq(computeView("online", true, 42, Date.now(), true).label, "Connected"));
check("P94780", "only the two waiting states pulse", () => {
  const p = (a, b, c, d, e) => computeView(a, b, c, d, e).pulse;
  return (p("offline", true, null, 0, false) === false && p("weak", false, null, 0, false) === true &&
          p("weak", true, null, 0, false) === true && p("online", true, null, 0, false) === false) || "the pulse is on the wrong states";
});
check("P94781", "every state returns a real colour and a real tint", () => {
  const bad = [["offline", true], ["weak", false], ["weak", true], ["online", true]]
    .map(([l, e]) => computeView(l, e, 42, Date.now(), false))
    .filter((v) => !/^#|^rgba/.test(v.color) || !/^rgba/.test(v.tint));
  return bad.length === 0 || JSON.stringify(bad);
});
check("P94782", "the bar count carries the same meaning as the colour, so it is never colour-only", () => {
  const off = computeView("offline", true, null, 0, false), live = computeView("online", true, null, 0, false);
  return (off.bars < live.bars) || `${off.bars} vs ${live.bars}`;
});
check("P94783", "the status sentence never names a millisecond figure a diner cannot use", () =>
  hasNot(statusLine(computeView("online", true, 42, Date.now(), false), false), /\d+\s*ms/));
check("P94784", "offline says 'No internet connection' in words", () =>
  eq(statusLine(computeView("offline", true, null, 0, false), false), "No internet connection"));
check("P94785", "the poll-only panel's sentence says how often it refreshes", () =>
  /refreshes every minute/.test(statusLine(computeView("online", true, null, 0, true), true)));
check("P94786", "a dropped live connection says it is reconnecting", () =>
  /reconnecting/i.test(statusLine(computeView("weak", true, null, 0, false), false)));

// ── R1f · OfflineNotice — how old is 'old', and which screens stay quiet ──
const ON = C("OfflineNotice");
const ago = lift("components/OfflineNotice.tsx", "ago");
check("P94787", "ago(0) says 'earlier' rather than 1970", () => eq(ago(0), "earlier"));
check("P94788", "a reply saved seconds ago reads 'a moment ago'", () => eq(ago(Date.now() - 4000), "a moment ago"));
check("P94789", "…and 7 minutes ago reads '7 min ago'", () => eq(ago(Date.now() - 7 * 60_000), "7 min ago"));
check("P94790", "past an hour it becomes a clock time", () =>
  /\d{1,2}:\d\d (am|pm)/.test(ago(Date.now() - 3 * 3600_000)) || ago(Date.now() - 3 * 3600_000));
check("P94791", "the two age helpers agree — the strip and the chip speak one voice", () => {
  const t = Date.now() - 23 * 60_000;
  return eq(ago(t), whenText(t));
});
const isPanelHost = lift("components/OfflineNotice.tsx", "isPanelHost");
const PH = [
  ["P94792", "/manager", true], ["P94793", "/kitchen", true], ["P94794", "/tablet", true],
  ["P94795", "/r/a/manager", true], ["P94796", "/r/a/kitchen", true], ["P94797", "/r/a/tablet", true],
  ["P94798", "/owner/menu", true], ["P94799", "/owner/manager", true], ["P94800", "/owner/inventory", true],
  ["P94801", "/owner", false], ["P94802", "/owner/reports", false],
  ["P94803", "/menu", false], ["P94804", "/r/a/menu", false], ["P94805", "/q/ABC", false],
  ["P94806", "/aevinite", false], ["P94807", "/managerx", false],
];
for (const [id, p, want] of PH)
  check(id, `the offline strip ${want ? "stays quiet" : "may speak"} on ${p}`, () => eq(isPanelHost(p), want));

// ── R1g · the offline layer's own routing decisions, run ──
const swFn = (name) => {
  const m = SW.match(new RegExp(`const ${name} = ([\\s\\S]*?);\\n`));
  return new Function("NEVER", "DATA_PATHS", `return ${m[1]};`);
};
const NEVER = new Function(`return ${SW.slice(SW.indexOf("const NEVER = ["), SW.indexOf("];", SW.indexOf("const NEVER = [")) + 1).replace("const NEVER = ", "")};`)();
const DATA_PATHS = new Function(`return ${SW.slice(SW.indexOf("const DATA_PATHS = ["), SW.indexOf("\n];", SW.indexOf("const DATA_PATHS = [")) + 2).replace("const DATA_PATHS = ", "")};`)();
const isNever = (p) => NEVER.some((re) => re.test(p));
const isData = (p) => DATA_PATHS.some((re) => re.test(p));
const isBigMedia = swFn("isBigMedia")();
const isDevPlumbing = swFn("isDevPlumbing")();
const apiFamily = swFn("apiFamily")();
// TABLE_PARAMS is read from the FILE, not written out here. Passing my own copy meant emptying
// the real one changed nothing this band could see — a check testing its own constant.
const TABLE_PARAMS = new Function(`return ${SW.match(/const TABLE_PARAMS = (\[[^\]]*\])/)[1]};`)();
const shellKey = new Function("TABLE_PARAMS", `return ${SW.slice(SW.indexOf("const shellKey = "), SW.indexOf("\n};", SW.indexOf("const shellKey = ")) + 2).replace("const shellKey = ", "")};`)(TABLE_PARAMS);
const rscKey = swFn("rscKey")();
const NEV = [
  ["P94808", "/api/login", true], ["P94809", "/api/staff-login", true], ["P94810", "/api/panel-login", true],
  ["P94811", "/api/owner/login", true], ["P94812", "/api/health", true],
  ["P94813", "/api/editor/floor", false], ["P94814", "/api/owner/summary", false],
  ["P94815", "/api/r/x/menu-data", false], ["P94816", "/login", false], ["P94817", "/staff-login", false],
];
for (const [id, p, want] of NEV)
  check(id, `${p} is ${want ? "never" : "allowed to be"} saved on a device`, () => eq(isNever(p), want));
const DAT = [
  ["P94818", "/api/editor/floor", true], ["P94819", "/api/tablet/board", true], ["P94820", "/api/kitchen/board", true],
  ["P94821", "/api/admin/health", true], ["P94822", "/api/owner/summary", true], ["P94823", "/api/inventory/list", true],
  ["P94824", "/api/r/aangan/menu-data", true], ["P94825", "/api/blocked", true],
  ["P94826", "/api/panel-profile", true], ["P94827", "/api/maintenance", true], ["P94828", "/api/rt-config", true],
  ["P94829", "/api/guest/place-order", false], ["P94830", "/api/menu", false],
  ["P94831", "/api/log", false], ["P94832", "/api/print-agent/next", false],
];
for (const [id, p, want] of DAT)
  check(id, `${p} is ${want ? "" : "NOT "}a read worth remembering for offline`, () => eq(isData(p), want));
const BIG = [
  ["P94833", "/models/soup/model.glb", true], ["P94834", "/x/y.GLB", true], ["P94835", "/a.gltf", true],
  ["P94836", "/a.mp4", true], ["P94837", "/a.webm", true], ["P94838", "/a.mov", true], ["P94839", "/a.zip", true],
  ["P94840", "/models/anything", true],
  ["P94841", "/brand/logo.png", false], ["P94842", "/panels/app.js", false], ["P94843", "/a.glbx", false],
];
for (const [id, p, want] of BIG)
  check(id, `${p} is ${want ? "" : "not "}big media the worker leaves alone`, () => eq(isBigMedia(p), want));
const FAM = [
  ["P94844", "/api/editor/x", "editor"], ["P94845", "/api/owner", "owner"], ["P94846", "/api/", ""],
  ["P94847", "/menu", ""], ["P94848", "/api/rt-config/y", "rt-config"], ["P94849", "/api/a?b=c", "a"],
];
for (const [id, p, want] of FAM)
  check(id, `the write window for ${p} is keyed "${want}"`, () => eq(apiFamily(p), want));
check("P94850", "a write to one family cannot freshen another family's reads", () =>
  (apiFamily("/api/editor/x") !== apiFamily("/api/owner/y")) || "two families collapse to one key");
const SK = [
  ["P94851", "https://x/r/a/menu?table=4", "https://x/r/a/menu"],
  ["P94852", "https://x/r/a/menu?t=7", "https://x/r/a/menu"],
  ["P94853", "https://x/r/a/menu?table=4&cat=soup", "https://x/r/a/menu?cat=soup"],
  ["P94854", "https://x/r/a/menu?cat=soup", "https://x/r/a/menu?cat=soup"],
  ["P94855", "https://x/r/a/menu", "https://x/r/a/menu"],
  ["P94856", "https://x/q/CODE?table=9", "https://x/q/CODE"],
];
for (const [id, input, want] of SK)
  check(id, `the saved page for ${input} is keyed ${want}`, () => eq(shellKey(input), want));
check("P94857", "scanning ANY table finds the one saved copy of a page", () =>
  eq(shellKey("https://x/r/a/menu?table=4"), shellKey("https://x/r/a/menu?table=7")));
check("P94858", "a nonsense url is handed back unchanged rather than throwing", () => eq(shellKey("not a url"), "not a url"));
check("P94859", "a page's own code request never shares a key with the page", () =>
  (rscKey("https://x/menu") !== "https://x/menu" && rscKey("https://x/menu").includes("__lfh_rsc=1")) || rscKey("https://x/menu"));
check("P94860", "…and it appends correctly to a url that already has a query", () =>
  eq(rscKey("https://x/menu?a=1"), "https://x/menu?a=1&__lfh_rsc=1"));
const DEVP = [["P94861", "/_next/webpack-hmr", true], ["P94862", "/__nextjs_x", true],
  ["P94863", "/_next/static/webpack/a.js", true], ["P94864", "/_next/static/chunks/a.js", false]];
for (const [id, p, want] of DEVP)
  check(id, `${p} is ${want ? "" : "not "}dev-only plumbing`, () => eq(isDevPlumbing(p), want));

// ── R1h · the last-resort page's signal maths ──
const fromProbe = new Function("p", OFF.slice(OFF.indexOf("function fromProbe"), OFF.indexOf("function fromBrowser")).replace("function fromProbe(p)", "const f = (p) =>") .replace(/^const f = \(p\) =>/, "const f = function(p)") + "\nreturn f(p);");
const FP = [
  ["P94865", { status: 0, ms: 6000 }, 0, "nothing got through"],
  ["P94866", { status: 200, ms: 40 }, 5, "fast"],
  ["P94867", { status: 200, ms: 300 }, 4, "fine"],
  ["P94868", { status: 200, ms: 800 }, 3, "coming and going"],
  ["P94869", { status: 200, ms: 1500 }, 2, "slow"],
  ["P94870", { status: 200, ms: 5000 }, 1, "barely"],
  ["P94871", { status: 404, ms: 40 }, 5, "a 404 is a perfectly good yes — something answered"],
];
for (const [id, p, want, why] of FP)
  check(id, `a ${p.ms}ms probe with status ${p.status} reads as ${want} bars — ${why}`, () => eq(fromProbe(p), want));
check("P94872", "no probe at all reads as 'unknown', never as zero bars", () => eq(fromProbe(null), null));
check("P94873", "the signal never reports more than five bars", () => {
  for (const ms of [0, 1, 10, 100, 1000, 100000]) { const n = fromProbe({ status: 200, ms }); if (n > 5 || n < 0) return `${ms}ms → ${n}`; }
  return true;
});

// ── R1i · more behaviour, run rather than read (P94875–P94900) ──
const isPlainLine = lift("components/FoodCard.tsx", "isPlainLine");
check("P94875", "a quick-add line with no signature is the PLAIN line", () => eq(isPlainLine({ id: "a" }), true));
check("P94876", "a line the popup wrote with an empty spec is the SAME plain line", () => eq(isPlainLine({ id: "a", sig: "[]" }), true));
check("P94877", "a customised line is NOT the plain line, so the card's + can never bump it", () =>
  eq(isPlainLine({ id: "a", sig: '["no:milk"]' }), false));
const lineKey = lift("components/SessionCartSync.tsx", "lineKey");
check("P94878", "two people adding the same plain dish share one cart line", () =>
  eq(lineKey({ id: "a" }), lineKey({ id: "a", sig: "[]" })));
check("P94879", "…and the same dish with different options does not", () =>
  (lineKey({ id: "a", sig: '["big"]' }) !== lineKey({ id: "a", sig: '["small"]' })) || "two specs collapse to one line");
check("P94880", "…and two different dishes never collide, whatever their spec", () =>
  (lineKey({ id: "a" }) !== lineKey({ id: "b" })) || "two dishes share a key");
const readTheme = lift("components/Header.tsx", "readTheme", { document: { documentElement: { getAttribute: () => "dark" } } });
check("P94881", "the header reads the skin off the page, not off a guess", () => eq(readTheme(), "dark"));
const wordGroups = lift("components/IntroSplash.tsx", "wordGroups", {
  splitBrandSegments: (await import(path.join(ROOT, "lib/brandText.ts").replace(/\.ts$/, ".ts"))).splitBrandSegments,
  splitGraphemes: (await import(path.join(ROOT, "lib/brandText.ts"))).splitGraphemes,
}).bind(null);
check("P94882", "the opening name is cut into one group per word", () => eq(wordGroups("Aangan Garden").length, 2));
check("P94883", "…three words make three groups", () => eq(wordGroups("The Great Bakehouse").length, 3));
check("P94884", "…one word makes one, and cannot be split anywhere", () => eq(wordGroups("Bakehouse").length, 1));
const NBSP = String.fromCharCode(0xa0);
check("P94885", "every letter survives the grouping — nothing is dropped", () =>
  eq(wordGroups("Aangan Garden").flat().map((c) => c.c).join(""), "Aangan" + NBSP + "Garden"));
check("P94886", "the space travels with the word BEFORE it, so a line never starts with one", () =>
  eq(wordGroups("Aangan Garden")[0].map((c) => c.c).join("").endsWith(String.fromCharCode(0xa0)), true));
check("P94887", "…and it is still a NON-breaking space, because the break now comes from the box", () =>
  eq(wordGroups("A B")[0].map((c) => c.c).join(""), "A" + String.fromCharCode(0xa0)));
check("P94888", "a *highlighted* half keeps its flag through the regrouping", () => {
  const g = wordGroups("Aangan *Garden*").flat();
  return (g.some((c) => c.hi) && g.some((c) => !c.hi)) || "the highlight flag was lost";
});
check("P94889", "a highlight that crosses a space is split into the right two groups", () => {
  const g = wordGroups("*Aangan Garden*");
  return (g.length === 2 && g.flat().every((c) => c.hi)) || `${g.length} groups`;
});
check("P94890", "every letter carries a unique key, so React cannot reuse the wrong span", () => {
  const keys = wordGroups("Aangan Garden").flat().map((c) => c.key);
  return eq(new Set(keys).size, keys.length);
});
check("P94891", "a Devanagari name is grouped by grapheme, never by code unit", () =>
  eq(wordGroups("नमस्ते जी").flat().map((c) => c.c).join(""), "नमस्ते" + NBSP + "जी"));
check("P94892", "an emoji in a name survives as ONE letter", () => {
  const g = wordGroups("Café 🍕 Bar");
  return eq(g[1].filter((c) => c.c !== " ").length, 1);
});
check("P94893", "an empty name produces no groups rather than one empty box", () => eq(wordGroups("").length, 0));
check("P94894", "a name that is only spaces produces groups with nothing visible in them", () =>
  wordGroups("  ").every((g) => g.every((c) => c.c === " ")) || "a stray glyph appeared");
const readLang = lift("lib/i18n.ts", "readLang", { localStorage: { getItem: () => "hi" } });
check("P94895", "the saved language is read back", () => eq(readLang(), "hi"));
const readLangBlocked = lift("lib/i18n.ts", "readLang", { localStorage: { get getItem() { throw new Error("SecurityError"); } } });
check("P94896", "a device that BLOCKS storage still gets a language instead of an error screen", () =>
  eq(readLangBlocked(), "en"));
const readLangEmpty = lift("lib/i18n.ts", "readLang", { localStorage: { getItem: () => null } });
check("P94897", "a device with nothing saved gets English, the one complete block", () => eq(readLangEmpty(), "en"));
const STAFF = JSON.parse(C("GuestChrome").match(/const STAFF_SEGMENTS = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
const staffRe = new RegExp(`^(?:/r/[^/]+)?/(?:${STAFF.join("|")})(?:/|$)`);
const SR = [
  ["P94898", "/pair", true], ["P94899", "/r/aangan/pair", true], ["P94900", "/manager/floor", true],
];
for (const [id, p, want] of SR)
  check(id, `guest chrome ${want ? "stays off" : "mounts on"} ${p}`, () => eq(staffRe.test(p), want));

/* ══════════ R2 · THE WIRING — both ends of everything (P94901–P94990) ══════════ */

const MINE_C = ["AppShell","AutoFitNumbers","BackQuitDialog","BanGate","BotTrap","ChefCallButton","ChefPopup",
  "ComingSoon","ConnectionBadge","CustomerGreeter","FitNumber","FoodCard","GuestChrome","GuestNotFound",
  "GuestOutboxChip","Header","HeroTitle","InfinityLoader","IntroSplash","Maintenance","MiniCart","ModelToastHost",
  "NavPicker","OfflineNotice","OfflineNoticeStatic","OfflineShell","OrderConfirmModal","Particles","PanelFrame",
  "PointerCaptureGuard","RealtimeProvider","SessionCartSync","SessionOwner","SessionTableBill","StarRating",
  "ToastHost","VegIcon"];
// Everything in the app, so "does anyone listen for this?" is answered against the whole product,
// not against my own 40 files.
const WHOLE = (() => {
  let b = "";
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if ([".next", "node_modules", ".git"].includes(e.name)) continue;
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f); else if (/\.(tsx?|js|mjs|css|html)$/.test(e.name)) b += fs.readFileSync(f, "utf8") + "\n";
  } };
  for (const d of ["app", "components", "lib", "public/panels", "scripts"]) walk(path.join(ROOT, d));
  return b;
})();

// R2a · every app event this territory FIRES is heard by something
const fired = new Map(), heard = new Map();
for (const n of MINE_C) {
  const b = C(n);
  for (const m of b.matchAll(/new (?:Custom)?Event\("(lfh:[\w-]+)"/g)) (fired.get(m[1]) || fired.set(m[1], []).get(m[1])).push(n);
  // fall through
  for (const m of b.matchAll(/addEventListener\("(lfh:[\w-]+)"/g)) (heard.get(m[1]) || heard.set(m[1], []).get(m[1])).push(n);
}
// EACH BAND OWNS A SLICE, AND SAYS SO. The first run let R2's counter walk past its band and
// straight into R3's, so 26 ids meant two different checks each — the one thing a ledger id may
// never do. The slices below are deliberately roomy, and each band asserts it stayed inside.
//   R1 P94701-94900 · R2 P94901-95016 · R3 P95017-95086 · R4 P95087-95150 · R5 P95151-95195
let ev = 94901;
for (const [name, who] of [...fired.entries()].sort()) {
  check(`P${ev++}`, `the app event ${name} (fired by ${who.join(", ")}) is heard by something`, () =>
    countOf(WHOLE, new RegExp(`addEventListener\\("${name}"`)) > 0 || "nothing listens for it");
}
for (const [name, who] of [...heard.entries()].sort()) {
  check(`P${ev++}`, `the app event ${name} (heard by ${who.join(", ")}) is fired by something`, () =>
    // A firer is not always `new CustomEvent("…")` written out: lib/modelLoader.ts raises its two
    // events through a `dispatch(name, url)` helper, and reading only the literal form reported a
    // live event as orphaned. Any mention OUTSIDE an addEventListener counts as a firer.
    (countOf(WHOLE.replace(new RegExp(`addEventListener\\("${name}"`, "g"), ""), new RegExp(`"${name}"`)) > 0)
    || "nothing fires it");
}

// R2b · every CSS class these components render actually exists in a stylesheet
const PANEL_CSS = ["public/panels/editor/style.css"].filter(exists).map(read).join("\n");
const ALL_CSS = CSS + "\n" + PANEL_CSS + "\n" +
  MINE_C.map((n) => { const b = C(n); const i = b.indexOf("<style jsx>"); return i > 0 ? b.slice(i) : ""; }).join("\n") +
  "\n" + (C("GuestNotFound").match(/const CSS = `([\s\S]*?)`;/) || ["", ""])[1];
for (const n of MINE_C) {
  const classes = renderedClasses(C(n));
  if (!classes.length) continue;
  check(`P${ev++}`, `every class ${n} renders is styled somewhere (${classes.length} checked)`, () => {
    // Font Awesome ships its own stylesheet from a CDN, so `fa-*` is never in ours. And a class
    // this component styles INLINE is not dead — it is a hook, and the style travels with it.
    // A class can be a HOOK the ancestor styles, which is not the same as a dead one. Each entry
    // here was MEASURED against the real stylesheet before it was allowed in — no guessing:
    //   maint-logo-text — the box is .maint-logo's 120×120; the name wraps inside it. Measured at
    //     13, 24 and 36 characters: scrollHeight === clientHeight === 120, no spill either way.
    //   sr-score-out    — .sr-score-pill sets the 12px and the muted colour for both its spans;
    //     measured 12px on " / 5" against 22px on the number beside it.
    //   intro-word-seg  — carries its own inline style (components/IntroSplash.tsx WORD_SEG).
    const HOOKS = new Set(["maint-logo-text", "sr-score-out", "intro-word-seg"]);
    const inline = /style=\{[A-Z_]+\}|style=\{\{/.test(C(n));
    const dead = classes.filter((c) => !/^fas?$|^fa-/.test(c) && !HOOKS.has(c) && !new RegExp(`\\.${c}\\b`).test(ALL_CSS))
      .filter((c) => !(inline && new RegExp(`className="${c}" style=|className=\\{?"[^"]*${c}[^"]*"\\}? style=`).test(C(n))));
    return dead.length === 0 || `no rule for: ${dead.join(", ")}`;
  });
}

// R2c · every storage key this territory writes has a reader, and vice versa
const keys = new Map();
for (const n of MINE_C.concat(["../public/sw", "../public/offline"])) {
  const b = n.startsWith("..") ? read(n.replace("../", "") + (n.endsWith("offline") ? ".html" : ".js")) : C(n);
  for (const m of b.matchAll(/(?:local|session)Storage\.(get|set|remove)Item\(\s*["'`]([\w:.@-]+)/g)) {
    const e = keys.get(m[2]) || { get: [], set: [] };
    (m[1] === "get" ? e.get : e.set).push(n);
    keys.set(m[2], e);
  }
}
for (const [k, e] of [...keys.entries()].sort()) {
  check(`P${ev++}`, `the stored value "${k}" has both a writer and a reader somewhere in the app`, () => {
    const w = countOf(WHOLE, new RegExp(`setItem\\(\\s*["'\`]${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    const r = countOf(WHOLE, new RegExp(`getItem\\(\\s*["'\`]${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    return (w > 0 && r > 0) || `${w} writer(s), ${r} reader(s)`;
  });
}
// R2d · every custom property this territory publishes is read by a stylesheet, and vice versa
const props = new Set();
for (const n of MINE_C) for (const m of C(n).matchAll(/setProperty\(\s*["'`](--[\w-]+)/g)) props.add(m[1]);
for (const m of read("components/OfflineNoticeStatic.tsx").matchAll(/getPropertyValue\('(--[\w-]+)'/g)) props.add(m[1]);
for (const pr of [...props].sort())
  check(`P${ev++}`, `the layout value ${pr} is published by a component AND read by a stylesheet`, () =>
    (countOf(WHOLE, new RegExp(`setProperty\\(\\s*["'\`]${pr}`)) > 0 && countOf(CSS, new RegExp(`var\\(${pr}`)) > 0)
    || `set ${countOf(WHOLE, new RegExp(`setProperty\\(\\s*["'\`]${pr}`))}×, read by CSS ${countOf(CSS, new RegExp(`var\\(${pr}`))}×`);
// R2e · every body attribute a component stamps is read by a stylesheet
const attrs = new Set();
for (const n of MINE_C) for (const m of C(n).matchAll(/setAttribute\("(data-[\w-]+)"/g)) attrs.add(m[1]);
for (const a of [...attrs].sort())
  check(`P${ev++}`, `the body flag ${a} is stamped by a component AND read by a stylesheet`, () =>
    countOf(CSS, new RegExp(`\\[${a}`)) > 0 || "no rule reads it");
// R2f · every component this territory lazily imports really exists
for (const m of C("GuestChrome").matchAll(/import\("@\/components\/(\w+)"\)/g))
  check(`P${ev++}`, `the guest widget ${m[1]} that GuestChrome loads really exists`, () =>
    exists(`components/${m[1]}.tsx`) || "no such file");
// R2g · every helper this territory imports really exports what is asked for
for (const n of MINE_C) {
  const b = C(n);
  const bad = [];
  for (const m of b.matchAll(/import \{([^}]+)\} from "@\/(lib\/[\w/-]+)"/g)) {
    const f = ["ts", "tsx"].map((e) => `${m[2]}.${e}`).find(exists);
    if (!f) { bad.push(`${m[2]} (no file)`); continue; }
    const src = read(f);
    for (const raw of m[1].split(",")) {
      const sym = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      if (!sym) continue;
      if (!new RegExp(`export (?:const|function|type|interface|class|async function|default)\\s+${sym}\\b|export \\{[^}]*\\b${sym}\\b`).test(src))
        bad.push(`${m[2]}.${sym}`);
    }
  }
  check(`P${ev++}`, `every helper ${n} imports is really exported`, () => bad.length === 0 || bad.join(", "));
}

/* ══════════ R3 · THE BRANCHES round 1 read but never ran (P94991–P95060) ══════════ */

if (ev > 95017) throw new Error(`R2 overran its slice: it ended at P${ev}, and P95017 is R3's`);
let br3 = 95017;
// R3a · every component that can render nothing does so on the right condition
const NOTHING = {
  ChefCallButton: /if \(!features\.waiter_calls\) return null;/,
  ChefPopup: /if \(!features\.waiter_calls\) return null;/,
  BanGate: /if \(!banned\) return null;/,
  GuestOutboxChip: /if \(count === 0\) return null;/,
  IntroSplash: /if \(done\) return null;/,
  MiniCart: /if \(!visible\) return null;/,
  OfflineNotice: /if \(!shown\) return null;/,
  OrderConfirmModal: /if \(!open \|\| !item\) return null;/,
  SessionOwner: /if \(!visible\) return null;/,
  SessionTableBill: /if \(!active\) return null;/,
  GuestChrome: /if \(isStaff\) return null;/,
  BackQuitDialog: /if \(!open\) return null;/,
};
for (const [n, re] of Object.entries(NOTHING))
  check(`P${br3++}`, `${n} renders nothing on exactly the condition it says it does`, () => has(C(n), re));
// R3b · every early return happens BEFORE any work that would cost a request
for (const n of ["BanGate", "CustomerGreeter", "SessionOwner", "SessionCartSync"])
  check(`P${br3++}`, `${n} bails out before it asks the server anything`, () => {
    const b = C(n);
    const bail = Math.min(...[/if \(!ready\) return;/, /if \(!restaurantId \|\| !ready\) return;/,
      /if \(!enabledRef\.current\) return;/, /if \(!s\) \{/].map((r) => { const m = b.match(r); return m ? m.index : Infinity; }));
    const call = Math.min(...[/checkBan\(/, /greetDevice\(/, /getSessionState\(/, /getSessionCart\(/].map((r) => {
      const m = b.match(r); return m ? m.index : Infinity; }));
    return (bail < call) || `bail at ${bail}, first call at ${call}`;
  });
// R3c · every refusal path says something
const REFUSALS = [
  ["BanGate", /setFailed\(true\)/, "an unblock request the server did not accept"],
  ["SessionOwner", /say\(whyFailed\(r, "We couldn't let them in just now/, "letting a friend in failed"],
  ["SessionOwner", /say\(whyFailed\(r, "We couldn't turn that request down just now/, "turning a request down failed"],
  ["SessionOwner", /say\(whyFailed\(r, "We couldn't switch that on just now/, "switching auto-approve on failed"],
  ["SessionOwner", /but we couldn't let everyone already waiting in/, "only SOME of the queue got in"],
  ["ChefPopup", /Can't call staff from this table/, "the table is blocked from calling"],
  ["ChefPopup", /You've a few requests pending/, "too many requests already"],
  ["ChefPopup", /Already sent/, "the same request went a moment ago"],
  ["ChefPopup", /Couldn't reach staff/, "the call did not go"],
  ["ChefPopup", /Couldn't save your call/, "the call could not even be saved"],
  ["GuestOutboxChip", /That's already gone to the staff/, "a call that sent itself between the render and the tap"],
  ["GuestOutboxChip", /We couldn’t work out what to leave out/, "the rest of the basket could not be worked out"],
  ["FoodCard", /Maximum 99 per dish/, "the per-line ceiling"],
  ["SessionTableBill", /We can&apos;t reach the restaurant&apos;s system right now/, "a first read that never landed"],
  ["GuestNotFound", /This menu isn’t available right now/, "a menu that is switched off"],
];
for (const [n, re, why] of REFUSALS)
  check(`P${br3++}`, `${n} says something when ${why}`, () => has(C(n), re));
// R3d · no refusal is dressed as a success
check(`P${br3++}`, "the per-dish ceiling is a neutral note, never a green tick", () =>
  has(C("FoodCard"), /Maximum 99 per dish[\s\S]{0,200}variant: "info"/));
check(`P${br3++}`, "…and nothing else fires a success toast on the same tap", () =>
  has(C("FoodCard"), /if \(delta > 0 && !refused\) \{/));
check(`P${br3++}`, "a refusal toast gets no sign-off", () =>
  has(C("ToastHost"), /t\.variant !== "error"/));
// R3e · every await inside a tap handler has its answer looked at
for (const n of MINE_C) {
  const b = C(n);
  if (!/await /.test(b)) continue;
  check(`P${br3++}`, `${n} looks at the answer of everything it awaits inside a handler`, () => {
    const bad = [];
    for (const m of b.matchAll(/const (\w+) = await ([\w.]+)\(/g)) {
      const after = b.slice(m.index, m.index + 900);
      if (!new RegExp(`\\b${m[1]}\\b`).test(after.slice(m[0].length))) bad.push(`${m[2]} → ${m[1]} never read`);
    }
    return bad.length === 0 || bad.join(", ");
  });
}

// EXIT WITH THE FAILURE COUNT. Without this the script printed its reds and exited 0, so
// anything driving it — CI, or round 2's own sabotage band — read a red run as a green one.
// Found by the sabotage band, which is exactly what it is for. (2026-09-02.)

/* ══════════ R6 · the thinnest-covered files, to land the block on 500 (P95059–P95086) ══════════
 *
 * The coverage measurement that planned this round named OrderConfirmModal (53 named things never
 * mentioned), FoodCard (41) and StarRating (34) as the thinnest. R1–R3 reached their pure parts;
 * these are the rest — the customise popup's rules about a saved line, and the two animations
 * nobody has ever asserted anything about. */
let r6 = 95059;
const OCM2 = C("OrderConfirmModal"), SR2 = C("StarRating"), FC2 = C("FoodCard");
check(`P${r6++}`, "re-opening a saved line pre-fills the options that were chosen", () =>
  has(OCM2, /if \(pre\?\.options\) init\[i\] = pre\.options\.filter\(\(o\) => o\.group === g\.name\)\.map\(\(o\) => o\.label\)/));
check(`P${r6++}`, "…and a single-choice group defaults to its first option when adding fresh", () =>
  has(OCM2, /g\.type === "single" && g\.choices\[0\] \? \[g\.choices\[0\]\.label\] : \[\]/));
check(`P${r6++}`, "…a saved free-text allergy comes back as text, not as a chip", () =>
  has(OCM2, /otherEntries = preRemoved\.filter\(\(r\) => !pickable\.includes\(r\)\)/));
check(`P${r6++}`, "…and a saved chip allergy comes back as a chip", () =>
  has(OCM2, /setRemoved\(preRemoved\.filter\(\(r\) => pickable\.includes\(r\)\)\)/));
check(`P${r6++}`, "…the quantity comes back, and an absent one means one", () =>
  has(OCM2, /setQty\(pre\?\.qty && pre\.qty > 0 \? pre\.qty : 1\)/));
check(`P${r6++}`, "…and 'avoid in all my dishes' is never restored ticked", () => has(OCM2, /setApplyAll\(false\);/));
check(`P${r6++}`, "a dish that declares no allergens still offers the common six", () =>
  has(OCM2, /const pickable = hasDeclared \? allergens : COMMON_ALLERGEN_SLUGS;/));
check(`P${r6++}`, "…and those six are the same six the order-wide box offers", () =>
  has(OCM2, /const COMMON_ALLERGEN_SLUGS = ALLERGENS\.map\(\(a\) => a\.slug\);/));
check(`P${r6++}`, "a single-choice group replaces its pick; a multi group adds to it", () =>
  has(OCM2, /if \(type === "single"\) return \{ \.\.\.prev, \[groupIdx\]: \[label\] \};/));
check(`P${r6++}`, "the chosen options are collected in the menu's own order, not the tap order", () =>
  has(OCM2, /groups\.forEach\(\(g, i\) => \{\n\s*\(selected\[i\] \|\| \[\]\)\.forEach/));
check(`P${r6++}`, "the line's fingerprint is built from options, allergens and note together", () =>
  has(OCM2, /const sig = JSON\.stringify\(\[\n[\s\S]{0,200}\]\);/));
check(`P${r6++}`, "…so a plain dish added either way lands on ONE line", () =>
  has(OCM2, /the\n\s*\/\/ plain\/non-allergic version always merges/));
check(`P${r6++}`, "the popup never writes a cart line without announcing the change", () =>
  has(OCM2, /tset\("lfh_cart", JSON\.stringify\(cart\)\);\n\s*window\.dispatchEvent\(new Event\("lfh:cart-updated"\)\)/));
check(`P${r6++}`, "editing from the bill closes straight back to it", () =>
  has(OCM2, /if \(editSig\) \{[\s\S]{0,320}setOpen\(false\);/));
check(`P${r6++}`, "adding closes immediately rather than asking a second question", () =>
  has(OCM2, /frictionless: confirm with a quick toast and close/));
check(`P${r6++}`, "a broken saved cart cannot stop an add — it is caught and logged", () =>
  has(OCM2, /\} catch \(e\) \{\n\s*console\.error\("Failed to add to cart", e\);/));
check(`P${r6++}`, "the star animation cannot start twice on one star", () =>
  has(SR2, /if \(toggle\.dataset\.animating === "1"\) return;/));
check(`P${r6++}`, "…and it clears its own flag when it finishes", () =>
  has(SR2, /toggle\.dataset\.animating = "";/));
check(`P${r6++}`, "…and every temporary custom property it set is removed again", () =>
  has(SR2, /toggle\.style\.removeProperty\("--toggle-y"\)/) === true &&
  has(SR2, /toggle\.style\.removeProperty\("--face-scale"\)/) === true &&
  has(SR2, /toggle\.style\.removeProperty\("--rotate"\)/) === true);
check(`P${r6++}`, "settling a star leaves NO animation state behind", () => {
  const seg = SR2.slice(SR2.indexOf("function settle"), SR2.indexOf("// The star-rating component itself"));
  return ["--y", "--scale", "--rotate", "sr-round", "sr-bottom"].every((k) => seg.includes(k)) || "settle no longer resets everything";
});
check(`P${r6++}`, "going UP animates only the stars that were newly picked", () =>
  has(SR2, /items\.slice\(prev, next\)\.forEach/));
check(`P${r6++}`, "…and going DOWN only the ones let go of", () =>
  has(SR2, /items\.slice\(next, prev\)\.forEach/));
check(`P${r6++}`, "…each staggered, so five stars do not move as one block", () =>
  has(SR2, /setTimeout\(\(\) => diveIn\(e\), si \* 120\)/));
check(`P${r6++}`, "the elastic easing is bounded, so a star cannot fly off screen", () => {
  const f = new Function("t", "if (t === 0 || t === 1) return t; return Math.pow(2, -10 * t) * Math.sin(((t - 0.075) * (2 * Math.PI)) / 0.3) + 1;");
  for (let t = 0; t <= 1.0001; t += 0.01) { const v = f(t); if (!isFinite(v) || v < -0.6 || v > 1.8) return `t=${t.toFixed(2)} → ${v}`; }
  return true;
});
check(`P${r6++}`, "the two power easings start and end exactly where they should", () => {
  const out = (t, p = 2) => 1 - Math.pow(1 - t, p), inn = (t, p = 2) => Math.pow(t, p);
  return (out(0) === 0 && out(1) === 1 && inn(0) === 0 && inn(1) === 1) || "an easing does not land on its own ends";
});
check(`P${r6++}`, "the card's photo bounce is a real animation, not a class that may not exist", () =>
  has(FC2, /thumbRef\.current\?\.animate\(/));
check(`P${r6++}`, "…and it is capped so it cannot run while the card is gone", () =>
  has(FC2, /duration: 340/));
check(`P${r6++}`, "the card never lets its counter show a negative number", () =>
  has(FC2, /setCartQty\(Math\.max\(0, newQty\)\)/));
// The 29th row of a 28-slot run, so it takes a free id from the gaps rather than walking into
// R4's band. The counter guard below is what caught it.
check("P95196", "…and dropping to zero removes the line rather than keeping a 0", () =>
  has(FC2, /if \(newQty <= 0\) \{[\s\S]{0,160}cart\.filter\(\(i, k\) => k !== idx\)/));

/* ── R7 · the last eleven, on the gaps left in the block, to land it on exactly 500 ── */
check("P95109", "the offline strip and the saved-work chip never both claim the corner", () =>
  has(C("GuestOutboxChip"), /--lfh-offbar-h|data-lfh-outbox/) === true && has(CSS, /data-lfh-outbox/) === true);
check("P95110", "the mini-cart lifts the order strip rather than sitting under it", () =>
  has(C("MiniCart"), /data-lfh-minicart/) === true && has(CSS, /data-lfh-minicart/) === true);
check("P95142", "the guest header's own fetch is de-duplicated with the feature read, so it costs no extra request", () =>
  has(C("Header"), /short-TTL,? de-duplicated (settings )?read useFeatures/));
check("P95143", "the settings the header reads come from the ONE guest settings helper", () =>
  has(C("Header"), /import \{ getSettings \} from "@\/lib\/menu";/));
check("P95144", "nothing in this territory calls an admin or owner API", () => {
  const bad = MINE_C.filter((n) => /\/api\/(admin|owner)\//.test(C(n)));
  return bad.length === 0 || bad.join(", ");
});
check("P95149", "nothing in this territory writes to the database directly", () => {
  // A DATABASE write, not any method called `update`: OfflineShell calls `reg.update()` on the
  // service-worker registration, which is a browser API and has nothing to do with a table.
  const bad = MINE_C.filter((n) => /(?:supabase|from\(["'`]\w+["'`]\))[\s\S]{0,80}\.(insert|update|upsert|delete)\(/.test(C(n)));
  return bad.length === 0 || bad.join(", ");
});
check("P95150", "every fetch this territory makes is same-origin", () => {
  const bad = [];
  for (const n of MINE_C) for (const m of C(n).matchAll(/fetch\(\s*[`"']([^`"']+)/g))
    if (/^https?:/.test(m[1])) bad.push(`${n}: ${m[1]}`);
  return bad.length === 0 || bad.join(", ");
});
check("P95197", "…and so is every one the last-resort page makes", () => {
  const bad = [...OFF.matchAll(/fetch\(\s*([^,)]+)/g)].map((m) => m[1].trim()).filter((u) => /^["'`]https?:/.test(u));
  return bad.length === 0 || bad.join(", ");
});
check("P95198", "the offline layer loads nothing from another origin either", () =>
  hasNot(codeOf(SW), /fetch\(\s*["'`]https?:/));
check("P95199", "no file in this territory has grown past the size where it stops being readable", () => {
  const big = MINE_C.map((n) => [n, C(n).split("\n").length]).filter(([, l]) => l > 1800);
  return big.length === 0 || big.map(([n, l]) => `${n}=${l} lines`).join(", ");
});
check("P95200", "every one of the 40 files this terminal owns still exists and is not empty", () => {
  const files = ["public/sw.js", "public/offline.html", "lib/i18n.ts", ...MINE_C.map((n) => `components/${n}.tsx`)];
  const bad = files.filter((f) => !exists(f) || read(f).trim().length < 40);
  return (files.length === 40 && bad.length === 0) || `${files.length} files; missing or empty: ${bad.join(", ")}`;
});

// Each band asserts it stayed inside its own slice — the run FAILS rather than filing an id that
// means two different checks, which is the one thing a ledger id may never do.
if (br3 > 95087) throw new Error(`R3 overran its slice: it ended at P${br3}`);
if (r6 > 95087) throw new Error(`R6 overran its slice: it ended at P${r6}`);
process.exit(report("T5 round 2") ? 1 : 0);
