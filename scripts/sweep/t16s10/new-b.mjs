// scripts/sweep/t16s10/new-b.mjs — NEW checks, sweep #10 T16, ids P185115–P185214.
// The three deliberately-public endpoints in depth, every branch called IN MEMORY (routes.mjs):
// boundaries, every browser tag, the restaurant label rules, the phone-alert rules, and the
// "each restaurant only touches its own switch" questions. Nothing written, nothing sent.
/* eslint-disable @typescript-eslint/no-unused-vars -- a check suite: helpers are imported whole */
import { R, ok, eq, tag, src, code, ROUTES } from "./lib.mjs";
import { call, world, g, FH, PP } from "./routes.mjs";

const done = tag("new-b");
let id = 185115;
const H = ROUTES.health, CE = ROUTES.clientError, MN = ROUTES.maintenance;
const N = (file, what, fn, how = "in memory: the real handler, stubbed database / alert / owner portfolio") => R(`P${id++}`, file, what, fn, how);
const post = (body, headers = {}) => call("clientError", "POST", { body, headers });
const rows = (a) => g().FIX.staff_actions.filter((r) => !a || r.action === a);
const UA = {
  safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  chromeIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 14; SM-A356E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-A356E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36",
  edgeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0",
  firefoxWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
  firefoxIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/128.0 Mobile/15E148 Safari/605.1.15",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  linuxChrome: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
};

