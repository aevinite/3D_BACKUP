// sweep-site.mjs — "does every screen actually work?" across the whole app.
//
//   node scripts/sweep-site.mjs [--base https://3-d-backup.vercel.app]
//
// READ-ONLY: it opens every surface and every manager/owner tab, and reports anything that
// renders EMPTY when it shouldn't, or logs a real error. It places no orders and changes no
// data, so it is safe to run against a live site.
//
// Why a script and not a one-off: "check everything works" is asked repeatedly, and doing it
// by hand misses tabs. This is the checklist.
import { chromium } from "playwright";
import { loginAs } from "./sweep/login.mjs";

const args = process.argv.slice(2);
const BASE = (args.includes("--base") ? args[args.indexOf("--base") + 1] : "") || "https://3-d-backup.vercel.app";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Noise that says nothing about whether the app works.
const NOISE = /Failed to load resource|net::ERR|DevTools|GoTrueClient|favicon|sentry\.io|Download the React|status of 4(0|1|3)|preload|model/i;

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m, extra) => { fail++; console.log(`  ❌ ${m}${extra ? `\n       ${extra}` : ""}`); };

// Run a function inside the staff panel's iframe (its state/api are top-level consts).
const inPanel = (page, fn, arg) => page.evaluate(
  ({ src, arg }) => {
    const f = document.querySelector("iframe");
    const w = f && f.contentWindow;
    if (!w) return { __err: "no panel iframe" };
    try { return new w.Function("arg", `return (${src})(arg)`)(arg); } catch (e) { return { __err: String((e && e.message) || e) }; }
  },
  { src: fn.toString(), arg },
);
async function waitFor(fn, ms = 30000, step = 500) {
  const until = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > until) return null; await sleep(step); }
}

