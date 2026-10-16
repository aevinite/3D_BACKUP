// Family E — THE LAYOUT GRID. Every shared pop-up, and a top bar crowded with everything the helpers
// put into it, inside each panel's REAL stylesheet (manager, waiter tablet, kitchen), at four widths
// (320 small phone · 390 phone · 768 tablet · 1280 desktop) and in both skins. Judged on:
//   1. the page never scrolls sideways (the commonest way a phone layout breaks);
//   2. nothing the helper built hangs off the screen (unless it sits inside its own scrolling strip);
//   3. every piece of text can be read on what is actually behind it — WCAG contrast 4.5:1 (3:1 for
//      large text), computed from the painted colours, walking up to the first solid background;
//      a gradient or picture behind the text is reported as "not judged", never passed by guessing.
import { C, ok } from "./lib.mjs";
import { page, open, setApi, sleep } from "./server.mjs";
import { W, TOP, api } from "./fd-access.mjs";

const PANELS = {
  manager: { css: ["/panels/vendor/fa/css/all.min.css", "/panels/editor/style.css"], kitchen: false },
  tablet: { css: ["/panels/tablet/style.css"], kitchen: false },
  kitchen: { css: ["/panels/kitchen/style.css"], kitchen: true },
};
// What each panel really carries (kitchen: no profile, no guest bell — R7 and the bell's own rule).
const ON = { "the undo card": ["manager", "tablet", "kitchen"], "the offline details sheet": ["manager", "tablet", "kitchen"], "the Connection panel": ["manager", "tablet", "kitchen"],
  "the guest-requests sheet": ["manager", "tablet"], "Report an issue": ["manager", "tablet", "kitchen"], "My profile & pay": ["manager", "tablet"], "the Settings drawer": ["manager", "tablet"] };
const TOPBAR = { name: "the top bar with every helper in it", scripts: ["backstack.js", "theme.js", "connbadge.js", "offline.js", "guestbell.js", "maint.js"], sel: ".topbar",
  open: () => { window.__on = false; window.dispatchEvent(new Event("offline")); window.LFH_BELL.sync({ menuOn: true, rows: [{ id: "a", kind: "call", table: "4", at: Date.now(), label: "Table 4 calls a waiter" }] }); } };
const WIDTHS = [320, 390, 768, 1280];
// THE TEXT THAT IS ALREADY UNDER THE STANDARD, AND IS WAITING ON THE OWNER (round-3 decision 28).
// Measured 2026-10-16. Most of it is the GOLD house colour (R13: "should be this colour only like
// golden") or a deliberately faded grey/green, so changing it is his call, not a guard's. Until he
// decides, each may not get any WORSE than measured here, and any text NOT on this list that falls
// under 4.5:1 (3:1 large) fails at once — a ratchet, so the list can only shrink.
const KNOWN = { "Undo": 2.23, "✓ Everything has been": 3.03, "✓ Everything is synced": 4.21, "just now": 3.98, "Send": 2.23, "Change password": 3.68, "Change PIN": 4.23, "Offline": 3.93 };