// ══ /api/health ══
N(H, "only GET is exported — no write of any kind on a public probe", () => { const c = code(H); return ok(/export async function GET\(/.test(c) && !/export async function (POST|PUT|PATCH|DELETE)/.test(c)); }, "read the route");
N(H, "it reads no cookie, no header and no body — it cannot depend on who asks", () => !/req\.|cookies|headers\(\)/.test(code(H)), "read the route");
N(H, "the success body is exactly {ok:true}", async () => { await world(); return eq((await call("health", "GET")).text, '{"ok":true}'); });
N(H, "a database refusal says db:false and nothing about why", async () => { await world({ fail: { restaurants: { message: "relation does not exist", code: "42P01" } } }); const r = await call("health", "GET"); return ok(r.status === 503 && !/relation|42P01/.test(r.text), r.text); });
N(H, "it asks for the id column only, never a row of data", () => /\.select\("id"\)/.test(code(H)) && !/select\("\*"\)/.test(code(H)), "read the route");
N(H, "it is marked force-dynamic, so a build can never freeze one answer", () => /export const dynamic = "force-dynamic";/.test(code(H)), "read the route");
N(H, "five probes in a row are five single reads — no state builds up", async () => { await world(); for (let i = 0; i < 5; i++) await call("health", "GET"); return ok(g().READS.length === 5, String(g().READS.length)); });
N(H, "it is named on the deliberately-public list in the gate doc", () => /`\/api\/health`/.test(src("docs/CLAUDE-DETAIL.md")), "read docs/CLAUDE-DETAIL.md");
N(H, "the rejected deeper health page is still recorded on the line where it would come back", () => /REJECTED \(owner, 2026-08-13\)/.test(src(H)), "read the route header");

// ══ /api/log/client-error ══
N(CE, "only POST is exported", () => /export async function POST\(/.test(code(CE)) && !/export async function (GET|PUT|PATCH|DELETE)/.test(code(CE)), "read the route");
for (const p of ["tablet", "kitchen", "editor", "manager", "owner", "admin", "guest", "menu"]) N(CE, `the '${p}' panel is accepted`, async () => { await world(); await post({ panel: p, message: "x" }); return ok(rows("client_error").length === 1 && rows("client_error")[0].panel === p); });
N(CE, "a panel name in capitals is read in lower case ('MANAGER' → manager)", async () => { await world(); await post({ panel: "MANAGER", message: "x" }); return ok((rows()[0] || {}).panel === "manager"); });
N(CE, "a panel name with stray spaces is not guessed at — it is refused calmly", async () => { await world(); const r = await post({ panel: " manager ", message: "x" }); return ok(r.json.skipped === "bad_panel" && !rows().length); });
N(CE, "a body of exactly 2,048 characters is still read", async () => { await world(); const base = JSON.stringify({ panel: "manager", message: "" }); const pad = "m".repeat(2048 - base.length); const r = await post(JSON.stringify({ panel: "manager", message: pad })); return ok(!r.json.skipped && rows().length === 1, `${JSON.stringify({ panel: "manager", message: pad }).length} chars → ${r.text}`); });
N(CE, "…and 2,049 is dropped as too large", async () => { await world(); const r = await post("x".repeat(2049)); return ok(r.json.skipped === "too_large"); });
N(CE, "an empty body is answered calmly and writes nothing", async () => { await world(); const r = await post(""); return ok(r.json.ok === true && !rows().length, r.text); });
N(CE, "a body of `null` is answered calmly and writes nothing", async () => { await world(); const r = await post("null"); return ok(r.json.ok === true && !rows().length, r.text); });
N(CE, "a body that is a JSON array writes nothing", async () => { await world(); const r = await post("[1,2]"); return ok(r.json.ok === true && !rows().length, r.text); });
N(CE, "any kind that is not 'taps' is filed as a crash (an unknown kind is never dropped)", async () => { await world(); await post({ panel: "manager", kind: "weird", message: "x" }); return ok(rows("client_error").length === 1); });
N(CE, "a crash with no message is filed as 'client error'", async () => { await world(); await post({ panel: "manager" }); return ok(/^client error/.test(rows()[0].detail), rows()[0].detail); });
N(CE, "the message is cut at 300 characters", async () => { await world(); await post({ panel: "manager", message: "m".repeat(400) }); return ok(rows()[0].detail.startsWith("m".repeat(300)) && !rows()[0].detail.startsWith("m".repeat(301))); });
N(CE, "the place is cut at 120 characters", async () => { await world(); await post({ panel: "manager", message: "x", where: "w".repeat(200) }); return ok(rows()[0].detail === "x @ " + "w".repeat(120)); });
N(CE, "a crash with no place reads as just the message", async () => { await world(); await post({ panel: "manager", message: "only words" }); return ok(rows()[0].detail === "only words", rows()[0].detail); });
N(CE, "the whole stored line never passes 500 characters, browser tag included", async () => { await world(); await post({ panel: "guest", message: "m".repeat(300), where: "w".repeat(120) }, { "user-agent": UA.safariIphone }); return ok(rows()[0].detail.length <= 500, String(rows()[0].detail.length)); });
N(CE, "a tap batch is cut at 1,500 characters", async () => { await world(); await post(JSON.stringify({ panel: "manager", kind: "taps", detail: "t".repeat(1900) }).slice(0, 2040)); return ok(rows("ui_taps")[0].detail.length <= 1500, String((rows("ui_taps")[0] || {}).detail && rows("ui_taps")[0].detail.length)); });
N(CE, "a tap batch is stored under the action 'ui_taps', a crash under 'client_error'", async () => { await world(); await post({ panel: "manager", kind: "taps", detail: "[1]" }); await post({ panel: "manager", message: "x" }); return ok(rows("ui_taps").length === 1 && rows("client_error").length === 1); });
N(CE, "a restaurant id in capitals is accepted (it is still a uuid)", async () => { await world(); await post({ panel: "manager", message: "x", where: "/manager", rid: PP.toUpperCase() }); return ok(rows()[0].restaurant_id === PP.toUpperCase()); });
N(CE, "a restaurant id that is a number is ignored, not stored", async () => { await world(); await post({ panel: "manager", message: "x", rid: 12345 }); return ok(rows()[0].restaurant_id === null); });
N(CE, "a guest crash with no place but a /r/<slug> referer is filed under that restaurant", async () => { await world(); await post({ panel: "guest", message: "x" }, { referer: "https://3-d-backup.vercel.app/r/pizza-palace/menu?table=4" }); return ok(rows()[0].restaurant_id === PP, String(rows()[0].restaurant_id)); });
N(CE, "an address naming a restaurant that does not exist files it under nobody", async () => { await world(); await post({ panel: "guest", message: "x", where: "/r/no-such-place/menu" }); return ok(rows()[0].restaurant_id === null); });
N(CE, "a /q/<code> address names no restaurant, so a panel tag stands", async () => { await world(); await post({ panel: "guest", message: "x", where: "/q/abc123", rid: PP }); return ok(rows()[0].restaurant_id === PP); });
N(CE, "an address in capitals (/r/French-House/menu) still finds French House", async () => { await world(); await post({ panel: "guest", message: "x", where: "/r/French-House/menu" }); return ok(rows()[0].restaurant_id === FH, String(rows()[0].restaurant_id)); });
N(CE, "the slug is read from a full URL as well as a path", async () => { await world(); await post({ panel: "guest", message: "x", where: "https://aevidine.example/r/pizza-palace/menu" }); return ok(rows()[0].restaurant_id === PP); });
N(CE, "an address the claim AGREES with keeps the claim", async () => { await world(); await post({ panel: "guest", message: "x", where: "/r/french-house/menu", rid: FH }); return ok(rows()[0].restaurant_id === FH); });
N(CE, "the restaurant lookup is asked once per report, not once per field", async () => { await world(); await post({ panel: "guest", message: "x", where: "/r/french-house/menu" }); return ok(g().SLUGS.length === 1, String(g().SLUGS.length)); });
N(CE, "a tap batch from a guest address is labelled with that restaurant too", async () => { await world(); await post({ panel: "guest", kind: "taps", detail: "[1]", where: "/r/pizza-palace/menu" }); return ok(rows("ui_taps")[0].restaurant_id === PP); });
const tagOf = async (ua) => { await world(); await post({ panel: "guest", message: "x" }, { "user-agent": ua }); return (rows()[0].detail.match(/\[([^\]]+)\]$/) || [])[1] || ""; };
for (const [k, want] of [["safariIphone", "Safari · iPhone"], ["chromeIphone", "Chrome · iPhone"], ["chromeAndroid", "Chrome · Android"], ["samsung", "Chrome · Android"], ["edgeWin", "Edge · Windows"], ["firefoxWin", "Firefox · Windows"], ["firefoxIos", "Firefox · iPhone"], ["safariMac", "Safari · Mac"], ["ipad", "Safari · iPad"], ["linuxChrome", "Chrome · Linux"]])
  N(CE, `the browser tag for ${k} reads '${want}'`, async () => { const t = await tagOf(UA[k]); return ok(t === want, t); });
N(CE, "no user agent at all adds no tag", async () => ok((await tagOf("")) === ""));
N(CE, "an agent nobody recognises adds no tag rather than a guess", async () => ok((await tagOf("curl/8.4")) === ""));
N(CE, "a crash pings the owner's phone ONCE, under one key per panel", async () => { await world(); await post({ panel: "kitchen", message: "Cannot read properties of null (reading 'x')", where: "app.js@abcd1234:1" }); await Promise.all(g().AFTER); return ok(g().ALERTS.length === 1 && g().ALERTS[0].key === "client:kitchen", JSON.stringify(g().ALERTS.map((a) => a.key))); });
N(CE, "…titled 'Screen error in <panel>'", async () => { await world(); await post({ panel: "tablet", message: "x" }); await Promise.all(g().AFTER); return ok(g().ALERTS[0].opts.title === "Screen error in tablet"); });
N(CE, "…and the alert reads as a sentence, not the browser's words", async () => { await world(); await post({ panel: "kitchen", message: "TypeError: Cannot read properties of null (reading 'innerHTML')", where: "/kitchen" }); await Promise.all(g().AFTER); const t = g().ALERTS[0].text; return ok(/^Problem: /.test(t) && !/TypeError/.test(t), t.split("\n")[0]); });
N(CE, "…and it points at where to look in the admin", async () => { await world(); await post({ panel: "kitchen", message: "x" }); await Promise.all(g().AFTER); return ok(/Open admin → Logs/.test(g().ALERTS[0].text)); });
N(CE, "a crash that hits the cap does NOT ping the phone", async () => { const now = new Date().toISOString(); await world({ actions: Array.from({ length: 5 }, (_, i) => ({ id: "a" + i, device_id: "d1", action: "client_error", created_at: now })) }); await post({ panel: "manager", message: "x" }, { cookie: "lfh_panel_device=d1" }); await Promise.all(g().AFTER); return ok(g().ALERTS.length === 0); });
N(CE, "a refused body (bad panel, too large, broken) never pings the phone", async () => { await world(); await post({ panel: "zzz" }); await post("x".repeat(3000)); await post("{nope"); await Promise.all(g().AFTER); return ok(g().ALERTS.length === 0); });
N(CE, "the alert is sent AFTER the answer, so a crashing page is never kept waiting", () => /after\(sendOwnerAlert\(/.test(code(CE)), "read the route");
N(CE, "an alert that fails to send is swallowed — the report was already kept", () => /\)\.catch\(\(\) => \{\}\)\);/.test(code(CE)), "read the route");
N(CE, "crashes older than ten minutes do not count towards the cap", async () => { const old = new Date(Date.now() - 11 * 60000).toISOString(); await world({ actions: Array.from({ length: 5 }, (_, i) => ({ id: "a" + i, device_id: "d1", action: "client_error", created_at: old })) }); const r = await post({ panel: "manager", message: "x" }, { cookie: "lfh_panel_device=d1" }); return ok(!r.json.skipped, r.text); });
N(CE, "the tap cap and the crash cap are counted separately", async () => { const now = new Date().toISOString(); await world({ actions: Array.from({ length: 40 }, (_, i) => ({ id: "t" + i, device_id: "d1", action: "ui_taps", created_at: now })) }); const r = await post({ panel: "manager", message: "x" }, { cookie: "lfh_panel_device=d1" }); return ok(!r.json.skipped && rows("client_error").length === 1); });
N(CE, "one device's cap does not silence another device", async () => { const now = new Date().toISOString(); await world({ actions: Array.from({ length: 5 }, (_, i) => ({ id: "a" + i, device_id: "d1", action: "client_error", created_at: now })) }); const r = await post({ panel: "manager", message: "x" }, { cookie: "lfh_panel_device=d2" }); return ok(!r.json.skipped); });
N(CE, "with no cookie the caller is counted by the first forwarded address", async () => { await world(); await post({ panel: "manager", message: "x" }, { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }); return ok(rows()[0].device_id === "ip:203.0.113.9", rows()[0].device_id); });
N(CE, "…and the address is the server's, never a field in the body", async () => { await world(); await post({ panel: "manager", message: "x", device_id: "forged", ip: "1.2.3.4" }); return ok(rows()[0].device_id === "ip:unknown", rows()[0].device_id); });
N(CE, "the counter's read is bounded at the cap itself", () => /\.limit\(max\)/.test(src("lib/publicCap.ts")), "read lib/publicCap.ts");
N(CE, "every path answers 200 — the error-logger never errors", async () => { await world({ fail: { "staff_actions:insert": "throw", "staff_actions:select": "throw" } }); const r = await post({ panel: "manager", message: "x" }); return ok(r.status === 200 && r.json.ok === true, r.text); });
N(CE, "it reads no login cookie at all — a crashing page has no session to give", () => !/requireRole|userFromCookie|tokenIsValid|ownerScope/.test(code(CE)), "read the route");
N(CE, "a crash row is written at level 'error', a tap batch at level 'info'", async () => { await world(); await post({ panel: "manager", message: "x" }); await post({ panel: "manager", kind: "taps", detail: "[1]" }); return ok(rows("client_error")[0].level === "error" && rows("ui_taps")[0].level === "info"); });
N(CE, "nothing a caller sends can set the level", async () => { await world(); await post({ panel: "manager", message: "x", level: "info" }); return ok(rows()[0].level === "error"); });
N(CE, "nothing a caller sends can set the action", async () => { await world(); await post({ panel: "manager", message: "x", action: "login" }); return ok(rows()[0].action === "client_error"); });
N(CE, "one report is ONE insert, never two", async () => { await world(); await post({ panel: "manager", message: "x" }); return ok(g().WRITES.filter((w) => w.op === "insert").length === 1); });

// ══ /api/maintenance ══
N(MN, "GET and POST are the only methods", () => /export async function GET\(/.test(code(MN)) && /export async function POST\(/.test(code(MN)) && !/export async function (PUT|PATCH|DELETE)/.test(code(MN)), "read the route");
N(MN, "a manager's read touches only the settings row of their own restaurant", async () => { await world(); g().SCOPE_LOG = []; await call("maintenance", "GET"); const q = g().SCOPE_LOG.filter((x) => x.table === "settings"); return ok(q.length === 1 && q[0].filters.some((f) => f.col === "restaurant_id" && f.val === FH), JSON.stringify(q)); });
N(MN, "…reading the service_mode column only", async () => { await world(); g().SCOPE_LOG = []; await call("maintenance", "GET"); return ok(g().SCOPE_LOG.find((x) => x.table === "settings").cols === "service_mode"); });
N(MN, "a read never looks at the power settings — only a write does", async () => { await world(); g().SCOPE_LOG = []; await call("maintenance", "GET"); return ok(!g().SCOPE_LOG.some((x) => x.table === "restaurants")); });
N(MN, "a manager's write is filtered by their restaurant id", async () => { await world({ access: { maintenance: { on: true, manager_opts: { who: "owner_manager" } } } }); g().SCOPE_LOG = []; await call("maintenance", "POST", { body: { on: true } }); const w = g().SCOPE_LOG.find((x) => x.table === "settings" && x.op === "update"); return ok(w && w.filters.some((f) => f.col === "restaurant_id" && f.val === FH), JSON.stringify(w)); });
N(MN, "a manager is refused when the power is on for the OWNER only", async () => { await world({ access: { maintenance: { on: true } } }); const r = await call("maintenance", "POST", { body: { on: true } }); return ok(r.status === 403); });
N(MN, "…and the refusal says who to ask, in plain words", async () => { await world(); const r = await call("maintenance", "POST", { body: { on: true } }); return ok(/ask your admin/.test(r.json.error), r.json.error); });
N(MN, "the admin may flip it with the power OFF (the admin always may)", async () => { await world({ who: "admin" }); const r = await call("maintenance", "POST", { body: { on: true }, query: "?rid=" + FH }); return ok(r.status === 200 && r.json.maintenance === true); });
N(MN, "the admin with no restaurant named and no act-as cookie is refused with a sentence", async () => { await world({ who: "admin" }); const r = await call("maintenance", "GET"); return ok(r.status === 400 && /No restaurant/.test(r.json.error), r.text); });
N(MN, "the admin's act-as cookie names the restaurant when there is no ?rid", async () => { await world({ who: "admin" }); const r = await call("maintenance", "GET", { headers: { cookie: "aevidine_admin_rid=" + PP } }); return ok(r.json.maintenance === true); });
N(MN, "…and a per-tab ?rid wins over that cookie", async () => { await world({ who: "admin" }); const r = await call("maintenance", "GET", { query: "?rid=" + FH, headers: { cookie: "aevidine_admin_rid=" + PP } }); return ok(r.json.maintenance === false); });
N(MN, "'on' must be exactly true — the string \"true\" brings the menu back, never takes it down", async () => { await world({ who: "admin" }); const r = await call("maintenance", "POST", { body: { on: "true" }, query: "?rid=" + FH }); return ok(r.json.maintenance === false); });
N(MN, "turning it on is logged as maintenance_on, off as maintenance_off", async () => { await world({ who: "admin" }); await call("maintenance", "POST", { body: { on: true }, query: "?rid=" + FH }); await call("maintenance", "POST", { body: { on: false }, query: "?rid=" + FH }); return eq(g().LOGS.map((l) => l.action), ["maintenance_on", "maintenance_off"]); });
N(MN, "the log line names the person in words", async () => { await world({ access: { maintenance: { on: true, manager_opts: { who: "owner_manager" } } } }); await call("maintenance", "POST", { body: { on: true } }); return ok(g().LOGS[0].detail === "Diag Manager took the guest menu OFFLINE", g().LOGS[0].detail); });
N(MN, "…carries the restaurant and the device", async () => { await world({ access: { maintenance: { on: true, manager_opts: { who: "owner_manager" } } } }); await call("maintenance", "POST", { body: { on: true } }); const l = g().LOGS[0]; return ok(l.restaurant_id === FH && l.device_id === "dev-test"); });
N(MN, "a refused write logs nothing", async () => { await world(); await call("maintenance", "POST", { body: { on: true } }); return ok(g().LOGS.length === 0); });
N(MN, "a database refusal on the read is a plain sentence, the code stays in the server log", async () => { await world({ fail: { settings: { message: "permission denied for table settings", code: "42501" } } }); const r = await call("maintenance", "GET"); return ok(r.status === 500 && !/permission|42501/.test(r.text)); });
N(MN, "an owner's restaurant check is asked of THAT owner's portfolio", async () => { await world({ who: "owner", owned: { o1: [PP] } }); await call("maintenance", "GET", { query: "?rid=" + PP }); return ok(JSON.stringify(g().OWNED_ASKED) === '["o1"]'); });
N(MN, "an owner of two restaurants reaches each one by naming it", async () => { const out = []; for (const r0 of [FH, PP]) { await world({ who: "owner", owned: { o1: [FH, PP] } }); out.push((await call("maintenance", "GET", { query: "?rid=" + r0 })).json.maintenance); } return eq(out, [false, true]); });
N(MN, "an owner whose restaurants are all switched off owns nothing here", async () => { await world({ who: "owner", owned: { o1: [] } }); const r = await call("maintenance", "GET", { query: "?rid=" + PP }); return ok(r.status === 403); });
N(MN, "a waiter or a cook never reaches the switch — the gate names the manager role", () => /requireRole\(req, "manager"\)/.test(code(MN)) && /if \(have === "manager"\) return need === "kitchen" \|\| need === "tablet";/.test(src("lib/userAuth.ts")), "read the gate and roleSatisfies");
N(MN, "the drawer shows the switch to managers only (not owners, cooks or waiters)", () => /const isManager = profile\.role === "manager" \|\| profile\.role === "editor";/.test(code("maint.js")) && /if \(isManager\) \{\s*const maintBtn/.test(code("maint.js")), "read maint.js");
N(MN, "the drawer's switch never claims a state the server did not confirm", () => /if \(!r\.ok\) \{ const e = new Error\(j\.error \|\| "The server wouldn't change it\."\); e\.status = r\.status; throw e; \}\s*maintOn = turnOn;/.test(code("maint.js")), "read maint.js setMaint");
N(MN, "every call from the drawer has an 8 s ceiling", () => (code("maint.js").match(/fetch\("\/api\/maintenance"[^;]*?signal: deadline\(\)/g) || []).length === 2, "read maint.js");
N(MN, "the switch's state is read fresh, never from a cache", () => /fetch\("\/api\/maintenance", \{ cache: "no-store"/.test(code("maint.js")), "read maint.js");

done();