async function run() {
  const browser = await chromium.launch();
  try {
    // ── GUEST MENU ────────────────────────────────────────────────────────────
    console.log("\n1) Guest menu");
    {
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      const errs = [];
      p.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errs.push(m.text().slice(0, 110)); });
      p.on("pageerror", (e) => { if (!NOISE.test(String(e.message))) errs.push("PAGE ERROR: " + String(e.message).slice(0, 110)); });
      await p.goto(`${BASE}/r/french-house/menu`, { waitUntil: "domcontentloaded" });
      const dishes = await waitFor(async () => { const n = await p.locator(".item-card:not(.skeleton-card)").count(); return n > 0 ? n : null; }, 40000);
      dishes ? ok(`${dishes} dishes listed`) : bad("the menu lists no dishes");
      const cats = await p.locator(".cat-card, .cat-scroller button, .cat-chip").count().catch(() => 0);
      cats > 0 ? ok(`${cats} categories`) : bad("no categories rendered");
      // open a dish
      await p.locator(".item-card:not(.skeleton-card)").first().click().catch(() => {});
      await sleep(2500);
      const opened = /\/item\//.test(p.url()) || (await p.locator(".sheet, .modal, .item-detail").count()) > 0;
      opened ? ok("a dish opens") : bad("clicking a dish did nothing", p.url());
      errs.length === 0 ? ok("no console errors") : bad(`${errs.length} console error(s)`, errs.slice(0, 3).join("\n       "));
      await ctx.close();
    }

    // ── STAFF PANELS ──────────────────────────────────────────────────────────
    for (const [role, label, ready] of [
      ["tablet", "Waiter panel", () => Object.keys((typeof state !== "undefined" && (state.summary || {}).tiles) || {}).length],
      ["kitchen", "Kitchen screen", () => (typeof state !== "undefined" && (state.dishes || []).length) || 0],
      ["manager", "Manager panel", () => (typeof state !== "undefined" && state.data && (state.data.items || []).length) || 0],
    ]) {
      console.log(`\n${label}`);
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
      const errs = [];
      const route = await loginAs(ctx, role, BASE);
      const p = await ctx.newPage();
      p.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errs.push(m.text().slice(0, 110)); });
      p.on("pageerror", (e) => { if (!NOISE.test(String(e.message))) errs.push("PAGE ERROR: " + String(e.message).slice(0, 110)); });
      await p.goto(BASE + route, { waitUntil: "domcontentloaded" });
      const n = await waitFor(async () => { const v = await inPanel(p, ready); return typeof v === "number" && v > 0 ? v : null; }, 45000);
      n ? ok(`loads with real data (${n})`) : bad("loaded EMPTY");

      if (role === "manager") {
        // Every tab must render something. A blank tab is the classic silent breakage.
        const tabs = await inPanel(p, () => [...document.querySelectorAll(".tab[data-tab]")].map((b) => b.dataset.tab));
        if (!Array.isArray(tabs) || !tabs.length) bad("no manager tabs found");
        else {
          ok(`${tabs.length} tabs found: ${tabs.join(", ")}`);
          for (const tab of tabs) {
            const before = errs.length;
            await inPanel(p, (t) => { const b = document.querySelector(`.tab[data-tab="${t}"]`); if (b) b.click(); return !!b; }, tab);
            await sleep(2600);
            const body = await inPanel(p, () => {
              const main = document.querySelector(".ed-main, .editor, .layout") || document.body;
              return { len: (main.innerText || "").trim().length, err: /couldn't load|could not load|failed/i.test(main.innerText || "") };
            });
            const newErrs = errs.length - before;
            if (!body || body.__err) bad(`tab "${tab}" could not be read`, body && body.__err);
            else if (body.len < 40) bad(`tab "${tab}" renders essentially EMPTY (${body.len} chars)`);
            else if (body.err) bad(`tab "${tab}" shows a load error on screen`);
            else if (newErrs > 0) bad(`tab "${tab}" logged ${newErrs} console error(s)`, errs.slice(-newErrs).join("\n       "));
            else ok(`tab "${tab}" renders`);
          }
        }
      }
      if (role === "tablet") {
        const tile = await inPanel(p, () => { const t = document.querySelector(".tile[data-t]"); if (t) t.click(); return t ? t.dataset.t : null; });
        await sleep(2500);
        const detail = await inPanel(p, () => !!document.querySelector(".detail-pop"));
        detail === true ? ok(`table ${tile} opens its detail`) : bad("tapping a table opened nothing");
      }
      errs.length === 0 ? ok("no console errors") : bad(`${errs.length} console error(s)`, [...new Set(errs)].slice(0, 3).join("\n       "));
      await ctx.close();
    }

    // ── OWNER + ADMIN PAGES ───────────────────────────────────────────────────
    for (const [role, pages] of [["owner", ["/owner", "/owner/reports", "/owner/menu", "/owner/staff", "/owner/settings"]]]) {
      console.log(`\n${role} pages`);
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
      await loginAs(ctx, role, BASE);
      for (const path of pages) {
        const p = await ctx.newPage();
        const errs = [];
        p.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errs.push(m.text().slice(0, 110)); });
        p.on("pageerror", (e) => { if (!NOISE.test(String(e.message))) errs.push("PAGE ERROR: " + String(e.message).slice(0, 110)); });
        const resp = await p.goto(BASE + path, { waitUntil: "domcontentloaded" }).catch(() => null);
        await sleep(6000);
        const txt = ((await p.locator("body").innerText().catch(() => "")) || "").trim();
        const status = resp ? resp.status() : "?";
        if (status >= 400) bad(`${path} → HTTP ${status}`);
        else if (txt.length < 60) bad(`${path} renders essentially EMPTY (${txt.length} chars)`);
        else if (errs.length) bad(`${path} logged ${errs.length} error(s)`, [...new Set(errs)].slice(0, 2).join("\n       "));
        else ok(`${path} renders (${txt.length} chars)`);
        await p.close();
      }
      await ctx.close();
    }
  } catch (e) {
    bad("the sweep stopped early", (e && (e.stack || e.message)) || String(e));
  } finally {
    console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed\n`);
    await browser.close();
    process.exit(fail === 0 ? 0 : 1);
  }
}
run();
