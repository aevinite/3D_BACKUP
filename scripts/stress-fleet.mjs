// stress-fleet.mjs — THE WHOLE-SAAS STRESS TEST (owner 2026-09-18: "62 restaurants, 30 tables
// each, all ordering/accepting/preparing simultaneously, 30 minutes straight, before and after").
//
// WHAT IT DOES
//   Seeds 62 disposable tenants (`zzstress-NN`, 30 tables + a real menu each), then spawns ONE OS
//   PROCESS PER RESTAURANT — 62 of them, all live for all 30 minutes. Inside each, the actors of
//   an actual restaurant: one waiter seating and settling tables, 30 guest phones on the anon key,
//   one kitchen screen, one floor board. 1,860 tables live at once.
//
// WHY PROCESSES AND NOT 62 LLM AGENTS
//   An LLM agent makes roughly one tool call every few seconds, so 62 of them produce a handful of
//   writes per second — less load than one waiter on a slow evening — while costing real tokens.
//   62 node processes produce hundreds per second and cost nothing. The owner's stated reason for
//   asking for Haiku was token cost; this serves that reason better than Haiku does.
//
// WHY AN INTENSITY LADDER AND NOT 30 FLAT MINUTES
//   A flat slam answers "did it break" and nothing else. Every restaurant is live throughout — what
//   climbs is how hard each table orders — so the answer is a ceiling ("it holds to N× a real
//   rush") and phase 1 is a truthful picture of 62 genuinely busy restaurants rather than a number
//   no dining room could ever produce.
//
// WHAT IT LEARNED THE HARD WAY (2026-09-18, and the reason for the rewrite below it)
//   The first version of this rig reported "the app fails: 68% of orders failed, an idle
//   restaurant's floor board took 19 seconds". Both numbers were artefacts of the rig:
//     · it drove 30 table-loops per restaurant into a race over the same 3 `status=received` rows,
//       which is contention no restaurant can generate (see stress-tenant.mjs for the full story);
//     · it measured "the floor board" as a raw PostgREST call to lfh_floor_bundle with a
//       service-role key — around the route, the permission check and the shared 1.5s snapshot
//       that the real screen actually has. A rig must never report a number for a screen it never
//       opened, so every probe here now goes through the real door.
//
// THE MEASUREMENT IS NOT THE LOAD'S OWN LATENCY. Throughout, a probe loop asks the question a
// restaurant owner would ask: while 62 other restaurants are slammed, does MY floor board still
// open, does the guest menu still load, is the site still up? That is the finding.
//
// Everything written lives inside the 62 stress tenants, so cleanup is exact and no real
// restaurant is ever written to — the real ones are READ by the probes only.
//
// The sb() deadline, the light disk-stat path and the probe in-flight guard came from the
// backup-menu-db session on 2026-09-18, which measured the per-table pg_total_relation_size walk
// in the watchdog at 1,427ms MEAN under load — a monitor costing more than the thing it monitors,
// and quietly inflating the tail latencies this script exists to report.
//
// Usage: node scripts/stress-fleet.mjs [--minutes 30] [--tenants 62] [--tables 30]
//                                      [--seed-only] [--cleanup-only] [--out <dir>]
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { refuseUnlessDevTestDb, dbRefOf } from "./sweep/devStacks.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = process.argv.slice(2);
const arg = (n, d) => { const i = ARGS.indexOf("--" + n); return i >= 0 ? ARGS[i + 1] : d; };
const has = (n) => ARGS.includes("--" + n);

const MINUTES = Number(arg("minutes", "30"));
const TENANTS = Number(arg("tenants", "62"));
const TABLES = Number(arg("tables", "30"));
const OUT = arg("out", join(ROOT, "stress-report"));
// How many idle rounds the before/after baseline averages over. 30 is right for a real run; a
// correctness smoke does not need three minutes of probing to prove a lifecycle works.
const PROBE_ROUNDS = Number(arg("probe-rounds", "30"));

