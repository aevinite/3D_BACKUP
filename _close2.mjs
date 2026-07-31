import { chromium } from "playwright";
import { loginAs } from "./scripts/sweep/login.mjs";
const BASE = "http://localhost:4013";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await chromium.launch(); const ctx = await b.newContext();
// baseline: how fast is a trivial read right now? (is the DB itself loaded?)
await loginAs(ctx, "manager", BASE);
for (let i = 0; i < 3; i++) {
  const t = Date.now(); const r = await ctx.request.get(`${BASE}/api/editor/summary`, { timeout: 60000 });
  console.log(`  summary read → ${r.status()} in ${((Date.now()-t)/1000).toFixed(1)}s`);
}
// now: seat a table with 3 orders as a waiter, then close it as manager
await loginAs(ctx, "tablet", BASE);
const menu = await ctx.request.get(`${BASE}/api/r/french-house/menu-data`).then(r=>r.json());
const dish = menu.items[0];
let table = null;
await loginAs(ctx, "manager", BASE);
for (let i = 29; i >= 1; i--) {
  const j = await ctx.request.get(`${BASE}/api/editor/sessions?table=${i}`).then(r=>r.json()).catch(()=>null);
  const list = Array.isArray(j)?j:(j&&j.sessions)||[];
  if (!list.some(s=>s&&s.status!=="closed")) { table = String(i); break; }
}
await loginAs(ctx, "tablet", BASE);
for (let k = 0; k < 3; k++) {
  await ctx.request.post(`${BASE}/api/tablet/order`, { headers:{"content-type":"application/json"}, data:{ table, items:[{id:dish.id, qty:2}], allergies:[], note:"close timing "+k }, timeout: 60000 });
  await sleep(400);
}
await loginAs(ctx, "manager", BASE);
const j = await ctx.request.get(`${BASE}/api/editor/sessions?table=${table}`).then(r=>r.json());
const sid = ((Array.isArray(j)?j:j.sessions)||[]).find(s=>s.status!=="closed")?.id;
console.log(`  table ${table} seated with 3 orders, session ${sid ? "found" : "MISSING"}`);
const t = Date.now();
try {
  const cl = await ctx.request.post(`${BASE}/api/editor/sessions/${sid}/close`, { headers:{"content-type":"application/json"}, data:{force:true}, timeout: 120000 });
  console.log(`  CLOSE with 3 orders → HTTP ${cl.status()} in ${((Date.now()-t)/1000).toFixed(1)}s`);
} catch(e) { console.log(`  CLOSE THREW after ${((Date.now()-t)/1000).toFixed(1)}s`); }
await b.close();
