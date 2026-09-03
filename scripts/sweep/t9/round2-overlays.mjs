// SWEEP #8 · T9 · ROUND 2, block C — EVERY OVERLAY, AT EVERY WIDTH, IN BOTH SKINS.
// P63650–P63700 then P99801–P99809.
//
// Round 1 asserted that each overlay registers a back layer and closes three ways — by reading the
// code. This block OPENS each one on a real screen at five widths in two skins and measures the
// four things that actually go wrong: does it fit, is every control finger-sized, does it cover the
// board it is supposed to cover, and does it leave the page scrolling sideways. That is the axis
// the two placeholder-clipped-on-a-phone faults in this repo's history were found on.
import { chromium } from "playwright";
import { loginAs } from "../login.mjs";

const BASE = (process.argv.find((a) => a.startsWith("--base=")) || "").slice(7) || "http://localhost:4309";
const PANEL = "iframe[src*='/panels/kitchen/index.html']";
const FILE = "round2-overlays";
const results = [];
const rec = (id, label, ok, note = "") => results.push({ id, label, ok: ok === true, note: ok === true ? note : (typeof ok === "string" ? ok : note) });

const WIDTHS = [[360, 780, "A35 phone"], [768, 1024, "iPad portrait"], [820, 1080, "small tablet"], [1194, 834, "kitchen tablet"], [1280, 800, "desktop"]];
const OVERLAYS = [
  ["the 86 board", () => { document.getElementById("boardBtn").click(); }, ".drawer", () => { const d = document.getElementById("drawerOverlay"); return !d.hidden; }, () => document.getElementById("drawerClose").click()],
  ["the printer sheet", () => { document.getElementById("printerBtn").click(); }, ".prsheet", () => !!document.getElementById("prSheet"), () => { const b = document.querySelector("#prSheet [data-prclose]"); if (b) b.click(); }],
  ["the ☰ menu", () => { document.getElementById("hamburger").click(); }, ".kds-dw", () => !!document.querySelector(".kds-dw"), () => { const b = document.querySelector(".kds-dw .dw-close"); if (b) b.click(); }],
  ["⚙️ Settings", () => { openKitchenSettings(); }, ".kset", () => !!document.querySelector(".kset-ov"), () => { if (window.__kdsSettingsClose) window.__kdsSettingsClose(); }],
];

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const route = await loginAs(ctx, "kitchen", BASE);
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e && e.message).slice(0, 120)));
  let id = 63650;
  const next = () => { const n = id; id = n === 63700 ? 99801 : n + 1; return "P" + String(n); };

  for (const [w, h, wname] of WIDTHS) {
    for (const skin of ["light", "dark"]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60000 });
      const F = await (await page.waitForSelector(PANEL, { timeout: 30000 })).contentFrame();
      await page.waitForTimeout(2000);
      await F.evaluate((s) => { if (window.LFH_THEME && window.LFH_THEME.get() !== s) document.getElementById("themeToggle").click(); }, skin);
      await page.waitForTimeout(300);

      for (const [oname, open, sel, isOpen, close] of OVERLAYS) {
        const r = await F.evaluate(async ([openSrc, selector, isOpenSrc, closeSrc]) => {
          // eslint-disable-next-line no-new-func
          new Function(openSrc)();
          await new Promise((res) => setTimeout(res, 350));
          const shown = new Function("return (" + isOpenSrc + ")()")();
          const box = document.querySelector(selector);
          const out = { shown, found: !!box };
          if (box) {
            const b = box.getBoundingClientRect();
            out.rect = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
            out.insideX = b.left >= -1 && b.right <= window.innerWidth + 1;
            out.insideY = b.top >= -1;                             // may scroll internally
            out.overflowsY = b.height > window.innerHeight + 1;
            out.ownScroll = getComputedStyle(box).overflowY === "auto" || getComputedStyle(box).overflowY === "scroll"
                            || [...box.querySelectorAll("*")].some((e) => { const cs = getComputedStyle(e); return (cs.overflowY === "auto" || cs.overflowY === "scroll") && e.scrollHeight > e.clientHeight; });
            const ctrls = [...box.querySelectorAll("button, a.btn, input, [role=button]")].filter((e) => e.offsetParent !== null);
            out.controls = ctrls.length;
            out.smallest = ctrls.length ? Math.min(...ctrls.map((e) => { const rr = e.getBoundingClientRect(); return Math.min(Math.round(rr.width), Math.round(rr.height)); })) : null;
            out.clippedText = [...box.querySelectorAll("*")].filter((e) => e.children.length === 0 && e.scrollWidth > e.clientWidth + 1).length;
            out.text = box.innerText.replace(/\s+/g, " ").slice(0, 120);
          }
          out.sidewaysDoc = document.documentElement.scrollWidth > window.innerWidth + 1;
          new Function(closeSrc)();
          await new Promise((res) => setTimeout(res, 250));
          out.closed = !new Function("return (" + isOpenSrc + ")()")();
          return out;
        }, [String(open).replace(/^\(\)\s*=>\s*/, "").replace(/^\{|\}$/g, ""), sel, String(isOpen), String(close).replace(/^\(\)\s*=>\s*/, "").replace(/^\{|\}$/g, "")]);

        const bad = [];
        if (!r.shown || !r.found) bad.push("did not open");
        if (r.found && !r.insideX) bad.push(`runs off the side (${r.rect.x}..${r.rect.x + r.rect.w} in ${w}px)`);
        if (r.found && r.overflowsY && !r.ownScroll) bad.push(`taller than the screen (${r.rect.h} > ${h}) with no scroll of its own`);
        if (r.found && r.smallest !== null && r.smallest < 44) bad.push(`a ${r.smallest}px control`);
        if (r.found && r.clippedText) bad.push(`${r.clippedText} clipped text node(s)`);
        if (r.sidewaysDoc) bad.push("the page scrolls sideways while it is open");
        if (!r.closed) bad.push("did not close");
        rec(next(), `${oname} at ${w}×${h} (${wname}), ${skin} skin: fits, finger-sized, closes`,
          bad.length === 0 ? true : bad.join("; "),
          r.found ? `${r.rect.w}×${r.rect.h}, ${r.controls} controls, smallest ${r.smallest}px` : "not found");
      }
    }
  }
  rec(next(), "no uncaught error was raised opening every overlay at every width in both skins",
    pageErrors.length === 0 ? true : pageErrors.slice(0, 3).join(" | "));

  // ── F · THE DELIVERY SLIP'S ACTUAL PAPER (item 9's new output) — 8 rows ──────────────────────
  // Item 9 was verified by reading the toast and the flags handed to the document. This reads the
  // PAPER: the markup kotDocHtml actually returns for a delivery ticket, which is the thing that
  // comes out of the printer and the one artefact nobody had looked at.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  const FP = await (await page.waitForSelector(PANEL, { timeout: 30000 })).contentFrame();
  await page.waitForTimeout(2500);
  const paper = await FP.evaluate(async () => {
    const real = LFH_BILLDOC.kotDocHtml;
    let html = null, arg = null;
    LFH_BILLDOC.kotDocHtml = function (o) { arg = o; const h = real.call(this, o); html = h; return h; };
    const btn = document.querySelector("[data-plat-reprint]");
    if (!btn) { LFH_BILLDOC.kotDocHtml = real; return null; }
    btn.click(); await new Promise((r) => setTimeout(r, 80));
    const first = { html, arg };
    html = null; arg = null;
    btn.click(); await new Promise((r) => setTimeout(r, 80));
    const second = { html, arg };
    LFH_BILLDOC.kotDocHtml = real;
    const p = (state.platform || [])[0] || {};
    return { first, second, row: { source: p.source, kot_no: p.kot_no, customer: p.customer_name, items: (p.items || []).length } };
  });
  if (!paper) {
    for (let i = 0; i < 8; i++) rec(next(), "the delivery slip's paper (no delivery ticket on the board to print)", "⏭ no platform ticket on this restaurant's board — re-run where one exists");
  } else {
    const h1 = paper.first.html || "", a1 = paper.first.arg || {}, h2 = paper.second.html || "";
    rec(next(), "a delivery slip is built by the ONE shared print document, not by the panel",
      /KITCHEN TICKET/.test(h1) && /<!doctype html>/i.test(h1) ? true : "the paper was not produced by kotDocHtml");
    rec(next(), "the slip's table slot carries the CHANNEL and the customer, not \"T?\"",
      /PARCEL|ZOMATO|SWIGGY|WEBSITE|PLATFORM/.test(String(a1.tableLabel)) && !/T\?/.test(String(a1.tableLabel))
        ? true : `tableLabel = "${a1.tableLabel}"`, `"${a1.tableLabel}"`);
    rec(next(), "the slip carries the delivery ticket's own KOT number",
      String(a1.kot) === String(paper.row.kot_no) ? true : `paper says ${a1.kot}, the row says ${paper.row.kot_no}`, `KOT #${a1.kot}`);
    rec(next(), "the slip names the restaurant, never a hard-coded brand",
      a1.rname && !/French House|Aangan/.test(String(a1.rname)) ? true : `rname = "${a1.rname}"`, `"${a1.rname}"`);
    rec(next(), "the slip carries every dish the ticket has",
      (a1.lines || []).length === paper.row.items ? true : `${(a1.lines||[]).length} lines for ${paper.row.items} dishes`, `${(a1.lines||[]).length} line(s)`);
    rec(next(), "the slip carries NO prices — a kitchen slip is not a bill",
      !/₹|\bTotal\b|\bSubtotal\b|\bTax\b/.test(h1) ? true : "a money word reached the paper");
    rec(next(), "the FIRST print of a delivery slip is not branded a duplicate",
      a1.reprint === false && !/Reprint · Duplicate/.test(h1) ? true : `reprint=${a1.reprint}, band present=${/Reprint · Duplicate/.test(h1)}`);
    rec(next(), "the SECOND print of the same delivery slip IS branded a duplicate",
      /Reprint · Duplicate/.test(h2) ? true : "the duplicate band is missing from the second sheet");
  }

  await browser.close();
  const bad = results.filter((r) => !r.ok);
  console.log("\nROUND 2 · C — EVERY OVERLAY, EVERY WIDTH, BOTH SKINS — " + BASE);
  console.log(`  ${results.length - bad.length} passed · ${bad.length} failed  (of ${results.length})`);
  for (const r of results) if (!r.ok) console.log(`  ✗ ${r.id}  ${r.label}\n      → ${r.note}`);
  if (process.argv.includes("--ledger")) for (const r of results)
    console.log(`| ${r.id} | ${r.label.replace(/\|/g,"\\|")} | \`node scripts/sweep/t9/${FILE}.mjs --base=<url>\` (driven) | ${r.ok ? "✅" : "❌"} | ${(r.note||"").replace(/\|/g,"\\|").replace(/\n/g," ").slice(0,160)} |`);
  console.log(`  (ids ${results[0].id} … ${results[results.length-1].id})`);
  process.exit(bad.length ? 1 : 0);
}
main().catch((e) => { console.error("round2-overlays threw:", e); process.exit(2); });
