// scripts/stress-realtime.mjs — Realtime fan-out stress test (reusable).
//
// Opens N anon Realtime subscribers (simulating N devices) on the 'ops' topic,
// then fires M breadcrumb rows in a burst and measures, across ALL subscribers:
//   • delivery loss      (did every device get every event?)
//   • duplicates         (harmless by design, but we count them)
//   • end-to-end latency (write issued → event delivered; same-process clock, so
//                          no clock-skew error)
// Then a RECONNECT sub-test: drop one subscriber's channel, re-subscribe, fire an
// event, confirm it recovers.
//
// It fires breadcrumbs DIRECTLY into realtime_events (service role) instead of
// touching real orders — so it stresses the fan-out/delivery layer (the part that
// scales and costs egress) WITHOUT polluting business tables or daily counters.
// Cleans up every row it creates. Prints an egress estimate so you can see how
// cheap realtime fan-out is vs per-second polling.
//
// Usage:  node scripts/stress-realtime.mjs [subscribers=30] [events=100]
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const N = Number(process.argv[2] || 30);   // simulated devices
const M = Number(process.argv[3] || 100);  // breadcrumbs fired

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split("\n")
  .map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; }));
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// ── SAFETY, added 2026-08-04 ──────────────────────────────────────────────────────────────────
// A LOAD script: refuse any database but the backup one, and refuse to start while another heavy
// run is alive. Two heavy runs at once is what took the database down on 2026-07-31 — the test
// rig, not the product. verify-everything and load-ramp-orders already do both; these did not.
{
  // ONE shared allow-list (T10 sweep, 2026-08-12). This carried its own copy of a single
  // hard-coded project id, so it refused on BACKUP-2 — the failover stack the owner uses when
  // backup-1 hits its 100-deploys-a-day cap. scripts/sweep/devStacks.mjs knows both dev stacks
  // and has never known the client one. Load-testing a CLIENT database is still refused.
  refuseUnlessDevTestDb(URL, "this opens load-test realtime sockets");
  const MINE = ".claude/stress.lock";
  for (const other of ["verify-everything.lock", "load-ramp.lock", "stress.lock"]) {
    const q = `.claude/${other}`;
    if (!fs.existsSync(q)) continue;
    let pid = 0; try { pid = Number(JSON.parse(fs.readFileSync(q, "utf8")).pid) || 0; } catch {}
    let alive = false; try { if (pid) { process.kill(pid, 0); alive = true; } } catch {}
    if (alive) { console.error(`Another heavy run is alive (${other}, pid ${pid}). Refusing.`); process.exit(1); }
  }
  try { fs.mkdirSync(".claude", { recursive: true }); } catch {}
  fs.writeFileSync(MINE, JSON.stringify({ pid: process.pid, script: process.argv[1], at: new Date().toISOString() }));
  const release = () => { try { fs.unlinkSync(MINE); } catch {} };
  process.on("exit", release);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { release(); process.exit(130); });
}
const SR = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE;
const REST = `${URL}/rest/v1/realtime_events`;
const SH = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
const TAG = "stress-" + Date.now() + "-"; // unique marker so we only touch our rows

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sendAt = new Map();                  // entity_id -> send time (ms)
const subs = [];                           // { client, channel, got:Set, dupes, lat:[] }

async function openSubscriber(i) {
  const c = createClient(URL, ANON, { realtime: { params: { eventsPerSecond: 50 } } });
  const s = { client: c, channel: null, got: new Set(), dupes: 0, lat: [] };
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("subscribe timeout #" + i)), 15000);
    s.channel = c.channel("rt:ops:" + i)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "realtime_events", filter: "topic=eq.ops" },
        (p) => {
          const eid = p.new && p.new.entity_id;
          if (!eid || !eid.startsWith(TAG)) return; // ignore anything not from this run
          if (s.got.has(eid)) { s.dupes++; return; }
          s.got.add(eid);
          const t0 = sendAt.get(eid);
          if (t0) s.lat.push(performance.now() - t0);
        })
      .subscribe((st) => { if (st === "SUBSCRIBED") { clearTimeout(to); resolve(); } });
  });
  subs.push(s);
}

