// T7 · third 500 · BLOCK E (P40714–P40749) — MOVING A KOT AND A DISH, FOR REAL.
// Both earlier passes stopped at "the picker offers the right tables". This does the move, checks
// the money landed on the other bill, and puts it back.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, toasts, clearToasts, armToasts, heard, forget, C, dump, at, LEAK } from "./lib.mjs";
at(40714);
const A = "26", B = "27";
let s;
// state.data.orders only ever holds the SELECTED table's slice, so a bill has to be OPENED before
// it can be counted. Measuring T27 while T26 was on screen reported "0 tickets" for a table that
// had just received one — the money check was reading an empty slice, not an empty bill.
const money = async (sess, t) => {
  await openTable(sess, t);
  return billOf(sess.fr, t);
};
const billOf = (fr, t) => fr.evaluate((tt) => {
  const rate = effRate();
  const os = partyOrders(tt).filter((o) => o.status !== "cancelled");
  return { n: os.length, due: Math.round(os.reduce((x, o) => x + (Number(o.total) || 0) - (Number(o.discount) || 0) * (1 + rate), 0) * 100) / 100, kots: os.map((o) => o.kot_no).filter(Boolean) };
}, t);
try {
  await retireTables([A, B]); await seatParty([A, B]);
  s = await open();
  await openTable(s, A);
  await armToasts(s.fr);
  const setup = await s.fr.evaluate(async (a) => {
    const ds = state.data.dishes.filter((x) => !x.open_price && !(x.options || []).length && !(x.tags || []).includes("sold-out")).slice(0, 2);
    await api("POST", "/order", { table: a, items: [{ id: ds[0].id, qty: 2 }, { id: ds[1].id, qty: 1 }], allergies: [], confirmDuplicate: true });
    await load();
    const mine = state.data.orders.filter((o) => String(o.table_number) === a && o.status === "received");
    for (const o of mine) await api("POST", `/orders/${o.id}/accept`);
    await load();
    return state.data.orders.filter((o) => String(o.table_number) === a && o.status !== "cancelled").length;
  }, A);
  await s.page.waitForTimeout(2000);
  C("the fixture put more than one kitchen ticket on the source table", setup >= 2, `${setup} tickets on T${A}`);

  await openTable(s, A);
  const before = { b: await money(s, B), a: await money(s, A) };
  C("the source table has money on it before the move", before.a.due > 0, `T${A}: ₹${before.a.due} across ${before.a.n} tickets`);

  // ── move ONE kitchen ticket ────────────────────────────────────────────────────────────
  await s.fr.evaluate(() => document.getElementById("kotMenuBtn").click());
  await s.fr.waitForSelector("[data-kotop]", { timeout: 30000 }); await s.page.waitForTimeout(400);
  const movable = await s.fr.evaluate(() => { const b = document.querySelector('[data-kotop="movekot"]'); return b ? { on: !b.disabled, txt: b.innerText.replace(/\s+/g, " ").trim() } : null; });
  C("the KOT sheet offers moving one ticket", movable && movable.on, movable ? movable.txt.slice(0, 90) : "row absent");
  C("…and says what that means in words", /ONE order|one KOT/i.test(movable.txt), movable.txt.slice(0, 100));
  await s.fr.evaluate(() => document.querySelector('[data-kotop="movekot"]').click());
  await s.fr.waitForSelector("[data-pickorder]", { timeout: 30000 }); await s.page.waitForTimeout(500);
  const orders = await s.fr.evaluate(() => [...document.querySelectorAll("[data-pickorder]")].map((b) => ({ id: b.dataset.pickorder, txt: b.innerText.replace(/\s+/g, " ").trim() })));
  C("the picker lists this table's tickets", orders.length >= 2, `${orders.length} tickets`);
  C("…each named by its KOT number and what it costs", orders.every((o) => /#/.test(o.txt) && /₹/.test(o.txt)), orders[0] ? orders[0].txt : "");
  C("…and none of them leaks code", orders.every((o) => !LEAK.test(o.txt)), orders.map((o) => o.txt).join(" | ").slice(0, 110));
  const picked = orders[0];
  await s.fr.evaluate((id) => document.querySelector(`[data-pickorder="${id}"]`).click(), picked.id);
  await s.fr.waitForSelector("[data-moveto]", { timeout: 30000 }); await s.page.waitForTimeout(500);
  const dests = await s.fr.evaluate((a) => ({ list: [...document.querySelectorAll("[data-moveto]")].map((b) => Number(b.dataset.moveto)), self: !![...document.querySelectorAll("[data-moveto]")].find((b) => b.dataset.moveto === a), q: (document.querySelector(".detail-body .muted") || {}).innerText || "" }), A);
  C("the destination step asks the question in words", /which table's bill/i.test(dests.q), dests.q.trim());
  C("…and never offers the table the ticket is already on", !dests.self, dests.list.slice(0, 12).join(","));
  C("…and offers the other seated table", dests.list.includes(Number(B)), `T${B} in [${dests.list.slice(0, 12).join(",")}…]`);
  await forget(s.fr); await armToasts(s.fr);
  await s.fr.evaluate((b) => document.querySelector(`[data-moveto="${b}"]`).click(), B);
  await s.page.waitForTimeout(4000);
  await s.fr.evaluate(async () => { await load(); }).catch(() => {});
  await s.page.waitForTimeout(1500);
  const said0 = (await heard(s.fr)).join(" | ");
  const after = { a: await money(s, A), b: await money(s, B) };
  C("the ticket really left the source table", after.a.n === before.a.n - 1, `${before.a.n} → ${after.a.n} tickets on T${A}`);
  C("…and really arrived on the other table's bill", after.b.n === before.b.n + 1, `${before.b.n} → ${after.b.n} tickets on T${B}`);
  C("the money moved with it — the source bill fell", after.a.due < before.a.due, `₹${before.a.due} → ₹${after.a.due}`);
  C("…and the destination bill rose by the same amount", Math.abs((after.b.due - before.b.due) - (before.a.due - after.a.due)) < 0.02, `T${B} +₹${(after.b.due - before.b.due).toFixed(2)} vs T${A} −₹${(before.a.due - after.a.due).toFixed(2)}`);
  C("nothing was created or lost overall", Math.abs((after.a.due + after.b.due) - (before.a.due + before.b.due)) < 0.02, `₹${(before.a.due + before.b.due).toFixed(2)} → ₹${(after.a.due + after.b.due).toFixed(2)}`);
  C("the ticket keeps its own KOT number on the new bill", after.b.kots.some((k) => before.a.kots.includes(k)), `moved KOTs now on T${B}: ${after.b.kots.join(",")}`);
  const said = said0;
  C("the waiter is told the ticket moved (item 19)", /KOT moved to/i.test(said), said.slice(0, 110) || "(nothing said)");
  C("…and the message names the table it went to", new RegExp(`T${B}\\b|table ${B}`, "i").test(said), said.slice(0, 110));

  // ── move ONE dish ──────────────────────────────────────────────────────────────────────
  await openTable(s, B);
  const beforeDish = { a: await money(s, A), b: await money(s, B) };
  await s.fr.evaluate(() => document.getElementById("kotMenuBtn").click());
  await s.fr.waitForSelector("[data-kotop]", { timeout: 30000 }); await s.page.waitForTimeout(400);
  const dishRow = await s.fr.evaluate(() => { const b = document.querySelector('[data-kotop="moveitem"]'); return b ? { on: !b.disabled, txt: b.innerText.replace(/\s+/g, " ").trim() } : null; });
  C("the KOT sheet offers moving a single dish", dishRow && dishRow.on, dishRow ? dishRow.txt.slice(0, 90) : "row absent");
  C("…and warns it makes a new ticket over there", /new KOT there/i.test(dishRow.txt), dishRow.txt.slice(0, 100));
  await s.fr.evaluate(() => document.querySelector('[data-kotop="moveitem"]').click());
  await s.page.waitForTimeout(1200);
  const items = await s.fr.evaluate(() => [...document.querySelectorAll("[data-mvitem]")].map((b) => ({ id: b.dataset.mvitem, txt: b.innerText.replace(/\s+/g, " ").trim() })));
  C("the dish picker lists the dishes on this bill", items.length > 0, `${items.length} dishes`);
  C("…each named, with its price", items.every((i) => i.txt.length > 2 && /₹/.test(i.txt)), items.map((i) => i.txt).join(" | ").slice(0, 110));
  C("…grouped under the kitchen ticket it came from", await s.fr.evaluate(() => /KOT #/.test(document.querySelector(".detail-body").innerText)), "KOT # heading");
  if (items.length) {
    await s.fr.evaluate((id) => document.querySelector(`[data-mvitem="${id}"]`).click(), items[0].id);
    await s.fr.waitForSelector("[data-mvto]", { timeout: 30000 }).catch(() => {});
    await s.page.waitForTimeout(600);
    const d2 = await s.fr.evaluate((b) => ({ list: [...document.querySelectorAll("[data-mvto]")].map((x) => Number(x.dataset.mvto)), self: !![...document.querySelectorAll("[data-mvto]")].find((x) => x.dataset.mvto === b), q: (document.querySelector(".detail-body .muted") || {}).innerText || "" }), B);
    C("the dish's destination picker never offers its own table", !d2.self, d2.list.slice(0, 12).join(","));
    C("…and offers the other table", d2.list.includes(Number(A)), `T${A} in [${d2.list.slice(0, 12).join(",")}…]`);
    await forget(s.fr); await armToasts(s.fr);
    await s.fr.evaluate((a) => document.querySelector(`[data-mvto="${a}"]`).click(), A);
    await s.page.waitForTimeout(4500);
    await s.fr.evaluate(async () => { await load(); }).catch(() => {});
    await s.page.waitForTimeout(1500);
    const afterDish = { a: await money(s, A), b: await money(s, B) };
    C("one dish moved leaves the source bill smaller", afterDish.b.due < beforeDish.b.due, `T${B} ₹${beforeDish.b.due} → ₹${afterDish.b.due}`);
    C("…and the other bill bigger by the same money", Math.abs((afterDish.a.due - beforeDish.a.due) - (beforeDish.b.due - afterDish.b.due)) < 0.02, `T${A} +₹${(afterDish.a.due - beforeDish.a.due).toFixed(2)}`);
    C("…and the whole floor's money is unchanged", Math.abs((afterDish.a.due + afterDish.b.due) - (beforeDish.a.due + beforeDish.b.due)) < 0.02, `₹${(beforeDish.a.due + beforeDish.b.due).toFixed(2)} → ₹${(afterDish.a.due + afterDish.b.due).toFixed(2)}`);
    C("…and it arrived as its own new kitchen ticket", afterDish.a.n >= beforeDish.a.n, `${beforeDish.a.n} → ${afterDish.a.n} tickets on T${A}`);
    const said2 = (await heard(s.fr)).join(" | ");
    C("the waiter is told the dish moved", said2.length > 0, said2.slice(0, 110) || "(nothing said)");
  } else { for (const w of ["the dish's destination picker never offers its own table", "…and offers the other table", "one dish moved leaves the source bill smaller", "…and the other bill bigger by the same money", "…and the whole floor's money is unchanged", "…and it arrived as its own new kitchen ticket", "the waiter is told the dish moved"]) C(w, false, "no movable dish"); }

  // ── a refused move must not leave the screen lying ─────────────────────────────────────
  await armToasts(s.fr); await forget(s.fr); await armToasts(s.fr);
  const refused = await s.fr.evaluate(async (a) => {
    const out = {};
    out.hit = 0;
    const real = window.LFH_OUTBOX.send.bind(window.LFH_OUTBOX);
    window.LFH_OUTBOX.send = async (o) => { if (!/\/move$/.test(o.path)) return real(o); out.hit++; const e = new Error("that table is no longer free"); e.status = 409; e.data = { error: "same_table" }; throw e; };
    document.querySelectorAll(".toast").forEach((t) => t.remove());
    const os = partyOrders(a).filter((o) => o.status !== "cancelled");
    const id = os[0] && os[0].id;
    const wasOn = os[0] && String(os[0].table_number);
    await runOptimistic(() => { const o = state.data.orders.find((x) => x.id === id); if (o) o.table_number = "999"; }, () => api("POST", `/orders/${id}/move`, { to: "999" }));
    await new Promise((r) => setTimeout(r, 1500));
    const now = state.data.orders.find((x) => x.id === id);
    out.snappedBack = now ? String(now.table_number) === wasOn : null;
    out.toasts = (window.__t7toasts || []).slice();
    out.live = [...document.querySelectorAll(".toast")].map((t) => t.innerText.replace(/\s+/g, " ").trim());
    out.id = id; out.wasOn = wasOn;
    window.LFH_OUTBOX.send = real;
    return out;
  }, A);
  C("the refusal probe really reached the move", refused.hit > 0, `stub hit ${refused.hit}× · order ${String(refused.id).slice(0, 8)} on T${refused.wasOn}`);
  C("a refused move is said out loud, never swallowed", refused.toasts.length > 0 || refused.live.length > 0, (refused.toasts.concat(refused.live)).join(" | ").slice(0, 110) || "(silent)");
  C("…in the server's own words, not a generic failure", refused.toasts.concat(refused.live).some((t) => /no longer free/i.test(t)), refused.toasts.concat(refused.live).join(" | ").slice(0, 110));
  C("…and the screen snaps back rather than showing a move that did not happen", refused.snappedBack !== false, `back on its table = ${refused.snappedBack}`);

  C("no uncaught page error while moving things", s.errs.length === 0, s.errs.join(" | ").slice(0, 200));
  C("no leaked code text after the moves", !LEAK.test(await s.fr.evaluate(() => document.body.innerText)));
} catch (e) { C("block E completed without crashing", false, String(e.message).slice(0, 220)); }
finally { if (s) try { await s.browser.close(); } catch {} await retireTables([A, B]); process.exitCode = dump("E") ? 1 : 0; }
