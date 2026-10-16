// SWEEP #10 T11 ROUND 2 · THE KITCHEN SCREEN, SECTION E — the phone layout and the menus. P180949–P180960.
// ⋯ MORE on a phone, ☰ → Settings / Printer / Report an issue, Sign out, the phone's Back button on every overlay,
// the "tap to enable sound" nudge, the take-back fallback when the shared bar is missing, the clock.
/* global updateSoundNudge -- the kitchen screen's own globals, used only inside functions that run IN THE PAGE (page.evaluate) */
import { open, board, order, item, dish, k, sleep } from "./p-lib.mjs";

const T = (o = {}) => board({ orders: [order("c1", { kot_no: 12 })], items: [item("a1", "c1")], dishes: [dish("d1", "Paneer Tikka")], ...o });
const PHONE = { viewport: { width: 390, height: 844 }, mobile: true };

export default async function sectionE() {
  // ── ⋯ MORE on a phone ─────────────────────────────────────────────────────────────────────────────
  let P = await open({ ...PHONE, S: { board: T() } });
  const ph = await P.ev(() => ({ more: getComputedStyle(document.getElementById("moreBtn")).display !== "none",
    moved: ["muteBtn", "viewBtn", "themeToggle", "reportIssueBtn"].every((id) => !!document.getElementById(id).closest("#morePop")),
    labels: [...document.querySelectorAll("#morePop .kmr-label")].map((x) => x.textContent), bar: Math.round(document.querySelector("header.topbar").getBoundingClientRect().height),
    oneLine: new Set(["boardBtn", "printerBtn", "moreBtn"].map((id) => Math.round(document.getElementById(id).getBoundingClientRect().top))).size === 1,
    sideways: document.documentElement.scrollWidth > innerWidth, clock: document.getElementById("clock").textContent }));
  k("P180949", "on a 390px phone the set-once controls (sound, layout, theme, report) move into ⋯ with their words; the bar is two rows at most (name, then the service controls on ONE line — it was three rows, 157px), nothing scrolls sideways, and the hidden clock is never written",
    ph.more && ph.moved && ph.labels.join("|") === "New-order sound|Board layout|Theme|Report an issue" && ph.bar <= 130 && ph.oneLine && !ph.sideways && ph.clock === "", JSON.stringify(ph));
  await P.page.tap("#moreBtn");
  const o1 = await P.ev(() => [document.getElementById("morePop").hidden, document.getElementById("moreBtn").getAttribute("aria-expanded")]);
  await P.page.tap("#muteBtn"); await sleep(250);
  const o2 = await P.ev(() => [document.getElementById("morePop").hidden, document.getElementById("muteBtn").textContent]);
  const th0 = await P.ev(() => document.documentElement.dataset.theme);
  await P.page.tap("#themeToggle"); await sleep(250);
  const o3 = await P.ev(() => [document.getElementById("morePop").hidden, document.documentElement.dataset.theme]);
  k("P180950", "⋯ opens the menu; 🔔 mutes and the menu STAYS open (a cook wants to see it change); 🌗 flips the theme and the menu closes",
    o1[0] === false && o1[1] === "true" && o2[0] === false && o2[1] === "🔕" && o3[0] === true && o3[1] !== th0, JSON.stringify([o1, o2, th0, o3]));
  await P.page.tap("#moreBtn"); await P.page.mouse.click(200, 600); await sleep(100);
  const c1 = await P.ev(() => document.getElementById("morePop").hidden);
  await P.page.tap("#moreBtn"); await P.page.keyboard.press("Escape"); await sleep(100);
  const c2 = await P.ev(() => document.getElementById("morePop").hidden);
  await P.page.tap("#moreBtn"); await P.page.goBack().catch(() => {}); await sleep(400);
  const c3 = await P.ev(() => document.getElementById("morePop").hidden);
  k("P180951", "the ⋯ menu closes on a tap outside it, on Escape, and on the phone's BACK button — and Back does not leave the kitchen screen", c1 && c2 && c3 && /kitchen\/index\.html/.test(P.page.url()), JSON.stringify([c1, c2, c3, P.page.url()]));
  await P.page.setViewportSize({ width: 1280, height: 860 }); await sleep(300);
  const desk = await P.ev(() => ({ order: [...document.querySelector(".top-actions").children].map((x) => x.id).filter(Boolean), more: getComputedStyle(document.getElementById("moreBtn")).display }));
  k("P180952", "widening to a desktop puts every control back in EXACTLY the slot index.html gave it, and ⋯ disappears",
    desk.order.join(",") === "lfhConnBadge,clock,muteBtn,boardBtn,printerBtn,viewBtn,reportIssueBtn,themeToggle,moreBtn" && desk.more === "none", JSON.stringify(desk));
  await P.close();

  // ── ☰ → the kitchen menu ──────────────────────────────────────────────────────────────────────────
  P = await open({ S: { board: T() } });
  await P.page.click("#hamburger");
  const dw = await P.ev(() => { const d = document.querySelector(".kds-dw"); return d ? { t: d.innerText.replace(/\s+/g, " "), build: document.getElementById("kdsBuild").textContent, v: new URL([...document.querySelectorAll('script[src*="app.js"]')].pop().src).searchParams.get("v") } : null; });
  k("P180953", "☰ opens the kitchen menu: 'Kitchen', the restaurant, Settings / Printer / Report an issue, and the build read off app.js's own version (never typed in) — and no profile, deliberately",
    dw && /Kitchen French House ⚙️ Settings 🖨 Printer 🚩 Report an issue/.test(dw.t) && dw.build === "kitchen " + dw.v && !/profile/i.test(dw.t), JSON.stringify(dw));
  await P.page.click(".kds-dw .dw-close"); const x1 = await P.ev(() => !document.querySelector(".kds-dw"));
  await P.page.click("#hamburger"); await P.page.mouse.click(1200, 500); const x2 = await P.ev(() => !document.querySelector(".kds-dw"));
  await P.page.click("#hamburger"); await P.page.goBack().catch(() => {}); await sleep(400); const x3 = await P.ev(() => !document.querySelector(".kds-dw"));
  await P.page.click("#hamburger"); await P.page.click('[data-kdw="printer"]'); const x4 = await P.ev(() => !!document.getElementById("prSheet") && !document.querySelector(".kds-dw"));
  await P.page.click("[data-prclose]");
  await P.page.click("#hamburger"); await P.page.click('[data-kdw="issue"]'); await sleep(200); const x5 = await P.ev(() => !!document.querySelector(".lfhir-ov"));
  k("P180954", "the menu closes on ✕, on the backdrop and on Back; 'Printer' opens the 🖨 sheet and 'Report an issue' opens the issue form", x1 && x2 && x3 && x4 && x5, JSON.stringify([x1, x2, x3, x4, x5]));
  await P.close();

  // ── ⚙️ Settings ──────────────────────────────────────────────────────────────────────────────────
  P = await open({ S: { board: T() } });
  const set = async () => { await P.page.click("#hamburger"); await P.page.click('[data-kdw="settings"]'); await sleep(100); return P.ev(() => document.querySelector(".kset").innerText.replace(/\s+/g, " ")); };
  const off = await set();
  await P.setBoard(T({ printRefused: "paused" })); await sleep(150);
  const paused = await P.ev(() => document.querySelector(".kset").innerText.replace(/\s+/g, " "));
  await P.setBoard(T({ helper: { owned: true, printer: "POS_80", agent: "Shop's PC", connected: true } })); await sleep(150);
  const comp = await P.ev(() => document.querySelector(".kset").innerText.replace(/\s+/g, " "));
  await P.setBoard(T({ kotPrintTarget: "counter" })); await sleep(150);
  const counter = await P.ev(() => document.querySelector(".kset").innerText.replace(/\s+/g, " "));
  await P.setBoard(T({ autoPrintKot: true, station: { mine: false, active: { label: "Kitchen screen", claimed_by: "Ravi" }, stale: true } })); await sleep(150);
  const stale = await P.ev(() => document.querySelector(".kset").innerText.replace(/\s+/g, " "));
  k("P180955", "⚙️ Settings says where paper comes out and nothing else: ABSENT when the restaurant does not print; 'nobody right now' when stopped; the computer by name; the counter; a screen gone quiet named as such — and it updates while open",
    !/Printing/.test(off) && /Tickets print on nobody right now/.test(paused) && /Tickets print on POS_80 — from Shop's PC/.test(comp) && /Kitchen tickets print on the counter screen/.test(counter) && /Kitchen screen · Ravi was printing and has stopped answering/.test(stale),
    JSON.stringify([off.slice(0, 60), paused.slice(0, 80), comp.slice(0, 80), counter.slice(0, 80), stale.slice(0, 160)]));
  const v0 = await P.ev(() => [document.getElementById("muteBtn").textContent, localStorage.getItem("kds_view") || "columns", document.documentElement.dataset.theme]);
  for (const id of ["muteBtn", "viewBtn", "themeToggle"]) await P.page.click(`[data-kset-click="${id}"]`);
  const v1 = await P.ev(() => [document.getElementById("muteBtn").textContent, localStorage.getItem("kds_view"), document.documentElement.dataset.theme, !!document.querySelector(".kset-ov")]);
  k("P180956", "the three 'this screen' buttons are the top bar's own buttons clicked through — sound, layout and theme all change, and the sheet stays open", v1[0] !== v0[0] && v1[1] !== v0[1] && v1[2] !== v0[2] && v1[3], JSON.stringify([v0, v1]));
  const so = await P.ev(() => { const f = document.querySelector('.kset form'); const b = f.querySelector("button"); return { m: f.method, a: new URL(f.action).pathname, t: f.target, h: Math.round(b.getBoundingClientRect().height) }; });
  await P.page.click("[data-kset-close]"); const s1 = await P.ev(() => !document.querySelector(".kset-ov") && window.__kdsSettingsOpen === false);
  await P.page.click("#hamburger"); await P.page.click('[data-kdw="settings"]'); await P.page.mouse.click(5, 5); const s2 = await P.ev(() => !document.querySelector(".kset-ov"));
  await P.page.click("#hamburger"); await P.page.click('[data-kdw="settings"]'); await P.page.goBack().catch(() => {}); await sleep(400); const s3 = await P.ev(() => !document.querySelector(".kset-ov"));
  k("P180957", "Sign out is a real POST form to /api/panel-logout aimed at the WHOLE window (_top), ≥ 44px; the sheet closes on ✕, outside, and Back",
    so.m === "post" && so.a === "/api/panel-logout" && so.t === "_top" && so.h >= 44 && s1 && s2 && s3, JSON.stringify([so, s1, s2, s3]));
  await P.close();

  // ── the sound nudge, the take-back fallback, the clock ─────────────────────────────────────────────
  P = await open({ S: { board: T() } });
  // The panel's `let audioCtx` is a script-level binding, so it is set through a Function body (a page-side setter).
  const setAudio = (st) => P.ev((x) => { new Function("v", "audioCtx = v")({ state: x, resume: () => Promise.resolve() }); updateSoundNudge(); }, st);
  await setAudio("suspended");
  const n1 = await P.ev(() => { const n = document.getElementById("soundNudge"); return n && !n.hidden ? n.textContent : null; });
  await P.page.click("#muteBtn"); const n2 = await P.ev(() => document.getElementById("soundNudge").hidden);
  await P.page.click("#muteBtn"); await setAudio("suspended");
  await setAudio("running"); await P.ev(() => { document.getElementById("soundNudge").hidden = false; }); await P.page.click("#soundNudge"); await sleep(400);
  const n3 = await P.ev(() => document.getElementById("soundNudge").hidden);
  k("P180958", "a screen whose sound is still locked shows '🔊 Tap to enable sound — new orders are silent' under the bar; muting hides it; once sound runs, it folds away", /Tap to enable sound — new orders are silent/.test(n1 || "") && n2 && n3, JSON.stringify([n1, n2, n3]));
  await P.ev(() => { delete window.LFH_UNDO; });
  await P.page.click("#boardBtn"); await P.page.click('[data-86="d1"]'); await sleep(300);
  const tb = await P.ev(() => { const t = [...document.querySelectorAll("#toasts .toast")].pop(); return t ? [t.querySelector("span").textContent, !!t.querySelector(".undo")] : null; });
  await P.ev(() => [...document.querySelectorAll("#toasts .toast .undo")].pop().click()); await sleep(300);
  k("P180959", "if the shared take-back bar ever fails to load, the message itself carries an UNDO that works", tb && /Paneer Tikka marked SOLD OUT/.test(tb[0]) && tb[1] && P.writes(/^\/dishes\/d1\/sold-out$/).map((c) => c.body.value).join() === "true,false", JSON.stringify(tb));
  await P.page.click("#drawerClose");
  await sleep(1100); const clk = await P.ev(() => document.getElementById("clock").textContent);
  await P.page.click('[data-reprint="c1"]'); await sleep(500);
  const fr1 = await P.ev(() => document.querySelectorAll("iframe").length);
  await P.ev(() => [...document.querySelectorAll("iframe")].forEach((f) => f.contentWindow.dispatchEvent(new Event("afterprint")))); await sleep(100);
  const fr2 = await P.ev(() => document.querySelectorAll("iframe").length);
  k("P180960", "on a desktop the clock shows the time (HH:MM); the hidden print frame is removed as soon as the browser says printing finished", /^\d{1,2}:\d{2}/.test(clk) && fr1 === 1 && fr2 === 0, JSON.stringify([clk, fr1, fr2]));
  await P.close();
}
