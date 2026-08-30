// T7 · fifth 500 · BLOCK D — TWO DEVICES ON THE SAME TABLE AT ONCE.
// Every earlier pass played the clash path from a stub. This opens the panel TWICE, as the same
// waiter on two tablets, and makes them fight over one bill.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, armToasts, heard, forget, spoke, C, dump, at, LEAK } from "./lib.mjs";
at(45020);
const T = ["24"];
let one, two;
const slice = (sess, t) => sess.fr.evaluate(async (tt) => { await selectTable(tt); const os = partyOrders(tt).filter((o) => o.status !== "cancelled");
  return { n: os.length, statuses: os.map((o) => o.status), items: state.data.items.map((i) => ({ id: i.id, qty: i.qty, status: i.status })), paid: os.filter((o) => o.payment_status === "paid").length }; }, t);
try {
  await retireTables(T); await seatParty(T);
  one = await open();
  two = await open();
  C("two tablets can be signed in at once, as the same waiter", !!one.fr && !!two.fr, "two panels open");
  for (const s of [one, two]) { await openTable(s, T[0]); await armToasts(s.fr); }
  await one.fr.evaluate(async (t) => {
    const d = state.data.dishes.find((x) => !x.open_price && !(x.options || []).length && !(x.tags || []).includes("sold-out"));
    await api("POST", "/order", { table: t, items: [{ id: d.id, qty: 3 }], allergies: [], confirmDuplicate: true });
    await selectTable(t);
    for (const o of partyOrders(t).filter((o) => o.status === "received")) await api("POST", `/orders/${o.id}/accept`);
    await selectTable(t);
  }, T[0]);
  await one.page.waitForTimeout(1500);
  const a0 = await slice(one, T[0]);
  const b0 = await slice(two, T[0]);
  C("both tablets see the same table", a0.n === b0.n && a0.n > 0, `${a0.n} vs ${b0.n} tickets`);
  C("…and the same dishes on it", a0.items.length === b0.items.length, `${a0.items.length} vs ${b0.items.length}`);
  C("…with the same statuses", JSON.stringify(a0.statuses) === JSON.stringify(b0.statuses), `${a0.statuses} vs ${b0.statuses}`);

  // ── device one serves; device two must find out ───────────────────────────────────────
  await one.fr.evaluate(async (t) => { for (const o of partyOrders(t).filter((o) => o.status !== "cancelled")) await api("POST", `/orders/${o.id}/serve-all`); await selectTable(t); }, T[0]);
  await one.page.waitForTimeout(1500);
  let sawIt = false, tries = 0;
  for (; tries < 12 && !sawIt; tries++) {
    await two.page.waitForTimeout(2500);
    const b = await slice(two, T[0]);
    sawIt = b.items.length > 0 && b.items.every((i) => i.status === "served");
  }
  C("a dish served on one tablet reaches the other", sawIt, `after ${tries} refresh(es)`);
  const a1 = await slice(one, T[0]), b1 = await slice(two, T[0]);
  C("…and the two agree afterwards", JSON.stringify(a1.items.map((i) => i.status).sort()) === JSON.stringify(b1.items.map((i) => i.status).sort()), `${a1.items.map((i) => i.status)} vs ${b1.items.map((i) => i.status)}`);

  // ── both change the SAME dish's quantity: first save wins, loser is told ──────────────
  await forget(two.fr); await armToasts(two.fr);
  const fight = await (async () => {
    const item = a1.items[0];
    if (!item) return { noItem: true };
    // NEVER SWALLOW THE SET-UP WRITE. The first version wrapped this in .catch(() => {}) — so when
    // it failed, the "fight" was between a device that had changed nothing and one that changed
    // something, and five rows blamed the product for accepting a save that had no rival.
    const first = await one.fr.evaluate(async ({ id, was }) => {
      try { await api("POST", `/items/${id}/qty`, { qty: 5 }, { expect: { table: "order_items", id, fields: { qty: was } } }); return { ok: true }; }
      catch (e) { return { ok: false, msg: String(e.message).slice(0, 100), data: JSON.stringify(e.data || {}).slice(0, 120) }; }
    }, { id: item.id, was: item.qty });
    await one.page.waitForTimeout(1200);
    if (!first.ok) return { setupFailed: true, first };
    // now device TWO tries to save the value it was showing
    return two.fr.evaluate(async ({ id, was }) => {
      const out = {};
      try {
        await api("POST", `/items/${id}/qty`, { qty: 4 }, { expect: { table: "order_items", id, fields: { qty: was } } });
        out.accepted = true;
      } catch (e) {
        out.accepted = false;
        out.clash = !!(e && e.data && e.data.clash);
        out.plain = e && e.data && e.data.clash ? e.data.clash.plain : String(e.message).slice(0, 90);
        out.todo = e && e.data && e.data.clash ? e.data.clash.todo : "";
      }
      return out;
    }, { id: item.id, was: item.qty });
  })();
  C("the first device's change really landed, so there IS something to clash with", !fight.setupFailed, fight.setupFailed ? `${fight.first.msg} ${fight.first.data}` : "qty 3 → 5 accepted");
  C("the second device's save is REFUSED, not silently applied over the first", fight.noItem || fight.setupFailed || fight.accepted === false, fight.noItem ? "no dish to fight over" : `accepted=${fight.accepted}`);
  C("…and the refusal is the clash the server means, not a generic error", fight.noItem || fight.setupFailed || fight.clash === true, fight.plain || "");
  C("…and it says what happened, in a sentence", fight.noItem || fight.setupFailed || (fight.plain || "").length > 20, (fight.plain || "").slice(0, 110));
  C("…and it says the change was NOT saved (item 23)", fight.noItem || fight.setupFailed || /not saved|NOT saved/i.test(fight.todo || ""), (fight.todo || "").slice(0, 120));
  C("…and neither half of it shows a code", fight.noItem || fight.setupFailed || (!LEAK.test(fight.plain || "") && !/clash_/.test((fight.plain || "") + (fight.todo || ""))), ((fight.plain || "") + " " + (fight.todo || "")).slice(0, 110));
  const won = await one.fr.evaluate(async (t) => { await selectTable(t); return state.data.items.map((i) => i.qty); }, T[0]);
  C("the FIRST save is what the table actually holds", fight.setupFailed || won.includes(5), won.join(","));

  // ── one device settles the bill; the other must not offer to settle it again ──────────
  await one.fr.evaluate(async (t) => { payBill(t, "Cash", null); }, T[0]);
  await one.page.waitForTimeout(4000);
  let gone = false; tries = 0;
  for (; tries < 12 && !gone; tries++) {
    await two.page.waitForTimeout(2500);
    await openTable(two, T[0]);
    gone = await two.fr.evaluate(() => !document.getElementById("payBill"));
  }
  C("a bill settled on one tablet stops being settleable on the other", gone, `after ${tries} refresh(es)`);
  const bothPaid = await slice(two, T[0]);
  C("…and the second tablet shows it as paid", bothPaid.paid > 0, `${bothPaid.paid} of ${bothPaid.n} paid`);
  C("…and it did not have to be reloaded by hand to find out", tries < 12, `${tries} polls`);

  // ── neither device is left with a stale screen ────────────────────────────────────────
  const ends = await Promise.all([one, two].map((s) => s.fr.evaluate(() => ({
    tiles: document.querySelectorAll(".tile[data-t]").length,
    overlays: document.querySelectorAll(".opt-overlay, .pay-overlay, .disc-overlay").length,
    txt: document.body.innerText.replace(/\s+/g, " ").slice(0, 200),
  }))));
  C("both tablets are still standing at the end", ends.every((e) => e.tiles > 0), ends.map((e) => e.tiles).join(" / "));
  C("…with nothing stacked on either of them", ends.every((e) => e.overlays === 0), ends.map((e) => e.overlays).join(" / "));
  C("…and no code text on either", ends.every((e) => !LEAK.test(e.txt)), ends[0].txt.slice(0, 80));
  C("no uncaught page error on the first tablet", one.errs.length === 0, one.errs.join(" | ").slice(0, 140));
  C("no uncaught page error on the second", two.errs.length === 0, two.errs.join(" | ").slice(0, 140));
} catch (e) { C("block D completed without crashing", false, String(e.message).slice(0, 220)); }
finally { for (const s of [one, two]) if (s) try { await s.browser.close(); } catch {} await retireTables(T); process.exitCode = dump("D") ? 1 : 0; }
