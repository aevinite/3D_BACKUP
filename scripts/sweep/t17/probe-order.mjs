import { chromium } from "playwright";
import { loginAs } from "../login.mjs";
const BASE = "http://localhost:4317";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await loginAs(ctx, "ownerMulti", BASE);
const p = await ctx.newPage();
const seen = { menuOrder: {}, menuDefault: {}, mmOrder: {} };
for (let i = 0; i < 8; i++) {
  await p.goto(BASE + "/owner/menu", { waitUntil: "domcontentloaded" });
  const m = await p.evaluate(() => ({
    opts: [...document.querySelectorAll(".ome-switch option")].map(o=>o.textContent),
    sel: document.querySelector(".ome-switch select")?.selectedOptions?.[0]?.textContent || null,
  }));
  seen.menuOrder[m.opts.join(" | ")] = (seen.menuOrder[m.opts.join(" | ")]||0)+1;
  seen.menuDefault[m.sel] = (seen.menuDefault[m.sel]||0)+1;
  await p.goto(BASE + "/owner/manager", { waitUntil: "domcontentloaded" });
  const mm = await p.evaluate(()=>[...document.querySelectorAll(".omm-card .nm")].map(e=>e.textContent));
  seen.mmOrder[mm.join(" | ")] = (seen.mmOrder[mm.join(" | ")]||0)+1;
}
console.log(JSON.stringify(seen,null,1));
await ctx.close(); await b.close();
