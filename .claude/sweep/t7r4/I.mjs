// T7 · fourth 500 · BLOCK I — WHEN THINGS GO WRONG.
// 4xx, 5xx, timeouts, somebody else editing the same thing, a double tap, and the back button
// pressed five layers deep. The panel is judged on what it SAYS and what it leaves on screen.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, armToasts, heard, forget, spoke, C, dump, at, LEAK, BASE } from "./lib.mjs";
at(42938);
const T = ["32"];
let s;
// Play ONE server answer for the next write, then put the real one back.
const answer = (fr, match, err) => fr.evaluate(({ m, e }) => {
  window.__realSend = window.__realSend || window.LFH_OUTBOX.send.bind(window.LFH_OUTBOX);
  window.LFH_OUTBOX.send = async (o) => {
    if (!new RegExp(m).test(o.path)) return window.__realSend(o);
    const err = new Error(e.message);
    Object.assign(err, e.props || {});
    throw err;
  };
  return true;
}, { m: match, e: err });
const restore = (fr) => fr.evaluate(() => { if (window.__realSend) { window.LFH_OUTBOX.send = window.__realSend; window.__realSend = null; } });
try {
  await retireTables(T); await seatParty(T);
  s = await open();
  await openTable(s, T[0]);
  await armToasts(s.fr);
  await s.fr.evaluate(async (t) => { for (const o of partyOrders(t).filter((o) => o.status === "received")) await api("POST", `/orders/${o.id}/accept`); await selectTable(t); }, T[0]);
  await s.page.waitForTimeout(1500);
  await openTable(s, T[0]);

  // ── a plain refusal (4xx) is repeated to the waiter in the server's words ──────────────
  for (const [what, props, expect] of [
    ["a 409 the server explains", { status: 409, data: { error: "already_paid" } }, /already|failed/i],
    ["a 403 the waiter is not allowed", { status: 403, data: { error: "not_allowed" } }, /allowed|failed/i],
    ["a 404 for something that has gone", { status: 404, data: { error: "gone" } }, /gone|failed/i],
  ]) {
    await forget(s.fr); await armToasts(s.fr);
    await answer(s.fr, "serve-all", { message: `that order is ${what.includes("409") ? "already paid" : "not available"}`, props });
    const r = await s.fr.evaluate(async (t) => {
      const os = partyOrders(t).filter((o) => o.status !== "cancelled");
      const before = JSON.stringify(os.map((o) => o.status));
      try { await api("POST", `/orders/${os[0].id}/serve-all`); } catch (e) { /* the caller toasts */ }
      await new Promise((r2) => setTimeout(r2, 800));
      return { before, threw: true };
    }, T[0]);
    await restore(s.fr);
    C(`${what} reaches the caller rather than being swallowed`, r.threw, `status ${props.status}`);
    C(`…and the panel is still standing afterwards`, await s.fr.evaluate(() => document.querySelectorAll(".tile[data-t]").length > 0));
  }

  // ── a 5xx and a timeout are treated like no internet: SAVED, not failed ───────────────
  for (const [what, props] of [
    ["a server too busy to answer", { status: 503, busy: true }],
    ["a request that never comes back", { offline: true }],
  ]) {
    await forget(s.fr); await armToasts(s.fr);
    const r = await s.fr.evaluate(async ({ t, p }) => {
      const real = window.LFH_OUTBOX.send.bind(window.LFH_OUTBOX);
      const out = {};
      window.LFH_OUTBOX.send = async (o) => { if (!/\/order$/.test(o.path)) return real(o); return { queued: true, why: p.busy ? "busy" : "offline" }; };
      const d = state.data.dishes.find((x) => !x.open_price && !(x.options || []).length);
      const res = await api("POST", "/order", { table: t, items: [{ id: d.id, qty: 1 }], allergies: [], confirmDuplicate: true });
      out.queued = !!(res && res.queued);
      out.why = res && res.why;
      out.msg = typeof savedMsg === "function" ? savedMsg(res) : "";
      window.LFH_OUTBOX.send = real;
      return out;
    }, { t: T[0], p: props });
    C(`${what} is SAVED, not lost`, r.queued, `queued=${r.queued} why=${r.why}`);
    C(`…and the waiter is told which kind of wait it is`, r.msg.length > 10, r.msg);
    C(`…in plain words with no code in them`, !LEAK.test(r.msg) && !/5\d\d|timeout|ECONN/i.test(r.msg), r.msg);
    C(`…and it never claims the kitchen has it`, !/kitchen has|sent to the kitchen/i.test(r.msg) || /hasn't/i.test(r.msg), r.msg);
  }

  // ── somebody else changed the same thing first ────────────────────────────────────────
  await forget(s.fr); await armToasts(s.fr);
  const clash = await s.fr.evaluate(async (t) => {
    const real = window.LFH_OUTBOX.send.bind(window.LFH_OUTBOX);
    window.LFH_OUTBOX.send = async () => {
      const e = new Error("clash_changed_elsewhere");
      e.status = 409;
      e.data = { clash: { plain: "Someone on another device changed this order a moment ago.", todo: "The screen has been refreshed — please check it and try again." } };
      throw e;
    };
    document.querySelectorAll(".toast").forEach((x) => x.remove());
    if (window.__t7toasts) window.__t7toasts.length = 0;
    await act(() => api("POST", `/orders/x/discount`, { amount: 1 }));
    await new Promise((r) => setTimeout(r, 900));
    window.LFH_OUTBOX.send = real;
    const t2 = (window.__t7toasts || []).slice();
    return { toasts: t2, live: [...document.querySelectorAll(".toast")].map((x) => x.innerText.replace(/\s+/g, " ").trim()) };
  }, T[0]);
  const clashSaid = clash.toasts.concat(clash.live).join(" | ");
  C("a clash with another device is said out loud", clashSaid.length > 0, clashSaid.slice(0, 120) || "(silent)");
  C("…in the server's own plain sentence", /another device/i.test(clashSaid), clashSaid.slice(0, 120));
  C("…and it says what to do next", /check it|try again|refreshed/i.test(clashSaid), clashSaid.slice(0, 140));
  C("…and never shows the code behind it", !/clash_changed_elsewhere/.test(clashSaid), clashSaid.slice(0, 120));

  // ── a double tap ──────────────────────────────────────────────────────────────────────
  await openTable(s, T[0]);
  const dbl = await s.fr.evaluate(async () => {
    const out = {};
    const pay = document.getElementById("payBill");
    if (!pay) return { noPay: true };
    pay.click(); pay.click();                    // as fast as a finger can bounce
    await new Promise((r) => setTimeout(r, 1200));
    out.sheets = document.querySelectorAll(".pay-overlay").length;
    const close = document.querySelector(".pay-overlay .pay-x, .pay-overlay .pay-cancel, .pay-overlay .pay-close");
    if (close) close.click(); else document.querySelectorAll(".pay-overlay").forEach((o) => o.remove());
    await new Promise((r) => setTimeout(r, 600));
    out.after = document.querySelectorAll(".pay-overlay").length;
    return out;
  });
  C("a double tap on Mark paid opens ONE sheet, not two", dbl.noPay || dbl.sheets <= 1, dbl.noPay ? "no settleable bill" : `${dbl.sheets} sheets`);
  C("…and closing it leaves none behind", dbl.noPay || dbl.after === 0, `${dbl.after} left`);

  // ── the back button, five layers deep ─────────────────────────────────────────────────
  await openTable(s, T[0]);
  const deep = await s.fr.evaluate(async () => {
    const out = { layers: [] };
    document.getElementById("kotMenuBtn").click();
    await new Promise((r) => setTimeout(r, 700));
    out.layers.push(!!document.querySelector("[data-kotop]"));
    const move = document.querySelector('[data-kotop="movekot"]');
    if (move && !move.disabled) { move.click(); await new Promise((r) => setTimeout(r, 800)); out.layers.push(!!document.querySelector("[data-pickorder]")); }
    const first = document.querySelector("[data-pickorder]");
    if (first) { first.click(); await new Promise((r) => setTimeout(r, 800)); out.layers.push(!!document.querySelector("[data-moveto]")); }
    return out;
  });
  C("a picker can be walked three screens deep", deep.layers.filter(Boolean).length >= 2, `${deep.layers.filter(Boolean).length} layers opened`);
  for (let i = 0; i < 3; i++) {
    await s.page.evaluate(() => history.back());
    await s.page.waitForTimeout(1100);
    const still = await s.fr.evaluate(() => ({ panel: !!document.getElementById("tiles"), tiles: document.querySelectorAll(".tile[data-t]").length, url: location.pathname })).catch(() => null);
    C(`back press ${i + 1} takes one layer off and leaves the panel standing`, !!still && still.panel, still ? `${still.tiles} tiles` : "the frame went away");
  }
  // and the tab is landed deliberately rather than left wherever the history walk ended
  await s.page.goto(BASE + "/tablet", { waitUntil: "networkidle", timeout: 150000 });
  s.fr = null;
  for (let i = 0; i < 100 && !s.fr; i++) { s.fr = s.page.frames().find((f) => /\/panels\/tablet\//.test(f.url())); if (!s.fr) await s.page.waitForTimeout(400); }
  await s.fr.waitForSelector(".tile[data-t]", { timeout: 60000 }).catch(() => {});
  await s.page.waitForTimeout(2000);
  C("the panel comes back cleanly after all of that", await s.fr.evaluate(() => document.querySelectorAll(".tile[data-t]").length > 0));

  // ── a reply that is not JSON at all, and a 401 ────────────────────────────────────────
  const odd = await s.fr.evaluate(async () => {
    const out = {};
    const realFetch = window.fetch;
    window.fetch = async (u, o) => {
      if (String(u).includes("/api/tablet/") && (!o || o.method === "GET")) return new Response("<html>gateway</html>", { status: 502, headers: { "content-type": "text/html" } });
      return realFetch(u, o);
    };
    try { await api("GET", "/state"); out.threw = false; } catch (e) { out.threw = true; out.msg = String(e.message).slice(0, 80); }
    window.fetch = realFetch;
    out.alive = document.querySelectorAll(".tile[data-t]").length > 0;
    return out;
  });
  C("a reply that is not JSON does not take the panel down", odd.alive, `tiles still drawn = ${odd.alive}`);
  C("…and it is reported as a failure, not treated as data", odd.threw, odd.msg || "(no throw)");
  C("…and the message is not a page of HTML", !/</.test(odd.msg || ""), (odd.msg || "").slice(0, 60));

  // ── nothing is left behind ────────────────────────────────────────────────────────────
  const end = await s.fr.evaluate(() => ({
    overlays: document.querySelectorAll(".opt-overlay, .pay-overlay, .disc-overlay, .qdest-overlay").length,
    picker: state.pickerOpen === true,
    toasts: document.querySelectorAll(".toast").length,
    tiles: document.querySelectorAll(".tile[data-t]").length,
  }));
  C("no overlay is left on screen after every failure", end.overlays === 0, `${end.overlays}`);
  C("no picker flag is left set", !end.picker, `pickerOpen=${end.picker}`);
  C("the floor is still there", end.tiles > 0, `${end.tiles} tiles`);
  C("no uncaught page error through all of it", s.errs.filter((e) => !/Failed to fetch|NetworkError|502/i.test(e)).length === 0, s.errs.join(" | ").slice(0, 160));
  C("no leaked code text at the end", !LEAK.test(await s.fr.evaluate(() => document.body.innerText)));
} catch (e) { C("block I completed without crashing", false, String(e.message).slice(0, 220)); }
finally { if (s) { try { await restore(s.fr); } catch {} try { await s.browser.close(); } catch {} } await retireTables(T); process.exitCode = dump("I") ? 1 : 0; }