const JUDGE = (sel) => {
  const root = document.querySelector(sel.split(",").map((s) => s.trim()).find((s) => document.querySelector(s)) || "#__none");
  if (!root) return { missing: true };
  const vw = document.documentElement.clientWidth;
  const sideways = document.documentElement.scrollWidth > vw + 1;
  const vis = (e) => { const b = e.getBoundingClientRect(), cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity !== 0; };
  const all = [root, ...root.querySelectorAll("*")].filter(vis);
  const inScroller = (e) => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const ox = getComputedStyle(a).overflowX; if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") return a !== document.documentElement; } return false; };
  const off = all.filter((e) => { const b = e.getBoundingClientRect(); return (b.right > vw + 1 || b.left < -1) && !inScroller(e); }).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]} ${Math.round(e.getBoundingClientRect().left)}→${Math.round(e.getBoundingClientRect().right)}`);
  const rgba = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] == null ? 1 : p[3]]; };
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (top, bot) => [0, 1, 2].map((i) => top[i] * top[3] + bot[i] * (1 - top[3])).concat(1);
  const bgOf = (e) => { const layers = []; for (let a = e; a; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.backgroundImage && cs.backgroundImage !== "none") return { unknown: true }; const c = rgba(cs.backgroundColor); if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } } let base = [255, 255, 255, 1]; for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base); return { c: base }; };
  const low = [], unjudged = [];
  for (const e of all) {
    const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join("").trim();
    if (!own || !/[\p{L}\p{N}]/u.test(own)) continue;
    const cs = getComputedStyle(e); if (e.closest("[disabled],[aria-disabled=true]")) continue;
    const fg = rgba(cs.color); const bg = bgOf(e); if (!fg) continue;
    if (bg.unknown) { unjudged.push(own.slice(0, 16)); continue; }
    const f = over([fg[0], fg[1], fg[2], fg[3] * (+cs.opacity || 1)], bg.c);
    const L1 = lum(f), L2 = lum(bg.c), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const px = parseFloat(cs.fontSize), large = px >= 24 || (px >= 18.66 && +cs.fontWeight >= 700);
    if (ratio < (large ? 3 : 4.5)) low.push({ text: own.slice(0, 22).trim(), ratio: Math.round(ratio * 100) / 100 });
  }
  return { sideways, off: off.slice(0, 4), low, unjudged: unjudged.length, judged: all.length };
};

for (const w of [...W, TOPBAR]) for (const pn of ON[w.name] || Object.keys(PANELS)) for (const skin of ["light", "dark"]) {
  const head = PANELS[pn].css.map((h) => `<link rel="stylesheet" href="${h}">`).join("");
  const pre = `localStorage.setItem("lfh_panel_theme","${skin}");document.documentElement.setAttribute("data-theme","${skin}");` + (PANELS[pn].kitchen ? "window.LFH_NO_PROFILE_AT_ALL=true;" : "") +
    "Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.__on!==false});";
  const scripts = w.scripts.includes("theme.js") ? w.scripts : ["theme.js", ...w.scripts];
  const P = page(`e-${pn}-${skin}-${w.name.replace(/\W+/g, "-")}`, { head, pre, body: TOP, scripts });
  for (const width of WIDTHS) C("E", w.scripts[w.scripts.length - 1], `${pn} panel, ${skin}, ${width}px: ${w.name} — no sideways scroll, nothing off-screen, every text readable (WCAG)`, async () => {
    if (pn === "kitchen" && w.name === "the top bar with every helper in it") { /* the kitchen has no bell: it is synced, and must render nothing */ }
    setApi(api);
    const h = await open(P, { viewport: { width, height: 820 }, touch: width < 800, dark: skin === "dark" });
    await sleep(350);
    await h.page.evaluate(`(${w.open})()`).catch((e) => h.errors.push("open: " + e.message));
    await sleep(700);
    const r = await h.page.evaluate(JUDGE, w.sel);
    const errors = h.errors.slice(); await h.close();
    if (r.missing) return ok(false, `${w.name} did not open${errors[0] ? " · " + errors[0] : ""}`);
    const problems = [];
    if (r.sideways) problems.push("the page scrolls sideways");
    if (r.off.length) problems.push("off-screen: " + r.off.join(", "));
    const known = r.low.filter((x) => KNOWN[x.text] != null && x.ratio >= KNOWN[x.text] - 0.01), fresh = r.low.filter((x) => !known.includes(x));
    if (fresh.length) problems.push(`${fresh.length} hard-to-read text: ${fresh.map((x) => `"${x.text}" ${x.ratio}:1${KNOWN[x.text] != null ? ` (worse than the ${KNOWN[x.text]}:1 measured)` : ""}`).join(", ")}`);
    if (errors.length) problems.push("page threw: " + errors[0]);
    return ok(!problems.length, problems.join(" · ") || `${r.judged} parts judged${r.unjudged ? `, ${r.unjudged} text on a gradient not judged` : ""}${known.length ? ` · under the standard, waiting on decision 28: ${known.map((x) => `"${x.text}" ${x.ratio}:1`).join(", ")}` : ""}`);
  });
}
