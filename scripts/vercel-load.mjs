// vercel-load.mjs — LIVE production web-tier load test (owner 2026-06-27).
// Hammers the real Vercel deployment's GUEST MENU pages (the public path that 1500
// restaurants' guests actually hit) at high concurrency, and reports throughput, latency
// percentiles, and error rate. This tests Vercel's serverless auto-scaling + the anon DB
// read path under concurrent guest traffic. (Panel APIs are auth-gated → not load-tested
// here.) Run the DB order-engine (stress-max) alongside for combined write+read pressure.
//
// Usage: node scripts/vercel-load.mjs [seconds=180] [concurrency=60]
const BASE = "https://3-d-backup.vercel.app";
const SLUGS = ["french-house","pizza-palace","sakura-sushi","spice-route","taco-fiesta","burger-barn","green-bowl"];
const SECONDS = parseInt(process.argv[2] || "180", 10);
const CONC = parseInt(process.argv[3] || "60", 10);
const deadline = Date.now() + SECONDS * 1000;

const lat = [];           // latency samples (ms)
const status = {};        // status-code tally
let done = 0, errors = 0;
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

async function hit() {
  const url = `${BASE}/r/${rnd(SLUGS)}/menu`;
  const t0 = performance.now();
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 30000);
    const r = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": "lfh-loadtest" } });
    clearTimeout(to);
    await r.arrayBuffer();                    // drain the body (counts real egress)
    const ms = performance.now() - t0;
    lat.push(ms);
    status[r.status] = (status[r.status] || 0) + 1;
    if (r.status >= 500) errors++;
  } catch (e) {
    errors++; status["ERR"] = (status["ERR"] || 0) + 1;
  } finally { done++; }
}

async function worker() { while (Date.now() < deadline) await hit(); }

const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.floor((p / 100) * (s.length - 1))]); };

(async () => {
  console.log(`LIVE LOAD → ${BASE}  ${SECONDS}s × ${CONC} concurrent guest menu loads\n`);
  const ticker = setInterval(() => {
    console.log(`  ${new Date().toISOString().slice(11,19)}  reqs=${done}  err=${errors}  p50=${pct(lat,50)}ms p95=${pct(lat,95)}ms  ${Object.entries(status).map(([k,v])=>k+":"+v).join(" ")}`);
  }, 15000);
  await Promise.all(Array.from({ length: CONC }, worker));
  clearInterval(ticker);
  console.log(`\n==== DONE ====`);
  console.log(`requests:   ${done}   (${(done/SECONDS).toFixed(1)}/s)`);
  console.log(`status:     ${Object.entries(status).map(([k,v])=>k+":"+v).join("  ")}`);
  console.log(`errors5xx:  ${errors}  (${((errors/Math.max(done,1))*100).toFixed(2)}%)`);
  console.log(`latency:    p50=${pct(lat,50)}ms  p95=${pct(lat,95)}ms  p99=${pct(lat,99)}ms  max=${pct(lat,100)}ms`);
})();
