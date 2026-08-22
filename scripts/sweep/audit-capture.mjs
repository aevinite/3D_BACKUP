// audit-capture.mjs — screenshot-every-state capture for the AV-live handover audit.
// Loads a route, screenshots the open state, enumerates clickables, clicks each
// NON-destructive control, screenshots the resulting popup/state, records console
// errors, then resets (Escape + re-nav) before the next click. Destructive-labelled
// controls are logged but never clicked (read-only-safe by default).
//
// Usage:
//   node scripts/sweep/audit-capture.mjs \
//     --base http://localhost:4000 --route /menu --out <dir> --label guest-menu \
//     [--role manager|kitchen|tablet|owner] [--user diagt11 --pass diag-t11-2026 --loginroute /tablet] \
//     [--iframe] [--vw 1194 --vh 834] [--max 60] [--wait 1800]
import { chromium } from "playwright";
import { loginAs } from "./login.mjs";
import { enumerateClickables } from "./crawl.mjs";
import fs from "fs";

const A = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) { const k = a.slice(2); const v = process.argv[i + 1]?.startsWith("--") || process.argv[i + 1] === undefined ? true : process.argv[++i]; A[k] = v; }
}
const BASE = A.base || "http://localhost:4000";
const OUT = A.out; fs.mkdirSync(OUT, { recursive: true });
const VW = Number(A.vw || 1194), VH = Number(A.vh || 834);
const MAX = Number(A.max || 60), WAIT = Number(A.wait || 1800);
const DESTRUCTIVE = /delete|remove|logout|log ?out|\bpay\b|settle|close table|void|cancel|\bban\b|\bkick\b|\b86\b|sold ?out|save|send|confirm|place order|reset|purge|delete order|mark paid|restart|approve|deny|make head/i;

// Cheap DOM-based visual-defect scan — runs on every state so we don't have to
// eyeball 10k screenshots. Flags candidates for a vision read: page-level
// horizontal scroll, interactive elements off the viewport, clipped/truncated
// text, and zero-size visible buttons. Has false positives — it only PICKS which
// shots deserve a human/vision look.
const SCAN_FN = () => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const vis = (el) => { const s = getComputedStyle(el); if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  // An element is "intentionally" off-screen if any ancestor is a horizontal (or
  // both-axis) scroll container (overflow-x auto/scroll) — category bars, chip
  // rails, carousels. Those are NOT layout bugs, so skip them.
  const inScroller = (el) => { let n = el.parentElement; while (n && n !== document.body) { const s = getComputedStyle(n); if (s.overflowX === "auto" || s.overflowX === "scroll" || s.overflow === "auto" || s.overflow === "scroll") return true; n = n.parentElement; } return false; };
  const out = { hScroll: document.documentElement.scrollWidth > vw + 3, offViewport: [], clipped: [], zeroSize: [] };
  const inter = [...document.querySelectorAll('button,a,input,select,[role="button"],[data-t],[data-filter]')];
  for (const el of inter) {
    const r = el.getBoundingClientRect();
    if (!vis(el)) { if ((el.tagName === "BUTTON" || el.getAttribute("role") === "button") && (r.width < 3 || r.height < 3) && el.offsetParent !== null) out.zeroSize.push((el.textContent || el.getAttribute("aria-label") || el.id || "").trim().slice(0, 30)); continue; }
    if (inScroller(el)) continue;
    if (r.right > vw + 3 || r.left < -3) out.offViewport.push((el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30) + ` @${Math.round(r.left)},${Math.round(r.right)}`);
  }
  const texty = [...document.querySelectorAll("h1,h2,h3,button,.chip,[class*=title],[class*=name],td,th,span")];
  for (const el of texty) {
    if (!vis(el) || inScroller(el)) continue; const s = getComputedStyle(el);
    if ((s.textOverflow === "ellipsis" || (s.overflow === "hidden" && s.whiteSpace === "nowrap")) && el.scrollWidth > el.clientWidth + 6 && (el.textContent || "").trim().length > 1)
      out.clipped.push((el.textContent || "").trim().slice(0, 30));
  }
  out.offViewport = [...new Set(out.offViewport)].slice(0, 12);
  out.clipped = [...new Set(out.clipped)].slice(0, 12);
  out.zeroSize = [...new Set(out.zeroSize)].slice(0, 12);
  out.flagged = out.hScroll || out.offViewport.length > 0 || out.clipped.length > 0 || out.zeroSize.length > 0;
  return out;
};

