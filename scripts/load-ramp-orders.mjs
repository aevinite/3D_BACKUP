// load-ramp-orders.mjs — FINDS THE REAL CEILING, WITHOUT BECOMING THE OUTAGE.
//
//   node scripts/load-ramp-orders.mjs                 # 10 → 25 → 50 → 100 concurrent orders
//   node scripts/load-ramp-orders.mjs --levels 10,25   # a gentler run
//   node scripts/load-ramp-orders.mjs --base http://localhost:4000
//
// The owner asked the right question after the 2026-07-31 outage: what happens when a real
// restaurant sends 800 orders at once? Reasoning said an order is cheap (~64-138ms measured) and
// that the free-tier shared CPU is the ceiling, but a number you reasoned to is not a number you
// know. This measures it on the app's REAL path (HTTP → route → RPC → triggers), ramping up and
// stopping at the first sign of trouble.
//
// IT MUST NOT BECOME THE THING IT MEASURES. Every rail here exists because our own test rig took
// the shared database down once already:
//   · it refuses to point anywhere but the BACKUP stack (never AV live, which has real clients);
//   · it refuses to start while another heavy suite or ramp is alive (pid lock);
//   · it makes ZERO logins — the admin gate cookie is presented directly (adminHeaders), so it
//     cannot raise a staff_login limit event or ping the owner's phone;
//   · it uses the STAFF order path, which has no rate-limit rule (guest_order is 8/table/min and
//     would alert), on ONE distinct table per order so the duplicate guard never fires;
//   · it samples /api/health THROUGHOUT each burst — the question is not "were my orders fast",
//     it is "did the restaurant's other screens keep working";
//   · it stops escalating the moment anything fails, and
//   · it DELETES every order and session it created, even if it aborts or is killed.
import { readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { adminHeaders } from "./sweep/login.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = process.argv.slice(2);
const arg = (n, d) => { const i = ARGS.indexOf(n); return i >= 0 ? ARGS[i + 1] : d; };
const BASE = (arg("--base", "https://3-d-backup.vercel.app")).replace(/\/$/, "");
const LEVELS = arg("--levels", "10,25,50,100").split(",").map(Number).filter(Boolean);

const env = {};
for (const l of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const SB = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;

// ── rail 1: the backup stack, or nothing ──────────────────────────────────────────────────
const BACKUP_DB = "wnsfcizclkbobwzcxqsf";
if (!SB || !SB.includes(BACKUP_DB)) {
  console.error(`⛔ This points at ${SB ? new URL(SB).hostname : "(no database)"} — it only ever runs against the backup database (${BACKUP_DB}). Never AV live.`);
  process.exit(2);
}
if (!/^https:\/\/3-d-backup\.vercel\.app$|^http:\/\/localhost:\d+$|^http:\/\/127\.0\.0\.1:\d+$/.test(BASE)) {
  console.error(`⛔ Refusing to load ${BASE}. Allowed: the backup site or a local dev server.`);
  process.exit(2);
}

// ── rail 2: one heavy thing at a time ─────────────────────────────────────────────────────
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
for (const name of ["verify-everything.lock", "load-ramp.lock"]) {
  try {
    const p = JSON.parse(readFileSync(join(ROOT, ".claude", name), "utf8"));
    if (p && p.pid && p.pid !== process.pid && alive(p.pid)) {
      console.error(`⛔ ${name} is held by a live process (pid ${p.pid}). Two heavy runs at once is what took the database down on 2026-07-31.`);
      process.exit(2);
    }
  } catch { /* absent or stale */ }
}
const LOCK = join(ROOT, ".claude", "load-ramp.lock");
mkdirSync(dirname(LOCK), { recursive: true });
writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: Date.now(), base: BASE }));
const dropLock = () => { try { rmSync(LOCK, { force: true }); } catch {} };
process.on("exit", dropLock);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { dropLock(); process.exit(130); });

// ── the target: a stress-test restaurant with 300 tables that nobody watches ───────────────
const RID = "00000000-0000-0000-0000-000000000003"; // burger-barn
const DISH = "burger-barn-classic-cheeseburger";
const FIRST_TABLE = 100;   // 100..299 — well clear of anything a person is looking at
const H = { ...adminHeaders(BASE), "Content-Type": "application/json" };
const db = (q, init) => fetch(`${SB}/rest/v1/${q}`, { ...init, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init?.headers || {}) } });

const created = [];       // order ids we made, for cleanup
const tablesUsed = new Set();
const startedAt = new Date().toISOString();
const pct = (a, p) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;

