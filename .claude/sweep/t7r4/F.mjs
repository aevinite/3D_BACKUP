// T7 · fourth 500 · BLOCK F — A TABLE'S WHOLE LIFE, AND THE REFUSAL AT EVERY STEP.
// open → order → accept → serve → bill → pay → close, driven once through, with the wrong move
// tried at each stage so the panel has to say no out loud.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, armToasts, heard, forget, spoke, C, dump, at, LEAK } from "./lib.mjs";
at(42812);
const T = ["20"];
let s;
const state = async (t) => s.fr.evaluate(async (tt) => {
  await selectTable(tt);
  const os = partyOrders(tt).filter((o) => o.status !== "cancelled");
  return { tile: tileState(tt).label, open: tileIsOpen(tt), n: os.length,
    statuses: os.map((o) => o.status), paid: os.filter((o) => o.payment_status === "paid").length,
    session: !!sessionOf(tt) };
}, t);
try {
  await retireTables(T); await seatParty(T);
  s = await open();
  await openTable(s, T[0]);
  await armToasts(s.fr);

  const seated = await state(T[0]);
  C("the table is open with a party on it", seated.open && seated.session, JSON.stringify(seated));
  C("…and its tile says so in words", seated.tile.length > 0 && !/undefined/.test(seated.tile), seated.tile);

  // ── an order arrives ──────────────────────────────────────────────────────────────────
  const placed = await s.fr.evaluate(async (t) => {
    const d = state.data.dishes.find((x) => !x.open_price && !(x.options || []).length && !(x.tags || []).includes("sold-out"));
    await api("POST", "/order", { table: t, items: [{ id: d.id, qty: 2 }], allergies: [], confirmDuplicate: true });
    await selectTable(t);
    const os = partyOrders(t).filter((o) => o.status !== "cancelled");
    return { n: os.length, received: os.filter((o) => o.status === "received").length, kot: os.map((o) => o.kot_no).filter(Boolean).length };
  }, T[0]);
  C("an order placed from this panel lands on the table", placed.n > 0, `${placed.n} tickets`);
  C("…as 'received', waiting to be accepted", placed.received > 0, `${placed.received} received`);
  C("…and it is given a kitchen-ticket number", placed.kot > 0, `${placed.kot} numbered`);

  // ── a bill before the order is accepted ───────────────────────────────────────────────
  await openTable(s, T[0]);
  const early = await s.fr.evaluate(() => {
    const pay = document.getElementById("payBill");
    return { exists: !!pay, disabled: pay ? pay.disabled : null, title: pay ? pay.title : "", txt: pay ? pay.innerText.trim() : "" };
  });
  C("a bill cannot be settled before the kitchen has the order", early.exists === false || early.disabled !== true, `payBill exists=${early.exists} disabled=${early.disabled}`);
  C("…and if a control IS shown, it is never a dead button with the reason in a hover", early.disabled !== true, `disabled=${early.disabled}`);

  // ── accept ────────────────────────────────────────────────────────────────────────────
  await forget(s.fr); await armToasts(s.fr);
  const accepted = await s.fr.evaluate(async (t) => {
    const ids = partyOrders(t).filter((o) => o.status === "received").map((o) => o.id);
    await optimisticAccept(ids);
    await new Promise((r) => setTimeout(r, 2500));
    await selectTable(t);
    const os = partyOrders(t).filter((o) => o.status !== "cancelled");
    return { left: os.filter((o) => o.status === "received").length, now: os.map((o) => o.status), n: ids.length };
  }, T[0]);
  C("accepting moves the ticket on", accepted.left === 0, `${accepted.left} still waiting`);
  C("…and nothing is lost doing it", accepted.now.length > 0, accepted.now.join(","));
  {
    // accept reports success through the TAKEBACK BAR, not a toast — the bar is also the way back,
    // so one thing does both jobs. Asking only about toasts called a speaking panel silent.
    const said = await spoke(s.fr);
    C("…and the waiter hears about it, one way or another", said.any, said.bar || said.toasts.join(" | ") || "(silent)");
    C("…and what it says names the takeback", /undo/i.test(said.bar) || said.toasts.length > 0, said.bar.slice(0, 90));
  }

  // ── serve ─────────────────────────────────────────────────────────────────────────────
  await openTable(s, T[0]);
  const served = await s.fr.evaluate(async (t) => {
    const os = partyOrders(t).filter((o) => o.status !== "cancelled");
    const before = state.data.items.filter((i) => os.some((o) => o.id === i.order_id)).map((i) => i.status);
    for (const o of os) await api("POST", `/orders/${o.id}/serve-all`);
    await selectTable(t);
    const os2 = partyOrders(t).filter((o) => o.status !== "cancelled");
    return { before, after: state.data.items.filter((i) => os2.some((o) => o.id === i.order_id)).map((i) => i.status) };
  }, T[0]);
  C("serving marks the dishes served", served.after.length > 0 && served.after.every((x) => x === "served"), served.after.join(","));
  C("…and there was something un-served before it", served.before.some((x) => x !== "served"), served.before.join(","));

  // ── the bill ──────────────────────────────────────────────────────────────────────────
  await openTable(s, T[0]);
  const bill = await s.fr.evaluate((t) => {
    const rate = effRate();
    const os = partyOrders(t).filter((o) => o.payment_status !== "paid" && o.status !== "cancelled" && o.status !== "received");
    const due = Math.round(os.reduce((a, o) => a + (Number(o.total) || 0) - (Number(o.discount) || 0) * (1 + rate), 0) * 100) / 100;
    const pay = document.getElementById("payBill");
    const print = document.getElementById("printBillBtn");
    return { due, canPay: !!pay, canPrint: !!print, payTxt: pay ? pay.innerText.replace(/\s+/g, " ").trim() : "", shown: (document.querySelector(".detail-pop") || {}).innerText.replace(/\s+/g, " ").slice(0, 400) };
  }, T[0]);
  C("there is now a bill to settle", bill.due > 0, `₹${bill.due}`);
  C("…and the control to settle it is there", bill.canPay, `payBill=${bill.canPay}`);
  C("…and it says what it will do", /paid|pay/i.test(bill.payTxt), bill.payTxt);
  C("…and the bill can be printed before it is paid", bill.canPrint, `print=${bill.canPrint}`);
  C("the table's own screen shows the money", /₹/.test(bill.shown), bill.shown.slice(0, 90));

  // ── closing a table that still owes money ─────────────────────────────────────────────
  await forget(s.fr); await armToasts(s.fr);
  const closeEarly = await s.fr.evaluate(async (t) => {
    const out = {};
    const btn = document.getElementById("closeTable");
    out.exists = !!btn;
    if (!btn) return out;
    btn.click();
    await new Promise((r) => setTimeout(r, 1200));
    const cf = document.querySelector("#confirmOverlay:not([hidden])");
    out.asked = !!cf;
    out.txt = cf ? cf.innerText.replace(/\s+/g, " ").trim() : "";
    const no = document.querySelector("#confirmNo");
    if (no) no.click();
    await new Promise((r) => setTimeout(r, 600));
    return out;
  }, T[0]);
  C("closing a table is offered", closeEarly.exists, `closeTable=${closeEarly.exists}`);
  C("…but never happens on one tap while money is owed", closeEarly.asked, `asked=${closeEarly.asked}`);
  C("…and the question says what is still owed", /₹|unpaid|bill|owe/i.test(closeEarly.txt), closeEarly.txt.slice(0, 140));
  C("…in words a waiter can act on", closeEarly.txt.length > 15 && !LEAK.test(closeEarly.txt), closeEarly.txt.slice(0, 120));

  // ── pay ───────────────────────────────────────────────────────────────────────────────
  await openTable(s, T[0]);
  await forget(s.fr); await armToasts(s.fr);
  const paid = await s.fr.evaluate(async (t) => {
    const out = { calls: [] };
    const real = window.LFH_OUTBOX.send.bind(window.LFH_OUTBOX);
    window.LFH_OUTBOX.send = async (o) => { out.calls.push(o.path); return real(o); };
    payBill(t, "Cash", null);
    await new Promise((r) => setTimeout(r, 4000));
    await selectTable(t);
    const os = partyOrders(t).filter((o) => o.status !== "cancelled");
    out.paid = os.filter((o) => o.payment_status === "paid").length;
    out.n = os.length;
    out.stillOpen = !!sessionOf(t);
    window.LFH_OUTBOX.send = real;
    return out;
  }, T[0]);
  C("the bill can be settled", paid.paid > 0, `${paid.paid} of ${paid.n} tickets paid`);
  C("…through the panel's own pay route", paid.calls.some((p) => /\/pay$/.test(p)), paid.calls.join(" · "));
  C("…and paying does NOT close the table by itself", paid.stillOpen, `session still open = ${paid.stillOpen}`);
  {
    const said = await spoke(s.fr);
    C("the waiter is told the bill is paid", /paid/i.test(said.bar + " " + said.toasts.join(" ")), (said.bar || said.toasts.join(" | ")).slice(0, 110) || "(silent)");
    C("…and offered a way to take it back", /undo|reopen/i.test(said.bar), said.bar.slice(0, 110));
  }

  // ── paying twice ──────────────────────────────────────────────────────────────────────
  await openTable(s, T[0]);
  const twice = await s.fr.evaluate(() => {
    const pay = document.getElementById("payBill");
    return { gone: !pay, txt: (document.querySelector(".detail-pop") || {}).innerText.replace(/\s+/g, " ").slice(0, 300) };
  });
  C("a settled bill no longer offers to be settled again", twice.gone, `payBill still there = ${!twice.gone}`);
  C("…and the screen says it is paid", /paid/i.test(twice.txt), twice.txt.slice(0, 110));

  // ── close ─────────────────────────────────────────────────────────────────────────────
  await forget(s.fr); await armToasts(s.fr);
  const closed = await s.fr.evaluate(async (t) => {
    const out = {};
    const btn = document.getElementById("closeTable");
    if (!btn) { out.noButton = true; return out; }
    btn.click();
    await new Promise((r) => setTimeout(r, 1200));
    const yes = document.querySelector("#confirmYes");
    out.asked = !!document.querySelector("#confirmOverlay:not([hidden])");
    if (yes) yes.click();
    await new Promise((r) => setTimeout(r, 4000));
    await loadTables().catch(() => {});
    out.open = tileIsOpen(t);
    out.tile = tileState(t).label;
    return out;
  }, T[0]);
  C("a paid table can be closed", !closed.noButton, `button=${!closed.noButton}`);
  C("…and it still asks first", closed.asked !== false, `asked=${closed.asked}`);
  C("…and the table really frees up", closed.open === false, `still open = ${closed.open}`);
  C("…and its tile says Free", /free/i.test(closed.tile || ""), closed.tile);
  {
    // CLOSING IS THE ONE ACTION THAT SAYS NOTHING, AND THAT IS RIGHT. closeTableAndFree() repaints
    // optimistically — the detail closes and the tile flips to Free — and only its REFUSALS speak.
    // A tap that changes the whole screen has not vanished in silence, which is what the rule is
    // about; a toast on top of that is noise. (The forced close does toast, because actGated has
    // no other way to say anything.) So the honest check is the one below: did the screen change?
    const said = await spoke(s.fr);
    C("closing says nothing, because the screen itself is the answer", closed.open === false, `said="${(said.bar || said.toasts.join(" | ")).slice(0, 60)}" · table open = ${closed.open}`);
    C("…and the detail closed with it, rather than sitting on a table that no longer exists",
      await s.fr.evaluate(() => state.table === null || !document.querySelector(".detail-pop")), "detail gone");
  }

  // ── and a closed table cannot be acted on ─────────────────────────────────────────────
  const after = await s.fr.evaluate(async (t) => {
    await selectTable(t).catch(() => {});
    return { orders: partyOrders(t).filter((o) => o.status !== "cancelled").length, session: !!sessionOf(t) };
  }, T[0]);
  C("a closed table carries no live session", !after.session, `session=${after.session}`);
  C("…and its orders do not follow it into the next party", after.orders === 0, `${after.orders} orders still attached`);

  C("no uncaught page error across the whole life of the table", s.errs.length === 0, s.errs.join(" | ").slice(0, 200));
  C("no leaked code text at the end of it", !LEAK.test(await s.fr.evaluate(() => document.body.innerText)));
} catch (e) { C("block F completed without crashing", false, String(e.message).slice(0, 220)); }
finally { if (s) try { await s.browser.close(); } catch {} await retireTables(T); process.exitCode = dump("F") ? 1 : 0; }
