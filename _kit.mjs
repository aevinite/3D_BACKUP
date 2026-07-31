import { chromium } from "playwright";
import { loginAs } from "./scripts/sweep/login.mjs";
const BASE = "http://localhost:4013";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await chromium.launch(); const ctx = await b.newContext();
const route = await loginAs(ctx, "kitchen", BASE);
const p = await ctx.newPage();
const bad = [];
p.on("response", r => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url().replace(BASE,"")}`); });
await p.goto(BASE + route, { waitUntil: "domcontentloaded" });
for (let i = 0; i < 40; i++) { if (await p.evaluate(() => !!navigator.serviceWorker.controller)) break; await sleep(500); }
await p.reload({ waitUntil: "domcontentloaded" });
const inP = (fn) => p.evaluate((src) => { const w = document.querySelector("iframe").contentWindow; try { return new w.Function(`return (${src})()`)(); } catch (e) { return { __err: String(e.message) }; } }, fn.toString());
let live = 0;
for (let i = 0; i < 60; i++) { const v = await inP(() => (typeof state !== "undefined" && (state.dishes||[]).length) || 0); if (v > 0) { live = v; break; } await sleep(500); }
console.log("kitchen dishes ONLINE:", live);
await sleep(3000);
const cached = await p.evaluate(async () => { const c = await caches.open("lfh-data-v4"); return (await c.keys()).map(r=>r.url.replace(location.origin,"")); });
console.log("cached for offline:", JSON.stringify(cached));
await ctx.setOffline(true);
await p.reload({ waitUntil: "domcontentloaded" }).catch(()=>{});
let off = 0;
for (let i = 0; i < 40; i++) { const v = await inP(() => (typeof state !== "undefined" && (state.dishes||[]).length) || 0); if (v > 0) { off = v; break; } await sleep(500); }
console.log("kitchen dishes OFFLINE:", off, off ? "✅" : "❌");
console.log("bar:", await inP(() => { const b=document.querySelector("#lfhOffBar"); return b?b.innerText.replace(/\n/g," | "):"(none)"; }));
console.log("failing requests:", bad.length ? [...new Set(bad)].join("  ") : "none");
await b.close();
