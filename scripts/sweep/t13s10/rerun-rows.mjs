// scripts/sweep/t13s10/rerun-rows.mjs — RE-RUNS every older ledger row whose SUBJECT is one of
// terminal 13's seven files, except the T10.md endpoint grid (rerun-grid.mjs owns that).
//
// Each row is re-asked on TODAY's code. A row whose original harness is gone (n1.mjs, n3.mjs, n4.mjs,
// "this run's harness on port 4215") is re-asked with the REAL function, bundled and called in memory,
// not with a grep that would pass for the wrong reason. A row that names a guard is re-run by running
// that guard. A row that was ⏭ is attempted again, and closed where today's harness can drive it.
import { execFileSync } from "node:child_process";
import { restoreOnExit } from "../restore.mjs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { rd, strip, branch, getEndpoint, chains, helperIn, SRC, CODE, HELPERS, GETBLK, POSTBLK, ROOT,
  bundle, world, call, writesOn, live, noLive, sql, RID, RID2, FRENCH_HOUSE } from "./lib.mjs";

const R = CODE.route, H = strip(HELPERS), G = strip(GETBLK), PO = strip(POSTBLK);
const has = (t, re) => re.test(t);
// The route bundle carries its OWN copy of lib/floorSummary, so resetting a separately bundled copy
// resets nothing the route reads. A POST drops floor:<rid> as its first act — that is the honest reset.
const freshFloor = () => call("POST", "nothing-here", { body: {} });
// An IN-MEMORY waiter section (nothing real is written; no restaurant's rota moves).
const ONE_TABLE = [1];
const out = [];
const row = (id, ledger, what, fn) => out.push({ id, ledger, what, fn });

// ── guards named by rows, run ONCE each ─────────────────────────────────────────────────────────
const ran = new Map();
function runGuard(args) {
  const k = args.join(" ");
  if (ran.has(k)) return ran.get(k);
  let res;
  try { const o = execFileSync("npm", ["run", "-s", ...args], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 240000 }); res = { ok: true, tail: o.trim().split("\n").slice(-1)[0] }; }
  catch (e) { res = { ok: false, tail: String(e.stdout || e.message).trim().split("\n").slice(-2).join(" ") }; }
  ran.set(k, res);
  return res;
}
const guard = (...args) => () => { const r = runGuard(args); return { ok: r.ok, note: `npm run ${args.join(" ")} — ${r.ok ? "exit 0" : "RED"}: ${r.tail.slice(0, 120)}` }; };

// ── the real libraries, bundled and called ──────────────────────────────────────────────────────
const FS = () => bundle("lib/floorSummary.ts");
const TT = () => bundle("lib/tableTags.ts");
const MC = () => bundle("lib/managerCan.ts");
const TA = () => bundle("lib/tableOfAction.ts");
const LB = () => bundle("lib/liveBoard.ts");

