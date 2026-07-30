// verify-no-fatal-ui.mjs — the "fatal mistake" detector, run against a LIVE site.
//
//   node scripts/verify-no-fatal-ui.mjs --base https://3-d-backup.vercel.app
//
// WHY THIS EXISTS. Two faults reached the owner's screen today that every other check missed,
// and they were the SAME KIND of fault twice:
//
//   1. A script tag got inserted inside an HTML comment, so the manager's top bar DISPLAYED
//      "…without it the pill was inserted at the far LEFT of the topbar. -->" to every user.
//      Source-level checks and an offline test suite were both blind to it, because the source
//      was valid and the data was fine — only the RENDERED TEXT was wrong.
//   2. An orange "Connection is struggling" bar sat directly above the panel's own green "Live"
//      badge. Nothing was broken; the UI simply contradicted itself.
//
// So this checks the one thing those had in common: what a person actually SEES, on the site
// that is actually deployed. It is read-only — it signs in, looks, and leaves.
//
// What it refuses to accept:
//   · leaked code in visible text  ("-->", "${", "[object Object]", "undefined", "NaN")
//   · two bits of UI contradicting each other about the connection
//   · a screen that renders empty
//   · console / page errors
import { chromium } from "playwright";
import { loginAs } from "./sweep/login.mjs";

const args = process.argv.slice(2);
const BASE = (args.includes("--base") ? args[args.indexOf("--base") + 1] : "") || "https://3-d-backup.vercel.app";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOISE = /Failed to load resource|net::ERR|DevTools|GoTrueClient|favicon|sentry\.io|Download the React|status of 4(0|1|3)|preload|model/i;

// Text that should NEVER be visible to a human. Each one is a real failure mode, not a style.
const LEAKS = [
  { re: /--&gt;|-->/, what: "an HTML comment terminator — a tag was inserted inside a comment" },
  { re: /\$\{[a-zA-Z_$]/, what: "an un-evaluated template placeholder" },
  { re: /\[object Object\]/, what: "an object printed instead of its value" },
  { re: /\bundefined\b/, what: '"undefined" printed as text' },
  { re: /\bNaN\b/, what: '"NaN" printed as text — a number that never got computed' },
  { re: /<\/?(div|span|button|script)\b/i, what: "raw HTML shown as text" },
];

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m, extra) => { fail++; console.log(`  ❌ ${m}${extra ? `\n       ${extra}` : ""}`); };

const inPanel = (page, fn) => page.evaluate((src) => {
  const f = document.querySelector("iframe"); const w = f && f.contentWindow;
  if (!w) return { __err: "no panel iframe" };
  try { return new w.Function(`return (${src})()`)(); } catch (e) { return { __err: String((e && e.message) || e) }; }
}, fn.toString());

async function waitFor(fn, ms = 40000, step = 500) {
  const until = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > until) return null; await sleep(step); }
}

// The heart of it: look at VISIBLE text and refuse anything that shouldn't be readable.
function scanText(label, text) {
  const t = String(text || "");
  let clean = true;
  for (const l of LEAKS) {
    const m = t.match(l.re);
    if (!m) continue;
    clean = false;
    const at = Math.max(0, t.indexOf(m[0]) - 50);
    bad(`${label}: ${l.what}`, `…${t.slice(at, at + 130).replace(/\s+/g, " ")}…`);
  }
  if (clean) ok(`${label}: nothing leaked into what people see`);
}

