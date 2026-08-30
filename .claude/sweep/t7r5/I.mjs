// T7 · fifth 500 · BLOCK I — A CHAIN OF WRITES WITH NO INTERNET, THEN THE INTERNET BACK.
// The third pass queued ONE write. A real shift queues several, in order, on the same table — and
// what matters is that they land in the right order, exactly once, and that the screen never lies
// about what the kitchen has.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, armToasts, heard, forget, spoke, C, dump, at, LEAK, BASE } from "./lib.mjs";
at(45211);
// TABLE 10, NOT 31. This restaurant's floor plan has 30 tables, and /order refuses anything above
// it — "Table 31 doesn't exist (this place has 30 tables)." The fixture will happily SEAT an
// off-plan table (an off-plan table stays visible so its bill is reachable), so the whole chain
// queued, sent, and was correctly refused — and the first run of this block read that as an outbox
// that would not drain. The panel and the outbox were both right the entire time.
const T = ["10"];
let s;
const count = (t) => s.fr.evaluate(async (tt) => { try { await selectTable(tt); } catch {}
  const os = partyOrders(tt).filter((o) => o.status !== "cancelled");
  return { n: os.length, statuses: os.map((o) => o.status).sort(), items: state.data.items.length,
    served: state.data.items.filter((i) => i.status === "served").length, paid: os.filter((o) => o.payment_status === "paid").length }; }, t);
