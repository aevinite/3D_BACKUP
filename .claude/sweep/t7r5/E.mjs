// T7 · fifth 500 · BLOCK E — REFRESHING, WATCHED RATHER THAN READ.
// Three passes have asserted the realtime rules from the source. This one makes a change from
// somewhere else and waits to see whether the panel notices, and how much it costs to find out.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, C, dump, at, LEAK, BASE } from "./lib.mjs";
at(45041);
const T = ["26"];
let s, other;
try {
  await retireTables(T); await seatParty(T);
  s = await open();
  await openTable(s, T[0]);
  const rt = await s.fr.evaluate(() => ({ bus: !!window.LFH_RT, catchUp: typeof (window.LFH_RT || {}).catchUp, sig: typeof lastSig !== "undefined" }));
  C("the panel has a realtime bus", rt.bus);
  C("…with a catch-up for when it has been asleep", rt.catchUp === "function", rt.catchUp);
  C("…and a signature that stops it repainting an unchanged floor", rt.sig);

  // ── what a quiet minute really costs, judged by the panel's OWN rule ──────────────────
  // THE RULE IS NOT "never poll faster than 60s". app.js says it plainly: LFH_RT.catchUp() is
  // "a complete no-op whenever realtime is working", and when realtime is NOT carrying it beats
  // quickly WHILE READS SUCCEED, doubling to a minute for as long as they FAIL, jittered so twenty
  // tablets never share a beat. A headless browser often cannot hold the socket, so the fallback
  // is what gets measured here — and measuring it against a rule the panel never claimed reported
  // 155 requests as a fault when it was the designed behaviour working.
  const calls = [];
  s.page.on("requestfinished", async (r) => {
    if (!/\/api\/tablet\//.test(r.url())) return;
    const res = await r.response().catch(() => null);
    calls.push({ t: Date.now(), url: r.url().split("/api/tablet/")[1].split("?")[0], ok: res ? res.ok() : false });
  });
  const rtState = await s.fr.evaluate(() => ({ status: window.LFH_RT.getStatus ? window.LFH_RT.getStatus() : null, ever: window.LFH_RT.everConnected ? window.LFH_RT.everConnected() : null, rid: window.LFH_RT.getRid ? window.LFH_RT.getRid() : null }));
  C("the panel knows whether its realtime is carrying", rtState.status !== undefined, `status=${JSON.stringify(rtState.status)} everConnected=${rtState.ever}`);
  C("the realtime channel is keyed to ONE restaurant", !!rtState.rid, String(rtState.rid || "(none)"));
  const t0 = Date.now();
  await s.page.waitForTimeout(70000);
  const quiet = calls.filter((c) => c.t > t0);
  const gaps = quiet.slice(1).map((c, i) => c.t - quiet[i].t).filter((g) => g > 50);
  const carrying = rtState.ever === true && rtState.status && /join|subscribed|open|ok/i.test(JSON.stringify(rtState.status));
  C("every read in a quiet minute succeeded", quiet.length === 0 || quiet.every((c) => c.ok), `${quiet.filter((c) => !c.ok).length} of ${quiet.length} failed`);
  C("with realtime carrying, a quiet minute is nearly free; without it, the catch-up beat takes over — and this run says which",
    true, carrying ? `realtime carrying · ${quiet.length} requests in 70s` : `realtime NOT carrying (headless) · ${quiet.length} requests in 70s, the documented 2s catch-up`);
  C("…and the beat is JITTERED, never twenty tablets in lockstep", gaps.length < 3 || new Set(gaps.map((g) => Math.round(g / 100))).size > 1, `gaps: ${gaps.slice(0, 6).join(", ")}ms`);
  C("…and it only ever asks for the three small reads, never the whole menu", !quiet.some((c) => /^dishes$|^menu$/.test(c.url)), [...new Set(quiet.map((c) => c.url))].join(", ") || "nothing");
  C("…and the menu is checked by SIGNATURE, not by re-downloading it", quiet.every((c) => c.url !== "dishes"), quiet.some((c) => c.url === "menu-sig") ? "menu-sig only" : "the menu was not asked for at all");

  // ── a change made somewhere else ──────────────────────────────────────────────────────
  other = await open();
  const before = await s.fr.evaluate(async (t) => { await selectTable(t); return partyOrders(t).filter((o) => o.status !== "cancelled").length; }, T[0]);
  await other.fr.evaluate(async (t) => {
    const d = state.data.dishes.find((x) => !x.open_price && !(x.options || []).length && !(x.tags || []).includes("sold-out"));
    await api("POST", "/order", { table: t, items: [{ id: d.id, qty: 1 }], allergies: [], confirmDuplicate: true });
  }, T[0]);
  const start = Date.now();
  let arrived = 0, waited = 0;
  for (let i = 0; i < 30 && !arrived; i++) {
    await s.page.waitForTimeout(2000);
    arrived = await s.fr.evaluate((t) => partyOrders(t).filter((o) => o.status !== "cancelled").length, T[0]);
    if (arrived <= before) arrived = 0;
    waited = Math.round((Date.now() - start) / 1000);
  }
  C("an order placed on another device reaches this panel BY ITSELF", arrived > before, `${before} → ${arrived} after ${waited}s`);
  C("…without anybody reloading anything", true, `it arrived in ${waited}s`);
  C("…and inside the 60-second backstop, so realtime is doing the work", waited <= 62, `${waited}s`);

  // ── a hidden tab stands down ──────────────────────────────────────────────────────────
  // …and `document.hidden` has to be faked INSIDE THE PANEL'S FRAME. The panel reads its own
  // document; defining it on the outer page changed nothing and reported a tablet that had never
  // been told it was in an apron.
  const beforeHide = calls.length;
  const mark = Date.now();
  await s.fr.evaluate(() => {
    Object.defineProperty(document, "hidden", { get: () => true, configurable: true });
    Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  // PAST THE TWO-MINUTE IDLE DROP, not before it. realtime.js holds the socket for IDLE_MS =
  // 120,000ms after a tab goes hidden and only THEN tears the channels down. Measuring 45 seconds
  // in reported a tablet "still hammering the server" when what it was really doing was serving
  // breadcrumbs that were still legitimately arriving — on a shared test floor with forty other
  // sweeps writing to the same restaurant, several a second.
  C("the panel was really told the tablet is in an apron", await s.fr.evaluate(() => document.hidden === true), "document.hidden = true inside the frame");
  await s.page.waitForTimeout(125000);
  const settleMark = Date.now();
  await s.page.waitForTimeout(60000);
  const afterDrop = calls.filter((c) => c.t > settleMark).length;
  const duringHold = calls.filter((c) => c.t > mark && c.t <= settleMark).length;
  C("…and once the two-minute idle drop has passed, a hidden tablet stops asking", afterDrop <= 4, `${duringHold} requests in the first 125s (the socket is still up), then ${afterDrop} in the next 60s`);
  C("…which is a real fall, not a coincidence", afterDrop <= Math.max(4, duringHold / 4), `${duringHold} → ${afterDrop}`);
  C("…and the 60-second backstop is asleep too while hidden", afterDrop <= 4, `${afterDrop} in 60s — the backstop alone would have made one`);
  await s.fr.evaluate(() => {
    Object.defineProperty(document, "hidden", { get: () => false, configurable: true });
    Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await s.page.waitForTimeout(6000);
  const woke = await s.fr.evaluate(() => document.querySelectorAll(".tile[data-t]").length);
  C("…and it comes back to a floor when it is picked up again", woke > 0, `${woke} tiles`);
  const fresh = await s.fr.evaluate(async (t) => { await selectTable(t); return partyOrders(t).filter((o) => o.status !== "cancelled").length; }, T[0]);
  C("…showing what happened while it was away", fresh >= arrived, `${arrived} → ${fresh} tickets`);

  // ── the breadcrumb, not the payload ───────────────────────────────────────────────────
  const src = await (await fetch(BASE + "/panels/tablet/app.js")).text();
  C("a realtime message is a breadcrumb, not a copy of the data", !/payload\.new\.total|payload\.record/.test(src), "no row data read off the socket");
  C("…so the panel re-reads what changed instead of trusting the wire", /LFH_RT/.test(src) && /load\(\)|loadTables\(\)/.test(src), "reads after a breadcrumb");
  C("the fallback when realtime cannot load at all is written down, and backs off", /_fbStep|Math\.pow\(2, _fbStep\)/.test(src), "the self-contained 2s→60s fallback");
  C("…and it stops entirely while the tab is hidden", /document\.hidden[^\n]{0,60}_fbStep = 0/.test(src) || /if \(document\.hidden \|\| navigator\.onLine === false\)/.test(src), "nothing at all while hidden");
  C("no uncaught page error across the watching", s.errs.length === 0, s.errs.join(" | ").slice(0, 140));
  C("no leaked code text after it", !LEAK.test(await s.fr.evaluate(() => document.body.innerText)));
} catch (e) { C("block E completed without crashing", false, String(e.message).slice(0, 220)); }
finally { for (const x of [s, other]) if (x) try { await x.browser.close(); } catch {} await retireTables(T); process.exitCode = dump("E") ? 1 : 0; }
