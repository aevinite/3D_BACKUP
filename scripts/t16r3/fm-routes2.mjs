// Family M — SECOND PASS, AIMED BY COVERAGE: the owner's own guest-menu switch (owner → Settings →
// Guest menu; app/api/owner/settings/route.ts, the maintenance half this terminal wrote in round 2 —
// the first pass never ran it), and the crash log's last unrun paths: the per-device limits and the
// browser named on each row. In memory, the real route files, the recording stand-in database.
import { C, ok, rng } from "./lib.mjs";
import { call, world, g, FH, PP } from "../sweep/t16s10/routes.mjs";

const quiet = async (fn) => { const k = [console.warn, console.error, console.log]; console.warn = console.error = console.log = () => {}; try { return await fn(); } finally { [console.warn, console.error, console.log] = k; } };
const CASES = 300;
function prop(subject, what, fn) {
  C("M", subject, what, () => quiet(async () => {
    for (let s = 1; s <= CASES; s++) { const why = await fn(rng(s * 17 + 3)); if (why) return ok(false, `seed ${s}: ${why}`); }
    return ok(true, `${CASES} random requests`);
  }));
}
const NOWHERE = "33333333-3333-4333-8333-333333333333";

// ── the owner's guest-menu switch ─────────────────────────────────────────────────────────────
prop("app/api/owner/settings/route.ts", "the owner's switch, for every mix of owner × restaurant × hand-over × settings entitlement × body × a database blip: exactly the answer the rule gives, only that restaurant's row moves, a refusal is a sentence", async (R) => {
  const kind = R.pick(["owner", "owner", "ownerAdmin", "admin"]);
  const scope = kind === "admin" ? { all: true, admin: true } : { all: false, ids: R.pick([[FH], [FH, PP], [PP]]), ownerId: "o1", ownerName: "Owner", ...(kind === "ownerAdmin" ? { admin: true } : {}) };
  const grant = { [FH]: R.pick([{}, { maintenance: { on: true } }, { maintenance: { on: false } }, { maintenance: { on: "true" } }]), [PP]: R.pick([{}, { maintenance: { on: true } }]) };
  const entOff = R.bool(0.2) ? [FH + ":settings", PP + ":settings"] : [];
  const rid = R.pick([FH, PP, NOWHERE, "", null]);
  const on = R.pick([true, false, "true", 1, null, undefined]);
  const failCfg = R.bool(0.08), failSet = R.bool(0.08);
  await world({ oscope: scope, entOff, access: grant[FH], accessPP: grant[PP] });
  const f = {}; if (failCfg) f.restaurants = "error"; if (failSet) f.settings = "error"; if (Object.keys(f).length) g().FAIL = f;
  const before = JSON.stringify(g().FIX.settings);
  const r = await call("ownerSettings", "PATCH", { body: { maintenance: { restaurant_id: rid, on } } });
  // the rule
  let want;
  if (!rid || typeof on !== "boolean") want = 400;
  else if (!scope.all && !scope.ids.includes(rid)) want = 403;
  else if (!scope.all && !scope.admin && entOff.includes(rid + ":settings")) want = 403;
  else if (failCfg) want = 503;
  else if (!(scope.all || scope.admin) && !(grant[rid] && grant[rid].maintenance && grant[rid].maintenance.on === true)) want = 403;
  else if (failSet) want = 500;
  else if (rid !== FH && rid !== PP) want = 409;
  else want = 200;
  const tag = JSON.stringify({ kind, ids: scope.ids, rid, on, grant: grant[rid], entOff: entOff.length, failCfg, failSet });
  if (r.status !== want && !(want === 503 && r.status === 500)) return `${tag} → ${r.status}, rule says ${want} (${r.text.slice(0, 120)})`;
  const was = JSON.parse(before), now = g().FIX.settings;
  const moved = now.filter((x, i) => JSON.stringify(x) !== JSON.stringify(was[i])).map((x) => x.restaurant_id);
  if (r.status === 200) {
    if (r.json.maintenance !== on) return `${tag} → said ${r.json.maintenance}`;
    if (moved.some((x) => x !== rid)) return `${tag} → another restaurant's switch moved`;
    if ((now.find((x) => x.restaurant_id === rid) || {}).service_mode !== on) return `${tag} → the saved switch disagrees`;
    const log = (g().LOGS || [])[0] || {};
    if (log.restaurant_id !== rid || !/guest menu/.test(log.detail || "")) return `${tag} → no Activity line for it: ${JSON.stringify(log)}`;
  } else {
    if (moved.length) return `${tag} → refused but a switch moved`;
    if (!r.json || !/ /.test(r.json.error || "")) return `${tag} → a ${r.status} with no sentence: ${r.text.slice(0, 100)}`;
  }
});
C("M", "app/api/owner/settings/route.ts", "the owner's Settings page lists the switch ONLY for a restaurant it was handed over for (and that has settings), with its real state; an unreadable state is said, not hidden", () => quiet(async () => {
  const OWN = { all: false, ids: [FH, PP], ownerId: "o1", ownerName: "Owner" };
  await world({ oscope: OWN, ent: { settings: true }, access: { maintenance: { on: true } }, accessPP: {}, settings: [{ id: "a", restaurant_id: FH, service_mode: true }, { id: "b", restaurant_id: PP, service_mode: false }] });
  g().FIX.restaurants.forEach((x) => { x.name = x.name || x.slug; });
  const a = await call("ownerSettings", "GET");
  await world({ oscope: OWN, ent: { settings: true }, access: { maintenance: { on: true } } });
  g().FAIL_NTH = { "restaurants:select": { at: 2, mode: "error" } };   // only the maintenance read (the page's 2nd restaurants read) fails
  const b = await call("ownerSettings", "GET");
  const ma = a.json && a.json.maintenance, mb = b.json && b.json.maintenance;
  return ok(a.status === 200 && Array.isArray(ma) && ma.length === 1 && ma[0].restaurant_id === FH && ma[0].on === true && a.json.maintenanceOk === true && b.status === 200 && b.json.maintenanceOk === false && Array.isArray(mb) && mb.length === 0,
    JSON.stringify({ a: { s: a.status, ma, ok: a.json && a.json.maintenanceOk, err: a.json && a.json.error }, b: { s: b.status, mb, ok: b.json && b.json.maintenanceOk } }));
}));