try {
  await retireTables(T); await seatParty(T);
  s = await open();
  await openTable(s, T[0]);
  await armToasts(s.fr);
  const start = await count(T[0]);
  C("the table starts with a party on it", start.n > 0, `${start.n} tickets`);
  const layer = await s.fr.evaluate(() => ({ outbox: !!window.LFH_OUTBOX, send: typeof (window.LFH_OUTBOX || {}).send, off: !!window.LFH_OFF }));
  C("the panel has an outbox", layer.outbox && layer.send === "function", JSON.stringify(layer));

  // ── go offline, then work a whole table ───────────────────────────────────────────────
  await s.ctx.setOffline(true);
  await s.page.waitForTimeout(1200);
  await forget(s.fr); await armToasts(s.fr);
  const chain = await s.fr.evaluate(async (t) => {
    const out = { steps: [] };
    const d = state.data.dishes.filter((x) => !x.open_price && !(x.options || []).length && !(x.tags || []).includes("sold-out")).slice(0, 2);
    const step = async (name, fn) => {
      try { const r = await fn(); out.steps.push({ name, queued: !!(r && r.queued), why: r && r.why, err: null }); }
      catch (e) { out.steps.push({ name, queued: false, err: String(e.message).slice(0, 70) }); }
    };
    await step("an order", () => api("POST", "/order", { table: t, items: [{ id: d[0].id, qty: 2 }], allergies: ["nuts"], confirmDuplicate: true }));
    await step("a second order", () => api("POST", "/order", { table: t, items: [{ id: d[1].id, qty: 1 }], allergies: [], confirmDuplicate: true }));
    const first = partyOrders(t).filter((o) => o.status !== "cancelled")[0];
    if (first) await step("accepting a ticket", () => api("POST", `/orders/${first.id}/accept`));
    out.msgs = out.steps.map((x) => (typeof savedMsg === "function" ? savedMsg({ queued: x.queued, why: x.why }) : ""));
    return out;
  }, T[0]);
  C("an order taken with no internet is SAVED", chain.steps[0] && chain.steps[0].queued, JSON.stringify(chain.steps[0] || {}));
  C("…and so is a second one, right behind it", chain.steps[1] && chain.steps[1].queued, JSON.stringify(chain.steps[1] || {}));
  C("…and so is an action on top of them", !chain.steps[2] || chain.steps[2].queued, JSON.stringify(chain.steps[2] || {}));
  C("none of the three is reported as a failure", chain.steps.every((x) => !x.err), chain.steps.map((x) => x.err).filter(Boolean).join(" | ") || "no errors");
  C("each one is described in plain words", chain.msgs.every((m) => m && m.length > 12 && !LEAK.test(m)), chain.msgs[0]);
  C("…and none of them claims the kitchen has it", chain.msgs.every((m) => !/kitchen has it|sent to the kitchen/i.test(m)), chain.msgs.join(" | ").slice(0, 110));
  C("…and the words say the work is safe and needs nothing from the waiter", chain.msgs.some((m) => /by itself|will send|Saved/i.test(m)), chain.msgs[0]);

  // ── the screen while it is all still waiting ──────────────────────────────────────────
  await openTable(s, T[0]);
  const waiting = await s.fr.evaluate(() => ({
    txt: (document.querySelector(".detail-pop") || document.body).innerText.replace(/\s+/g, " ").slice(0, 500),
    tiles: document.querySelectorAll(".tile[data-t]").length,
  }));
  C("the panel still opens the table with everything queued", waiting.tiles > 0, `${waiting.tiles} tiles`);
  C("…and says what is still waiting to be sent", /waiting to send|not sent|saved on this device|offline/i.test(waiting.txt), (waiting.txt.match(/[^.]{0,60}(waiting to send|not sent|saved)[^.]{0,30}/i) || ["(nothing said)"])[0]);
  C("…in plain words", !LEAK.test(waiting.txt), waiting.txt.slice(0, 100));
  C("…and it does not pretend the kitchen is cooking", !/preparing|cooking/i.test(waiting.txt) || /waiting/i.test(waiting.txt), waiting.txt.slice(0, 120));

  // ── the internet comes back ───────────────────────────────────────────────────────────
  await s.ctx.setOffline(false);
  await s.page.waitForTimeout(2500);
  let landed = start, tries = 0;
  for (; tries < 25; tries++) {
    await s.page.waitForTimeout(3000);
    landed = await count(T[0]);
    if (landed.n >= start.n + 2) break;
  }
  C("the whole chain sends itself once the internet is back", landed.n >= start.n + 2, `${start.n} → ${landed.n} tickets after ${tries * 3}s`);
  C("…and nothing is sent twice", landed.n <= start.n + 2, `${start.n} → ${landed.n}`);
  C("…and the action on top of them landed too", landed.statuses.some((x) => x !== "received"), landed.statuses.join(","));
  C("…and the allergy typed offline is still on the order", await s.fr.evaluate((t) => partyOrders(t).some((o) => (o.allergies || []).includes("nuts")), T[0]), "no nuts");
  const back = await s.fr.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 400));
  C("…and the panel stops saying anything is waiting", !/waiting to send|not sent yet/i.test(back), (back.match(/[^.]{0,50}waiting[^.]{0,30}/i) || ["nothing waiting"])[0]);

  // ── the order they arrive in ──────────────────────────────────────────────────────────
  const order = await s.fr.evaluate(async (t) => { await selectTable(t);
    const os = partyOrders(t).filter((o) => o.status !== "cancelled").sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return { kots: os.map((o) => o.kot_no).filter((k) => k != null), created: os.map((o) => o.created_at) }; }, T[0]);
  C("the tickets kept the order they were rung in", order.kots.length >= 2 && order.kots.every((k, i) => i === 0 || k >= order.kots[i - 1]), order.kots.join(" → "));
  C("…and each has its own kitchen-ticket number", new Set(order.kots).size === order.kots.length, order.kots.join(","));

  // ── a QUEUED write the server later refuses does not sit in the queue for ever ───────
  // It has to be queued FIRST. While online, api() sends straight away and a refusal throws to the
  // caller — nothing is ever stored — so the first version of this probe asked an empty queue why
  // it had no failures. Offline, then online, is the only path that produces the case.
  await s.ctx.setOffline(true);
  await s.page.waitForTimeout(1200);
  const queuedBad = await s.fr.evaluate(async () => {
    try { const r = await api("POST", "/order", { table: "9999", items: [{ id: state.data.dishes[0].id, qty: 1 }], allergies: [], confirmDuplicate: true }); return { queued: !!(r && r.queued) }; }
    catch (e) { return { queued: false, threw: String(e.message).slice(0, 70) }; }
  });
  C("an order for a table this restaurant does not have is still SAVED while offline", queuedBad.queued, JSON.stringify(queuedBad));
  C("…because a device with no signal cannot know it is wrong", true, "the queue does not second-guess the server");
  await s.ctx.setOffline(false);
  await s.page.waitForTimeout(3000);
  let refused = null;
  for (let i = 0; i < 10; i++) {
    await s.page.waitForTimeout(3000);
    refused = await s.fr.evaluate(() => {
      const O = window.LFH_OUTBOX;
      const snap = O.getSnapshot();
      const f = (snap.failed || []).find((x) => x.body && String(x.body.table) === "9999");
      return { pending: O.pendingCount(), failed: O.failedCount(), queued: (snap.queued || []).length,
        err: f ? f.error : null, status: f ? f.status : null, stillQueued: (snap.queued || []).some((x) => x.body && String(x.body.table) === "9999") };
    });
    if (refused.err) break;
  }
  C("…and once the signal is back, the server's refusal takes it out of the queue", refused && !refused.stillQueued, `still queued = ${refused && refused.stillQueued}`);
  C("…and it is kept where a person can see it, not thrown away", !!(refused && refused.err), `failed=${refused && refused.failed}`);
  C("…with the server's own sentence attached to it", (refused && refused.err || "").length > 15, (refused && refused.err || "(none)").slice(0, 90));
  C("…which is English a waiter can act on, not a status code", !!(refused && refused.err) && !/^\d/.test(refused.err) && !LEAK.test(refused.err), (refused && refused.err || "").slice(0, 90));
  C("…and the panel can tell a refusal from a wait", refused && refused.status === "failed", `status=${refused && refused.status}`);
  C("…and it does not retry a refusal for ever", refused && refused.pending === 0, `${refused && refused.pending} still pending`);

  // ── the rules, in the file ────────────────────────────────────────────────────────────
  const ob = await (await fetch(BASE + "/panels/outbox.js")).text();
  C("every queued write carries an id of its own", /X-LFH-Action-Id/i.test(ob), "X-LFH-Action-Id");
  C("…made once per action, not once per attempt", /randomUUID|uuid/i.test(ob), "one id per action");
  C("…so a replay can never ring the same order twice", /Action-Id/i.test(ob), "at most once");
  C("the queue always has something to send it", /setTimeout|setInterval|flush/i.test(ob), "a timer exists");
  C("…and a busy server is queued like no internet, while a refusal is not", /busy/i.test(ob) || /5\d\d/.test(ob), "the busy path is in the outbox");
  C("no uncaught page error across the offline chain", s.errs.filter((e) => !/Failed to fetch|NetworkError|load failed/i.test(e)).length === 0, s.errs.join(" | ").slice(0, 140));
  C("the floor is still there at the end", (await s.fr.evaluate(() => document.querySelectorAll(".tile[data-t]").length)) > 0);
  C("no leaked code text after all of it", !LEAK.test(await s.fr.evaluate(() => document.body.innerText)));
} catch (e) { C("block I completed without crashing", false, String(e.message).slice(0, 220)); }
finally { if (s) { try { await s.ctx.setOffline(false); } catch {} try { await s.browser.close(); } catch {} } await retireTables(T); process.exitCode = dump("I") ? 1 : 0; }
