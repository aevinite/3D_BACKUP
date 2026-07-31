import { chromium } from "playwright";
import { loginAs } from "./scripts/sweep/login.mjs";
const SLOW = "http://localhost:4099";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await chromium.launch(); const ctx = await b.newContext();
await loginAs(ctx, "manager", SLOW);
const p = await ctx.newPage();
await p.goto(SLOW + "/manager", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 40; i++) { if (await p.evaluate(() => !!navigator.serviceWorker.controller)) break; await sleep(500); }
await p.reload({ waitUntil: "domcontentloaded" });
const inP = (fn) => p.evaluate((src) => { const w = document.querySelector("iframe").contentWindow; try { return new w.Function(`return (${src})()`)(); } catch (e) { return { __err: String(e.message) }; } }, fn.toString());
for (let i = 0; i < 60; i++) { const v = await inP(() => (typeof state !== "undefined" && state.data && (state.data.items||[]).length) || 0); if (v > 0) break; await sleep(500); }
await sleep(3000);
const keys = await p.evaluate(async () => { const o={}; for (const n of await caches.keys()) o[n]=(await (await caches.open(n)).keys()).map(r=>r.url.replace(location.origin,"")); return o; });
console.log("cached DATA before the slow reload:", JSON.stringify(keys["lfh-data-v4"]||[]));
await fetch(SLOW + "/__slow?ms=14000");
const t0 = Date.now();
await p.reload({ waitUntil: "domcontentloaded" }).catch(()=>{});
let painted = 0;
for (let i = 0; i < 80; i++) { const v = await inP(() => (typeof state !== "undefined" && state.data && (state.data.items||[]).length) || 0); if (v > 0) { painted = Date.now()-t0; break; } await sleep(250); }
console.log(`board painted in ${(painted/1000).toFixed(1)}s (delay was 14s → under 14 means the fallback fired)`);
const after = await p.evaluate(async () => { const c = await caches.open("lfh-data-v4"); return (await c.keys()).map(r=>r.url.replace(location.origin,"")); });
console.log("cached DATA after:", JSON.stringify(after));
await fetch(SLOW + "/__slow?ms=0");
await b.close();
