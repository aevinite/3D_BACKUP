// Shared driver for sweep #8 terminal 8, ROUND 2 (ids P99301–P99800).
//
// Round 1 wrote 875 rows and 731 of them READ the shipped code; only 144 drove the real app, at
// two widths, as essentially one role, with one of the six surfaces that embed this shell ever
// opened. Round 2 is planned from that measurement: almost every row here DRIVES.
import { chromium } from "playwright";
import { loginAs } from "../login.mjs";
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(new URL("../../..", import.meta.url).pathname);
export const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const i = process.argv.indexOf("--base");
export const BASE = i > -1 ? process.argv[i + 1] : (process.env.LFH_BASE || "http://localhost:4308");
export const SLUG = "french-house";

const results = [];
export async function checkA(id, what, fn) {
  let ok = false, note = "";
  try { const r = await fn(); ok = r === true || r === undefined; if (typeof r === "string") { ok = false; note = r; } }
  catch (e) { ok = false; note = String((e && e.message) || e).replace(/\s+/g, " ").slice(0, 200); }
  results.push({ id, what, ok, note });
  return ok;
}
export function skip(id, what, why) { results.push({ id, what, ok: null, note: why }); }
// A NOTE MUST NEVER CARRY A KEY, WHOLE OR PARTIAL. A browser console message about a failed
// realtime socket quotes the whole subscribe URL, and that URL carries the anon key — so a row's
// note would have printed one into the ledger and into the report. Redacted at the one place every
// note passes through, rather than at each call site.
const scrub = (t) => String(t || "")
  .replace(/eyJ[A-Za-z0-9_\-]{8,}(?:\.[A-Za-z0-9_\-]+){0,2}/g, "<key redacted>")
  .replace(/(apikey|access_token|token)=[^&"'\s]+/gi, "$1=<redacted>")
  .replace(/sbp_[A-Za-z0-9]+/g, "<key redacted>");

export function report(label) {
  for (const r of results) r.note = scrub(r.note);
  const bad = results.filter((r) => r.ok === false), sk = results.filter((r) => r.ok === null);
  for (const r of bad) console.log(`❌ ${r.id}  ${r.what}${r.note ? "  — " + r.note : ""}`);
  for (const r of sk) console.log(`⏭ ${r.id}  ${r.what}  — ${r.note}`);
  console.log(`${label}: ${results.filter((r) => r.ok === true).length} ✅ · ${bad.length} ❌ · ${sk.length} ⏭  (${results.length} rows)`);
  const out = process.env.T8R2_RESULTS || path.join(process.env.TMPDIR || "/tmp", `t8r2-${label.replace(/\W+/g, "-")}.json`);
  try { fs.writeFileSync(out, JSON.stringify(results, null, 1)); } catch { /* the run still stands */ }
  return bad.length;
}
export const eq = (a, b) => a === b || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`;

export const browser = await chromium.launch();

// ONE sign-in per role for the whole run — loginAs caches in-process AND across processes, because
// staff login is rate-limited and reaching that wall pings the owner's phone about his own tooling.
export async function ctxAs(role, vp = { width: 1280, height: 800, dpr: 1 }, extra = {}) {
  const c = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr, ...extra });
  if (role) await loginAs(c, role, BASE);
  return c;
}
/** Open a page and return { page, errors } — every uncaught error and console error is collected. */
export async function pageOf(ctx) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e.message).slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 160)); });
  return { page, errors };
}
/** The panel lives in an iframe; resolve it and wait for the panel's own root. */
export async function frameOf(page, ms = 45000) {
  await page.waitForSelector("iframe", { timeout: ms });
  const f = await (await page.$("iframe")).contentFrame();
  await f.waitForSelector("#editor", { timeout: ms });
  return f;
}
/** ON SCREEN, measured — never `offsetParent`, which is null for every position:fixed element. */
export const ONSCREEN = `(el)=>{ if(!el) return false; const cs=getComputedStyle(el);
  if(cs.display==="none"||cs.visibility==="hidden"||parseFloat(cs.opacity)===0) return false;
  const r=el.getBoundingClientRect();
  if(r.width<1||r.height<1) return false;
  return r.right>0 && r.bottom>0 && r.left<innerWidth && r.top<innerHeight; }`;
