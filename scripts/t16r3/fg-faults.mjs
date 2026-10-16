// Family G — THE REAL PANELS WHEN THE SERVER MISBEHAVES. Manager, kitchen and waiter tablet, signed in
// once each (scripts/sweep/login.mjs caches it), on a running copy of the app (--base / LFH_BASE — never
// a default port). The server is made busy, silent, or erratic for the panel's READS, and the panel is
// judged on what a person would see.
//
// WRITES NEVER LEAVE THIS BROWSER. Every non-GET request a panel makes during these runs is answered
// here with a plain {ok:true} and never reaches the server — an earlier sweep sent six real test
// orders to French House's kitchen when its fake outage ended and the queue replayed
// (memory: an-offline-test-that-goes-back-online-sends-real-orders). Crash reports are recorded in the
// page and sent nowhere. So this family reads the dev database like a person looking at a screen,
// and writes nothing at all.
//
// What must hold, on every panel, in every fault:
//   1. the page never throws, and files no crash report — a busy server is not our crash;
//   2. no technical words reach the screen (TypeError, Failed to fetch, undefined, [object …], NaN);
//   3. a BUSY server is never worded as the person's internet (the "never blame a fine phone" rule);
//   4. when the server is well again the panel comes back BY ITSELF, without a reload.
import { C, ok, rng } from "./lib.mjs";
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { baseFrom, requireUp } from "../sweep/appUp.mjs";
import { loginAs } from "../sweep/login.mjs";
import { covStart, covStop } from "../sweep/t16s10/cov.mjs";   // T16_COV: credit the real panels' runs too

