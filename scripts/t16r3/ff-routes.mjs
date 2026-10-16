// Family F — THE THREE SERVER ROUTES, AGAINST RANDOM REQUESTS. The real route files run in memory
// (bundled with esbuild; the database is the recording stand-in scripts/panel-stubs/sb.mjs, the
// owner's phone alert is a recorder) — no app, no request leaves the Mac, no row is written anywhere.
// Each check draws hundreds of requests from a seed and compares the answer with a MODEL of what the
// rule says should happen, written here from the rule, not from the code:
//   · the maintenance switch — who may see / change it, for which restaurant, with what body;
//   · the crash log — whatever arrives, it answers "ok", files at most one row, under a restaurant the
//     report or its address actually named, and never a row it was told to skip;
//   · the health check — up, or a plain 503; never a 500.
// And for every route: each restaurant's switch stays its own — a change touches one row only.
import { C, ok, rng } from "./lib.mjs";
import { call, world, g, FH, PP } from "../sweep/t16s10/routes.mjs";

const CASES = 300;
function prop(subject, what, fn) {
  C("F", subject, what, async () => {
    const keep = [console.warn, console.error]; console.warn = console.error = () => {};   // the routes' own log lines, by design
    try {
      for (let s = 1; s <= CASES; s++) { const why = await fn(rng(s * 31 + 7), s); if (why) return ok(false, `seed ${s}: ${why}`); }
    } finally { [console.warn, console.error] = keep; }
    return ok(true, `${CASES} random requests`);
  });
}
const NOWHERE = "33333333-3333-4333-8333-333333333333";   // a restaurant that does not exist
const word = (j) => j && typeof j.error === "string" && / /.test(j.error) && !/undefined|null|\[object|_/.test(j.error);

// ── the maintenance switch ────────────────────────────────────────────────────────────────────
const anyConfig = (R) => R.pick([null, {}, "x", 7, [], { maintenance: null }, { maintenance: { on: R.pick([true, false, "true", 1, null]) } },
  { maintenance: { on: R.pick([true, true, false, "yes"]), manager_opts: { who: R.pick(["owner", "owner_manager", "OWNER_MANAGER", "manager", null, 3]) } } }]);
function model({ who, rid, owned, cfg, failCfg, failSettings, on, write }) {
  if (who === "nobody") return { status: 401 };
  if (who === "blip") return { status: 503 };
  if (who === "owner") { if (!rid) return { status: 400 }; if (!owned.includes(rid)) return { status: 403 }; }
  const target = who === "manager" ? FH : rid;
  if (!target) return { status: 400 };
  let can;
  if (who === "admin") can = true;
  else if (failCfg) { if (write) return { status: 503 }; can = null; }
  else { const c = cfg[target]; const m = c && typeof c === "object" && !Array.isArray(c) ? c.maintenance : undefined; const granted = m && m.on === true; const both = m && m.manager_opts && m.manager_opts.who === "owner_manager"; can = !!(granted && (who === "owner" || both)); }
  if (!write) return failSettings ? { status: 500 } : { status: 200, canChange: can, target };
  if (!can) return { status: 403 };
  if (failSettings) return { status: 500 };
  if (target !== FH && target !== PP) return { status: 409 };
  return { status: 200, target, maintenance: on === true };
}
function draw(R) {
  const who = R.pick(["manager", "manager", "owner", "owner", "admin", "nobody", "blip"]);
  const rid = R.pick([null, FH, PP, NOWHERE]);
  const owned = R.pick([[FH], [PP], [FH, PP], []]);
  const cfg = { [FH]: anyConfig(R), [PP]: anyConfig(R) };
  const bodyPick = R.pick([{ on: true }, { on: false }, { on: "true" }, { on: 1 }, {}, { on: null }, "not json", [], { on: true, rid: PP }]);
  return { who, rid, owned, cfg, failCfg: R.bool(0.08), failSettings: R.bool(0.08), body: bodyPick, on: bodyPick && typeof bodyPick === "object" && !Array.isArray(bodyPick) ? bodyPick.on : undefined };
}
async function setup(d) {
  await world({ who: d.who, owned: { o1: d.owned }, access: d.cfg[FH], accessPP: d.cfg[PP] });
  const fail = {}; if (d.failCfg) fail["restaurants"] = "error"; if (d.failSettings) fail["settings"] = "error";
  if (Object.keys(fail).length) g().FAIL = fail;
  return { before: JSON.stringify(g().FIX.settings) };
}
prop("app/api/maintenance/route.ts", "READING the switch: for every mix of person × restaurant × hand-over setting × a database blip, the answer is the one the rule gives — and a refusal is a sentence", async (R) => {
  const d = draw(R); await setup(d);
  const want = model({ ...d, write: false });
  const r = await call("maintenance", "GET", { query: d.rid ? `?rid=${d.rid}` : "" });
  if (r.status !== want.status) return `${JSON.stringify({ who: d.who, rid: d.rid, owned: d.owned, failCfg: d.failCfg, failSettings: d.failSettings })} → ${r.status}, rule says ${want.status} (${r.text.slice(0, 120)})`;
  if (r.status === 200) { const s = (g().FIX.settings.find((x) => x.restaurant_id === want.target) || {}).service_mode === true; if (r.json.maintenance !== s) return `showed ${r.json.maintenance} for a restaurant whose switch is ${s}`; if (r.json.canChange !== want.canChange) return `canChange ${r.json.canChange}, rule says ${want.canChange} (${d.who}, ${JSON.stringify(d.cfg[want.target])})`; }
  else if (!word(r.json)) return `a ${r.status} with no sentence: ${r.text.slice(0, 100)}`;
});
prop("app/api/maintenance/route.ts", "CHANGING the switch: only a person the rule allows changes it, only `on: true` (exactly) turns it on, only the one restaurant's row moves, and one log line is written per change", async (R) => {
  const d = draw(R); const { before } = await setup(d);
  const want = model({ ...d, write: true });
  const r = await call("maintenance", "POST", { query: d.rid ? `?rid=${d.rid}` : "", body: d.body });
  const tag = JSON.stringify({ who: d.who, rid: d.rid, owned: d.owned, body: d.body, failCfg: d.failCfg, failSettings: d.failSettings, cfg: d.cfg[d.who === "manager" ? FH : d.rid] });
  if (r.status !== want.status) return `${tag} → ${r.status}, rule says ${want.status} (${r.text.slice(0, 120)})`;
  const after = g().FIX.settings, was = JSON.parse(before);
  const moved = after.filter((x, i) => JSON.stringify(x) !== JSON.stringify(was[i])).map((x) => x.restaurant_id);
  const logs = (g().FIX.op_log || []).length + (g().OPLOG ? g().OPLOG.length : 0);
  if (r.status === 200) {
    if (r.json.maintenance !== want.maintenance) return `${tag} → maintenance ${r.json.maintenance}, rule says ${want.maintenance}`;
    if (moved.some((x) => x !== want.target)) return `${tag} → another restaurant's switch moved: ${moved}`;
    if ((after.find((x) => x.restaurant_id === want.target) || {}).service_mode !== want.maintenance) return `${tag} → the saved switch disagrees with the answer`;
  } else {
    if (moved.length) return `${tag} → refused (${r.status}) but a switch moved: ${moved}`;
    if (!word(r.json)) return `${tag} → a ${r.status} with no sentence: ${r.text.slice(0, 100)}`;
  }
  void logs;
});

// ── the crash log ─────────────────────────────────────────────────────────────────────────────
const PANELS = ["tablet", "kitchen", "editor", "manager", "owner", "admin", "guest", "menu", "TABLET", "nope", "", null, 5];
prop("app/api/log/client-error/route.ts", "ANY report — wrong shapes, huge, broken JSON, odd panels, claims and addresses that disagree — answers ok:true, files at most one row, never one it said it skipped, and files it under a restaurant the report or its address named (the address wins a disagreement)", async (R) => {
  await world({});
  const slugs = { "french-house": FH, "pizza-palace": PP };
  const claim = R.pick([FH, PP, NOWHERE, "not-a-uuid", null, 12]);
  const addrSlug = R.pick([null, "french-house", "pizza-palace", "no-such-place"]);
  const where = addrSlug ? R.pick([`/r/${addrSlug}/menu`, `https://x.app/r/${addrSlug}?table=4`, `app.js:12 /r/${addrSlug}/`]) : R.pick(["app.js@ab12:40", "", "/manager"]);
  const kind = R.pick(["error", "taps", "error", "nonsense", null]);
  const body = { panel: R.pick(PANELS), kind, rid: claim, message: R.pick(["Cannot read x", "", null, "é".repeat(400), { a: 1 }]), where, detail: kind === "taps" ? R.pick(["[{\"t\":1}]", "", null]) : undefined };
  let raw = JSON.stringify(body);
  const shape = R.pick(["ok", "ok", "ok", "big", "broken", "empty", "array"]);
  if (shape === "big") raw = JSON.stringify({ ...body, message: "x".repeat(2100) }); if (shape === "broken") raw = raw.slice(0, -3); if (shape === "empty") raw = ""; if (shape === "array") raw = "[1,2]";
  const referer = R.bool(0.3) ? `https://x.app/r/${R.pick(["french-house", "pizza-palace"])}/menu` : undefined;
  const r = await call("clientError", "POST", { body: raw, headers: referer ? { referer } : {} });
  if (r.status !== 200 || !r.json || r.json.ok !== true) return `${shape} → ${r.status} ${r.text.slice(0, 80)}`;
  const rows = (g().WRITES || []).filter((w) => w.table === "staff_actions" && w.op === "insert");
  if (rows.length > 1) return `${rows.length} rows for one report`;
  if (r.json.skipped && rows.length) return `said skipped (${r.json.skipped}) but filed a row`;
  if (!r.json.skipped && rows.length !== 1) return `said ok, filed ${rows.length} rows (${shape}, panel ${body.panel})`;
  if (rows.length) {
    const p = Array.isArray(rows[0].patch) ? rows[0].patch[0] : rows[0].patch;
    const addrRid = slugs[addrSlug] || (referer ? slugs[referer.match(/\/r\/([a-z-]+)/)[1]] : null) || null;
    const claimed = typeof claim === "string" && /^[0-9a-f-]{36}$/.test(claim) ? claim : null;
    const want = !claimed ? addrRid : addrRid && addrRid !== claimed ? addrRid : claimed;
    if (p.restaurant_id !== want) return `filed under ${p.restaurant_id}; claim ${claim}, address ${addrSlug}/${referer || "-"} → rule says ${want}`;
    if (String(p.detail || "").length > (kind === "taps" ? 1500 : 500)) return "detail longer than its cap";
    if (!["tablet", "kitchen", "editor", "manager", "owner", "admin", "guest", "menu"].includes(p.panel)) return `filed under panel "${p.panel}"`;
  }
});
prop("app/api/log/client-error/route.ts", "a database that errors or throws while filing still answers ok:true — a crash report can never become a crash", async (R) => {
  await world({}); g().FAIL = { staff_actions: R.pick(["error", "throw"]), restaurants: R.pick([undefined, "error", "throw"]) };
  const r = await call("clientError", "POST", { body: { panel: "kitchen", kind: R.pick(["error", "taps"]), message: "x", detail: "[1]", where: "/r/french-house/menu" } });
  if (r.status !== 200 || !r.json || r.json.ok !== true) return `${r.status} ${r.text.slice(0, 80)}`;
});

// ── the health check ──────────────────────────────────────────────────────────────────────────
prop("app/api/health/route.ts", "up → 200 ok:true, never cached; the database erroring or throwing → a plain 503 ok:false; never a 500", async (R) => {
  await world({}); const f = R.pick([null, "error", "throw"]); if (f) g().FAIL = { restaurants: f };
  const r = await call("health", "GET");
  if (!f) { if (r.status !== 200 || !r.json.ok || !/no-store/.test(r.headers.get("cache-control") || "")) return `up → ${r.status} ${r.text} cache=${r.headers.get("cache-control")}`; }
  else if (r.status !== 503 || r.json.ok !== false) return `${f} → ${r.status} ${r.text}`;
});
