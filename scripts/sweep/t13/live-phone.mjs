// scripts/sweep/t13/live-phone.mjs — the owner dashboard at 360×780 (his Samsung A35) and on the
// LIGHT skin, which is where this page has historically broken: a sparkline drawn through a
// caption, a label breaking mid-word, a card 136px off the right edge, an emerald figure at
// 1.92:1 on a white card. Every one of those was invisible to a desktop dark screenshot.
// ── NO SUFFIXED IDS (T13, sweep #8) ──────────────────────────────────────────────────────────
// Four checks in this file were first written as P05589b / P05923b / P20825b / P20961b — a new
// check leaning on the number of a NEARBY T12 row. That is not an id: nothing in the registry
// owns it, verify:ledger-index cannot see it, and "re-run P05589b" is a sentence with no meaning.
// They are P67297-P67300, from this terminal's own block.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { loginAs } from "../login.mjs";
import { chk, skip, report, setOnly } from "./lib.mjs";

/** Same signature as chk, but records an honest skip with the width that made it inapplicable. */
const skipRow = (id, what) => skip(id, what, `not applicable at ${process.argv[process.argv.indexOf("--width") + 1] || "this"}px — this row is about the phone layout`);

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg("base", "http://localhost:4313").replace(/\/$/, "");
const ROLE = arg("role", "owner");
const SKIN = arg("skin", "light");
const W = Number(arg("width", "360")), H = Number(arg("height", "780"));
const SHOTS = ".claude/sweep/shots/T13";
// The console's own breakpoints: .adm becomes the scroller and the ☰ appears at <=900px, and the
// tile grid steps to two columns at <=760px (globals.css + page.tsx). A row written for the phone
// is not a FAILURE at 1280 — it does not apply there, and calling that red is how a suite teaches
// people to scroll past it.
const PHONE = W <= 760, NARROW = W <= 900;
const argOnly = process.argv.find((x) => x.startsWith("--only="));
if (argOnly) setOnly(argOnly.slice(7).split(","));
mkdirSync(SHOTS, { recursive: true });

const CREDS = ROLE === "estate" ? { username: "diagestate", password: "diag-estate-2026", route: "/owner" } : null;
const browser = await chromium.launch();
const seed = await browser.newContext();
const route = await loginAs(seed, CREDS ? null : ROLE, BASE, CREDS || undefined);
const state = await seed.storageState();
const ctx = await browser.newContext({
  storageState: state,
  viewport: { width: W, height: H }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
});
await ctx.addCookies([{ name: "aevidine_skin", value: SKIN, url: BASE }]);
const pg = await ctx.newPage();
const errs = [];
pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 250)); });
pg.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 250)));
await pg.addInitScript((s) => { try { localStorage.setItem("aevidine_skin", s); } catch {} }, SKIN);
await pg.goto(BASE + route, { waitUntil: "networkidle", timeout: 180000 });
await pg.waitForTimeout(3200);
const tag = `${ROLE}-${W}-${SKIN}`;