const env = {};
for (const l of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const U = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SITE = arg("site", "https://3-d-backup.vercel.app");

// THE ADMIN DOOR, WITHOUT EVER POSTING A PASSWORD (scripts/sweep/login.mjs, same trick).
// lib/staffAuth accepts a cookie holding sha256(ADMIN_PASSWORD), so the rig makes zero login
// requests: no failed-login rows, no staff_login limit (5 per 5 min) colouring the numbers, no
// alert to the owner's phone. The act-as cookie (lib/panelScope) then points that admin session
// at ONE restaurant, so a kitchen screen and a floor board can be driven for all 62 tenants from
// a single credential. requireRole() treats admin as super-access (user === null) — the app's
// own X-ray, not a hole cut for the test.
if (!env.ADMIN_PASSWORD) { console.error("ADMIN_PASSWORD missing from .env.local — the panel probes need it."); process.exit(1); }
const ADMIN_C = `lfh_staff_auth=${createHash("sha256").update(env.ADMIN_PASSWORD).digest("hex")}`;
const cookieFor = (rid) => `${ADMIN_C}; aevidine_admin_rid=${rid}`;

// ── rail 1: the backup stack, or nothing ───────────────────────────────────────────────────────
refuseUnlessDevTestDb(U, "this creates 62 test restaurants and places tens of thousands of orders");

// ── rail 2: one heavy run at a time (two at once is what took the DB down on 2026-07-31) ───────
const LOCK = join(ROOT, ".claude/stress.lock");
if (!has("cleanup-only")) {
  for (const other of ["verify-everything.lock", "load-ramp.lock", "stress.lock"]) {
    const p = join(ROOT, ".claude", other);
    if (!existsSync(p)) continue;
    let pid = 0; try { pid = Number(JSON.parse(readFileSync(p, "utf8")).pid) || 0; } catch {}
    let alive = false; try { if (pid) { process.kill(pid, 0); alive = true; } } catch {}
    if (alive) { console.error(`refusing: another heavy run is alive (${other}, pid ${pid}).`); process.exit(1); }
  }
  mkdirSync(join(ROOT, ".claude"), { recursive: true });
  writeFileSync(LOCK, JSON.stringify({ pid: process.pid, script: "stress-fleet", at: new Date().toISOString() }));
}
const release = () => { try { unlinkSync(LOCK); } catch {} };
process.on("exit", release);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { release(); process.exit(130); });

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
// EVERY CALL CARRIES ITS OWN DEADLINE. Without one, a probe that never comes back does not
// record a slow answer — it records NOTHING, and the report prints `p50=0ms p95=0ms err=0`,
// which reads as "instant and healthy" at the exact moment the database has stopped answering.
// That happened on the 2026-09-18 12-minute run: every phase after the first showed 0 ms.
const sb = async (q, init = {}) => {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), Number(init.timeoutMs) || 20000);
  try {
    const r = await fetch(`${U}/rest/v1/${q}`, { ...init, signal: ctrl.signal, headers: { ...H, ...(init.headers || {}) } });
    const t = await r.text();
    return { ok: r.ok, status: r.status, headers: r.headers, data: t ? JSON.parse(t) : null, raw: t };
  } catch (e) {
    // THE DEADLINE MUST NOT BECOME AN UNCAUGHT REJECTION. Every caller checks `.ok`, so a request
    // that never came back has to LOOK like a failed request — not take the whole orchestrator
    // down. It did exactly that on 2026-09-18: seeding ran against a database that was still
    // settling after a heavy run, the 20s abort escaped as a DOMException, and the process died
    // with "This operation was aborted" before a single tenant existed.
    return { ok: false, status: 0, headers: new Headers(), data: null, raw: String(e?.message || e) };
  } finally { clearTimeout(to); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor((p / 100) * (s.length - 1))]); };
const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

