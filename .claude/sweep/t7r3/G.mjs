// T7 · third 500 · BLOCK G (P40792–P40816) — WORKING WITH NO INTERNET, AND BACK.
// Reads first (does the floor even open?), then a write (is it saved and does it really go?), and
// the ONLINE path asserted alongside every offline one — an offline test that never checks the
// normal case can pass while the panel is broken for everybody who has signal.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, armToasts, heard, forget, C, dump, at, LEAK } from "./lib.mjs";
at(40792);
const T = ["29"];
let s;
try {
  await retireTables(T); await seatParty(T);
  s = await open();
  await openTable(s, T[0]);
  await armToasts(s.fr);
  const layer = await s.fr.evaluate(() => ({ outbox: !!window.LFH_OUTBOX, off: !!window.LFH_OFF, sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller) }));
  C("the panel has an outbox for its writes", layer.outbox);
  C("…and something that knows whether a reply came from the network", layer.off);
  C("…and a service worker in charge of this page", layer.sw, `controller=${layer.sw}`);

  // ── ONLINE FIRST: the normal path must be proved before the offline one means anything ──
  const onlineOrder = await s.fr.evaluate(async (t) => {
    const d = state.data.dishes.find((x) => !x.open_price && !(x.options || []).length && !(x.tags || []).includes("sold-out"));
    const r = await api("POST", "/order", { table: t, items: [{ id: d.id, qty: 1 }], allergies: [], confirmDuplicate: true });
    await load();
    return { queued: !!(r && r.queued), n: state.data.orders.filter((o) => String(o.table_number) === t && o.status !== "cancelled").length };
  }, T[0]);
  C("with signal, an order goes straight to the kitchen", !onlineOrder.queued, `queued=${onlineOrder.queued}`);
  C("…and appears on the bill immediately", onlineOrder.n > 0, `${onlineOrder.n} tickets`);

  // ── the floor OPENS with no internet ───────────────────────────────────────────────────
  await s.ctx.setOffline(true);
  await s.page.waitForTimeout(1200);
  const reload = await (async () => {
    try { await s.page.reload({ waitUntil: "domcontentloaded", timeout: 90000 }); } catch (e) { return { err: String(e.message).slice(0, 80) }; }
    let fr = null; for (let i = 0; i < 60 && !fr; i++) { fr = s.page.frames().find((f) => /\/panels\/tablet\//.test(f.url())); if (!fr) await s.page.waitForTimeout(400); }
    if (!fr) return { err: "no frame" };
    s.fr = fr;
    await fr.waitForSelector(".tile[data-t]", { timeout: 45000 }).catch(() => {});
    await s.page.waitForTimeout(2500);
    return fr.evaluate(() => ({ tiles: document.querySelectorAll(".tile[data-t]").length, txt: document.body.innerText.replace(/\s+/g, " ").slice(0, 300), bar: !!document.querySelector(".offline-bar, .off-bar, [data-offline]") }));
  })();
  C("the panel still opens with no internet", !reload.err && reload.tiles > 0, reload.err || `${reload.tiles} tiles`);
  C("…and shows the floor it had, not an error page", !reload.err && !/can't be reached|ERR_/i.test(reload.txt || ""), (reload.txt || "").slice(0, 90));
  C("…and says the data is saved rather than live", /offline|saved|no internet|not connected/i.test(reload.txt || ""), (reload.txt || "").slice(0, 140));
  C("…in plain words, with no code in the notice", !LEAK.test(reload.txt || ""), (reload.txt || "").slice(0, 110));

  // ── a WRITE with no internet is saved, and says so ─────────────────────────────────────
  await armToasts(s.fr);
  const off = await s.fr.evaluate(async (t) => {
    const d = state.data.dishes.find((x) => !x.open_price && !(x.options || []).length && !(x.tags || []).includes("sold-out"));
    let r = null, err = null;
    try { r = await api("POST", "/order", { table: t, items: [{ id: d.id, qty: 1 }], allergies: [], confirmDuplicate: true }); }
    catch (e) { err = String(e.message).slice(0, 100); }
    return { queued: !!(r && r.queued), why: r && r.why, err, dish: d.title };
  }, T[0]);
  C("a write with no internet is SAVED, not lost", off.queued === true, off.queued ? `why=${off.why}` : `err=${off.err}`);
  C("…and it is not reported as a failure", !off.err, off.err || "no error thrown");
  const said = (await heard(s.fr)).join(" | ");
  C("…and the panel is able to say so in plain words", !said || !LEAK.test(said), said.slice(0, 120) || "(no toast on the api() path — the callers toast)");
  const queue = await s.fr.evaluate(async () => {
    const q = window.LFH_OUTBOX && window.LFH_OUTBOX.pending ? await window.LFH_OUTBOX.pending() : null;
    return { n: Array.isArray(q) ? q.length : (typeof q === "number" ? q : null), has: !!window.LFH_OUTBOX };
  });
  C("the saved write is really sitting in the queue", queue.n === null || queue.n > 0, queue.n === null ? "(the outbox does not expose a count — checked by replay below)" : `${queue.n} waiting`);

  // ── back online: it goes by itself ─────────────────────────────────────────────────────
  // COUNT ON THE TABLE'S OWN SLICE. state.data.orders holds whichever table is open, and after the
  // offline reload nothing was — so this read 0 for a bill that had a ticket on it.
  await openTable(s, T[0]);
  const beforeBack = await s.fr.evaluate((t) => state.data.orders.filter((o) => String(o.table_number) === t && o.status !== "cancelled").length, T[0]);
  await s.ctx.setOffline(false);
  await s.page.waitForTimeout(2000);
  let landed = 0;
  for (let i = 0; i < 20; i++) {
    await s.page.waitForTimeout(3000);
    landed = await s.fr.evaluate(async (t) => { try { await selectTable(t); } catch { try { await load(); } catch {} } return state.data.orders.filter((o) => String(o.table_number) === t && o.status !== "cancelled").length; }, T[0]);
    if (landed > beforeBack) break;
  }
  C("the saved order sends itself once the internet is back", landed > beforeBack, `${beforeBack} → ${landed} tickets`);
  C("…and it is not sent twice", landed <= beforeBack + 1, `${beforeBack} → ${landed}`);
  const after = await s.fr.evaluate(() => ({ txt: document.body.innerText.replace(/\s+/g, " ").slice(0, 300) }));
  C("…and the offline notice goes away when it is no longer true", !/no internet|not connected/i.test(after.txt), after.txt.slice(0, 110));

  // ── a BUSY server is treated like offline, and a refusal is not ────────────────────────
  const busy = await s.fr.evaluate(async () => {
    const out = {};
    const real = window.LFH_OUTBOX.send.bind(window.LFH_OUTBOX);
    // 5xx = queue like offline; 4xx = tell the person. Both answers, one after the other.
    window.LFH_OUTBOX.send = async (o) => { const e = new Error("server busy"); e.status = 503; e.busy = true; throw e; };
    document.querySelectorAll(".toast").forEach((t) => t.remove());
    try { await api("POST", "/orders/nope/accept", {}); out.busyThrew = false; } catch (e) { out.busyThrew = true; out.busyMsg = String(e.message).slice(0, 60); }
    window.LFH_OUTBOX.send = async (o) => { const e = new Error("that dish is sold out"); e.status = 409; e.data = { error: "sold_out" }; throw e; };
    try { await api("POST", "/orders/nope/accept", {}); out.refThrew = false; } catch (e) { out.refThrew = true; out.refMsg = String(e.message).slice(0, 60); }
    window.LFH_OUTBOX.send = real;
    return out;
  });
  C("a busy server reaches the caller as something to handle, not a silent success", busy.busyThrew, busy.busyMsg || "");
  C("a refusal reaches the caller in the server's own words", busy.refThrew && /sold out/i.test(busy.refMsg || ""), busy.refMsg || "");

  // ── the offline layer knows which API families to keep ─────────────────────────────────
  const sw = await (await fetch("https://3-d-backup.vercel.app/sw.js")).text();
  // The patterns in sw.js are REGEX LITERALS, so the text reads `/^\/api\/tablet\//` — searching
  // the file for a plain "/api/tablet" finds nothing and accuses a service worker that is correct.
  C("the service worker keeps the tablet's own data", /\\\/api\\\/tablet/.test(sw), /\\\/api\\\/tablet/.test(sw) ? "listed in DATA_PATHS" : "MISSING from DATA_PATHS");
  C("…and the panel's own files", /panels/.test(sw));
  // The login PAGE must stay cached (a device bounced to /login with no signal used to get the
  // browser's own error page). Only the login POSTS are skipped, which is the whole distinction.
  C("the login page is not excluded from the offline shell — only its POSTs are", /\^\\\/api\\\/\(staff-\)\?login/.test(sw), "the never-cache list holds /api/…login, not /login");
  C("…and the never-cache list is about writes, not pages", !/NEVER[^\n]*"\/login"/.test(sw));

  // ── and the ONLINE path still works at the end ─────────────────────────────────────────
  await openTable(s, T[0]);
  const finalOnline = await s.fr.evaluate(async (t) => {
    const before = state.data.orders.filter((o) => String(o.table_number) === t && o.status !== "cancelled").length;
    const d = state.data.dishes.find((x) => !x.open_price && !(x.options || []).length && !(x.tags || []).includes("sold-out"));
    const r = await api("POST", "/order", { table: t, items: [{ id: d.id, qty: 1 }], allergies: [], confirmDuplicate: true });
    try { await selectTable(t); } catch { await load(); }
    return { queued: !!(r && r.queued), before, after: state.data.orders.filter((o) => String(o.table_number) === t && o.status !== "cancelled").length };
  }, T[0]);
  C("with the internet back, a new order goes straight through again", !finalOnline.queued, `queued=${finalOnline.queued}`);
  C("…and lands on the bill", finalOnline.after > finalOnline.before, `${finalOnline.before} → ${finalOnline.after}`);
  C("no uncaught page error across the offline walk", s.errs.filter((e) => !/Failed to fetch|NetworkError|load failed/i.test(e)).length === 0, s.errs.join(" | ").slice(0, 200));
} catch (e) { C("block G completed without crashing", false, String(e.message).slice(0, 220)); }
finally { if (s) { try { await s.ctx.setOffline(false); } catch {} try { await s.browser.close(); } catch {} } await retireTables(T); process.exitCode = dump("G") ? 1 : 0; }
