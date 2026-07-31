import { chromium } from "playwright";
import { loginAs } from "./scripts/sweep/login.mjs";
const BASE = "http://localhost:4013";
const b = await chromium.launch(); const ctx = await b.newContext();
await loginAs(ctx, "manager", BASE);
// find a free table, open it, close it — timing each step
let table = null;
for (let i = 30; i >= 1; i--) {
  const j = await ctx.request.get(`${BASE}/api/editor/sessions?table=${i}`).then(r => r.json()).catch(() => null);
  const list = Array.isArray(j) ? j : (j && j.sessions) || [];
  if (!list.some(s => s && s.status !== "closed")) { table = String(i); break; }
}
console.log("free table:", table);
let t = Date.now();
const op = await ctx.request.post(`${BASE}/api/editor/sessions/open`, { headers: { "content-type": "application/json" }, data: { table }, timeout: 60000 });
const opened = await op.json().catch(() => null);
console.log(`open  → HTTP ${op.status()} in ${((Date.now()-t)/1000).toFixed(1)}s`);
const sid = opened && (opened.id || (opened.session && opened.session.id));
t = Date.now();
try {
  const cl = await ctx.request.post(`${BASE}/api/editor/sessions/${sid}/close`, { headers: { "content-type": "application/json" }, data: { force: true }, timeout: 90000 });
  console.log(`close → HTTP ${cl.status()} in ${((Date.now()-t)/1000).toFixed(1)}s`);
  console.log("   body:", (await cl.text()).slice(0, 120));
} catch (e) { console.log(`close → THREW after ${((Date.now()-t)/1000).toFixed(1)}s: ${String(e.message).slice(0,60)}`); }
await b.close();