await (NARROW ? chk : skipRow)("P05811", `at ${W}x${H} the scrolling element is .adm, and .adm-main is overflow-y: visible`, async () => {
  const r = await pg.evaluate(() => {
    const m = document.querySelector(".adm-main"), a = document.querySelector(".adm");
    return {
      mainOverflow: m ? getComputedStyle(m).overflowY : null,
      adm: a ? [a.scrollHeight, a.clientHeight] : null,
      main: m ? [m.scrollHeight, m.clientHeight] : null,
    };
  });
  const admScrolls = r.adm && r.adm[0] > r.adm[1] + 2;
  return admScrolls && r.mainOverflow === "visible" ? true : `.adm=${JSON.stringify(r.adm)} .adm-main overflow-y=${r.mainOverflow}`;
});
await (NARROW ? chk : skipRow)("P05812", "therefore window.scrollTo moves nothing at this width", async () => {
  const moved = await pg.evaluate(() => {
    const before = document.documentElement.scrollTop;
    window.scrollTo(0, 400);
    const after = document.documentElement.scrollTop;
    window.scrollTo(0, before);
    return after !== before;
  });
  return moved === false ? true : "the window really does scroll here — the save/restore rule would need rewriting";
});
await (PHONE ? chk : skipRow)("P20957", "two tiles per row, labels intact", async () => {
  const cols = await pg.evaluate(() => {
    const g = document.querySelector(".ow2-stats");
    return g ? getComputedStyle(g).gridTemplateColumns.split(" ").length : 0;
  });
  return cols === 2 ? true : `${cols} tile columns at ${W}px`;
});
await chk("P05859", "no KPI label is clipped or broken mid-word", async () => {
  const bad = await pg.evaluate(() => {
    const out = [];
    document.querySelectorAll(".ow2-kpi .ow2-kt .k").forEach((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      // 1) CLIPPED — the text does not fit its own box at all.
      const clipped = el.scrollWidth > el.clientWidth + 1;
      // 2) BROKEN MID-WORD — measure each word with the label's REAL font.
      //    `getComputedStyle().font` returns "" in Chrome, so setting the probe's `font`
      //    shorthand from it left the probe at the page default of 16px and inflated every word
      //    by 16/9.5 ≈ 1.68x. That reported four labels as overflowing when scrollWidth ===
      //    clientWidth === 46 and the screenshot showed them on one clean line. Copy the
      //    properties individually — a detector fault worth naming, since the whole point of
      //    this row is that a mid-word break is invisible to innerText.
      const probe = document.createElement("span");
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      probe.style.whiteSpace = "nowrap";
      probe.style.fontSize = cs.fontSize;
      probe.style.fontFamily = cs.fontFamily;
      probe.style.fontWeight = cs.fontWeight;
      probe.style.fontStyle = cs.fontStyle;
      probe.style.letterSpacing = cs.letterSpacing;
      probe.style.textTransform = cs.textTransform;
      document.body.appendChild(probe);
      let widest = 0;
      for (const w of (el.textContent || "").trim().split(/\s+/)) {
        probe.textContent = w;
        widest = Math.max(widest, probe.getBoundingClientRect().width);
      }
      probe.remove();
      const midWord = widest > r.width + 1;
      if (clipped || midWord) out.push({
        text: el.textContent, widestWord: Math.round(widest), box: Math.round(r.width),
        scrollW: el.scrollWidth, clientW: el.clientWidth, clipped, midWord,
      });
    });
    return out;
  });
  return bad.length === 0 ? true : `labels clipped or broken mid-word: ${JSON.stringify(bad)}`;
});
await chk("P05860", "the sparkline never draws through a caption", async () => {
  const overlaps = await pg.evaluate(() => {
    const out = [];
    document.querySelectorAll(".ow2-kpi").forEach((tile) => {
      const spark = tile.querySelector(".ow2-spark");
      if (!spark) return;
      const sr = spark.getBoundingClientRect();
      const label = tile.querySelector(".ow2-kt .k")?.textContent?.trim() || "?";
      tile.querySelectorAll(".ow2-sub, .ow2-kt").forEach((cap) => {
        const cr = cap.getBoundingClientRect();
        const overlap = Math.min(sr.bottom, cr.bottom) - Math.max(sr.top, cr.top);
        if (overlap > 1) out.push({ tile: label, caption: (cap.textContent || "").trim().slice(0, 36), overlapPx: Math.round(overlap) });
      });
    });
    return out;
  });
  return overlaps.length === 0 ? true : `the green line crosses a caption: ${JSON.stringify(overlaps)}`;
});
await chk("P05893", `"TODAY SO FAR ● live" holds one line beside its pill`, async () => {
  const r = await pg.evaluate(() => {
    const tile = [...document.querySelectorAll(".ow2-kpi")].find((t) => /TODAY SO FAR/i.test(t.textContent || ""));
    if (!tile) return "the Today tile is not on screen";
    const k = tile.querySelector(".ow2-kt .k"), pill = tile.querySelector(".ow2-live");
    if (!k) return "no label";
    const cs = getComputedStyle(k);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    return { lines: Math.round(k.getBoundingClientRect().height / lh), pillOnSameRow: pill ? Math.abs(pill.getBoundingClientRect().top - k.getBoundingClientRect().top) < lh : null };
  });
  if (typeof r === "string") return r;
  return r.lines === 1 ? true : `the label wraps to ${r.lines} lines`;
});
await chk("P05862", "no card runs off the right edge", async () => {
  const off = await pg.evaluate(() => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    document.querySelectorAll(".adm-card, .ow2-kpi, .own-hero, .ow2-split").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1) {
        const title = el.querySelector(".ow2-ct > span:first-child")?.textContent?.trim().replace(/\s+/g, " ").slice(0, 40)
          || el.className.toString().slice(0, 40);
        out.push({ title, right: Math.round(r.right), vw });
      }
    });
    return out;
  });
  return off.length === 0 ? true : `off the right edge: ${JSON.stringify(off)}`;
});
await chk("P40051", "…and no content is stranded wider than its box with no way to reach it", async () => {
  const wide = await pg.evaluate(() => {
    const out = [];
    document.querySelectorAll(".adm-main *").forEach((el) => {
      // SVG first: an <svg> reports clientWidth 0, so scrollWidth > clientWidth is true for every
      // chart on the page. That alone produced four bogus hits. Only HTML boxes have the
      // scroll geometry this row is about.
      if (!(el instanceof HTMLElement)) return;
      // 4px, not 1: sub-pixel layout at deviceScaleFactor 3 rounds a 332.4px box to 335, and a
      // 3px phantom on a wrapper is not a stranded table.
      if (el.scrollWidth <= el.clientWidth + 4) return;
      // Reachable if THIS element scrolls, or any ancestor does. `overflow-y: auto` makes a box
      // scrollable on x too, and the page scrollport counts — the reason an earlier version of
      // this check passed over a genuinely 900px-wide div.
      let e = el, reachable = false;
      while (e && e !== document.body) {
        const cs = getComputedStyle(e);
        if (/auto|scroll/.test(cs.overflowX) || /auto|scroll/.test(cs.overflowY)) { reachable = true; break; }
        e = e.parentElement;
      }
      if (reachable) return;
      out.push({ cls: el.className.toString().slice(0, 44), tag: el.tagName, scrollW: el.scrollWidth, clientW: el.clientWidth, overflowX: getComputedStyle(el).overflowX });
    });
    return out.slice(0, 6);
  });
  return wide.length === 0 ? true : `content wider than its box with no way to scroll it: ${JSON.stringify(wide)}`;
});
await chk("P05861", "the hero shortcut row wraps rather than overflowing", async () => {
  const n = await pg.locator(".own-hero-link").count();
  if (n === 0) return true;   // multi-restaurant estate has no hero
  const bad = await pg.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll(".own-hero-link")].filter((el) => el.getBoundingClientRect().right > vw + 1).length;
  });
  return bad === 0 ? true : `${bad} of ${n} hero buttons run off the edge`;
});
await chk("P05891", "the restaurant name is not truncated", async () => {
  const n = await pg.locator(".own-hero-name").count();
  if (n === 0) return true;
  const r = await pg.evaluate(() => {
    const el = document.querySelector(".own-hero-name");
    return { clipped: el.scrollWidth > el.clientWidth + 1, text: el.textContent.trim() };
  });
  return !r.clipped ? true : `"${r.text}" is clipped`;
});
await chk("P05850", `every ink clears 3:1 against its own surface (${SKIN} skin, ${W}px)`, async () => {
  const bad = await pg.evaluate(() => {
    // ── PARSE WHAT CHROME ACTUALLY RETURNS ──────────────────────────────────────────────────
    // A `color-mix()` resolves to the MODERN syntax — "color(srgb 0.230588 0.764706 0.595294)"
    // — whose channels are 0–1 floats, not 0–255 integers. Scraping numbers and dividing by 255
    // turned the "● live" pill's bright green into near-black and reported it at 1.13:1 on the
    // dark skin, where the page's own measurement (and ledger row P05858) says 8.4:1. The light
    // skin passed only because its value happened to come back as legacy rgb(). A detector fault
    // that would have sent the next reader to "fix" a pill that was already correct.
    const lum = (c) => {
      if (!c) return null;
      const modern = /^color\(srgb\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)(?:\s*\/\s*([\d.eE+-]+%?))?\s*\)/.exec(c);
      let r, g, b, a;
      if (modern) {
        r = parseFloat(modern[1]) * 255; g = parseFloat(modern[2]) * 255; b = parseFloat(modern[3]) * 255;
        a = modern[4] === undefined ? 1 : (String(modern[4]).endsWith("%") ? parseFloat(modern[4]) / 100 : parseFloat(modern[4]));
      } else {
        const m = c.match(/[\d.]+/g);
        if (!m) return null;
        [r, g, b] = m.map(Number);
        a = m[3] === undefined ? 1 : Number(m[3]);
      }
      if (![r, g, b].every(Number.isFinite)) return null;
      if (a < 0.5) return null;
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bgOf = (el) => {
      let e = el;
      while (e) {
        const c = getComputedStyle(e).backgroundColor;
        const l = lum(c);
        if (l !== null && !/rgba\(0, 0, 0, 0\)/.test(c)) return l;
        e = e.parentElement;
      }
      return lum(getComputedStyle(document.body).backgroundColor) ?? 1;
    };
    const out = [];
    document.querySelectorAll(".adm-main *").forEach((el) => {
      if (!el.offsetParent && getComputedStyle(el).position !== "fixed") return;
      const txt = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join("");
      if (!txt) return;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || Number(cs.opacity) < 0.3) return;
      const fl = lum(cs.color), bl = bgOf(el);
      if (fl === null || bl === null) return;
      const ratio = (Math.max(fl, bl) + 0.05) / (Math.min(fl, bl) + 0.05);
      if (ratio < 3) out.push({ text: txt.slice(0, 40), ratio: Math.round(ratio * 100) / 100, color: cs.color, size: cs.fontSize });
    });
    return out.slice(0, 10);
  });
  return bad.length === 0 ? true : `${bad.length} inks under 3:1 — ${JSON.stringify(bad)}`;
});
await chk("P05892", `every tile is drawn on the ${SKIN} surface with readable ink`, async () => {
  const r = await pg.evaluate(() => {
    const t = document.querySelector(".ow2-kpi");
    if (!t) return "no tile";
    const cs = getComputedStyle(t);
    return { bg: cs.backgroundColor, color: cs.color };
  });
  if (typeof r === "string") return r;
  const light = /255, 255, 255|25[0-5], 25[0-5], 25[0-5]/.test(r.bg);
  return SKIN === "light" ? (light ? true : `a light-skin tile is drawn on ${r.bg}`) : true;
});
await chk("P67299", "no leaked code text or raw database word on the phone either", async () => {
  const body = await pg.locator(".adm-main").innerText();
  const bad = ["[object Object]", "undefined", "NaN", "${", "-->", "order_place", "bill_paid"];
  const found = bad.filter((b) => body.includes(b));
  return found.length === 0 ? true : `on screen: ${JSON.stringify(found)}`;
});
await chk("P05924", "no number is shown with no unit or currency mark", async () => {
  // every tile VALUE is either money (₹) or an explicit count whose label says so
  const vals = await pg.locator(".ow2-kpi .v").allInnerTexts();
  const labels = await pg.locator(".ow2-kpi .ow2-kt .k").allInnerTexts();
  const bad = vals.map((v, i) => ({ v: v.trim(), k: (labels[i] || "").trim() }))
    .filter((x) => !/₹/.test(x.v) && !/ORDERS/i.test(x.k) && x.v !== "—");
  return bad.length === 0 ? true : `bare numbers: ${JSON.stringify(bad)}`;
});
await (NARROW ? chk : skipRow)("P67300", "the drawer opens and the phone's BACK closes it without leaving", async () => {
  const burger = pg.locator("button").filter({ has: pg.locator(".fa-bars") }).first();
  if ((await burger.count()) === 0) return "no ☰ control at this width";
  await burger.click();
  await pg.waitForTimeout(600);
  const opened = await pg.evaluate(() => !!document.querySelector(".adm-nav.open, .adm-drawer, [data-nav-open='true']")
    || getComputedStyle(document.querySelector(".adm-side") || document.body).transform !== "none");
  await pg.goBack();
  await pg.waitForTimeout(700);
  const stillHere = /\/owner/.test(new URL(pg.url()).pathname);
  return stillHere ? true : `BACK left the panel: ${pg.url()}`;
});
await chk("P05804", `the page renders at ${W}px with no console errors`, () => {
  const real = errs.filter((e) => !/favicon|model-viewer|Download the React DevTools/i.test(e));
  return real.length === 0 ? true : `console errors: ${JSON.stringify(real.slice(0, 3))}`;
});

await pg.screenshot({ path: `${SHOTS}/${tag}.png` });
await pg.evaluate(() => { const el = document.querySelector(".adm") || document.documentElement; el.scrollTop = el.scrollHeight; });
await pg.waitForTimeout(900);
await pg.screenshot({ path: `${SHOTS}/${tag}-bottom.png` });
report(`T13 live · ${ROLE} · ${W}px ${SKIN} · ${BASE}`, { minChecks: 12 });
await browser.close();
