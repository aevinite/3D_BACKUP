// Replay of the kitchen rows that live in OTHER terminals' ledgers — T10, T25, T27, T28, T29, T30.
// Sweep #8 re-cut the territories, so these rows are about files T9 now owns even though they sit
// in someone else's file. Their `result` is updated in place there; the mechanics live here.
import { row, APP, APPC, HTML, CSS, ROUTE, ROUTEC, PAGE, LAYOUT, has, hasRe, lacks, lacksRe, P, src } from "./lib.mjs";
import { readFileSync, existsSync } from "node:fs";

// ── T10 · the kitchen API route (P04729, P19878–P19937, P19998) ──────────────
row("P04729", "the route gates every request with requireRole(req, \"kitchen\")", () => hasRe(ROUTEC(), /requireRole\(req, "kitchen"\)/));
row("P19878", "a DB blip answers 503 and keeps the panel logged in", () => hasRe(ROUTEC(), /g\.transient[\s\S]{0,140}status: 503/));
row("P19882", "a genuinely bad cookie answers 401", () => hasRe(ROUTEC(), /Not authorised — please log in\.[\s\S]{0,40}status: 401/));
row("P19886", "a missing restaurant scope is a sentence, not a crash", () => hasRe(ROUTEC(), /return err\("No restaurant scope — open this panel from the admin console\.", 400\)/));
row("P19890", "POST is wrapped in withIdempotency", () => hasRe(ROUTEC(), /withIdempotency\(invalidateFloorAfter\(postImpl\), "kitchen"\)/));
row("P19894", "the floor snapshot is dropped AFTER the write, not only before", () => hasRe(ROUTEC(), /finally \{[\s\S]{0,160}if \(rid\) invalidateFloor\(rid\);/));
row("P19897", "an empty id segment is refused before a uuid query", () => hasRe(ROUTEC(), /if \(emptyIdSegment\(b\) \|\| emptyIdSegment\(c\)\) return err/));
row("P19900", "the replay-clash gate is present", () => hasRe(ROUTEC(), /const clash = await replayClash\(req, rid, a, b, c,/));
row("P19903", "the expect-clash gate is present", () => hasRe(ROUTEC(), /const overwrite = await expectClash\(req, rid\);/));
row("P19907", "a blocked device is refused, scoped to this restaurant", () => hasRe(ROUTEC(), /if \(await deviceBlocked\(dev, rid\)\) return err\("This device has been blocked by staff\.", 403\)/));
row("P19909", "a blocked device's board READ goes dark too", () => hasRe(ROUTEC(), /if \(await blockedForRead\(deviceIdFrom\(req\), rid\)\) return BLOCKED_READ\(\);/));
row("P19911", "the catch routes through panelFailure", () => ((ROUTEC().match(/return panelFailure\(e\);/g) || []).length === 2) || "one handler does not");
row("P19915", "an ordinary refusal is kept out of the error log", () => hasRe(ROUTEC(), /if \(worthLogging\(e\)\)/));
row("P19918", "the admin's per-tab ?rid= pin is honoured", () => hasRe(ROUTEC(), /const rid = panelRestaurantId\(req, g\);/));
row("P19922", "a dish moved to a status it never had rolls the parent order up the same way", () => {
  const r = ROUTEC();
  const f = /const overall = served === rows\.length && rows\.length > 0 \? "served" : anyActive \? "preparing" : "received";/g;
  return ((r.match(f) || []).length === 2) || "the two rollups have drifted";
});
row("P19924", "a tap that moved nothing answers 404, never ok:true", () => hasRe(ROUTEC(), /if \(!item\) return err\("That dish isn't on this restaurant's board any more/));
row("P19928", "the whoami tells the panel who is looking", () => hasRe(ROUTEC(), /return ok\(\{ actor, higherView:/));
row("P19931", "?view=real answers as the real role", () => hasRe(ROUTEC(), /simulate \? "kitchen" : "admin"/));
row("P19934", "?as= names a person without changing who is writing", () => {
  const r = ROUTEC();
  // the pin only reaches the ribbon label; the write actor still comes from the staff cookie
  return (/asName: personLabel\(asPerson\)/.test(r) && /const adminMark = g\.user\s*\n?\s*\? \{ actor: g\.user\.name/.test(r)) || "the pin can change the write actor";
});
row("P19937", "an unknown endpoint answers 404, not 500", () => {
  const r = ROUTEC();
  return ((r.match(/return err\("unknown (GET|POST) endpoint", 404\)/g) || []).length === 2) || "one handler does not 404";
});

// ── T25 · the shared board helper (P12327) ───────────────────────────────────
row("P12327", "the board endpoint returns only received/preparing orders (activeOnly)", () => {
  const r = ROUTEC();
  const calls = [...r.matchAll(/liveOrdersAndItems\(rid, [^,]+, (\w+)\)/g)].map((m) => m[1]);
  return (calls.length === 2 && calls.every((c) => c === "true")) || `activeOnly values: ${calls.join(", ")}`;
});

// ── T27 · every word on the screen (P13414, P28204, P28205, P28311) ──────────
row("P13414", "the panel's visible text reads as English and names things the way the panels do", () => {
  const a = APP();
  // no raw identifiers, codes or template leftovers in anything the panel renders as words
  const bad = [];
  for (const m of a.matchAll(/toast\("([^"]{4,})"/g)) if (/_|[a-z]+[A-Z]|\$\{|undefined|null|NaN/.test(m[1])) bad.push(m[1]);
  return bad.length === 0 || `raw wording: ${bad.slice(0, 3).join(" | ")}`;
});
row("P28204", "the panel's refusal sentences give a reason, and none hands over our own words", () => {
  const a = APP();
  const says = [...a.matchAll(/toast\("(Failed|Couldn't|Undo failed)[^"]*"/g)].map((m) => m[0]);
  // "Failed: " + e.message is R21's deliberate wording — it must stay, and it must stay short
  const all = (a.match(/toast\("[^"]*"/g) || []).join(" ");
  return (says.length > 0 && !/SQLSTATE|PGRST|uuid|restaurant_id/i.test(all)) || "a refusal leaks a code";
});
row("P28205", "the route's refusal sentences give a reason and name no internals", () => {
  const r = ROUTEC();
  const errs = [...r.matchAll(/return err\("([^"]+)"/g)].map((m) => m[1]);
  const leaks = errs.filter((e) => /uuid|SQLSTATE|PGRST|column|relation|restaurant_id/i.test(e));
  // the eight "No restaurant scope" sentences are R48 — refused on reachability, kept on purpose
  const real = leaks.filter((e) => !/No restaurant scope/.test(e));
  return real.length === 0 || `a refusal names internals: ${real.join(" | ")}`;
});
row("P28311", "an empty state says why it is empty", () => {
  const a = APP();
  return (has(a, '<div class="empty">Nothing here.</div>') === true && has(a, "No dishes on the menu yet") === true) || "an empty state is a blank box";
});

// ── T28 · the guards' own health (P36574, P37709) ────────────────────────────
row("P36574", "verify:ready-tile names something real in the kitchen panel", () => {
  const g = readFileSync(P("scripts/verify-ready-tile-and-kitchen.mjs"), "utf8");
  // It MIRRORS the merge rather than reading the file — recorded honestly, and the reason
  // verify:kitchen exists. What it must still do is name the panel it claims to guard.
  return has(g, "kitchen");
});
row("P37709", "verify:ready-tile goes RED when the thing it names is broken", () => {
  // Judged by READING it: its kitchen half re-implements load()'s pendingReady merge as a local
  // function and tests THAT, so breaking the panel's own merge leaves it green. That is why the
  // panel's merge is asserted against the real file here (P02693, P63207) instead.
  const g = readFileSync(P("scripts/verify-ready-tile-and-kitchen.mjs"), "utf8");
  const mirrors = /const kitchenMerge = \(serverItems, pendingReady\) =>/.test(g);
  const readsFile = /readFileSync|public\/panels\/kitchen/.test(g);
  return (!mirrors || readsFile) || "it only tests a copy of the logic, so it cannot catch the panel drifting";
});

// ── T29 · the shared widgets reach this panel (P14427, P14441) ───────────────
row("P14427", "the shared issue widget reaches the KITCHEN panel", () => {
  return (has(HTML(), "/panels/issue-raise.js") === true && has(APPC(), "LFH_ISSUE.open({ api, rid: PANEL_RID") === true) || "the widget is loaded but never opened, or vice versa";
});
row("P14441", "it is reachable from the panel's own drawer AND its bar button", () => {
  const a = APPC();
  return ((a.match(/LFH_ISSUE\.open\(/g) || []).length >= 2) || "only one door opens it";
});

// ── T30 · cross-panel truth (P14522, P14541, P14664, P14679, P29699, P29732–4) ─
row("P14522", "the kitchen route reads money through a shared definition, never its own arithmetic", () => {
  const r = ROUTEC();
  const shared = /rpc\(|netOf|splitBill|billMoney|net_amount|disc_gross/.test(r);
  return shared || "no shared money definition is referenced";
});
row("P14541", "the kitchen route does not subtract a discount by hand", () => {
  const r = ROUTEC();
  return lacksRe(r, /total\s*-\s*disc|subtotal\s*-\s*discount/);
});
row("P14664", "the panel uses the SAME five order/item status words as every other panel", () => {
  const a = APPC();
  const words = new Set([...a.matchAll(/"(received|preparing|served|ready|cancelled)"/g)].map((m) => m[1]));
  return (words.size === 5) || `it uses ${[...words].sort().join(" ")}`;
});
row("P14679", "the /r/<slug>/kitchen twin still matches app/kitchen/page.tsx on title, gate and src", () => {
  const twin = P("app/r/[restaurant]/kitchen/page.tsx");
  if (!existsSync(twin)) return "the tenant twin is gone";
  const t = readFileSync(twin, "utf8"), m = PAGE();
  const title = (s) => (s.match(/metadata = \{ title: "([^"]+)" \}/) || [])[1];
  if (title(t) !== title(m)) return `titles differ: "${title(m)}" vs "${title(t)}"`;
  const srcCall = (s) => /panelIframeSrc\("\/panels\/kitchen\/index\.html",[^)]*\{ as, view \}\)/.test(s);
  if (!srcCall(t) || !srcCall(m)) return "one twin does not build its iframe src through panelIframeSrc";
  // The GATE is deliberately different — one is address-scoped, one is console-scoped — but both
  // must have one, and the tenant twin's lives in the page because there is no shared layout.
  const gated = /requirePanelAt\("kitchen"/.test(t) && /requirePanel\("kitchen", "\/kitchen"\)/.test(LAYOUT());
  return gated || "one of the two addresses is ungated";
});
row("P29699", "the kitchen screen needs no whoami re-read — nothing on it is permission-gated", () => {
  const a = APPC();
  const whoamis = (a.match(/api\("GET", "\/whoami"\)/g) || []).length;
  const gated = /caps\.|hasCap\(|can\(/.test(a);
  return (whoamis === 1 && !gated) || `whoami reads: ${whoamis}; permission gates present: ${gated}`;
});
row("P29732", "the POST goes through a wrapper that drops the floor snapshot AFTER the write", () => hasRe(ROUTEC(), /invalidateFloorAfter\(postImpl\)/));
row("P29733", "it ALSO drops it at the START of the write", () => hasRe(ROUTEC(), /if \(rid\) \{ invalidateFloor\(rid\); writeRid\.set\(req, rid\); \}/));
row("P29734", "the POST is wrapped in withIdempotency, so a retry cannot double-apply", () => hasRe(ROUTEC(), /export const POST = withIdempotency\(/));
row("P29646", "printer_events is written only on a real report or resolve, never on a heartbeat", () => {
  const r = ROUTEC();
  const writes = [...r.matchAll(/from\("printer_events"\)\s*\.(insert|update)/g)].length;
  const inHeartbeat = /touchStationSafe[\s\S]{0,200}printer_events/.test(r);
  return (writes >= 1 && !inHeartbeat) || `printer_events writes: ${writes}; reached from the heartbeat: ${inHeartbeat}`;
});
row("P14626", "the blockMemo cache has a TTL, so a lifted block takes hold by itself", () => hasRe(ROUTEC(), /const BLOCK_TTL_MS = 30_000;/));
row("P14638", "the blockMemo cache has both a TTL and a ceiling", () => {
  const r = ROUTEC();
  return (/BLOCK_TTL_MS/.test(r) && /blockMemo\.size > 500/.test(r)) || "one of the two bounds is missing";
});
row("P14611", "the kitchen's 86 is one of the writers that purges the guest menu bundle", () => hasRe(ROUTEC(), /revalidateTag\(menuTag\(rid\), \{ expire: 0 \}\)/));
row("P14551", "the ops/order breadcrumb has a refetch on this panel", () => hasRe(APPC(), /ops: \(detail\) =>/));
row("P14563", "the menu/menu_item breadcrumb has a refetch on this panel", () => hasRe(APPC(), /menu: \(\) => fullSoon\(\)/));
row("P04785", "the kitchen board loads on the running app", () =>
  // driven, not asserted: scripts/sweep/t9/live.mjs → P02802/P02804 open /kitchen and read the board.
  has(readFileSync(P("scripts/sweep/t9/live.mjs"), "utf8"), "the board draws real tickets"));
row("P19998", "the board endpoint requires being signed in", () =>
  // asserted by reading the gate, never by calling the endpoint login-less (the house rule).
  hasRe(ROUTEC(), /const g = await gate\(req\); if \(g instanceof NextResponse\) return g;/));