async function run() {
  console.log(`\nFATAL-UI CHECK — ${BASE}\n`);
  const browser = await chromium.launch();
  try {
    // ── the three staff panels: rendered text + no self-contradiction ─────────
    for (const [role, label] of [["manager", "Manager panel"], ["tablet", "Waiter panel"], ["kitchen", "Kitchen screen"]]) {
      console.log(`${label}`);
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
      const errs = [];
      const route = await loginAs(ctx, role, BASE);
      const p = await ctx.newPage();
      p.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errs.push(m.text().slice(0, 120)); });
      p.on("pageerror", (e) => { if (!NOISE.test(String(e.message))) errs.push("PAGE ERROR: " + String(e.message).slice(0, 120)); });
      await p.goto(BASE + route, { waitUntil: "domcontentloaded" });
      const up = await waitFor(async () => { const v = await inPanel(p, () => !!document.querySelector(".topbar")); return v === true ? true : null; });
      if (!up) { bad(`${label}: never rendered`); await ctx.close(); continue; }
      await sleep(5000);

      // The header is where the comment leak surfaced, so check it on its own AND the whole page.
      const seen = await inPanel(p, () => {
        const top = document.querySelector(".topbar");
        return {
          header: top ? top.innerText : "",
          body: document.body.innerText.slice(0, 6000),
          bar: (function () { const b = document.querySelector("#lfhOffBar"); return b ? b.innerText.replace(/\n/g, " | ") : ""; })(),
          badge: (function () { const b = document.querySelector("#lfhConnBadge"); return b ? b.innerText.replace(/\n/g, " ") : ""; })(),
          rt: (window.LFH_RT && window.LFH_RT.getStatus) ? window.LFH_RT.getStatus() : "?",
        };
      });
      if (!seen || seen.__err) { bad(`${label}: could not read the screen`, seen && seen.__err); await ctx.close(); continue; }
      scanText(`${label} top bar`, seen.header);
      scanText(`${label} whole screen`, seen.body);

      // NO SELF-CONTRADICTION: an alarm bar while the badge says live is the fault the owner
      // photographed. Either both agree it's bad, or the bar stays away.
      const alarmed = /struggling|no internet/i.test(seen.bar);
      const badgeLive = /live|\d+\s*ms/i.test(seen.badge);
      if (alarmed && (badgeLive || seen.rt === "online")) {
        bad(`${label}: the UI contradicts itself`, `bar: "${seen.bar}" | badge: "${seen.badge}" | realtime: ${seen.rt}`);
      } else {
        ok(`${label}: connection UI agrees with itself (badge "${(seen.badge || "").trim().slice(0, 22)}", bar ${seen.bar ? `"${seen.bar.slice(0, 30)}"` : "none"})`);
      }
      errs.length === 0 ? ok(`${label}: no console errors`) : bad(`${label}: ${errs.length} console error(s)`, [...new Set(errs)].slice(0, 3).join("\n       "));
      await ctx.close();
    }

    // ── guest menu + owner pages: rendered text only ──────────────────────────
    for (const [label, path, needLogin] of [
      ["Guest menu", "/r/french-house/menu", null],
      ["Owner dashboard", "/owner", "owner"],
      ["Owner reports", "/owner/reports", "owner"],
    ]) {
      console.log(`${label}`);
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
      if (needLogin) await loginAs(ctx, needLogin, BASE);
      const p = await ctx.newPage();
      const errs = [];
      p.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errs.push(m.text().slice(0, 120)); });
      p.on("pageerror", (e) => { if (!NOISE.test(String(e.message))) errs.push("PAGE ERROR: " + String(e.message).slice(0, 120)); });
      await p.goto(BASE + path, { waitUntil: "domcontentloaded" });
      await sleep(7000);
      const txt = ((await p.locator("body").innerText().catch(() => "")) || "");
      txt.trim().length > 60 ? ok(`${label}: renders (${txt.length} chars)`) : bad(`${label}: renders essentially EMPTY`);
      scanText(label, txt.slice(0, 6000));
      errs.length === 0 ? ok(`${label}: no console errors`) : bad(`${label}: ${errs.length} console error(s)`, [...new Set(errs)].slice(0, 2).join("\n       "));
      await ctx.close();
    }
  } catch (e) {
    bad("the check stopped early", (e && (e.stack || e.message)) || String(e));
  } finally {
    console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed\n`);
    await browser.close();
    process.exit(fail === 0 ? 0 : 1);
  }
}
run();