async function fire(eid) {
  sendAt.set(eid, performance.now());
  await fetch(REST, { method: "POST", headers: SH, body: JSON.stringify({ topic: "ops", kind: "order", entity_id: eid }) });
}

function pct(arr, p) { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); return Math.round(a[Math.floor((a.length - 1) * p)]); }

async function main() {
  console.log(`\n⏱  Realtime stress: ${N} subscribers, ${M} events\n`);
  console.log("Opening subscribers…");
  for (let i = 0; i < N; i++) await openSubscriber(i);
  console.log(`✓ ${subs.length} subscribers connected\n`);
  await sleep(500);

  console.log(`Firing ${M} breadcrumbs in a burst…`);
  const t0 = performance.now();
  const ids = Array.from({ length: M }, (_, i) => TAG + i);
  // Fire in chunks of 20 concurrently to simulate a busy floor burst.
  for (let i = 0; i < ids.length; i += 20) await Promise.all(ids.slice(i, i + 20).map(fire));
  const fireMs = Math.round(performance.now() - t0);
  console.log(`✓ fired in ${fireMs}ms — waiting for delivery…\n`);
  await sleep(4000); // let everything land

  // ── results ──
  const allLat = subs.flatMap((s) => s.lat);
  const fullyReceived = subs.filter((s) => s.got.size === M).length;
  const totalExpected = N * M, totalGot = subs.reduce((a, s) => a + s.got.size, 0);
  const totalDupes = subs.reduce((a, s) => a + s.dupes, 0);
  console.log("── DELIVERY ──");
  console.log(`  subscribers that got ALL ${M}:  ${fullyReceived}/${N}`);
  console.log(`  events delivered:              ${totalGot}/${totalExpected}  (${((totalGot / totalExpected) * 100).toFixed(2)}%)`);
  console.log(`  losses:                        ${totalExpected - totalGot}`);
  console.log(`  duplicates:                    ${totalDupes}  (harmless — we refetch truth)`);
  console.log("── LATENCY (write issued → delivered) ──");
  console.log(`  avg ${Math.round(allLat.reduce((a, b) => a + b, 0) / (allLat.length || 1))}ms · p50 ${pct(allLat, 0.5)}ms · p95 ${pct(allLat, 0.95)}ms · max ${Math.round(Math.max(...allLat, 0))}ms`);

  // ── reconnect sub-test ──
  console.log("\n── RECONNECT ──");
  const victim = subs[0];
  await victim.client.removeChannel(victim.channel);          // simulate a drop
  await sleep(500);
  victim.got.clear();
  await new Promise((resolve) => {                            // re-subscribe
    victim.channel = victim.client.channel("rt:ops:re")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "realtime_events", filter: "topic=eq.ops" },
        (p) => { if (p.new && p.new.entity_id === TAG + "re") victim.got.add("re"); })
      .subscribe((st) => { if (st === "SUBSCRIBED") resolve(); });
  });
  await fire(TAG + "re");
  await sleep(1500);
  console.log(`  recovered after reconnect: ${victim.got.has("re") ? "YES ✓" : "NO ✗"}`);

  // ── egress estimate ──
  const bytesPerEvent = 220; // a breadcrumb row over the wire ≈ 200-240 bytes
  const mb = (totalGot * bytesPerEvent) / (1024 * 1024);
  console.log("\n── EGRESS ──");
  console.log(`  this test moved ~${mb.toFixed(2)} MB for ${totalGot} deliveries across ${N} devices`);
  console.log(`  (polling: ${N} devices × full-state every 1s would be MBs per MINUTE — that's the difference)\n`);
}

main()
  .catch((e) => { console.error("STRESS ERROR:", e.message); process.exitCode = 1; })
  .finally(async () => {
    // cleanup: remove every breadcrumb this run created
    await fetch(`${REST}?entity_id=like.${TAG}*`, { method: "DELETE", headers: SH }).catch(() => {});
    for (const s of subs) { try { await s.client.removeAllChannels(); } catch {} }
    console.log("✓ cleaned up; exiting.");
    setTimeout(() => process.exit(process.exitCode || 0), 500);
  });