// ── the crash log: limits and the browser on each row ─────────────────────────────────────────
C("M", "app/api/log/client-error/route.ts", "one device past its limit (5 crash rows, or 40 tap trails, in 10 minutes) is quietly not filed again — still answered ok — while another device is filed as normal", () => quiet(async () => {
  const now = new Date().toISOString();
  const rows = (dev, action, n) => Array.from({ length: n }, (_, i) => ({ id: `${dev}-${action}-${i}`, device_id: dev, action, created_at: now }));
  await world({ actions: [...rows("dev-busy", "client_error", 5), ...rows("dev-busy", "ui_taps", 40)] });
  const send = (dev, body) => call("clientError", "POST", { body, headers: { cookie: `lfh_panel_device=${dev}` } });
  const e1 = await send("dev-busy", { panel: "kitchen", message: "x" });
  const t1 = await send("dev-busy", { panel: "kitchen", kind: "taps", detail: "[1]" });
  const e2 = await send("dev-calm", { panel: "kitchen", message: "x" });
  const ins = (g().WRITES || []).filter((w) => w.table === "staff_actions" && w.op === "insert").map((w) => (Array.isArray(w.patch) ? w.patch[0] : w.patch).device_id);
  return ok(e1.json.skipped === "rate_limited" && t1.json.skipped === "rate_limited" && e2.json.ok === true && !e2.json.skipped && ins.length === 1 && ins[0] === "dev-calm", JSON.stringify({ e1: e1.json, t1: t1.json, e2: e2.json, ins }));
}));
const UAS = [
  ["Mozilla/5.0 (Linux; Android 14; SM-X205) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Safari/537.36", "Samsung · Android"],
  ["Mozilla/5.0 (Linux; Android 13; SM-A146B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36", "Samsung · Android"],
  ["Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36", "Chrome · Android"],
  ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.71 Mobile/15E148 Safari/604.1", "Chrome · iPhone"],
  ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1", "Safari · iPhone"],
  ["Mozilla/5.0 (iPad; CPU OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1", "Safari · iPad"],
  ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/125.0 Mobile/15E148 Safari/605.1.15", "Firefox · iPhone"],
  ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/124.0.2478.50 Mobile/15E148 Safari/605.1.15", "Edge · iPhone"],
  ["Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 EdgA/124.0.2478.62", "Edge · Android"],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.2478.67", "Edge · Windows"],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15", "Safari · Mac"],
  ["Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0", "Firefox · Linux"],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0", "Firefox · Windows"],
];
C("M", "app/api/log/client-error/route.ts", "each crash row names the browser and device it came from, correctly — Samsung Internet as Samsung (it also says 'Chrome'), Edge on a phone as Edge, Chrome on an iPhone as Chrome", () => quiet(async () => {
  const wrong = [];
  for (const [ua, want] of UAS) {
    await world({});
    await call("clientError", "POST", { body: { panel: "tablet", message: "boom" }, headers: { "user-agent": ua } });
    const w = (g().WRITES || []).find((x) => x.table === "staff_actions" && x.op === "insert");
    const d = w && (Array.isArray(w.patch) ? w.patch[0] : w.patch).detail;
    if (!d || !d.endsWith(`[${want}]`)) wrong.push(`${want} → ${d && d.slice(d.indexOf("["))}`);
  }
  return ok(!wrong.length, wrong.join(" · ") || `${UAS.length} real browsers`);
}));
