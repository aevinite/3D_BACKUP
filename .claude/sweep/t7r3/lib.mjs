import * as __nodefs from "node:fs";
globalThis.__fs = __nodefs;
import { chromium } from "playwright";
import { loginAs, adminCookie } from "../../../scripts/sweep/login.mjs";
export const BASE = "https://3-d-backup.vercel.app";
export const ROWS = [];
let n = 40500;
export const at = (id) => { n = id - 1; };
export const C = (what, cond, note = "") => { n++; ROWS.push({ id: n, what, ok: !!cond, note: String(note || "") }); return !!cond; };
export const dump = (tag) => {
  const fs = globalThis.__fs;
  const p = Number(process.env.T7_NO_WRITE) ? null : `.claude/sweep/t7r3/rows-${tag}.json`;
  if (p) fs.writeFileSync(p, JSON.stringify(ROWS));
  const bad = ROWS.filter((r) => !r.ok);
  console.log(`BLOCK ${tag} (P${ROWS[0] ? ROWS[0].id : "-"}–P${n}): ${ROWS.length - bad.length} pass · ${bad.length} FAIL`);
  bad.forEach((r) => console.log(`  FAIL P${r.id} ${r.what}${r.note ? " — " + r.note : ""}`));
  return bad.length;
};
export const LEAK = /-->|\$\{|\bundefined\b|\bNaN\b|\[object Object\]/;
export async function open(vp = { width: 1194, height: 834, dpr: 2 }, opts = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr, hasTouch: opts.touch !== false });
  if (opts.admin) await ctx.addCookies([adminCookie(BASE)]);
  else await loginAs(ctx, "tablet", BASE);
  if (opts.cookies) await ctx.addCookies(opts.cookies);
  await ctx.addInitScript((sk) => { try { localStorage.setItem("lfh_panel_theme", sk); } catch {} }, opts.skin || "light");
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e.message)));
  const url = BASE + "/tablet" + (opts.qs || "");
  await page.goto(url, { waitUntil: "networkidle", timeout: 150000 });
  let fr = null;
  for (let i = 0; i < 100 && !fr; i++) { fr = page.frames().find((f) => /\/panels\/tablet\//.test(f.url())); if (!fr) await page.waitForTimeout(400); }
  if (!fr) { await browser.close(); throw new Error("the tablet panel frame never appeared (landed on " + page.url() + ")"); }
  await fr.waitForSelector(".tile[data-t]", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  return { browser, ctx, page, fr, errs };
}
export async function openTable(s, t) {
  for (let i = 0; i < 3; i++) {
    const closed = await s.fr.evaluate(() => { const p = document.getElementById("panel"); const x = p && p.querySelector(".picker-back, #detailClose"); if (x) { x.click(); return true; } return false; });
    if (!closed) break;
    await s.page.waitForTimeout(450);
  }
  await s.page.waitForTimeout(300);
  await s.fr.waitForSelector(`.tile[data-t="${t}"]`, { timeout: 40000, state: "attached" });
  await s.fr.evaluate((tt) => document.querySelector(`.tile[data-t="${tt}"]`).click(), t);
  await s.fr.waitForSelector(".detail-pop", { timeout: 40000 });
  await s.fr.waitForFunction(() => { const p = document.querySelector(".detail-pop"); return !!p && !/Loading order details|sending…/.test(p.innerText) && !!p.querySelector("#closeTable, #kotMenuBtn, #payBill"); }, null, { timeout: 45000 }).catch(() => {});
  await s.page.waitForTimeout(600);
}
export const toasts = (fr) => fr.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.innerText.replace(/\s+/g, " ").trim()));
export const clearToasts = (fr) => fr.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));

// A TOAST IS GONE IN 2.6 SECONDS. Reading .toast after an action that takes four seconds to settle
// reports "(nothing said)" about a panel that said it perfectly — the same trap noted in an earlier
// pass. Arm this once and every toast raised from then on is kept, whether or not anyone was
// looking when it appeared.
export const armToasts = (fr) => fr.evaluate(() => {
  if (window.__t7toasts) { window.__t7toasts.length = 0; return true; }
  window.__t7toasts = [];
  const grab = (n) => { if (n && n.nodeType === 1 && n.classList && n.classList.contains("toast")) window.__t7toasts.push(n.innerText.replace(/\s+/g, " ").trim()); };
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach(grab))).observe(document.body, { childList: true, subtree: true });
  document.querySelectorAll(".toast").forEach(grab);
  return true;
});
export const heard = (fr) => fr.evaluate(() => (window.__t7toasts || []).slice());
export const forget = (fr) => fr.evaluate(() => { if (window.__t7toasts) window.__t7toasts.length = 0; document.querySelectorAll(".toast").forEach((t) => t.remove()); });