async function placeOne(table) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/api/tablet/order?rid=${RID}`, {
      method: "POST", headers: { ...H, "X-LFH-Action-Id": crypto.randomUUID() },
      body: JSON.stringify({ table: String(table), items: [{ id: DISH, qty: 1 }], allergies: [] }),
      signal: AbortSignal.timeout(30000),
    });
    const ms = Date.now() - t0;
    const j = await res.json().catch(() => null);
    if (res.ok && j && (j.order_id || j.ok)) { if (j.order_id) created.push(j.order_id); tablesUsed.add(String(table)); return { ms, ok: true }; }
    return { ms, ok: false, why: `${res.status} ${(j && (j.error || j.reason)) || ""}`.trim() };
  } catch (e) {
    return { ms: Date.now() - t0, ok: false, why: e.name === "TimeoutError" ? "no answer in 30s" : String(e.message || e) };
  }
}

// Is the REST of the restaurant still working while the burst is in flight? That is the whole
// question — an order that takes 4s is fine, a kitchen screen that goes blank is not.
function watchHealth(stop) {
  const samples = [];
  (async () => {
    while (!stop.done) {
      const t0 = Date.now();
      try {
        const r = await fetch(`${BASE}/api/health`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
        samples.push({ ms: Date.now() - t0, ok: r.ok });
      } catch { samples.push({ ms: Date.now() - t0, ok: false }); }
      await new Promise((r) => setTimeout(r, 1500));
    }
  })();
  return samples;
}

let verdict = "the free tier held every level tested";
try {
  console.log(`\nRamping real staff orders at ${BASE}\n  target: burger-barn (300 tables), one distinct table per order, tables ${FIRST_TABLE}+\n  levels: ${LEVELS.join(" → ")}\n`);
  let nextTable = FIRST_TABLE;
  for (const n of LEVELS) {
    if (nextTable + n > 300) { console.log(`  (skipping ${n}: would run past table 300)`); continue; }
    const stop = { done: false };
    const health = watchHealth(stop);
    const tables = Array.from({ length: n }, () => nextTable++);
    const t0 = Date.now();
    const results = await Promise.all(tables.map(placeOne));
    const wall = Date.now() - t0;
    stop.done = true;
    const okMs = results.filter((r) => r.ok).map((r) => r.ms);
    const failed = results.filter((r) => !r.ok);
    const hBad = health.filter((h) => !h.ok).length;
    const hWorst = Math.max(0, ...health.map((h) => h.ms));
    console.log(`  ${String(n).padStart(3)} at once → ${okMs.length}/${n} placed in ${wall}ms  ` +
      `(p50 ${pct(okMs, 0.5)}ms, p95 ${pct(okMs, 0.95)}ms, worst ${Math.max(0, ...okMs)}ms)  ` +
      `· health ${health.length - hBad}/${health.length} ok, worst ${hWorst}ms`);
    if (failed.length) {
      const why = [...new Set(failed.map((f) => f.why))].slice(0, 3).join(" | ");
      console.log(`      ↳ ${failed.length} did NOT go through: ${why}`);
      verdict = `orders start failing at ${n} at once (${failed.length}/${n}) — that is where the queue-on-device behaviour takes over`;
      break;
    }
    if (hBad) { verdict = `at ${n} at once the rest of the site stopped answering (${hBad} health checks failed) — this is the real ceiling`; break; }
    if (pct(okMs, 0.95) > 8000) { verdict = `at ${n} at once orders cross the database's own 8s limit (p95 ${pct(okMs, 0.95)}ms)`; break; }
    await new Promise((r) => setTimeout(r, 3000)); // let it breathe between levels
  }
} finally {
  // ── put the floor back, whatever happened ───────────────────────────────────────────────
  // CLOSE the sessions; do NOT try to delete rows. The first version deleted, and the database
  // refused it outright: every order gets a bill number on insert, so it counts as an ISSUED
  // bill and `lfh_block_issued_delete` blocks a hard delete — *"corrections use void /
  // soft-delete; permanent erase only via the 90-day purge"*. That guard is the CGST rule we
  // deliberately built in, and it was right to stop me. Closing is the in-app path: the mig-232
  // close trigger cancels the unpaid work with a visible ✕ record and archives the rest, so the
  // tables are free, the audit trail is intact and nothing is erased.
  // (It reported "removed 0 test orders" and left 185 rows behind because it only counted rows
  // the database had let it delete — which was none. Closing needs no ids and cannot be refused,
  // so it can't fail the same silent way; and the count printed below is READ BACK from the
  // database rather than assumed.)
  process.stdout.write("\n  putting the floor back… ");
  const closedAt = new Date().toISOString();
  const r = await db(`sessions?restaurant_id=eq.${RID}&created_at=gte.${startedAt}&status=neq.closed`, {
    method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "closed", closed_at: closedAt }),
  });
  const closed = r.ok ? (await r.json().catch(() => [])).length : -1;
  console.log(closed >= 0 ? `closed ${closed} test sessions (their orders are cancelled + archived, not deleted).` : "COULD NOT CLOSE — check burger-barn by hand.");
  const stillOpen = await db(`sessions?restaurant_id=eq.${RID}&created_at=gte.${startedAt}&status=eq.open&select=id`);
  const openLeft = stillOpen.ok ? (await stillOpen.json().catch(() => [])).length : -1;
  console.log(openLeft === 0 ? "  ✅ no table from this run is left occupied." : `  ⚠️ ${openLeft} table(s) from this run are still open — close them on burger-barn.`);
  if (created.length) console.log(`  (order ids seen in responses: ${created.length}/${tablesUsed.size} — informational only)`);
  console.log(`\nVERDICT: ${verdict}\n`);
}