const argv = process.argv.slice(2);
export const BASE = argv.includes("--base") ? baseFrom(process.argv) : process.env.LFH_BASE || null;
export const PANELS = [["manager", "editor"], ["kitchen", "kitchen"], ["tablet", "tablet"]];
const RAW = /TypeError|Failed to fetch|NetworkError|\bundefined\b|\[object |\bNaN\b|Load failed|AbortError|operation was aborted/;
const BLAMES_INTERNET = /no internet|check your (internet|connection)|you(?:'| a)re offline/i;
let browser = null, upChecked = false;

export async function openPanel(role, dir, fault, beforeLoad) {
  if (!upChecked) { await requireUp(BASE, "the manager, kitchen and tablet panels (round-3 family G)"); upChecked = true; }
  browser ||= await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await loginAs(ctx, role, BASE);
  // The crash reporter's beacon is caught in the page and kept there.
  await ctx.addInitScript(() => {
    window.__crash = [];
    try { navigator.sendBeacon = function (u, b) { try { b && b.text ? b.text().then((t) => window.__crash.push(u + " " + t)) : window.__crash.push(u + " " + b); } catch { /* never break the page */ } return true; }; } catch { /* a browser without sendBeacon */ }
  });
  const seen = { gets: [], writes: 0 };
  // A mutation run: the real panel is handed the BROKEN copy of the one shared file under test.
  if (process.env.T16_MUT && /^public\/panels\/[a-z-]+\.js$/.test(process.env.T16_MUT_REL || "")) {
    const name = process.env.T16_MUT_REL.slice("public".length), body = readFileSync(process.env.T16_MUT, "utf8");
    await ctx.route((u) => u.pathname === name, (route) => route.fulfill({ status: 200, contentType: "application/javascript", body }));
  }
  await ctx.route("**/api/**", async (route) => {
    const req = route.request(), url = req.url();
    if (/\/api\/log\/client-error/.test(url)) return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    if (req.method() !== "GET" && req.method() !== "HEAD") { seen.writes++; return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); }
    const f = fault.now(url);
    seen.gets.push({ url, f, at: Date.now() });
    if (f === "busy") return route.fulfill({ status: 503, headers: { "X-LFH-Busy": "1" }, contentType: "application/json", body: '{"error":"The system is very busy right now","busy":true}' });
    if (f === "drop") return route.abort("connectionreset");
    if (f === "hang") { fault.held.push(route); return; }
    if (f === "slow") await new Promise((r) => setTimeout(r, 1800));
    return route.continue().catch(() => {});
  });
  const page = await ctx.newPage();
  await covStart(page);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  page.on("frameattached", (fr) => fr.page().on("pageerror", () => {}));
  if (beforeLoad) beforeLoad(page);   // e.g. family H's socket watcher — attached BEFORE the panel connects
  await page.goto(BASE + "/" + role, { waitUntil: "domcontentloaded" });
  const frame = async () => { for (let i = 0; i < 60; i++) { const f = page.frames().find((x) => x.url().includes(`/panels/${dir}/`)); if (f) return f; await page.waitForTimeout(250); } return null; };
  return { ctx, page, errors, seen, frame, close: async () => { await covStop(page); await ctx.close().catch(() => {}); } };
}
async function look(fr) {
  return fr.evaluate(() => {
    const bar = document.getElementById("lfhOffBar");
    const barOn = !!(bar && !bar.hidden && bar.getBoundingClientRect().height > 0 && getComputedStyle(bar).display !== "none");
    return { text: document.body ? document.body.innerText : "", barOn, barText: barOn ? bar.innerText : "", crash: (window.__crash || []).filter((x) => /"kind":"error"/.test(x)) };
  }).catch(() => ({ text: "", barOn: false, crash: [], gone: true }));
}
function judge(snap, { busy }) {
  const p = [];
  const raw = snap.text.match(RAW); if (raw) p.push(`technical words on screen: "${snap.text.slice(Math.max(0, raw.index - 40), raw.index + 40).replace(/\s+/g, " ")}"`);
  if (busy && BLAMES_INTERNET.test(snap.text)) p.push(`a busy server was worded as the internet: "${(snap.text.match(BLAMES_INTERNET) || [""])[0]}"`);
  if (snap.crash.length) p.push(`filed a crash report: ${snap.crash[0].slice(0, 160)}`);
  return p;
}
// Recovery: after the fault lifts, within the panels' own 60 s backstop (+ margin), the panel has
// asked again, been answered, and shows no busy/offline bar.
async function recovers(h, fault, liftAt) {
  const end = Date.now() + 80000;
  while (Date.now() < end) {
    const fr = await h.frame(); const s = fr ? await look(fr) : null;
    const answered = h.seen.gets.some((g) => g.at > liftAt && g.f === "ok");
    if (s && answered && !s.barOn && s.text.length > 120) return { ok: true, secs: Math.round((Date.now() - liftAt) / 1000) };
    await h.page.waitForTimeout(1000);
  }
  const fr = await h.frame(); const s = fr ? await look(fr) : {};
  return { ok: false, bar: s.barText, len: (s.text || "").length };
}

const SCEN = {
  "a BUSY server for the first 10 seconds (every read answers 503 + X-LFH-Busy)": { kind: "busy", mk: (t0) => () => (Date.now() - t0 < 10000 ? "busy" : "ok"), lift: 10000 },
  "a server that HANGS for the first 20 seconds (every read waits and never answers)": { kind: "hang", mk: (t0) => () => (Date.now() - t0 < 20000 ? "hang" : "ok"), lift: 20000 },
  "an ERRATIC server for 30 seconds (each read: fine, busy, dropped or slow, at random) with the tab losing and regaining focus": { kind: "chaos", mk: (t0, R) => () => (Date.now() - t0 < 30000 ? R.pick(["ok", "ok", "busy", "drop", "slow"]) : "ok"), lift: 30000 },
};
for (const [role, dir] of PANELS) for (const [name, sc] of Object.entries(SCEN)) C("G", `${dir} panel (real)`, `${role}: ${name} — never throws, no crash report, no technical words${sc.kind === "busy" ? ", never blames the internet" : ""}, and comes back by itself`, async () => {
  if (!BASE) return "skip: needs a running app — pass --base http://localhost:<port> (never a default port)";
  const R = rng(role.length * 97 + sc.lift);
  const t0 = Date.now(); const fault = { held: [], now: sc.mk(t0, R) };
  const h = await openPanel(role, dir, fault);
  const problems = [];
  try {
    const fr = await h.frame(); if (!fr) return ok(false, "the panel frame never loaded");
    // During the fault: look every 2 s.
    while (Date.now() - t0 < sc.lift) {
      if (sc.kind === "chaos" && R.bool(0.3)) await fr.evaluate((hide) => { Object.defineProperty(document, "hidden", { configurable: true, get: () => hide }); Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hide ? "hidden" : "visible") }); document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event(hide ? "blur" : "focus")); }, R.bool()).catch(() => {});
      const s = await look(await h.frame() || fr);
      for (const x of judge(s, { busy: sc.kind === "busy" })) if (!problems.includes(x)) problems.push(x);
      await h.page.waitForTimeout(2000);
    }
    // Lift: the held reads are let through, the tab is visible.
    const liftAt = Date.now();
    for (const r of fault.held.splice(0)) r.continue().catch(() => {});
    await (await h.frame() || fr).evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); }).catch(() => {});
    const rec = await recovers(h, fault, liftAt);
    if (!rec.ok) problems.push(`did not come back by itself within 80 s (bar: "${(rec.bar || "").slice(0, 80)}", ${rec.len} chars on screen)`);
    const end = await look(await h.frame() || fr);
    for (const x of judge(end, { busy: false })) if (!problems.includes(x)) problems.push(x);
    if (h.errors.length) problems.push("page threw: " + h.errors[0]);
    return ok(!problems.length, problems.join(" · ") || `${h.seen.gets.length} reads (${h.seen.gets.filter((g) => g.f !== "ok").length} faulted), back in ${rec.secs}s, ${h.seen.writes} writes kept in the browser`);
  } finally { for (const r of fault.held.splice(0)) r.abort().catch(() => {}); await h.close(); }
});
// (Sets it back to null, so family H — run in the same process — opens a fresh one.)
C("G", "browser", "close the browser", async () => { if (browser) await browser.close(); browser = null; return ok(true, ""); });