// A stable, obviously-fake uuid per tenant, so a re-run reuses the same rows instead of breeding.
const ridOf = (i) => `57e55000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const slugOf = (i) => `zzstress-${String(i).padStart(2, "0")}`;

// ── THE FLEET ──────────────────────────────────────────────────────────────────────────────────
async function ensureFleet() {
  log(`seeding ${TENANTS} tenants × ${TABLES} tables …`);
  const tmpl = await sb(`menu_items?restaurant_id=eq.00000000-0000-0000-0000-000000000001&select=title,price,category,veg,image,description&limit=14`);
  if (!tmpl.ok || !tmpl.data?.length) { console.error("cannot read a template menu:", tmpl.raw?.slice(0, 200)); process.exit(1); }

  const restaurants = [], settings = [], items = [];
  for (let i = 1; i <= TENANTS; i++) {
    const rid = ridOf(i), slug = slugOf(i);
    restaurants.push({ id: rid, slug, name: `Stress Kitchen ${i}`, active: true, logo_text: `Stress ${i}`, hero_title: "Load test tenant", accent_color: "#888888" });
    // Minimal settings: table_count is what the floor plan and the table pickers read, and the
    // ordering modules must be ON or every write is correctly refused and the run measures nothing.
    settings.push({
      id: slug, // settings.id is a TEXT primary key that holds the slug (mig 003)
      restaurant_id: rid, table_count: TABLES, sessions_enabled: true, require_location: false, require_otp: false,
      restaurant_name: `Stress Kitchen ${i}`, take_orders_allowed: true, take_orders_enabled: true,
      // NOTE: service_mode is a BOOLEAN here, not a mode name — left at its default deliberately.
      // sessions_enabled is ON (French House has it off) because a session is what makes the
      // heavy path heavy: session_members, table ownership, and the close trigger all hang off it.
      table_ops_allowed: true, table_ops_enabled: true, menu_enabled: true,
    });
    tmpl.data.forEach((m, j) => items.push({
      id: `sf${String(i).padStart(2, "0")}-${j}`, slug: `sf${String(i).padStart(2, "0")}-${j}`,
      restaurant_id: rid, title: m.title, price: m.price, category: m.category || "mains",
      veg: m.veg ?? true, image: m.image, description: m.description, sort_order: j, tags: [],
    }));
  }
  for (const [name, table, rows, conflict] of [
    ["restaurants", "restaurants", restaurants, "id"],
    ["settings", "settings", settings, "id"],
    ["menu_items", "menu_items", items, "id"],
  ]) {
    for (let k = 0; k < rows.length; k += 200) {
      const chunk = rows.slice(k, k + 200);
      const r = await sb(`${table}?on_conflict=${conflict}`, {
        method: "POST", body: JSON.stringify(chunk),
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      });
      if (!r.ok) { console.error(`seed ${name} failed:`, r.status, r.raw?.slice(0, 300)); process.exit(1); }
    }
    log(`  ${name}: ${rows.length} rows ready`);
  }
  const menu = {};
  for (let i = 1; i <= TENANTS; i++) menu[ridOf(i)] = tmpl.data.map((_, j) => `sf${String(i).padStart(2, "0")}-${j}`);
  return menu;
}

// ── PROBES: the owner's own restaurant, while the other 62 are slammed ─────────────────────────
const R1 = "00000000-0000-0000-0000-000000000001"; // French House — READ ONLY here
const probes = {};
// ── THE CEILING RAIL ──────────────────────────────────────────────────────────────────────────
// A stress test exists to FIND the ceiling, not to sit on top of it until the instance dies. On
// 2026-09-18 a 62-restaurant launch left the dev Postgres refusing connections — Supabase's own
// health endpoint reported db UNHEALTHY for fourteen minutes and it needed a restart. Nothing was
// lost, but a run that kills the database cannot measure its own recovery, which is half the
// question ("does it come back?"). So when the BYSTANDER site stops answering for three probe
// rounds in a row, the ladder has its answer and the run ends itself.
let badProbeRounds = 0;
const pcell = (phase, name) => {
  const k = phase + "|" + name;
  return (probes[k] = probes[k] || { phase, name, ok: 0, err: 0, lat: [], bytes: 0, errs: {} });
};
async function timed(phase, name, fn) {
  const t0 = performance.now();
  try {
    const bytes = (await fn()) || 0;
    const c = pcell(phase, name); c.ok++; c.lat.push(performance.now() - t0); c.bytes += bytes;
  } catch (e) {
    const c = pcell(phase, name); c.err++; c.lat.push(performance.now() - t0);
    const t = String(e.message || e).slice(0, 140); c.errs[t] = (c.errs[t] || 0) + 1;
  }
}
async function probeOnce(phase) {
  // ── THE BYSTANDER TEST — the only question a SaaS owner actually has ─────────────────────────
  // French House is NOT in the load. Every probe below is the real screen a real person opens,
  // through the real door, with the real gate in front of it. The previous version of this file
  // asked PostgREST for `lfh_floor_bundle` with a service-role key and called the answer "the
  // floor board took 19 seconds" — that number was a raw query, measured around the route, the
  // permission check and the shared 1.5s snapshot (lib/floorSummary) that the actual screen has.
  // A rig must never report a number for a screen it never opened.
  const screen = async (name, path, headers) => timed(phase, name, async () => {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 25000);
    try {
      const r = await fetch(SITE + path, { signal: ctrl.signal, headers: { "User-Agent": "lfh-stress-crowd", ...(headers || {}) }, cache: "no-store" });
      const b = await r.arrayBuffer();
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return b.byteLength;
    } finally { clearTimeout(to); }
  });

  // The manager's floor board and the kitchen board for the restaurant nobody is loading.
  await screen("floor_board_french_house", "/api/tablet/summary", { Cookie: cookieFor(R1) });
  await screen("kitchen_board_french_house", "/api/kitchen/board", { Cookie: cookieFor(R1) });
  // A guest walking in off the street, both doors: the page and the menu data behind it.
  await screen("guest_menu_page", "/r/french-house/menu");
  await screen("guest_menu_data", "/api/r/french-house/menu-data");
  const healthErrBefore = pcell(phase, "site_health").err;
  await screen("site_health", "/api/health");
  badProbeRounds = pcell(phase, "site_health").err > healthErrBefore ? badProbeRounds + 1 : 0;
  // And ONE raw database ping, deliberately kept. Comparing it with the screens above is what
  // separates "the database is saturated" from "our own code is slow" — without it, a slow floor
  // board has two possible causes and no way to tell them apart.
  await timed(phase, "db_ping_raw", async () => {
    const r = await sb("restaurants?select=id&limit=1"); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.raw.length;
  });
  // One stress tenant's floor board too — the tenant that IS being hammered, for contrast.
  await screen("floor_board_loaded_tenant", "/api/tablet/summary", { Cookie: cookieFor(ridOf(1)) });
}

// ── DISK: the rail that keeps a stress test from becoming an outage of its own ─────────────────
// The free tier stops at 500 MB and a SOFT-deleted order still occupies its bytes forever (mig 331
// forbids the hard delete). So the run measures the database's size as it goes and ENDS ITSELF if
// it gets close to the ceiling — filling the dev database would break every other session on this
// Mac, which is exactly the "test rig became the outage" mistake of 2026-07-31.
const PAT = env.SUPABASE_ACCESS_TOKEN;
const PROJECT = new URL(U).hostname.split(".")[0];
async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) return null;
  return r.json();
}
// `light` = the disk watchdog's 30-second sample, which must cost the database almost nothing.
// The per-table breakdown walks pg_class and sums every relation's size: MEASURED at 1,427 ms
// MEAN while the fleet was running (pg_stat_statements, 2026-09-18) — the watchdog was competing
// with the app for the CPU it was there to protect. It is now taken only BEFORE and AFTER.
async function dbStats(light = false) {
  const size = await sql("select pg_database_size(current_database()) as bytes");
  if (light) return { bytes: Number(size?.[0]?.bytes) || 0, tables: [] };
  const tables = await sql(
    "select relname, pg_total_relation_size(c.oid) as bytes from pg_class c " +
    "join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' " +
    "order by pg_total_relation_size(c.oid) desc limit 12");
  return { bytes: Number(size?.[0]?.bytes) || 0, tables: tables || [] };
}

// ── row-count snapshot: before vs after, so "it worked" has a number ──────────────────────────
async function counts() {
  const out = {};
  for (const t of ["restaurants", "settings", "menu_items", "sessions", "orders", "order_items", "waiter_calls", "bills"]) {
    const r = await sb(`${t}?select=id&limit=1`, { headers: { Prefer: "count=exact", Range: "0-0" } });
    out[t] = Number((r.headers.get("content-range") || "*/0").split("/")[1]) || 0;
  }
  const mine = await sb(`orders?restaurant_id=in.(${Array.from({ length: TENANTS }, (_, i) => ridOf(i + 1)).join(",")})&select=id&limit=1`, { headers: { Prefer: "count=exact", Range: "0-0" } });
  out.orders_stress_tenants = Number((mine.headers.get("content-range") || "*/0").split("/")[1]) || 0;
  const open = await sb(`sessions?status=eq.open&select=id&limit=1`, { headers: { Prefer: "count=exact", Range: "0-0" } });
  out.sessions_open = Number((open.headers.get("content-range") || "*/0").split("/")[1]) || 0;
  return out;
}

// ── CLEANUP: soft-delete, never DELETE — mig 331 refuses a hard delete of an issued bill ──────
async function cleanup() {
  log("cleanup: soft-deleting stress orders and closing stress sessions …");
  const rids = Array.from({ length: TENANTS }, (_, i) => ridOf(i + 1));
  let orders = 0, sessions = 0, refused = [];
  for (const rid of rids) {
    const o = await sb(`orders?restaurant_id=eq.${rid}&deleted_at=is.null`, {
      // archived and archived_at travel together — a half-written stamp is what makes an order
      // invisible on the board but still "not archived" to every report that filters on the date.
      method: "PATCH", body: JSON.stringify({ archived: true, archived_at: new Date().toISOString(), deleted_at: new Date().toISOString() }),
      headers: { Prefer: "return=representation" },
    });
    if (o.ok) orders += (o.data || []).length; else refused.push(`orders ${rid}: ${o.status} ${o.raw?.slice(0, 90)}`);
    const s = await sb(`sessions?restaurant_id=eq.${rid}&status=neq.closed`, {
      method: "PATCH", body: JSON.stringify({ status: "closed", closed_at: new Date().toISOString() }),
      headers: { Prefer: "return=representation" },
    });
    if (s.ok) sessions += (s.data || []).length; else refused.push(`sessions ${rid}: ${s.status} ${s.raw?.slice(0, 90)}`);
  }
  // COUNT WHAT IS LEFT and say so. A cleanup that reports success without counting is how 3,893
  // test orders once ended up on the owner's kitchen board.
  const left = await sb(`orders?restaurant_id=in.(${rids.join(",")})&deleted_at=is.null&select=id&limit=1`, { headers: { Prefer: "count=exact", Range: "0-0" } });
  const leftN = Number((left.headers.get("content-range") || "*/0").split("/")[1]) || 0;
  log(`cleanup: ${orders} orders soft-deleted, ${sessions} sessions closed, ${leftN} live stress orders left${refused.length ? `, ${refused.length} refusals` : ""}`);
  if (refused.length) refused.slice(0, 5).forEach((r) => log("  refused: " + r));
  return { orders, sessions, leftN, refused };
}

// ── MAIN ───────────────────────────────────────────────────────────────────────────────────────
// A CONCURRENCY LADDER, one variable at a time. The pace is held constant at a brisk-but-human
// 20s per table action for every phase, so the ONLY thing that changes between phases is how many
// restaurants are live. That is what makes the result a ceiling ("it holds to N tables") instead
// of just "it broke". Tenants join at the start of their phase and never leave, so phase 5 is the
// full 62 × 30 the owner asked for, sustained.
// A RESTAURANT-COUNT LADDER AT A REAL DINNER-RUSH PACE.
//
// The first cut of this ramped INTENSITY with all 62 restaurants live throughout, on the
// assumption that 62 works and only the pace is in question. It does not: 62 restaurants at a
// genuine rush saturated the deployment inside a minute, twice, and a run that is 100% failures
// from its first tick answers nothing except "it broke" — which is where the previous session
// ended up. Two independent rigs now agree the ceiling is in the NUMBER OF LIVE RESTAURANTS
// (backup-menu-db measured 4 tenants clean, 8 tenants 79% failed, on a completely different
// actor model), so that is the variable worth climbing.
//
// So: the pace is held at a REAL rush for every phase — a table orders about every six minutes,
// which is a party sitting, ordering, eating, ordering again and paying — and what changes is how
// many restaurants are doing it. The result is the number the owner actually wants: how many
// restaurants this stack holds before his customers notice. Restaurants join at the start of
// their phase and never leave, so the last phase is the full 62 x 30 he asked to see, sustained.
const REAL_RUSH_MS = Number(arg("pace-real", "360000"));
const PHASES = [
  { name: "1_four",      untilSec:  6 * 60, tenants:  4, orderEveryMs: REAL_RUSH_MS, label: "4 restaurants ·   120 tables" },
  { name: "2_eight",     untilSec: 12 * 60, tenants:  8, orderEveryMs: REAL_RUSH_MS, label: "8 restaurants ·   240 tables" },
  { name: "3_sixteen",   untilSec: 18 * 60, tenants: 16, orderEveryMs: REAL_RUSH_MS, label: "16 restaurants ·  480 tables" },
  { name: "4_thirtyone", untilSec: 24 * 60, tenants: 31, orderEveryMs: REAL_RUSH_MS, label: "31 restaurants ·  930 tables" },
  { name: "5_all",       untilSec: 30 * 60, tenants: 62, orderEveryMs: REAL_RUSH_MS, label: "ALL 62 restaurants · 1,860 tables" },
];
// When does restaurant i open its doors? At the start of the first phase whose count includes it.
function startSecOf(i, list) {
  for (let k = 0; k < list.length; k++) if (i <= list[k].tenants) return k === 0 ? 0 : list[k - 1].untilSec;
  return 0;
}
function scalePhases(minutes) {
  // --pace <ms> collapses the ladder into ONE phase, every restaurant live, at a fixed order
  // interval. That is the correctness smoke: at the real six-minute rush pace a short run would
  // only ever prove that seating works and would never get as far as a plate of food.
  const forced = arg("pace", null);
  const decorate = (p) => ({
    ...p,
    what: `${p.label} · ${((p.tenants || TENANTS) * TABLES / (p.orderEveryMs / 1000)).toFixed(1)} orders/sec`,
  });
  if (forced !== null) return [decorate({ name: "smoke_fixed_pace", untilSec: minutes * 60, tenants: TENANTS, orderEveryMs: Number(forced), label: `fixed pace ${forced}ms` })];
  const f = (minutes * 60) / (30 * 60);
  return PHASES.map((p) => decorate({ ...p, untilSec: Math.round(p.untilSec * f) }));
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  log(`database ${dbRefOf(U)} (backup-1 dev)  ·  site ${SITE}`);

  if (has("cleanup-only")) { await cleanup(); return; }

  const menu = await ensureFleet();
  if (has("seed-only")) { log("seed-only: done"); return; }

  // ── BEFORE ───────────────────────────────────────────────────────────────────────────────────
  log(`BEFORE: measuring an idle system (${PROBE_ROUNDS} probe rounds) …`);
  const before = { counts: await counts(), db: await dbStats(), at: new Date().toISOString() };
  log(`BEFORE: database is ${(before.db.bytes / 1048576).toFixed(1)} MB (free tier stops at 500 MB)`);
  for (let i = 0; i < PROBE_ROUNDS; i++) await probeOnce("0_before");
  const beforeProbes = JSON.parse(JSON.stringify(probes));

  // ── THE RUN ──────────────────────────────────────────────────────────────────────────────────
  const list = scalePhases(MINUTES);
  const startedAt = Date.now();
  const DEADLINE = startedAt + MINUTES * 60000;
  const phaseArg = JSON.stringify({ startedAt, list });
  log(`START — ${MINUTES} min · ${TENANTS} processes · ${TENANTS * TABLES} live tables`);
  list.forEach((p) => log(`   phase ${p.name.padEnd(18)} until ${String(Math.round(p.untilSec / 60)).padStart(2)}min — ${p.what}`));
  log(`   pace held at a real dinner rush (a table orders every ${Math.round(REAL_RUSH_MS / 60000)} min) — the NUMBER OF RESTAURANTS is the only variable`);

  const kids = [];
  const perTenant = [];
  for (let i = 1; i <= TENANTS; i++) {
    const rid = ridOf(i);
    const child = spawn(process.execPath, [
      join(ROOT, "scripts/stress-tenant.mjs"),
      "--url", U, "--site", SITE, "--rid", rid, "--slug", slugOf(i),
      "--tables", String(TABLES), "--deadline", String(DEADLINE),
      "--phases", phaseArg, "--menu", JSON.stringify(menu[rid]), "--fill", arg("fill", "90000"),
      "--startSec", String(startSecOf(i, list)),
      // ── WHY THE COOKIE IS NOT AN ARGUMENT ───────────────────────────────────────────────────
      // argv is world-readable: `ps -eo command` shows every flag of every process on the machine.
      // The panel gate accepts a cookie holding sha256(ADMIN_PASSWORD) as proof on its own, so that
      // value IS the admin password for all practical purposes — and the version of this file
      // before 2026-09-18 put the SERVICE ROLE KEY there, which is worse. A child's environment is
      // not listed by ps, so both travel that way now. (Found by reading our own `ps` output while
      // the smoke test ran, which is the only reason anyone ever notices this.)
    ], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LFH_ANON: ANON, LFH_COOKIE: cookieFor(rid) } });
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try { const j = JSON.parse(line); perTenant.push(j); } catch {}
      }
    });
    child.stderr.on("data", (d) => { const s = d.toString().trim(); if (s) log(`  [${slugOf(i)}] stderr: ${s.slice(0, 200)}`); });
    kids.push(child);
    if (i % 10 === 0) await sleep(150); // stagger the spawn so 62 processes don't all connect on the same millisecond
  }
  log(`${kids.length} tenant processes up`);

  // Probe + report while it runs. ONE ROUND AT A TIME: a round is seven sequential calls, and
  // when each is waiting out its deadline a round takes longer than the 10-second timer — so
  // overlapping rounds used to pile up and the probe became load of its own.
  let probing = false;
  const probeTimer = setInterval(() => {
    if (probing) return;
    probing = true;
    const el = (Date.now() - startedAt) / 1000;
    const ph = list.find((p) => el < p.untilSec) || list[list.length - 1];
    probeOnce(ph.name).catch(() => {}).finally(() => { probing = false; });
  }, 10000);
  const tickTimer = setInterval(() => {
    const el = Math.round((Date.now() - startedAt) / 1000);
    const ph = (list.find((p) => el < p.untilSec) || list[list.length - 1]).name;
    const latest = new Map();
    for (const s of perTenant) latest.set(s.slug, s);
    let ok = 0, err = 0, refused = 0, busy = 0;
    for (const s of latest.values()) for (const c of s.cells) { ok += c.ok; err += c.err; refused += c.refused || 0; busy += c.busy || 0; }
    const p = pcell(ph, "floor_board_french_house");
    log(`  ${String(Math.floor(el / 60)).padStart(2)}m${String(el % 60).padStart(2, "0")} ${ph.padEnd(16)} ok=${ok} failed=${err} refused=${refused} busy=${busy}  ·  french-house FLOOR BOARD p50=${pct(p.lat, 50)}ms p95=${pct(p.lat, 95)}ms err=${p.err}`);
  }, 30000);

  // ── DISK WATCHDOG ────────────────────────────────────────────────────────────────────────────
  // SAMPLED EVERY 15s, NOT 30s. At the top of the ladder this writes ~80 orders a second, and
  // lfh_rt_emit is FOR EACH ROW on both `orders` and `order_items` — so one 3-item order lays down
  // 8 breadcrumb rows and a full table lifecycle 20-30 emits (measured by the backup-menu-db
  // session, 2026-09-18). A 30-second blind spot at that rate is tens of megabytes, and the whole
  // point of this rail is to stop the test becoming the outage.
  const MAX_MB = Number(arg("max-db-mb", "420"));
  let stoppedEarly = null;
  let lastOkSeen = -1, flatTicks = 0;
  const diskSamples = [];
  const diskTimer = setInterval(async () => {
    // THE CEILING, SECOND SIGNAL: THROUGHPUT FLATLINED. The bystander check below only fires when
    // the site stops answering ALTOGETHER, and on 2026-09-19 an all-62 run sat for minutes with
    // `ok` frozen at 1,104 and failures climbing into the thousands while /api/health was merely
    // SLOW — so the rail never tripped and the run would have burned its full half hour proving
    // nothing. A run whose successes have stopped moving has already found the wall.
    if (!stoppedEarly) {
      const latestOk = (() => { const m = new Map(); for (const s2 of perTenant) m.set(s2.slug, s2);
        let n = 0; for (const s2 of m.values()) for (const c of s2.cells) n += c.ok; return n; })();
      if (latestOk > 0 && latestOk === lastOkSeen) { flatTicks++; } else { flatTicks = 0; lastOkSeen = latestOk; }
      if (flatTicks >= 8) {   // 8 x 15s = two minutes with not one new success anywhere
        const el = Math.round((Date.now() - startedAt) / 1000);
        stoppedEarly = `CEILING FOUND — not one new success across all ${TENANTS} restaurants for two minutes (stuck at ${latestOk}), so the run ended itself at ${Math.floor(el / 60)}m${String(el % 60).padStart(2, "0")}`;
        log(`⛔ ${stoppedEarly}`);
        kids.forEach((c) => { try { c.kill("SIGTERM"); } catch {} });
        return;
      }
    }
    // THE CEILING: three probe rounds in a row where the site did not answer at all.
    if (badProbeRounds >= 3 && !stoppedEarly) {
      const el = Math.round((Date.now() - startedAt) / 1000);
      const ph = (list.find((p) => el < p.untilSec) || list[list.length - 1]);
      stoppedEarly = `CEILING FOUND in phase ${ph.name} (${ph.label}) — the site stopped answering for 3 probe rounds running, so the run ended itself at ${Math.floor(el / 60)}m${String(el % 60).padStart(2, "0")} rather than hold the database under water`;
      log(`⛔ ${stoppedEarly}`);
      kids.forEach((c) => { try { c.kill("SIGTERM"); } catch {} });
      return;
    }
    const st = await dbStats(true);
    if (!st.bytes) return;
    const mb = st.bytes / 1048576;
    diskSamples.push({ at: Date.now(), mb: Number(mb.toFixed(1)) });
    if (mb >= MAX_MB && !stoppedEarly) {
      stoppedEarly = `database reached ${mb.toFixed(1)} MB (cap ${MAX_MB} MB) — ended the run early rather than fill the free tier`;
      log(`⛔ ${stoppedEarly}`);
      kids.forEach((c) => { try { c.kill("SIGTERM"); } catch {} });
    }
  }, 15000);

  await Promise.all(kids.map((c) => new Promise((res) => c.on("exit", res))));
  clearInterval(probeTimer); clearInterval(tickTimer); clearInterval(diskTimer);
  log("all tenant processes finished");

  // ── AFTER ────────────────────────────────────────────────────────────────────────────────────
  log(`AFTER: measuring the system once the rush has passed (${PROBE_ROUNDS} probe rounds) …`);
  for (let i = 0; i < PROBE_ROUNDS; i++) await probeOnce("6_after");
  const after = { counts: await counts(), db: await dbStats(), at: new Date().toISOString() };

  const finals = new Map();
  for (const s of perTenant) if (s.final) finals.set(s.slug, s);
  const clean = await cleanup();
  const afterCleanup = await counts();

  const report = {
    at: new Date().toISOString(), db: dbRefOf(U), site: SITE,
    config: { minutes: MINUTES, tenants: TENANTS, tables: TABLES, liveTables: TENANTS * TABLES },
    phases: list, before, after, afterCleanup, cleanup: clean, stoppedEarly, diskSamples,
    probes: Object.values(probes).map((c) => ({ phase: c.phase, name: c.name, ok: c.ok, err: c.err, bytes: c.bytes, p50: pct(c.lat, 50), p95: pct(c.lat, 95), p99: pct(c.lat, 99), max: pct(c.lat, 100), errs: Object.entries(c.errs).sort((a, b) => b[1] - a[1]).slice(0, 5) })),
    beforeProbeSnapshot: Object.values(beforeProbes).map((c) => ({ name: c.name, p50: pct(c.lat, 50), p95: pct(c.lat, 95) })),
    tenants: [...finals.values()],
  };
  const f = join(OUT, `stress-fleet-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(f, JSON.stringify(report, null, 2));
  log(`report → ${f}`);

  // ── the summary that answers the question ────────────────────────────────────────────────────
  const agg = {};
  for (const t of finals.values()) for (const c of t.cells) {
    const k = c.phase + "|" + c.action;
    const a = (agg[k] = agg[k] || { phase: c.phase, action: c.action, ok: 0, err: 0, refused: 0, busy: 0, p95s: [], errs: {}, refusals: {} });
    a.ok += c.ok; a.err += c.err; a.refused += c.refused || 0; a.busy += c.busy || 0; if (c.p95) a.p95s.push(c.p95);
    for (const [msg, n] of c.errs) a.errs[msg] = (a.errs[msg] || 0) + n;
    for (const [msg, n] of (c.refusals || [])) a.refusals[msg] = (a.refusals[msg] || 0) + n;
  }
  console.log("\n════ WRITES, BY PHASE ════");
  for (const p of list) {
    const rows = Object.values(agg).filter((a) => a.phase === p.name);
    if (!rows.length) continue;
    const ok = rows.reduce((s, r) => s + r.ok, 0), err = rows.reduce((s, r) => s + r.err, 0);
    const refused = rows.reduce((s, r) => s + r.refused, 0), busy = rows.reduce((s, r) => s + r.busy, 0);
    const i = list.indexOf(p);
    const secs = Math.max(1, p.untilSec - (i > 0 ? list[i - 1].untilSec : 0));
    console.log(`\n${p.name} — ${p.what}`);
    // "failed" = nobody answered or the server broke. A REFUSAL (over the limit, table closed)
    // and a BUSY (the app's own 502 + Retry-After backpressure) are the app working correctly,
    // and lumping them into a failure rate is how a healthy guard gets reported as an outage.
    console.log(`  ${ok} ok · ${err} FAILED (${(100 * err / Math.max(1, ok + err + refused + busy)).toFixed(2)}%) · ${refused} refused-on-purpose · ${busy} told-to-wait  ·  ${((ok + err + refused + busy) / secs).toFixed(0)} calls/sec sustained`);
    for (const r of rows.sort((a, b) => b.ok + b.err - (a.ok + a.err))) {
      console.log(`    ${r.action.padEnd(16)} ok=${String(r.ok).padStart(6)} failed=${String(r.err).padStart(5)} refused=${String(r.refused).padStart(5)} busy=${String(r.busy).padStart(4)} p95≈${String(pct(r.p95s, 50)).padStart(6)}ms`);
      Object.entries(r.errs).sort((a, b) => b[1] - a[1]).slice(0, 2).forEach(([m, n]) => console.log(`        FAILED ${n}× ${m}`));
      Object.entries(r.refusals).sort((a, b) => b[1] - a[1]).slice(0, 2).forEach(([m, n]) => console.log(`        refused ${n}× ${m}`));
    }
  }
  console.log("\n════ COULD THE REST OF THE APP STILL BE USED? (probes) ════");
  const names = [...new Set(Object.values(probes).map((c) => c.name))];
  const phaseOrder = ["0_before", ...list.map((p) => p.name), "6_after"];
  for (const n of names) {
    console.log(`\n  ${n}`);
    for (const ph of phaseOrder) {
      const c = probes[ph + "|" + n]; if (!c) continue;
      console.log(`    ${ph.padEnd(18)} p50=${String(pct(c.lat, 50)).padStart(6)}ms p95=${String(pct(c.lat, 95)).padStart(6)}ms  ok=${String(c.ok).padStart(4)} err=${c.err}`);
      Object.entries(c.errs).sort((a, b) => b[1] - a[1]).slice(0, 2).forEach(([m, k]) => console.log(`        ${k}× ${m}`));
    }
  }
  console.log("\n════ DISK ════");
  console.log(`  before ${(before.db.bytes / 1048576).toFixed(1)} MB   after ${(after.db.bytes / 1048576).toFixed(1)} MB   grew ${((after.db.bytes - before.db.bytes) / 1048576).toFixed(1)} MB  (free tier ceiling 500 MB)`);
  const bt = Object.fromEntries((before.db.tables || []).map((t) => [t.relname, Number(t.bytes)]));
  for (const t of after.db.tables || []) {
    const g = Number(t.bytes) - (bt[t.relname] || 0);
    if (Math.abs(g) > 262144) console.log(`    ${t.relname.padEnd(24)} ${(Number(t.bytes) / 1048576).toFixed(1)} MB  (grew ${(g / 1048576).toFixed(1)} MB)`);
  }
  if (stoppedEarly) console.log(`\n  ⛔ ${stoppedEarly}`);

  console.log("\n════ ROWS ════");
  for (const k of Object.keys(before.counts)) console.log(`  ${k.padEnd(16)} before=${String(before.counts[k]).padStart(8)}  after=${String(after.counts[k]).padStart(8)}  after cleanup=${String(afterCleanup[k]).padStart(8)}`);
  process.stdout.write("", () => process.exit(0));
})();