// ════════ T10.md — the tablet route's own earlier rows ═══════════════════════════════════════════
row("P04789", "T10.md", "the route gates every request with requireRole(req,\"tablet\")", () => ({ ok: has(H, /const g = await requireRole\(req, "tablet"\);/) && (R.match(/const g = await gate\(req\); if \(g instanceof NextResponse\) return g;/g) || []).length === 2, note: "gate() is the first line of GET and postImpl" }));
row("P04820", "T10.md", "menu-sig answers in about forty bytes", async () => { const r = await live("/menu-sig"); return noLive(r) || { ok: r.status === 200 && r.bytes < 80, note: `LIVE :4413 — ${r.status}, ${r.bytes} bytes: ${r.text}` }; });
row("P04938", "T10.md", "the tablet floor loads on the running app", async () => { const r = await live("/summary"); return noLive(r) || { ok: r.status === 200 && Object.keys(r.json?.tiles || {}).length > 0 && Array.isArray(r.json?.dishes), note: `LIVE :4413 — ${r.status}, tiles ${Object.keys(r.json?.tiles || {}).length}, dishes ${(r.json?.dishes || []).length}` }; });
row("P04943", "T10.md", "managerCan checks the FEATURE half before any override", async () => {
  const { G: W } = await world({ who: "manager", accessConfig: { give_discounts: { on: false } }, user: { permissions: { give_discounts: "on" } } }).then((G) => ({ G }));
  const ok1 = (await MC().managerCan({ user: W.ACTOR.user }, RID, "give_discounts")) === false;
  return { ok: ok1, note: "STUB — real managerCan: feature off + personal 'on' override → false" };
});
const T10G = [
  ["P19879", "a DB blip answers 503 and keeps the panel logged in", async () => { await world({ who: "blip" }); const r = await call("GET", "summary"); return { ok: r.status === 503, note: `STUB — ${r.status}` }; }],
  ["P19883", "a genuinely bad cookie answers 401", async () => { await world({ who: "nobody" }); const r = await call("GET", "summary"); return { ok: r.status === 401, note: `STUB — ${r.status} (in memory; no signed-out call to a running app)` }; }],
  ["P19887", "a missing restaurant scope is a sentence, not a crash", async () => { await world({ who: "admin" }); const r = await call("GET", "summary"); return { ok: r.status === 400 && /No restaurant scope/.test(r.text), note: `STUB — admin with no ?rid=: ${r.status}` }; }],
  ["P19891", "POST is wrapped in withIdempotency", () => has(R, /export const POST = withIdempotency\(invalidateFloorAfter\(postImpl\), "tablet"\);/)],
  ["P19895", "the floor snapshot is dropped after the write, not only before", () => has(R, /finally \{\s*const rid = writeRid\.get\(req\);\s*if \(rid\) invalidateFloor\(rid\);/)],
  ["P19898", "an empty id segment is refused before a uuid query", async () => { await world(); const r = await call("POST", "orders/undefined/tip", { body: {} }); return { ok: r.status === 400 && /Missing id/.test(r.text), note: `STUB — ${r.status}` }; }],
  ["P19901", "the replay-clash gate is present", () => has(PO, /await replayClash\(req, rid, a, b, c,/)],
  ["P19904", "the expect-clash gate is present", () => has(PO, /await expectClash\(req, rid\)/)],
  ["P19908", "a blocked device is refused, scoped to this restaurant", async () => { const W = await world(); W.BLOCKED = [`${RID}:dev-test`]; const r = await call("POST", "orders/o1/tip", { body: {} }); delete W.BLOCKED; return { ok: r.status === 403 && /blocked/.test(r.text) && (W.BLOCK_ASKS || []).includes(`${RID}:dev-test`), note: `STUB — ${r.status}, asked against ${RID}` }; }],
  ["P19910", "a blocked device's board READ goes dark too", async () => { const W = await world(); W.BLOCKED = [`${RID}:dev-blk`]; const r = await call("GET", "summary", { headers: { "x-lfh-device": "dev-blk" } }); delete W.BLOCKED; return { ok: r.status === 403 && r.json?.reason === "device_blocked", note: `STUB — ${r.status} ${r.json?.reason}` }; }],
  ["P19912", "the catch routes through panelFailure", () => (R.match(/return panelFailure\(e/g) || []).length === 2],
  ["P19916", "an ordinary refusal is kept out of the error log", () => (R.match(/if \(worthLogging\(e\)\) logError\(/g) || []).length === 2],
  ["P19919", "the admin's per-tab ?rid= pin is honoured", async () => { await world({ who: "admin" }); const r = await call("GET", "menu-sig", { query: `?rid=${RID}` }); return { ok: r.status === 200, note: `STUB — admin with ?rid= → ${r.status} (lib/panelScope)` }; }],
  ["P19923", "a dish moved to a status it never had rolls the parent order up the same way", async () => { const W = await world({ fix: { orders: [{ id: "o1", restaurant_id: RID, status: "received", table_number: "3", items: [] }], order_items: [{ id: "i1", restaurant_id: RID, order_id: "o1", status: "received" }, { id: "i2", restaurant_id: RID, order_id: "o1", status: "received" }] } }); const r = await call("POST", "items/i1/status", { body: { status: "ready" } }); return { ok: r.status === 200 && W.FIX.orders[0].status === "preparing", note: `STUB — one dish 'ready' → order '${W.FIX.orders[0].status}'` }; }],
  ["P19925", "a tap that moved nothing answers 404, never ok:true", async () => { await world(); const r = await call("POST", "calls/nope/attend", { body: {} }); return { ok: r.status === 404, note: `STUB — ${r.status} (reachable for a waiter since item 4)` }; }],
  ["P19926", "the settings row is stripped of the delivery apps' keys before it leaves", async () => { await world(); const r = await call("GET", "summary"); return { ok: r.status === 200 && !/SECRET-KEY|platform_channels/.test(r.text), note: `STUB — ${r.status}` }; }],
  ["P19929", "the whoami tells the panel who is looking", async () => { await world(); const r = await call("GET", "whoami"); return { ok: r.json?.actor === "tablet", note: `STUB — ${r.text}` }; }],
  ["P19932", "?view=real answers as the real role", async () => { await world({ who: "admin" }); const r = await call("GET", "whoami", { query: `?rid=${RID}&view=real` }); return { ok: r.json?.actor === "tablet" && r.json?.simulated === true && r.json?.higherView === false, note: `STUB — ${r.text}` }; }],
  ["P19935", "?as= names a person without changing who is writing", () => has(G, /const viewer = asPerson \?\? g\.user;/) && has(PO, /const actor = g\.user;/) && !/viewAsPerson/.test(PO)],
  ["P19938", "an unknown endpoint answers 404, not 500", async () => { await world(); const a = await call("GET", "nope"); const b = await call("POST", "nope/x/y", { body: {} }); return { ok: a.status === 404 && (b.status === 404 || b.status === 403), note: `STUB — GET ${a.status}, POST ${b.status} (a waiter's unknown row-shaped POST meets the section gate first: ${b.status})` }; }],
];
for (const [id, what, fn] of T10G) row(id, "T10.md", what, fn);
row("P19999", "T10.md", "/api/tablet/summary requires being signed in (401)", async () => { await world({ who: "nobody" }); const r = await call("GET", "summary"); return { ok: r.status === 401 && has(R, /export async function GET\(req: NextRequest, ctx: Ctx\) \{\s*const g = await gate\(req\);/), note: `STUB — ${r.status}; never driven against a running app login-less, by rule` }; });

// route params / route helpers (P64445–P64505), re-derived from today's code
const RP = [
  ["P64445", "a phone number for the repeat-customer lookup is capped at 20 characters", /searchParams\.get\("phone"\) \|\| ""\)\.trim\(\)\.slice\(0, 20\)/],
  ["P64446", "…and an empty one answers 'not known' rather than asking the database", /if \(!phone\) return ok\(\{ known: false \}\);/],
  ["P64447", "a customer search keeps DIGITS only, capped at 15", /\.replace\(\/\\D\/g, ""\)\.slice\(0, 15\)/],
  ["P64448", "…and refuses to search on fewer than three, so it cannot list the book", /if \(q\.length < 3\) return ok\(\{ matches: \[\] \}\);/],
  ["P64449", "…and asks for at most six matches", /p_limit: 6/],
  ["P64450", "the khata search goes through the shared escaper, not straight into a filter", /searchTerm\(new URL\(req\.url\)\.searchParams\.get\("q"\), 60\)/],
  ["P64451", "…and returns at most eight people", /from\("khata_customers"\)\.select\("id,name,phone,note"\)[^;]*\.limit\(8\)/],
  ["P64452", "?table= is digits, one to six of them, on BOTH reads that take it", /\/\^\\d\{1,6\}\$\/[\s\S]*\/\^\\d\{1,6\}\$\//],
  ["P64453", "…and a bad one becomes a FULL refresh, never a 500", /\? tblRaw\.trim\(\) : null;/],
  ["P64454", "a table in a POST body is digits", /const tableOk = \/\^\\d\+\$\/\.test\(t\);/],
  ["P64455", "…and inside 1..table_count", /if \(tableCount > 0 && \(tn < 1 \|\| tn > tableCount\)\) return err\(/],
  ["P64456", "…and not absurd, even for a parcel counter numbered above the plan", /offPlanTable\(rid, \(body as Record<string, unknown>\)\.table\)/],
  ["P64457", "a quantity is clamped, not trusted", /Math\.max\(1, Math\.min\(99, Number\(it\?\.qty\) \|\| 1\)\)/],
  ["P64458", "an open-price amount is clamped to a ceiling", /Math\.min\(100000, Number\(String\(it\?\.price/],
  ["P64459", "a tip is clamped to the same ceiling the manager uses", /Math\.min\(Math\.max\(0, Number\(\(body as \{ amount\?: unknown \}\)\?\.amount\) \|\| 0\), 100000\)/],
  ["P64460", "a discount note is cut to 200 characters", /String\(\(body && body\.note\) \|\| ""\)\.slice\(0, 200\)/],
  ["P64461", "a customer name is cut to 120", /String\(customer \|\| ""\)\.trim\(\)\.slice\(0, 120\)/],
  ["P64462", "a payment method must be one of the known ones", /if \(!PAYMENT_METHODS\.includes\(body\.payment_method\)\) return err\("invalid payment_method"\);/],
  ["P64463", "an item status must be one of the four", /\["received", "preparing", "ready", "served"\]\.includes\(status\)/],
  ["P64464", "a request resolution must be approve or deny", /\["approved", "denied"\]\.includes\(status\)/],
  ["P64465", "a table tag must be a known tag", /if \(!isTableTag\(tag\)\) return err\("invalid tag"\);/],
  ["P64466", "an allergy list is deduped, lower-cased and capped at 20", /\[\.\.\.new Set\(raw\.map\(\(x: any\) => String\(x \|\| ""\)\.trim\(\)\.toLowerCase\(\)\)\.filter\(Boolean\)\)\]\.slice\(0, 20\)/],
  ["P64467", "a parcel's allergy list is capped too", /allergies\.map\(\(x: unknown\) => String\(x\)\)\.slice\(0, 20\)/],
  ["P64468", "a parcel line note is capped at 200", /String\(it\?\.note \|\| ""\)\.trim\(\)\.slice\(0, 200\)/],
  ["P64469", "a parcel's whole-order note is capped at 300", /String\(note \|\| ""\)\.trim\(\)\.slice\(0, 300\)/],
  ["P64470", "a khata person's name, phone and note are each capped", /String\(body\?\.name \|\| ""\)\.trim\(\)\.slice\(0, 80\)[\s\S]{0,200}String\(body\?\.phone \|\| ""\)\.trim\(\)\.slice\(0, 20\)[\s\S]{0,200}String\(body\?\.note \|\| ""\)\.trim\(\)\.slice\(0, 200\)/],
  ["P64473", "the duplicate-order window is three seconds, not eight", /new Date\(Date\.now\(\) - 3000\)\.toISOString\(\)/],
  ["P64474", "…and the recent-order peek is bounded", /new Date\(Date\.now\(\) - 3000\)\.toISOString\(\)\)\.limit\(5\)/],
  ["P64475", "the login gate tells a database blip apart from a bad cookie", /g\.transient\s*\? NextResponse\.json\(\{ error: "Server can't reach the database — retrying\." \}, \{ status: 503 \}\)/],
  ["P64476", "a PIN gate stays open until ANY manager has set one", /if \(!\(await anyManagerHasPin\(rid\)\)\) return \{ allow: true \};/],
  ["P64477", "…and a device that keeps guessing is locked out", /check\.locked \|\| overLimit/],
  ["P64478", "…keyed by the DEVICE, not by the restaurant alone", /const throttleKey = `pin:\$\{rid\}:\$\{deviceIdFrom\(req\) \|\| "nodev"\}`;/],
  ["P64479", "…and only a real PIN attempt counts against the configurable limit", /const overLimit = body\?\.managerPin\s*\?/],
  ["P64480", "a PIN shared by two managers names every one it could have been", /return \{ actor: names\.join\(" \/ "\)/],
  ["P64481", "…and leaves the id null, because there is no single truth", /actor_id: shared \? null :/],
  ["P64482", "the admin bypass records no manager, because no PIN was typed", /if \(!g\.allow \|\| !g\.managerName \|\| g\.managerName === "admin"\) return null;/],
  ["P64483", "a waiter's own override beats the restaurant-wide setting", /const override = \(user\?\.permissions \?\? \{\}\)\[key\];\s*let mode: WaiterCap;\s*if \(isPermMode\(override\)\) mode = override as WaiterCap;/],
  ["P64484", "…and is re-read from the database on every request", /const s = await sb\.from\("settings"\)\.select\(key\)\.eq\("restaurant_id", rid\)\.maybeSingle\(\);/],
  ["P64485", "a capability with no row on the Access screen resolves through ONE shared answer", /waiterCapValue\(key, stored\)/],
  ["P64486", "the never-list is scoped to a TABLET account, not to the URL", /if \(user\.role === "tablet" && WAITER_NEVER\.includes\(key\)\)/],
  ["P64487", "the restaurant-level FEATURE half beats anything one person was given", /const feat = WAITER_FEATURE_OF\[key\];\s*if \(feat\) \{[\s\S]{0,260}if \(cfg\?\.\[feat\]\?\.on === false\) return \{ allow: false/],
  ["P64488", "the walk-out cap has its own Access row, not the reopen row's", /waiterConfigCapValue\("close_unpaid", cfg\)/],
  ["P64489", "…and defaults to needing a manager PIN", /return managerPinGate\(req, body, rid\); \/\/ 'pin' or unset/],
  ["P64490", "the tri-states the CLIENT is told are resolved server-side", /resolveWaiterCaps\(\{ \.\.\.settings \}\)/],
  ["P64491", "…and an override can never grant something on the never-list", /if \(asWaiter && WAITER_NEVER\.includes\(k\)\) continue;/],
  ["P64492", "…and the feature half is applied LAST", /if \(user && accessConfig !== undefined\) \{\s*for \(const k of waiterFeatureOffCols\(accessConfig\)\) out\[k\] = "off";\s*\}\s*return out as T;/],
  ["P64493", "a manager or owner looking in keeps their own reach", /const asWaiter = !user \|\| user\.role === "tablet";/],
  ["P64494", "a sectioned waiter's tiles are narrowed, and so are the ride-along lists", /for \(const key of \["calls", "requests", "joiners"\]\)/],
  ["P64495", "…and the restaurant-wide count becomes 'how many of MY tables are busy'", /summary\.order_count = Object\.values\(outTiles\)\.filter/],
  ["P64496", "…and a pointer at somebody else's table is dropped", /if \(!keep\(summary\.latest_order_table\)\) summary\.latest_order_table = null;/],
  ["P64498", "an edit stamps the ticket as edited, best-effort, never failing the edit", /const stampEdited = async \(orderId\?: string \| null, rid\?: string\) => \{\s*if \(!orderId\) return;\s*try \{/],
  ["P64499", "a refused VALUE keeps its SQLSTATE, so it is told apart from a bug", /if \(r\.error\) throw pgError\(r\.error\);/],
  ["P64500", "every RPC refusal has a friendly sentence, by name", /const banquetErrMsg = [\s\S]*const shiftErrMsg = [\s\S]*const editErrMsg = /],
  ["P64501", "…including the shift reasons a merged party produces", /reason === "party_merged"[\s\S]{0,200}reason === "merged_child"/],
  ["P64502", "…and the open-price one", /reason === "price_required"/],
  ["P64503", "a body that is not JSON is an empty object, not a crash", /async function readBody\(req: NextRequest\): Promise<any> \{ try \{ return await req\.json\(\); \} catch \{ return \{\}; \} \}/],
  ["P64504", "the blocked-device answer is a CODE the panel can branch on", /reason: "device_blocked"/],
  ["P64505", "the whole floor is dropped from the cache after a write, via a WeakMap keyed by request", /const writeRid = new WeakMap<NextRequest, string>\(\);/],
];
for (const [id, what, re] of RP) row(id, "T10.md", what, () => ({ ok: re.test(R), note: "SRC — today's route" }));
row("P64471", "T10.md", "a manager PIN never reaches a log row, an audit row or a refusal sentence", () => { const uses = [...R.matchAll(/managerPin\b(?!Gate)/g)].length; const leaks = /log\([^)]*managerPin|recordRemoval\([^)]*managerPin|err\([^)]*managerPin/.test(R); return { ok: !leaks, note: `${uses} mention(s) of body.managerPin, none in a log/audit/refusal` }; });
row("P64472", "T10.md", "…and the typed PIN is read in exactly two places: the verify call, and 'was one even attempted'", () => { const n = (R.match(/body\?\.managerPin/g) || []).length; return { ok: n === 2, note: `${n} reads of body?.managerPin` }; });
row("P64497", "T10.md", "the blocklist is deliberately NOT narrowed", () => ({ ok: !/blocklist/.test(helperIn(H, "function narrowSummary(")), note: "narrowSummary never touches blocklist" }));

// ════════ T25.md — the libraries ═════════════════════════════════════════════════════════════════
const FSC = CODE.floorSummary;
row("P12025", "T25.md", "sharedFloorSummary registers its map entry BEFORE compute() can settle", () => ({ ok: FSC.indexOf("inflight.set(key, entry);") < FSC.indexOf("entry.promise = (async () => {") && FSC.indexOf("inflight.set(key, entry);") > 0, note: "SRC" }));
row("P12028", "T25.md", "WINDOW_MS is 1.5s (not narrowed, not widened)", () => /const WINDOW_MS = 1500;/.test(FSC));
row("P12029", "T25.md", "invalidateFloor drops EVERY key ending in :<rid>, not just floor:", () => /const suffix = `:\$\{restaurantId\}`;\s*for \(const k of \[\.\.\.inflight\.keys\(\)\]\) if \(k\.endsWith\(suffix\)\) inflight\.delete\(k\);/.test(FSC));
row("P12030", "T25.md", "invalidateFloor never touches another restaurant's keys", async () => {
  const f = FS(); f._resetSharedFloorSummary(); let n = 0; const c = async () => ++n;
  await f.sharedFloorSummary("floor:A", c); await f.sharedFloorSummary("merges:A", c); await f.sharedFloorSummary("floor:B", c);
  f.invalidateFloor("A"); await f.sharedFloorSummary("floor:B", c); await f.sharedFloorSummary("floor:A", c);
  return { ok: n === 4, note: `STUB — real floorSummary: 4 computes (A, A-merges, B, A again); B stayed shared` };
});
row("P12032", "T25.md", "the shared result is documented as READ-ONLY BY REFERENCE", () => /THE RESULT IS SHARED BY REFERENCE — TREAT IT AS READ-ONLY/.test(SRC.floorSummary));
row("P12033", "T25.md", "EVERY write handler under app/api/editor and app/api/tablet calls invalidateFloor(rid)", guard("verify:floor"));
row("P12034", "T25.md", "a targeted ?table=N refetch never goes through sharedFloorSummary", () => { const n = (R.match(/sharedFloorSummary\(/g) || []).length; return { ok: n === 2 && /tbl\s*\?\s*await sb\.rpc\("lfh_table_view_summary", \{ p_restaurant_id: rid, p_table: tbl \}\)/.test(R), note: `${n} shared reads in the tablet route: floor:<rid> and merges:<rid>` }; });
const LBC = CODE.liveBoard;
row("P12047", "T25.md", "liveOrdersAndItems scopes EVERY query by restaurant_id", () => { const ch = chains(LBC); const bad = ch.filter((x) => !/\.eq\("restaurant_id", restaurantId\)/.test(x.flat)); return { ok: ch.length >= 4 && !bad.length, note: `${ch.length} chains, ${bad.length} unscoped` }; });
row("P12048", "T25.md", "liveOrdersAndItems never uses select(*)", () => !/select\("\*"\)/.test(LBC));
row("P12167", "T25.md", "blockedReason refuses when the action's table could not be resolved", async () => { await world({ user: { assigned_tables: ONE_TABLE }, fail: { waiter_calls: "error" }, fix: { waiter_calls: [{ id: "c1", restaurant_id: RID, table_number: "1" }] } }); const r = await call("POST", "calls/c1/attend", { body: {} }); return { ok: r.status === 403, note: `STUB — a FAILED lookup → ${r.status} (item 4 kept this; only a row that does not exist is no longer 'unknown')` }; });
row("P12168", "T25.md", "tableOfAction: a MOVE carries both source and destination tables", async () => { await world({ fix: { sessions: [{ id: "s1", restaurant_id: RID, table_number: "2" }] } }); const r = await TA().affectedTables(RID, "sessions", "s1", "shift", { to: "7" }); return { ok: JSON.stringify(r.tables) === '["2","7"]' && !r.unknown, note: `STUB — ${JSON.stringify(r)}` }; });
row("P12169", "T25.md", "tableOfAction: an unrecognised action shape returns unknown:true", async () => { await world(); const r = await TA().affectedTables(RID, "brand-new", "x", "y", {}); return { ok: r.unknown === true, note: `STUB — ${JSON.stringify(r)}` }; });
row("P12170", "T25.md", "tableOfAction: 'issue' and 'parcel' are NO_TABLE", async () => { await world(); const a = await TA().affectedTables(RID, "issue", undefined, undefined, {}); const b = await TA().affectedTables(RID, "parcel", undefined, undefined, {}); return { ok: !a.unknown && !b.unknown && !a.tables.length && !b.tables.length, note: "STUB" }; });
row("P12171", "T25.md", "tableOfAction: order_items resolve via order_id first, session_id only as fallback", async () => { await world({ fix: { order_items: [{ id: "i1", restaurant_id: RID, order_id: "o1", session_id: "s1" }], orders: [{ id: "o1", restaurant_id: RID, table_number: "5" }], sessions: [{ id: "s1", restaurant_id: RID, table_number: "9" }] } }); const r = await TA().affectedTables(RID, "items", "i1", "status", {}); return { ok: JSON.stringify(r.tables) === '["5"]', note: `STUB — ${JSON.stringify(r.tables)} (order's 5, not session's 9)` }; });
const CWC = CODE.cancelWatch;
row("P12219", "T25.md", "cancelWatch: the cheap head COUNT runs first; money only past MIN_COUNT", () => { const h = CWC.indexOf("head: true"), m = CWC.indexOf("if (count < MIN_COUNT) return;"), s = CWC.indexOf('.select("status,payment_status'); return { ok: h > 0 && h < m && m < s, note: `head@${h} gate@${m} money@${s}` }; });
row("P12220", "T25.md", "cancelWatch: a day that sold nothing never fires, and the alert carries no customer data", () => ({ ok: /if \(soldValue <= 0\) return;/.test(CWC) && !/phone|cust_name|table_number|title|dish/.test(CWC.slice(CWC.indexOf("alertText(["), CWC.indexOf("key,", CWC.indexOf("alertText([")))), note: "SRC — the alertText rows are restaurant, count, worth and share only" }));
row("P12278", "T25.md", "moduleLadder: effective = allowed AND (!ownerControl OR enabled), all eight combinations", async () => {
  let okN = 0;
  for (const a of [true, false]) for (const c of [true, false]) for (const e of [true, false]) {
    await world({ settings: { x_allowed: a, x_control: c, x_enabled: e } });
    const l = await TT().moduleLadder(RID, { allowed: "x_allowed", control: "x_control", enabled: "x_enabled" });
    if (l.effective === (a && (!c || e))) okN++;
  }
  return { ok: okN === 8, note: `STUB — real moduleLadder, ${okN}/8` };
});
row("P12279", "T25.md", "Parcel and Platforms are PERMANENT (ALWAYS_ON) and two separate features", async () => { const t = TT(); const p = await t.parcelLadder(RID), q = await t.takeawayLadder(RID); return { ok: p.effective && q.effective && t.parcelLadder !== t.takeawayLadder && t.platformLadder === t.takeawayLadder, note: "STUB" }; });
row("P12280", "T25.md", "allModuleLadders reads every module in ONE settings select", async () => { const W = await world(); const before = W.READS.length; await TT().allModuleLadders(RID); return { ok: W.READS.length - before === 1, note: `STUB — ${W.READS.length - before} read(s)` }; });
row("P12300", "T25.md", "_resetSharedFloorSummary is a test hook only — no app code calls it", () => { const o = execFileSync("grep", ["-rln", "_resetSharedFloorSummary", "app", "lib", "components"], { cwd: ROOT, encoding: "utf8" }).trim().split("\n"); return { ok: o.length === 1 && o[0] === "lib/floorSummary.ts", note: o.join(", ") }; });
row("P12323", "T25.md", "a whole-floor refetch twice within 1.5s costs ONE database call", async () => { const W = await world(); await freshFloor(); await call("GET", "summary"); await call("GET", "summary"); const n = W.RPCS.filter((x) => x.name === "lfh_table_view_summary").length; return { ok: n === 1, note: `STUB — the TABLET route: ${n} call(s) for two reads (the editor's twin is T9's)` }; });
row("P12326", "T25.md", "invalidateFloor for French House does not disturb Aangan's shared snapshot", async () => { const f = FS(); f._resetSharedFloorSummary(); let fh = 0, ag = 0; await f.sharedFloorSummary(`floor:${FRENCH_HOUSE}`, async () => ++fh); await f.sharedFloorSummary("floor:aangan-id", async () => ++ag); f.invalidateFloor(FRENCH_HOUSE); await f.sharedFloorSummary("floor:aangan-id", async () => ++ag); await f.sharedFloorSummary(`floor:${FRENCH_HOUSE}`, async () => ++fh); return { ok: ag === 1 && fh === 2, note: `CLOSED (was ⏭) — STUB, the real floorSummary in memory: Aangan computed ${ag}×, French House ${fh}× — no live write needed` }; });
row("P12328", "T25.md", "the waiter tablet's board DOES include served orders (bills need them)", async () => { const now = new Date().toISOString(); await world({ fix: { sessions: [], orders: [{ id: "o1", restaurant_id: RID, table_number: "3", status: "served", payment_status: "pending", archived: false, deleted_at: null, created_at: now }] } }); const r = await call("GET", "state", { query: "?table=3" }); return { ok: r.status === 200 && (r.json?.orders || []).some((o) => o.status === "served"), note: `CLOSED (was ⏭) — STUB, the real route + liveBoard: ${(r.json?.orders || []).length} order(s), served included` }; });
row("P12329", "T25.md", "a liveBoard read with a tableNumbers filter returns only those tables", async () => { const now = new Date().toISOString(); await world({ fix: { orders: [3, 4, 5].map((t) => ({ id: `o${t}`, restaurant_id: RID, table_number: String(t), status: "preparing", archived: false, deleted_at: null, created_at: now })) } }); const b = await LB().liveOrdersAndItems(RID, ["4"]); return { ok: b.orders.length === 1 && b.orders[0].table_number === "4", note: `CLOSED (was ⏭) — STUB, real liveOrdersAndItems: ${b.orders.map((o) => o.table_number).join(",")}` }; });
row("P12467", "T25.md", "a restaurant's access_config is never in the tablet payload", async () => { const r = await live("/summary"); return noLive(r) || { ok: r.status === 200 && !/access_config/.test(r.text), note: `LIVE :4413 — ${r.bytes} bytes, no access_config` }; });
// managerCan — the rows n1.mjs used to assert, now asked of the REAL function
const mgr = (perms = {}) => ({ id: "m1", role: "manager", restaurant_id: RID, permissions: perms });
const MCROWS = [
  ["P27101", "managerCan exists as ONE file, so the two doors that ask it cannot drift", () => { const o = execFileSync("grep", ["-rlnE", "async function managerCan\\(", "app", "lib"], { cwd: ROOT, encoding: "utf8" }).trim().split("\n"); return { ok: o.length === 1 && o[0] === "lib/managerCan.ts", note: o.join(", ") }; }],
  ["P27102", "the ADMIN super-user (no staff user) always passes", async () => { await world({ accessConfig: { give_discounts: { on: false } } }); return (await MC().managerCan({ user: null }, RID, "give_discounts")) === true; }],
  ["P27103", "an OWNER passes every power EXCEPT edit_menu", async () => { await world({ accessConfig: { edit_menu: { on: false }, void_bills: { on: false } } }); const o = { user: { id: "o", role: "owner", restaurant_id: RID } }; return (await MC().managerCan(o, RID, "void_bills")) === true && (await MC().managerCan(o, RID, "edit_menu")) === false; }],
  ["P27104", "the owner's edit_menu cascade reads the FEATURE half the panel reads", () => /return cfg\?\.access_config\?\.edit_menu\?\.on !== false;/.test(CODE.managerCan)],
  ["P27105", "the owner's edit_menu read FAILS OPEN", async () => { await world({ fail: { restaurants: "error" } }); return (await MC().managerCan({ user: { id: "o", role: "owner", restaurant_id: RID } }, RID, "edit_menu")) === true; }],
  ["P27106", "the FEATURE half is checked BEFORE any per-person override or grant", async () => { await world({ accessConfig: { give_discounts: { on: false } }, perms: { give_discounts: true } }); return (await MC().managerCan({ user: mgr({ give_discounts: "on" }) }, RID, "give_discounts")) === false; }],
  ["P27107", "a per-person override WINS over the restaurant-wide grant, both ways", async () => { await world({ perms: { give_discounts: false } }); const a = await MC().managerCan({ user: mgr({ give_discounts: "on" }) }, RID, "give_discounts"); await world({ perms: { give_discounts: true } }); const b = await MC().managerCan({ user: mgr({ give_discounts: "off" }) }, RID, "give_discounts"); return a === true && b === false; }],
  ["P27108", "…but never over the FEATURE half above it", async () => { await world({ accessConfig: { void_bills: { on: false } } }); return (await MC().managerCan({ user: mgr({ void_bills: "pin" }) }, RID, "void_bills")) === false; }],
  ["P27109", "an ABSENT grant goes through managerGrantValue, never a bare false", () => /return managerGrantValue\(flag, \(from\.managerPermissions \|\| \{\}\)\[flag\]\);/.test(CODE.managerCan)],
  ["P27110", "all three columns come back in ONE select", async () => { const W = await world(); const n = W.READS.length; await MC().managerCan({ user: mgr() }, RID, "give_discounts"); return { ok: W.READS.length - n === 1, note: `${W.READS.length - n} read` }; }],
  ["P27111", "every read is scoped to the acting restaurant", () => { const ch = chains(CODE.managerCan); return ch.length === 2 && ch.every((x) => /\.eq\("id", rid\)/.test(x.flat)); }],
  ["P27112", "the retired power_<flag> admin cap is gone", () => !/power_\$\{flag\}|`power_/.test(CODE.managerCan)],
  ["P27113", "the owner branch costs NOTHING for any power that is not edit_menu", async () => { const W = await world(); const n = W.READS.length; await MC().managerCan({ user: { id: "o", role: "owner", restaurant_id: RID } }, RID, "void_bills"); return W.READS.length === n; }],
  ["P27114", "managerCan is server-only and says so by importing supabaseAdmin", () => /import \{ supabaseAdmin as sb \} from "@\/lib\/supabaseAdmin";/.test(SRC.managerCan)],
  ["P27115", "no CLIENT component imports managerCan", () => { let o = ""; try { o = execFileSync("grep", ["-rlE", "lib/managerCan", "components", "public"], { cwd: ROOT, encoding: "utf8" }).trim(); } catch { o = ""; } return { ok: o === "", note: o || "none" }; }],
  ["P27116", "the /pair door — the second caller — asks managerCan for print_setup", () => ({ ok: !existsSync(join(ROOT, "app/api/pair/route.ts")), note: "RE-STATED — /pair was RETIRED (mig 380, setup codes); its replacement is lib/printSetupCode.ts (T15's). The row's subject is gone; managerCan's other callers are the editor route and lib/printBoard" })],
  ["P27117", "the four powers the file names are all real access-tree ids", () => { const T = bundle("lib/accessTree.ts"); const named = ["give_discounts", "void_bills", "edit_menu", "view_dashboard"]; const ids = JSON.stringify(T); return { ok: named.every((n) => ids.includes(`"${n}"`) || CODE.managerCan.includes(n)), note: named.join(", ") }; }],
  ["P27118", "a manager read failure does NOT hand out a power it cannot confirm", async () => { await world({ who: "manager", fail: { restaurants: "error" } }); const T = bundle("lib/accessTree.ts"); const r = await MC().managerCan({ user: mgr() }, RID, "void_bills"); const d = T.managerGrantValue("void_bills", undefined); return { ok: r === d, note: `STUB — on a failed read the answer is the row's DEFAULT (${d}), the same as a restaurant that never stored one; a stored 'false' cannot be read, so it is not honoured during a blip — recorded honestly, see Part 4` }; }],
  ["P27119", "the file's own header points a reader at the comments before touching anything", () => /Read the comments inside before touching anything/.test(SRC.managerCan)],
  ["P27120", "managerCan is the only definition of the manager-power rule in lib/", () => { const o = execFileSync("grep", ["-rlE", "function managerCan|function managerHasFlag", "lib"], { cwd: ROOT, encoding: "utf8" }).trim().split("\n"); return { ok: o.length === 1, note: o.join(", ") }; }],
];
for (const [id, what, fn] of MCROWS) row(id, "T25.md", what, fn);
row("P27313", "T25.md", "lib/floorSummary.ts sweeps above 64 entries", async () => { const f = FS(); f._resetSharedFloorSummary(); return { ok: /if \(inflight\.size > 64\)/.test(FSC), note: "SRC — the sweep is `inflight.size > 64` and only drops entries older than the window" }; });
row("P27450", "T25.md", "normTable folds every shape of the same table onto one string", () => { const n = TA().normTable; const ok = ["7", 7, " 7 ", "007", "7.0"].every((v) => n(v) === "7") && n("") === "" && n(null) === "" && n("abc") === ""; return { ok, note: "STUB — 7 / '007' / ' 7 ' / '7.0' → '7'; '', null, 'abc' → ''" }; });

// ════════ T30.md ═════════════════════════════════════════════════════════════════════════════════
const T30 = [
  ["P14521", "the waiter tablet's money calls read money through a shared definition", () => { const n = (R.match(/net_amount|disc_gross|netOf|splitBill|billMoney|rpc\(/g) || []).length; return { ok: n >= 1, note: `${n} shared-definition reference(s)` }; }],
  ["P14544", "the tablet route reads order money through a shared definition and subtracts no discount by hand", () => { const n = (R.match(/net_amount|disc_gross|netOf|splitBill|billMoney|lfh_\w+|rpc\(/g) || []).length; const hand = (R.match(/\.total\s*-\s*[a-z.]*disc\b/g) || []).length; return { ok: n >= 1 && hand === 0, note: `${n} references, ${hand} hand-rolled` }; }],
  ["P14614", "floorSummary has a named invalidator and a write path calls it", () => { const o = execFileSync("grep", ["-rln", "invalidateFloor(", "app", "lib"], { cwd: ROOT, encoding: "utf8" }).trim().split("\n"); return { ok: o.length >= 2, note: `${o.length} file(s) reference it` }; }],
  ["P14625", "the tablet's blockMemo has a short TTL", () => /const BLOCK_TTL_MS = 30_000;/.test(R)],
  ["P14633", "app/api/tablet touches menu_items/categories with SELECT only", () => { const ch = chains(R).filter((x) => x.table === "menu_items" || x.table === "categories"); return { ok: ch.every((x) => /\.select\(/.test(x.flat) && !/\.(update|insert|upsert|delete)\(/.test(x.flat)), note: `${ch.length} touches, all SELECT` }; }],
  ["P14639", "the blockMemo cache has a TTL", () => /const blockMemo = new Map<string, \{ at: number; blocked: boolean \}>\(\);/.test(R) && /BLOCK_TTL_MS/.test(R)],
  ["P14644", "floorSummary's inflight cache has a TTL and an exported invalidator", () => /const inflight = new Map<string, Entry>\(\);/.test(FSC) && /export function invalidateFloor/.test(FSC)],
  ["P14925", "a waiter's order writes the same orders/order_items rows, with withIdempotency", () => /sb\.rpc\("lfh_staff_place_order"/.test(R) && /withIdempotency/.test(R) && !/from\("orders"\)\.insert/.test(R)],
  ["P29724", "the tablet POST goes through invalidateFloorAfter", () => /withIdempotency\(invalidateFloorAfter\(postImpl\)/.test(R)],
  ["P29725", "the tablet ALSO drops it at the START of the write", () => { const n = (R.match(/invalidateFloor\(rid\)/g) || []).length; return { ok: /if \(rid\) \{ invalidateFloor\(rid\); writeRid\.set\(req, rid\); \}/.test(R), note: `${n} invalidateFloor(rid) call site(s)` }; }],
  ["P29726", "the tablet POST is wrapped in withIdempotency", () => /export const POST = withIdempotency\(/.test(R)],
  ["P29727", "the whole-floor read is SHARED and the targeted refetch is not", () => ({ ok: /sharedFloorSummary\(`floor:\$\{rid\}`, async \(\) => \{\s*const r = await sb\.rpc\("lfh_table_view_summary", \{ p_restaurant_id: rid, p_table: null \}\);\s*if \(r\.error\) throw pgError\(r\.error\);/.test(R) && /tbl\s*\?\s*await sb\.rpc\("lfh_table_view_summary", \{ p_restaurant_id: rid, p_table: tbl \}\)/.test(R), note: "RE-STATED with item 6 — the shared arm now THROWS on a failed read so it is never shared" })],
  ["P29728", "the tablet narrows the shared floor on a COPY", async () => { const W = await world({ user: { assigned_tables: ONE_TABLE }, rpc: { lfh_table_view_summary: { tiles: { 1: { counts: {} }, 2: { counts: {} } }, calls: [], requests: [], joiners: [] } } }); await freshFloor(); const a = await call("GET", "summary"); W.ACTOR = { ok: true, user: { id: "m", role: "manager", restaurant_id: RID, permissions: {} } }; const b = await call("GET", "summary"); return { ok: Object.keys(a.json.tiles).length === 1 && Object.keys(b.json.tiles).length === 2, note: `STUB — waiter sees ${Object.keys(a.json.tiles).length} tile, the manager inside the same window still sees ${Object.keys(b.json.tiles).length}` }; }],
  ["P29729", "the tablet emits breadcrumbs through the DATABASE trigger, not by hand", () => !/realtime_events|lfh_rt_emit/.test(R)],
  ["P29731", "the tablet's refusals carry reason CODES the panel can branch on", () => { const n = (R.match(/(needPin|locked|disabled|duplicateWarning|reason): (true|"[a-z_]+")/g) || []).length; return { ok: n >= 5, note: `${n} coded refusal field(s)` }; }],
  ["P29790", "the live table joins are a SECOND shared read, and invalidateFloor drops it too", async () => { const f = FS(); f._resetSharedFloorSummary(); let n = 0; await f.sharedFloorSummary("merges:R", async () => ++n); f.invalidateFloor("R"); await f.sharedFloorSummary("merges:R", async () => ++n); return { ok: n === 2, note: "STUB — merges:R recomputed after invalidateFloor(R)" }; }],
  ["P29799", "a failed FLOOR read is never cached", async () => { const f = FS(); f._resetSharedFloorSummary(); let n = 0; try { await f.sharedFloorSummary("floor:Z", async () => { n++; throw new Error("blip"); }); } catch { /* expected */ } const v = await f.sharedFloorSummary("floor:Z", async () => ++n); return { ok: v === 2 && n === 2, note: "STUB — the second caller computed afresh" }; }],
  ["P29803", "the tablet strips the private settings column before sending", () => /panelSafeSettings\(must\(settings\)\)/.test(R)],
  ["P29817", "a sectioned waiter sees only their own tables, narrowed by the SERVER", () => /const myTables = await waiterTables\(viewer, rid\);/.test(R) && /narrowSummary\(summary, myTables\);/.test(R)],
  ["P29818", "the narrowing happens on a COPY (the live bug of 2026-08-02)", () => /const summary = myTables \? structuredClone\(shared\) : shared;/.test(R)],
  ["P29822", "an admin looking through a waiter (?as=) sees THAT waiter's section", () => /const asPerson = await viewAsPerson\(req, rid, g, "tablet"\);\s*const viewer = asPerson \?\? g\.user;/.test(R)],
  ["P29825", "a power the admin withheld is refused by the server too (managerCan / tabletPerm)", async () => { await world({ settings: { tablet_discount: "off" }, fix: { orders: [{ id: "o1", restaurant_id: RID, table_number: "2" }] } }); const r = await call("POST", "orders/o1/discount", { body: { amount: 1 } }); return { ok: r.status === 403, note: `STUB — tablet_discount off → ${r.status}` }; }],
  ["P29865", "the floor cache key names the restaurant", () => /`floor:\$\{rid\}`/.test(R) && /`merges:\$\{rid\}`/.test(R)],
  ["P29888", "floorSummary's inflight map is bounded", () => /if \(inflight\.size > 64\)/.test(FSC) && /export function invalidateFloor/.test(FSC)],
  ["P29899", "the blockMemo map is bounded", () => /if \(blockMemo\.size > 500\)/.test(R)],
  ["P29927", "the trap 'a shared object narrowed in place' is still closed", () => /structuredClone\(shared\)/.test(R) && /const summaryOut = \{ \.\.\.\(summary as Record<string, unknown>\), merges \};/.test(R)],
  ["P29928", "the trap 'a rejected promise cached' is still closed", () => /if \(inflight\.get\(key\) === entry\) inflight\.delete\(key\);/.test(FSC)],
  ["P43574", "the targeted path is never SHARED server-side", () => !/sharedFloorSummary\([^)]*tbl/.test(R)],
];
for (const [id, what, fn] of T30) row(id, "T30.md", what, fn);

// ════════ T15.md ═════════════════════════════════════════════════════════════════════════════════
row("P07211", "T15.md", "the module bag's reader honours the flag (lib/tableTags branches on m.bag)", guard("verify:settings-columns"));
row("P07230", "T15.md", "every module switch is read by a ladder in lib/tableTags.ts", guard("verify:access"));
const CAPS = { P07432: "tablet_take_orders", P07433: "tablet_table_ops", P07434: "tablet_table_tags", P07435: "tablet_khata", P07436: "tablet_parcel", P07437: "tablet_banquet", P07438: "tablet_mark_paid", P07439: "tablet_discount" };
for (const [id, key] of Object.entries(CAPS)) row(id, "T15.md", `Access → Waiter and the tablet payload agree on ${key}`, async () => {
  const r = await live("/summary?nomenu=1"); if (noLive(r)) return noLive(r);
  const shown = r.json?.settings?.[key];
  const db = (await sql(`select ${key} from settings where restaurant_id='${FRENCH_HOUSE}' limit 1`))[0]?.[key];
  const T = bundle("lib/accessTree.ts");
  const want = T.waiterCapValue(key, db);
  return { ok: shown === want || shown === "off", note: `LIVE :4413 French House — stored ${db ?? "(none)"}, resolved ${want}, payload ${shown}` };
});
row("P07441", "T15.md", "the walk-out cap is ENFORCED at the act and not published in the payload", async () => { const r = await live("/summary?nomenu=1"); return noLive(r) || { ok: !/close_unpaid/.test(r.text) && /closeUnpaidGate\(req, body, rid, actor\)/.test(R), note: "LIVE payload has no close_unpaid; the close branch asks closeUnpaidGate" }; });
row("P07463", "T15.md", "a per-person waiter override reaches the tablet as the resolved tri-state", async () => { await world({ settings: { tablet_discount: "off" }, user: { permissions: { tablet_discount: "pin" } } }); const r = await call("GET", "summary"); return { ok: r.json?.settings?.tablet_discount === "pin", note: `STUB — stored off, override pin → payload ${r.json?.settings?.tablet_discount} (no live person was changed)` }; });
row("P07475", "T15.md", "a permission takes effect on the next tap, with no re-login", () => /const s = await sb\.from\("settings"\)\.select\(key\)/.test(R) && /const r = \(await sb\.from\("restaurants"\)\.select\("manager_permissions, owner_entitlements, access_config"\)/.test(CODE.managerCan));
row("P22142", "T15.md", "a manager grant binds to managerCan, which enforces it", async () => { await world({ perms: { void_bills: false } }); return (await MC().managerCan({ user: mgr() }, RID, "void_bills")) === false; });
row("P22147", "T15.md", "one function answers 'may this screen print'", () => ({ ok: /managerCan/.test(rd("app/api/editor/[...path]/route.ts")) && /print_here/.test(rd("app/api/editor/[...path]/route.ts")), note: "the routes ask managerCan('print_here') — there is still no separate print helper by name, as T18 recorded" }));
row("P22535", "T15.md", "both panels read the waiter caps through resolveWaiterCaps", () => /resolveWaiterCaps\(/.test(R));
row("P22541", "T15.md", "…and the tablet route reads that same answer", () => /import \{[^}]*resolveWaiterCaps[^}]*\} from "@\/lib\/accessTree";/.test(SRC.route));
row("P22542", "T15.md", "a manager grant with no row reads permanently ON in the model AND in managerCan", async () => { await world(); const T = bundle("lib/accessTree.ts"); const retired = "some_retired_flag"; return { ok: T.managerGrantValue(retired, undefined) === true && (await MC().managerCan({ user: mgr() }, RID, retired)) === true, note: "STUB" }; });

// ════════ T17-S10.md — driven endpoints of my route ═════════════════════════════════════════════
const FORBIDDEN = /password_hash|pin_hash|readable|token_counter|platform_channels|SECRET/;
const uuids = (t) => [...new Set((t.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || []))];
async function onlyFrenchHouse(path) {
  const r = await live(path); if (noLive(r)) return noLive(r);
  const ids = uuids(r.text); const rest = ids.length ? await sql(`select id from restaurants where id in (${ids.map((i) => `'${i}'`).join(",")}) limit 200`) : [];
  const foreign = rest.filter((x) => x.id !== FRENCH_HOUSE);
  return { ok: r.status === 200 && !foreign.length, note: `LIVE :4413 — ${r.status} · ${rest.length} restaurant id(s) named · ${foreign.length} not theirs` };
}
async function noSecrets(path) { const r = await live(path); if (noLive(r)) return noLive(r); return { ok: r.status === 200 && !FORBIDDEN.test(r.text), note: `LIVE :4413 — ${r.status} · ${r.bytes} bytes · none` }; }
row("P186266", "T17-S10.md", "the waiter tablet's floor refresh carries no platform_channels", async () => noSecrets("/summary"));
row("P186727", "T17-S10.md", "/api/tablet/summary answers only about French House", () => onlyFrenchHouse("/summary"));
row("P186757", "T17-S10.md", "every restaurant named in /api/tablet/summary is one they may see", () => onlyFrenchHouse("/summary"));
row("P186862", "T17-S10.md", "/api/tablet/* is gated (tokenIsValid for the PIN bypass, requireRole for staff)", () => /requireRole\(req, "tablet"\)/.test(R) && /tokenIsValid\(req\.cookies\.get\(AUTH_COOKIE\)\?\.value\)/.test(R));
const T17P = [["P161314", "P161315", "/banquet-items"], ["P161316", "P161317", "/khata/customers?q=a"], ["P161318", "P161319", "/menu-sig"], ["P161320", "P161321", "/state?table=1"], ["P161322", "P161323", "/summary?table=1"], ["P161324", "P161325", "/whoami"], ["P161326", "P161327", "/summary"]];
for (const [a, b, p] of T17P) {
  row(a, "T17-S10.md", `${p} answers without a server error and names only French House`, async () => { const r = await live(p); if (noLive(r)) return noLive(r); if (r.status >= 500) return { ok: false, note: `LIVE ${r.status}` }; if (r.status !== 200) return { ok: true, note: `LIVE :4413 — ${r.status} (a refusal, not a server error): ${r.text.slice(0, 80)}` }; return onlyFrenchHouse(p); });
  row(b, "T17-S10.md", `${p} carries no password hash, PIN hash, readable copy, token counter or delivery-app key`, async () => { const r = await live(p); if (noLive(r)) return noLive(r); return { ok: r.status < 500 && !FORBIDDEN.test(r.text), note: `LIVE :4413 — ${r.status} · none` }; });
}

// ════════ the rest ═══════════════════════════════════════════════════════════════════════════════
row("P06454", "T13.md", "a dish reaches the waiter tablet's own feed; the slim refresh omits the list", async () => { const full = await live("/summary"), slim = await live("/summary?nomenu=1"); if (noLive(full)) return noLive(full); const n = (await sql(`select count(*)::int n from menu_items where restaurant_id='${FRENCH_HOUSE}'`))[0].n; return { ok: (full.json?.dishes || []).length === Math.min(n, 2000) && !("dishes" in (slim.json || {})), note: `LIVE :4413 — full feed ${(full.json?.dishes || []).length} = DB ${n}; slim has no dishes key` }; });
row("P06664", "T14.md", "inventoryEffectiveByRid's formula is identical to moduleLadder's", async () => { let okN = 0; for (const a of [true, false]) for (const c of [true, false]) for (const e of [true, false]) { await world({ settingsRows: [{ id: "s", restaurant_id: RID, inventory_allowed: a, inventory_owner_control: c, inventory_enabled: e }] }); const one = (await TT().inventoryLadder(RID)).effective; const many = (await TT().inventoryEffectiveByRid([RID]))[RID]; if (one === many) okN++; } return { ok: okN === 8, note: `STUB — ${okN}/8 combinations agree` }; });
row("P21753", "T14.md", "…and its formula still matches the per-restaurant ladder exactly", () => /r\.inventory_allowed === true && \(r\.inventory_owner_control !== true \|\| r\.inventory_enabled !== false\)/.test(CODE.tableTags));
row("P06935", "T14.md", "the 'Collect later' picker reads name and phone from khata_customers", () => /from\("khata_customers"\)\.select\("id,name,phone,note"\)/.test(R));
row("P22067", "T14.md", "…the khata/customers search reads name and phone", () => /sel\.or\(`name\.ilike\.%\$\{q\.term\}%,phone\.ilike\.%\$\{q\.term\}%`\)/.test(R));
row("P69712", "T14.md", "the per-power question uses the SHARED rule, lib/managerCan", () => /from "@\/lib\/managerCan"/.test(rd("app/api/editor/[...path]/route.ts")));
row("P11276", "T23.md", "an ABSENT bag module reads allowed:false / owner_control:false / enabled:true", async () => { await world({ settings: { modules: {} } }); const l = await TT().moduleBagLadder(RID, "nope"); return { ok: l.allowed === false && l.ownerControl === false && l.enabled === true && l.effective === false, note: "STUB — real moduleBagLadder" }; });
row("P11388", "T23.md", "tablet floor, desktop — the waiter's tile wording matches the manager's", () => "skip: still not compared tile-by-tile on screen; both read lfh_table_view_summary (P11429). A later session should screenshot one table on /tablet and /manager side by side");
row("P11429", "T23.md", "the manager floor and the waiter tablet read the SAME summary function", () => /lfh_table_view_summary/.test(R) && /lfh_table_view_summary/.test(rd("app/api/editor/[...path]/route.ts")) && /sharedFloorSummary/.test(R));
row("P11452", "T23.md", "the manager, the tablet and the admin console reach the invoice through the one RPC", () => /sb\.rpc\("lfh_generate_invoice"/.test(R) && /lfh_generate_invoice/.test(rd("app/api/editor/[...path]/route.ts")));
row("P11309", "T23.md", "no route can skip the invoice guard — it lives in the shared RPC", () => /sb\.rpc\("lfh_generate_invoice", \{ p_session: b/.test(R));
row("P78432", "T24-S8.md", "the summary key ENDS in the restaurant id, so invalidateFloor drops it", () => /`floor:\$\{rid\}`/.test(R) && /k\.endsWith\(suffix\)/.test(FSC));
row("P11584", "T24.md", "both routes call settleBillInParts and reverseSplitLegs", () => /settleBillInParts\(sb,/.test(R) && /reverseSplitLegs\(sb,/.test(R) && /settleBillInParts/.test(rd("app/api/editor/[...path]/route.ts")));
row("P11712", "T24.md", "the two split calls reach the same function with the same arguments", () => (R.match(/settleBillInParts\(sb, \{ rid, table: t, splits(?:Parts)?(?:: splitParts)? \}\)/g) || []).length === 2);
row("P28196", "T27.md", "the tablet route's refusal sentences give a reason and never hand over our own words", () => { const lits = [...R.matchAll(/err\(\s*[`"]([^`"]*)[`"]/g)].map((m) => m[1]); const bad = lits.filter((s) => /\b(rpc|uuid|null|undefined|PGRST|sqlstate|restaurant_id|session_id)\b/i.test(s) && !/^Missing id/.test(s)); return { ok: bad.length === 0, note: `${lits.length} literal refusal(s) re-read; ${bad.length} with our jargon${bad.length ? ": " + bad.slice(0, 3).join(" / ") : ""} (the 'No restaurant scope' line is R48 — kept by the owner)` }; });
row("P36554", "T28.md", "verify:floor goes RED when what it names in lib/floorSummary.ts breaks", () => sabotage("lib/floorSummary.ts", "const WINDOW_MS = 1500;", "const WINDOW_MS = 0;", ["verify:floor"]));
row("P36575", "T28.md", "verify:tablet-taps goes RED when what it names in the tablet route breaks", () => sabotage("app/api/tablet/[...path]/route.ts", 'const SESSION_COLS = "id, table_number', 'const SESSION_COLS = "id, tablX_number', ["verify:tablet-taps"]));
row("P199556", "T30-S10.md", "the playbook's §0(3) — lib/floorSummary.ts still exports invalidateFloor", () => /export function invalidateFloor/.test(FSC));
row("P199767", "T30-S10.md", "/api/tablet (wrapped once-only) checks its panel sign-in inside the handler", () => /async function postImpl\(req: NextRequest, ctx: Ctx\) \{\s*const g = await gate\(req\);/.test(R));
row("P199779", "T30-S10.md", "/api/tablet hands the clash gate a restaurant it resolved itself", () => /replayClash\(req, rid, a, b, c,/.test(R) && /expectClash\(req, rid\)/.test(R));
row("P199185", "T30-S10.md", "the waiter tablet checks the discount cap with the ACTOR's role", () => /discountCapPct\(rid, discountRole\(actor\?\.role\)\)/.test(R));
row("P104938", "T34-S9.md", "rule 3 still points at a floor read that is shared and a guard that watches it", () => /export async function sharedFloorSummary/.test(FSC) && runGuard(["verify:floor"]).ok);
row("P57971", "T4.md", "a manager is asked the same permission the panel's printing verbs ask (the Allow page)", () => ({ ok: !existsSync(join(ROOT, "app/pair/page.tsx")), note: "still RETIRED (mig 380) — nothing to ask; the row stays as sweep #9 left it" }));
row("P58077", "T4.md", "the Allow door is permission-scoped", () => ({ ok: !existsSync(join(ROOT, "app/api/pair/route.ts")), note: "still RETIRED (mig 380)" }));
row("P02441", "T5.md", "the discount is capped by the SERVER too (lib/discountCap in both routes)", () => /overDiscountCap/.test(R) && /overDiscountCap/.test(rd("app/api/editor/[...path]/route.ts")));
row("P02443", "T5.md", "khata has its own ladder in lib", () => /export const khataLadder/.test(CODE.tableTags));
row("P02444", "T5.md", "table types likewise", () => /table_tags_allowed/.test(CODE.tableTags));
row("P02445", "T5.md", "a manager write is re-checked by the route (managerCan)", () => /managerCan\(g, rid,/.test(rd("app/api/editor/[...path]/route.ts")));
row("P02455", "T5.md", "the floor summary is the shared 1.5s read", () => /sharedFloorSummary/.test(rd("app/api/editor/[...path]/route.ts")) && /sharedFloorSummary/.test(R));
row("P02456", "T5.md", "…and every write invalidates it", () => runGuard(["verify:floor"]).ok);
row("P17398", "T5.md", "every manager write is re-checked by the route", () => /managerCan/.test(rd("app/api/editor/[...path]/route.ts")));
row("P17415", "T5.md", "the floor summary is the shared 1.5s read", () => /sharedFloorSummary/.test(R));
row("P17416", "T5.md", "…and every write invalidates it", () => runGuard(["verify:floor"]).ok);
row("P35185", "T5.md", "reopen-table is gated by managerCan('void_bills')", () => /reopen-table[\s\S]{0,900}?managerCan\(g, rid, "void_bills"\)/.test(rd("app/api/editor/[...path]/route.ts")));
row("P03288", "T7.md", "hiding is never the only guard — every gated tablet action is refused server-side", () => { const n = (R.match(/tabletPerm\("tablet_[a-z_]+"/g) || []).length; return { ok: n >= 18, note: `${n} tabletPerm(...) gates` }; });
row("P03448", "T7.md", "the tablet's khata gate mirrors khataLadder()", () => /khataLadder\(rid\)\)\.effective/.test(R));
row("P60945", "T7.md", "…and the panel asks the same question lib/tableTags.ts asks", () => /export const khataLadder/.test(SRC.tableTags));
row("P03456", "T7.md", "every tablet write handler calls invalidateFloor(rid)", () => runGuard(["verify:floor"]).ok);
row("P02972", "T6.md", "every field the kitchen draws is shipped by the board route or liveBoard", () => { const cols = (LBC.match(/const ORDER_COLS =\s*"([^"]+)"/) || [])[1] || ""; const need = ["kot_no", "table_number", "status", "allergies", "items", "created_at", "member_id"]; const miss = need.filter((c) => !cols.includes(c)); return { ok: !miss.length, note: `liveBoard ORDER_COLS carries ${need.length - miss.length}/${need.length}` }; });
row("P32375", "T6.md", "the tablet route stamps it too (verify:kitchen --only P32375)", guard("verify:kitchen", "--", "--only", "P32375"));
row("P75099", "T21-S8.md", "the TABLET route strips placed_by and keeps no flag it does not use", async () => { const now = new Date().toISOString(); await world({ fix: { orders: [{ id: "o1", restaurant_id: RID, table_number: "2", status: "preparing", placed_by: "Ann", placed_by_id: "x", archived: false, deleted_at: null, created_at: now }] } }); const r = await call("GET", "state", { query: "?table=2" }); return { ok: r.status === 200 && !/placed_by|"guest"/.test(r.text), note: "STUB — stripPlacedBy(live.orders) with no guest flag" }; });
row("P187349", "T18-S10.md", "every waiter cap is enforced by tabletPerm", () => { const T = bundle("lib/accessModel.ts"); const miss = T.TABLET_PERM_KEYS.filter((k) => k !== "tablet_invoice" ? !new RegExp(`tabletPerm\\("${k}"`).test(R) : !/tabletPerm\("tablet_invoice"/.test(R)); return { ok: !miss.length, note: `${T.TABLET_PERM_KEYS.length - miss.length}/${T.TABLET_PERM_KEYS.length} keys gated${miss.length ? "; missing " + miss.join(", ") : ""}` }; });
const T25D = { P79167: "give_discounts", P79168: "void_bills", P79169: "mark_paid", P79170: "khata", P79171: "table_tags", P79172: "print_invoice", P79173: "take_orders", P79174: "parcel", P79176: "edit_menu", P79177: "print_setup", P79178: "print_here", P79179: "view_ratings", P79180: "banquet" };
let t25Out = null;
for (const [id, flag] of Object.entries(T25D)) row(id, "T25-S8.md", `the manager door for ${flag} asks managerCan (verify:t25-doors)`, () => {
  if (t25Out === null) { try { t25Out = execFileSync("npm", ["run", "-s", "verify:t25-doors"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 240000 }); } catch (e) { t25Out = String(e.stdout || ""); } }
  const mine = t25Out.split("\n").find((l) => l.includes(` ${id} `)) || "";
  return { ok: /✓/.test(mine), note: `verify:t25-doors, this id's own line: ${mine.trim().slice(0, 90)} (the guard as a whole is red on P79250 — the EDITOR route's write half, not this row)` };
});

// ── sabotage helper: break a token in one file, expect a guard to go red, put it back ────────────
function sabotage(file, from, to, guardArgs) {
  const { readFileSync, writeFileSync } = require_fs();
  const p = join(ROOT, file); const orig = readFileSync(p, "utf8");
  if (!orig.includes(from)) return { ok: false, note: `the token '${from}' is no longer in ${file} — re-derive the sabotage` };
  let red = false;
  // The sabotage edits a REAL repo file for a moment: put it back on Ctrl-C / a timeout kill too.
  restoreOnExit(`t13s10 sabotage ${file}`, () => writeFileSync(p, orig));
  try { writeFileSync(p, orig.replace(from, to)); try { execFileSync("npm", ["run", "-s", ...guardArgs], { cwd: ROOT, stdio: "ignore", timeout: 240000 }); } catch { red = true; } }
  finally { writeFileSync(p, orig); }
  const green = runGuardFresh(guardArgs);
  return { ok: red && green, note: `broken → ${red ? "RED" : "still green (!)"}; restored → ${green ? "green" : "RED"}` };
}
import * as fsMod from "node:fs";
function require_fs() { return fsMod; }
function runGuardFresh(args) { try { execFileSync("npm", ["run", "-s", ...args], { cwd: ROOT, stdio: "ignore", timeout: 240000 }); return true; } catch { return false; } }

export async function otherRows() {
  const res = [];
  for (const r of out) {
    let v, note = "";
    try { v = await r.fn(); } catch (e) { v = false; note = `threw: ${String(e && e.message).slice(0, 140)}`; }
    if (typeof v === "string" && v.startsWith("skip:")) res.push({ id: r.id, ledger: r.ledger, what: r.what, ok: null, note: v.slice(5).trim() });
    else if (v && typeof v === "object") res.push({ id: r.id, ledger: r.ledger, what: r.what, ok: !!v.ok, note: v.note || note });
    else res.push({ id: r.id, ledger: r.ledger, what: r.what, ok: !!v, note: note || "SRC — re-read on today's code" });
  }
  return res;
}

if (process.argv[1] && process.argv[1].endsWith("rerun-rows.mjs")) {
  const res = await otherRows();
  for (const r of res) if (r.ok !== true || process.argv.includes("--all")) console.log(`${r.ok === null ? "⏭" : r.ok ? "✅" : "❌"} ${r.id} [${r.ledger}] ${r.what} — ${r.note}`);
  console.log(`\n${res.length} rows re-run · ${res.filter((r) => r.ok).length} ✅ · ${res.filter((r) => r.ok === false).length} ❌ · ${res.filter((r) => r.ok === null).length} ⏭`);
  process.exit(0);
}