const b = await chromium.launch({ headless: true });
const manifest = { label: A.label, route: A.route, base: BASE, viewport: { VW, VH }, shots: [], skipped: [], consoleErrors: [] };
try {
  const ctx = await b.newContext({ viewport: { width: VW, height: VH } });
  if (A.adminlogin) {
    // Admin (/aevinite) uses /api/staff-login (form data, ADMIN_PASSWORD), NOT
    // panel-login — so it dodges the per-username panel-login throttle. Read the
    // secret from .env.local and POST it; never print it.
// THIS CHECKOUT'S OWN KEYS, NOT THE SHARED FOLDER'S (sweep #6 / T28, 2026-08-22). This read
// /Users/aevinite/Documents/Projects/backup_Menu/.env.local by absolute path. Every parallel lane of a
// sweep runs from its OWN worktree — that is the rule — so a guard that reaches back into the shared
// folder asserts against whatever stack THAT copy is pointed at, which may be the other backup stack
// entirely. A check that tests something other than what you asked for is worse than no check.
    const env = fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
    const pw = (env.match(/^ADMIN_PASSWORD=(.+)$/m) || [])[1]?.trim();
    if (pw) await ctx.request.post(BASE + "/api/staff-login", { form: { password: pw } });
  } else if (A.role && A.user) await loginAs(ctx, A.role, BASE, { username: A.user, password: A.pass, route: A.loginroute || A.route });
  else if (A.role) await loginAs(ctx, A.role, BASE);
  const p = await ctx.newPage();
  const errs = [];
  p.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
  p.on("pageerror", (e) => errs.push("PAGEERR:" + String(e).slice(0, 200)));

  const gotoBase = async () => { await p.goto(BASE + A.route, { waitUntil: "domcontentloaded", timeout: 30000 }); await p.waitForTimeout(WAIT + 1500); };
  await gotoBase();

  const targetFrame = async () => {
    if (!A.iframe) return p;
    const el = await p.$("iframe"); return el ? await el.contentFrame() : p;
  };
  let fr = await targetFrame();

  // open state
  await p.screenshot({ path: `${OUT}/00-open.png`, fullPage: false });
  { let scan = null; try { scan = await fr.evaluate(SCAN_FN); } catch {} manifest.shots.push({ file: "00-open.png", label: "open", scan }); }

  let clickables = [];
  try { clickables = await enumerateClickables(fr); } catch (e) { clickables = []; manifest.enumErr = String(e).slice(0, 120); }
  manifest.clickableCount = clickables.length;

  let n = 0;
  for (const c of clickables) {
    if (n >= MAX) break;
    const label = (c.text || c.aria || c.selector || "").replace(/\s+/g, " ").trim().slice(0, 40) || "el";
    if (DESTRUCTIVE.test(c.text || "") || DESTRUCTIVE.test(c.aria || "")) { manifest.skipped.push({ selector: c.selector, label, reason: "destructive" }); continue; }
    n++;
    const errBefore = errs.length;
    try {
      const loc = fr.locator(c.selector).first();
      await loc.click({ timeout: 4000 });
      await p.waitForTimeout(WAIT);
      const file = `${String(n).padStart(2, "0")}-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 28)}.png`;
      await p.screenshot({ path: `${OUT}/${file}`, fullPage: false });
      let scan = null; try { scan = await fr.evaluate(SCAN_FN); } catch {}
      manifest.shots.push({ file, label, selector: c.selector, scan });
      const newErrs = errs.slice(errBefore);
      if (newErrs.length) manifest.consoleErrors.push({ afterClick: label, errs: newErrs });
    } catch (e) {
      manifest.skipped.push({ selector: c.selector, label, reason: "click-failed:" + String(e).slice(0, 60) });
    }
    // reset: escape any popup, re-nav to base
    try { await p.keyboard.press("Escape"); await p.waitForTimeout(200); await p.keyboard.press("Escape"); } catch {}
    await gotoBase();
    fr = await targetFrame();
  }
  manifest.totalConsoleErrors = errs.length;
  manifest.consoleErrorSample = [...new Set(errs)].slice(0, 8);
  await ctx.close();
} finally { await b.close(); }
fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(`CAPTURED ${manifest.shots.length} shots, skipped ${manifest.skipped.length}, console-errors ${manifest.totalConsoleErrors}`);
console.log("clickables:", manifest.clickableCount, "| enumErr:", manifest.enumErr || "none");
if (manifest.consoleErrorSample?.length) console.log("errSample:", JSON.stringify(manifest.consoleErrorSample));
const flagged = manifest.shots.filter((s) => s.scan && s.scan.flagged);
console.log(`LAYOUT-FLAGGED shots (${flagged.length}) — vision-review these:`);
for (const s of flagged) console.log(`  ${s.file} [${s.label}] hScroll=${s.scan.hScroll} off=${JSON.stringify(s.scan.offViewport)} clip=${JSON.stringify(s.scan.clipped)} zero=${JSON.stringify(s.scan.zeroSize)}`);
