// Family H — WHAT AN OPEN PANEL COSTS WHEN NOBODY TOUCHES IT. A manager screen, a kitchen screen and a
// waiter tablet are left open all shift, so what they ask for while idle is what the database pays
// for all day (owner: "cost" = egress). Signed in once each, on a running copy of the app, writes kept
// in the browser exactly as in family G. Judged on the app's own rules (CLAUDE.md "Protect the
// DB/connection budget", checklist point 9 "no poll faster than the 60 s backstop"):
//   1. VISIBLE and idle for 130 s: no address is asked more than 4 times (a fixed 15 s poll would be 9);
//   2. HIDDEN for 200 s: the manager and tablet go quiet — at most one read per address, and the live
//      socket is let go after its 120 s idle limit; the kitchen may stay awake on purpose (it keeps its
//      socket while it is the printer — realtime.js keepAlive), but still no faster than the backstop.
import { C, ok } from "./lib.mjs";
import { openPanel, BASE, PANELS } from "./fg-faults.mjs";

const pathOf = (u) => new URL(u).pathname;
// THE ONE DELIBERATE FASTER RHYTHM. The manager panel asks /print-jobs/pending every 20 s and keeps
// asking while hidden — on purpose (public/panels/editor/app.js → managerPrintPass: "a screen covered by
// another window is exactly the situation the owner reported"). It is held to ITS documented rhythm
// here, not exempted: faster than every 20 s still fails. Its cost is put to the owner (round-3 decision 29).
const RHYTHM = { "/api/editor/print-jobs/pending": 20 };
const allowed = (p, secs, dflt) => (RHYTHM[p] ? Math.ceil(secs / RHYTHM[p]) + 1 : dflt);
const over = (m, secs, dflt) => Object.entries(m).filter(([p, n]) => n > allowed(p, secs, dflt));
// A read a LIVE EVENT asked for (another device changed something — other sessions do write to the
// dev restaurant) is the design working, not a poll; only reads with no event in the 2.5 s before them
// are counted against the rhythm. Events are seen on the live socket itself.
function perPath(gets, from, to, events = []) { const m = {}; for (const g of gets) { if (g.at < from || g.at > to) continue; if (events.some((e) => e <= g.at && g.at - e < 2500)) continue; m[pathOf(g.url)] = (m[pathOf(g.url)] || 0) + 1; } return m; }
function watchSocket(page) {
  const ws = { open: 0, closed: 0, lastFrame: 0, events: [] };
  page.on("websocket", (s) => {
    if (!/realtime|supabase|\/socket\b/.test(s.url()) || /_next|webpack|hmr|turbopack/.test(s.url())) return;
    ws.open++; s.on("close", () => ws.closed++);
    s.on("framesent", () => { ws.lastFrame = Date.now(); });
    s.on("framereceived", (f) => { ws.lastFrame = Date.now(); if (/postgres_changes/.test(String(f.payload || ""))) ws.events.push(Date.now()); });
  });
  return ws;
}
async function hide(fr, on) {
  await fr.evaluate((on) => { Object.defineProperty(document, "hidden", { configurable: true, get: () => on }); Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (on ? "hidden" : "visible") }); document.dispatchEvent(new Event("visibilitychange")); }, on);
}
for (const [role, dir] of PANELS) {
  C("H", `${dir} panel (real)`, `${role}: open and untouched for 130 s, visible — no address asked more than 4 times`, async () => {
    if (!BASE) return "skip: needs a running app — pass --base http://localhost:<port>";
    let ws = null;
    const h = await openPanel(role, dir, { held: [], now: () => "ok" }, (pg) => { ws = watchSocket(pg); });
    try {
      await h.frame(); await h.page.waitForTimeout(25000);
      const from = Date.now(); await h.page.waitForTimeout(130000);
      const m = perPath(h.seen.gets, from, Date.now(), ws.events); const worst = Object.entries(m).sort((a, b) => b[1] - a[1]);
      return ok(!over(m, 130, 4).length, (worst.slice(0, 5).map(([p, n]) => `${p} ×${n}`).join(", ") || "no unprompted reads") + ` · ${ws.events.length} live events answered`);
    } finally { await h.close(); }
  });
  C("H", `${dir} panel (real)`, `${role}: hidden for 200 s — ${role === "kitchen" ? "no address faster than the 60 s backstop (the kitchen may stay awake as the printer)" : "at most one read per address, and the live socket is let go after its 120 s idle limit"}`, async () => {
    if (!BASE) return "skip: needs a running app — pass --base http://localhost:<port>";
    let ws = null;   // only the LIVE socket — a dev server keeps its own reload socket chatting
    const h = await openPanel(role, dir, { held: [], now: () => "ok" }, (pg) => { ws = watchSocket(pg); });
    try {
      const fr = await h.frame(); await h.page.waitForTimeout(20000);
      await hide(fr, true); const from = Date.now();
      await h.page.waitForTimeout(200000);
      const m = perPath(h.seen.gets, from + 2000, Date.now(), ws.events); const worst = Object.entries(m).sort((a, b) => b[1] - a[1]);
      const quietFor = Math.round((Date.now() - ws.lastFrame) / 1000);
      await hide(fr, false);
      // The kitchen keeps its 60 s backstop while hidden (it may be the printer): no faster than that.
      const lim = role === "kitchen" ? Math.ceil(200 / 60) + 1 : 1;
      // Let go = the socket closed, or silent for longer than its 25-30 s heartbeat.
      const socketLetGo = role === "kitchen" || ws.closed > 0 || quietFor >= 35;
      return ok(!over(m, 200, lim).length && socketLetGo,
        `${worst.slice(0, 5).map(([p, n]) => `${p} ×${n}`).join(", ") || "no reads while hidden"} · sockets opened ${ws.open}, closed ${ws.closed}, last socket traffic ${quietFor}s before the end`);
    } finally { await h.close(); }
  });
}
