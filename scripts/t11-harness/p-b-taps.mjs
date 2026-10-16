// SWEEP #10 T11 ROUND 2 · THE KITCHEN SCREEN, SECTION B — every tap a cook makes. P180883–P180910.
// ✓ a dish, ALL READY, take-back, the delivery buttons, the 86 drawer, the 🖨 — each answered by the test as the
// server would (yes / refused / busy / no signal), and the screen read afterwards.
/* global state, toast -- the kitchen screen's own globals, used only inside functions that run IN THE PAGE (page.evaluate) */
import { open, board, order, item, plat, dish, k, sleep } from "./p-lib.mjs";

const T = () => board({
  orders: [order("c1", { kot_no: 12, table_number: 7 }), order("c2", { kot_no: 13, table_number: 8 }), order("l1", { kot_no: 16, table_number: 5, items: [{ title: "Old Soup", qty: 2, status: "preparing" }] })],
  items: [item("a1", "c1", { title: "Naan" }), item("a2", "c1", { title: "Rice", status: "ready" }), item("b1", "c2", { title: "Dal" }), item("b2", "c2", { title: "Roti" }), item("b3", "c2", { title: "Salad" })],
  tableNames: { 7: "Patio" },
});
const toasts = () => [...document.querySelectorAll("#toasts .toast span")].map((x) => x.textContent);

export default async function sectionB() {
  // ── ✓ one dish ────────────────────────────────────────────────────────────────────────────────
  let P = await open({ S: { board: T() } });
  await P.page.click('[data-item-ready="b1"]');
  await sleep(150);
  const one = await P.ev(() => ({ line: document.querySelector('[data-ticket="c2"] .line').className, tick: !!document.querySelector('[data-item-ready="b1"]'), bar: (() => { const b = document.getElementById("lfh-undobar"); return b && b.classList.contains("show") ? b.querySelector(".lfh-undo-title").textContent + " | " + b.querySelector(".lfh-undo-sub").textContent : null; })() }));
  const w1 = P.writes(/^\/items\/b1\/status$/);
  k("P180883", "✓ a dish: its line turns ready AT ONCE, the ✓ goes, one write { status: ready } is sent, and the take-back bar names the dish and the table",
    /line-ready/.test(one.line) && !one.tick && w1.length === 1 && w1[0].body.status === "ready" && /Dal marked ready/.test(one.bar || "") && /T8 · tap undo/.test(one.bar || ""), JSON.stringify([one, w1.length]));
  const readsBefore = P.reads(/^\/board$/).length; await sleep(2900);
  k("P180884", "…and ~2.5 s after the taps stop, ONE fresh board read reconciles with the server", P.reads(/^\/board$/).length === readsBefore + 1, `${readsBefore} → ${P.reads(/^\/board$/).length}`);
  await P.ev(() => document.querySelector("#lfh-undobar .lfh-undo-btn").click()); await sleep(400);
  const u1 = P.writes(/^\/items\/b1\/status$/);
  k("P180885", "UNDO on a single ✓ sends the dish back to exactly where it was (one write, status preparing) and the ✓ returns",
    u1.length === 2 && u1[1].body.status === "preparing" && await P.ev(() => !!document.querySelector('[data-item-ready="b1"]')), JSON.stringify(u1.map((x) => x.body)));
  // two quick taps on two dishes of the same ticket — neither is eaten
  await P.page.click('[data-item-ready="b2"]'); await P.page.click('[data-item-ready="b3"]'); await sleep(150);
  k("P180886", "two quick ✓ taps on one ticket both land (the first does not rebuild the card under the second)", P.writes(/^\/items\/b[23]\/status$/).length === 2 && await P.ev(() => !document.querySelector('[data-item-ready="b2"]') && !document.querySelector('[data-item-ready="b3"]')));
  // the ✓ that finishes a ticket slides it to Ready at once
  await P.page.click('[data-item-ready="a1"]'); await sleep(150);
  k("P180887", "the ✓ that finishes a ticket slides it into Ready at once and recounts both lanes", await P.ev(() => document.querySelector('.ticket[data-ticket="c1"]').parentElement.id === "list-ready" && document.getElementById("count-ready").textContent === String(document.querySelectorAll("#list-ready .ticket").length)));
  await P.close();

  // ── ✓ refused, busy, no signal ────────────────────────────────────────────────────────────────
  P = await open({ S: { board: T(), answer: (c) => c.sub === "/items/b1/status" ? { status: 409, body: { error: "That dish has already been served — refresh the board." } } : { body: { ok: true } } } });
  await P.page.click('[data-item-ready="b1"]'); await sleep(600);
  const ref = await P.ev(() => ({ t: [...document.querySelectorAll("#toasts .toast span")].map((x) => x.textContent), tick: !!document.querySelector('[data-item-ready="b1"]'), bar: !!(document.getElementById("lfh-undobar") || { classList: { contains: () => false } }).classList.contains("show") }));
  k("P180888", "a REFUSED ✓ says 'Failed: <the server's sentence>', shows no take-back bar, and the ✓ comes back so the cook can try again", ref.t.some((x) => x === "Failed: That dish has already been served — refresh the board.") && ref.tick && !ref.bar, JSON.stringify(ref));
  await P.close();
  P = await open({ S: { board: T(), answer: (c) => c.sub === "/items/b1/status" ? { status: 400, body: { error: "nope" } } : { body: { ok: true } } } });
  P.S.boardAnswer = () => ({ status: 503, body: { error: "The system is very busy right now", busy: true }, headers: { "X-LFH-Busy": "1" } });
  await P.page.click('[data-item-ready="b1"]'); await sleep(900);
  const ref2 = await P.ev(() => ({ tick: !!document.querySelector('[data-item-ready="b1"]'), line: document.querySelector('[data-ticket="c2"] .line').className }));
  k("P180889", "a refused ✓ while the board read is ALSO failing still puts the ✓ back on screen — it must not wait for a read that is not coming", ref2.tick && !/line-ready/.test(ref2.line), JSON.stringify(ref2));
  await P.close();
  P = await open({ S: { board: T(), answer: () => ({ status: 503, body: { error: "busy", busy: true }, headers: { "X-LFH-Busy": "1" } }) } });
  await P.page.click('[data-item-ready="b1"]'); await sleep(500);
  k("P180890", "a ✓ on a BUSY server is kept on this device and said so ('Saved on this device ✓ — it will send by itself'); the dish stays ready",
    (await P.ev(toasts)).some((x) => /Saved on this device/.test(x)) && await P.ev(() => !document.querySelector('[data-item-ready="b1"]')), JSON.stringify(await P.ev(toasts)));
  await P.close();
  P = await open({ S: { board: T() } });
  await P.ctx.setOffline(true); await P.page.click('[data-item-ready="b1"]'); await sleep(300);
  const off = { t: await P.ev(toasts), sent: P.writes(/^\/items\/b1\/status$/).length };
  await P.ctx.setOffline(false); await P.ev(() => window.dispatchEvent(new Event("online"))); await sleep(2500);
  k("P180891", "a ✓ with NO signal is saved on this device (told so, nothing sent), and sends by itself once the signal is back — exactly once",
    off.t.some((x) => /Saved on this device/.test(x)) && off.sent === 0 && P.writes(/^\/items\/b1\/status$/).length === 1, JSON.stringify([off, P.writes(/^\/items\/b1\/status$/).length]));
  await P.close();

  // ── ALL READY and its take-back ────────────────────────────────────────────────────────────────
  P = await open({ S: { board: T() } });
  await P.page.click('.ticket[data-ticket="c2"] [data-ready]'); await sleep(200);
  const all = await P.ev(() => ({ lane: document.querySelector('.ticket[data-ticket="c2"]').parentElement.id, bar: (() => { const b = document.getElementById("lfh-undobar"); return b.querySelector(".lfh-undo-title").textContent + " | " + b.querySelector(".lfh-undo-sub").textContent; })() }));
  k("P180892", "ALL READY: the ticket goes to Ready at once, ONE write is sent, and the bar says 'All dishes marked ready · T8 · 3 dishes'",
    all.lane === "list-ready" && P.writes(/^\/orders\/c2\/ready$/).length === 1 && /All dishes marked ready \| T8 · 3 dishes/.test(all.bar), JSON.stringify(all));
  await P.ev(() => document.querySelector("#lfh-undobar .lfh-undo-btn").click()); await sleep(500);
  const un = P.writes(/^\/orders\/c2\/unready$/);
  k("P180893", "UNDO on ALL READY is ONE request carrying each dish's own earlier status, and the ticket returns to Cooking",
    un.length === 1 && JSON.stringify(un[0].body.dishes) === '[{"id":"b1","prev":"preparing"},{"id":"b2","prev":"preparing"},{"id":"b3","prev":"preparing"}]' && await P.ev(() => document.querySelector('.ticket[data-ticket="c2"]').parentElement.id === "list-cooking"), JSON.stringify(un.map((x) => x.body)));
  await P.page.click('.ticket[data-ticket="l1"] [data-ready]'); await sleep(200);
  k("P180894", "ALL READY on an old-style ticket (dishes inside the order) moves it to Ready too — and offers no take-back (there are no dish ids to restore)",
    await P.ev(() => document.querySelector('.ticket[data-ticket="l1"]').parentElement.id === "list-ready") && P.writes(/^\/orders\/l1\/ready$/).length === 1, "");
  await P.close();
  P = await open({ S: { board: T(), answer: (c) => /\/ready$/.test(c.sub) ? { status: 409, body: { error: "Every dish on that ticket has already been served — refresh the board." } } : { body: { ok: true } } } });
  await P.page.click('.ticket[data-ticket="c2"] [data-ready]'); await sleep(900);
  const ar = await P.ev(() => ({ t: [...document.querySelectorAll("#toasts .toast span")].map((x) => x.textContent), lane: document.querySelector('.ticket[data-ticket="c2"]').parentElement.id }));
  k("P180895", "a REFUSED ALL READY says why ('Failed: …') and the ticket goes back to Cooking", ar.t.some((x) => /^Failed: Every dish on that ticket/.test(x)) && ar.lane === "list-cooking", JSON.stringify(ar));
  P.S.boardAnswer = () => ({ status: 503, body: { error: "busy", busy: true } });
  await P.page.click('.ticket[data-ticket="c2"] [data-ready]'); await sleep(900);
  k("P180896", "a refused ALL READY while the board read is ALSO failing still puts the ticket back in Cooking (not left saying 'ready')", await P.ev(() => document.querySelector('.ticket[data-ticket="c2"]').parentElement.id === "list-cooking"));
  await P.close();
  P = await open({ S: { board: T(), answer: (c) => /unready|status$/.test(c.sub) ? { status: 409, body: { error: "Those dishes have already moved on — refresh the board." } } : { body: { ok: true } } } });
  await P.page.click('.ticket[data-ticket="c2"] [data-ready]'); await sleep(200);
  await P.ev(() => document.querySelector("#lfh-undobar .lfh-undo-btn").click()); await sleep(500);
  k("P180897", "a take-back the server refuses says 'Undo failed: <why>'", (await P.ev(toasts)).some((x) => x === "Undo failed: Those dishes have already moved on — refresh the board."), JSON.stringify(await P.ev(toasts)));
  // a ✓ on a dish that left the board between paint and finger; a ✓ on a served dish
  await P.ev(() => { state.items = state.items.filter((i) => i.id !== "a1"); });
  await P.ev(() => document.querySelector('[data-item-ready="a1"]').click()); await sleep(200);
  k("P180898", "a ✓ on a dish that changed under the finger is never silent: 'That dish just changed — refreshing the board.'", (await P.ev(toasts)).some((x) => /That dish just changed/.test(x)));
  await P.close();

  // ── delivery buttons ──────────────────────────────────────────────────────────────────────────
  P = await open({ S: { board: board({ platformAccept: true, platform: [plat("p1"), plat("p2", { status: "accepted" }), plat("p3", { status: "ready" })] }) } });
  const r0 = P.reads(/^\/board$/).length;
  for (const sel of ['[data-plat-accept="p1"]', '[data-plat-ready="p2"]', '[data-plat-hand="p3"]']) await P.page.click(sel);
  await sleep(600);
  const pw = P.writes(/^\/platform\//).map((c) => c.sub + ":" + c.body.status);
  k("P180899", "delivery: ACCEPT (when the manager allows it), ALL READY and HANDED OVER each send their one status, then refresh the board",
    JSON.stringify(pw) === '["/platform/p1/status:accepted","/platform/p2/status:ready","/platform/p3/status:handed_over"]' && P.reads(/^\/board$/).length > r0, JSON.stringify(pw));
  P.S.answer = () => ({ status: 409, body: { error: "That delivery order was cancelled — it stays off the kitchen board." } });
  await P.page.click('[data-plat-ready="p2"]'); await sleep(400);
  k("P180900", "a refused delivery tap says the server's reason (item 16's 'was cancelled')", (await P.ev(toasts)).some((x) => x === "Failed: That delivery order was cancelled — it stays off the kitchen board."), JSON.stringify(await P.ev(toasts)));
  await P.close();

  // ── the 86 drawer ─────────────────────────────────────────────────────────────────────────────
  P = await open({ S: { board: board({ dishes: [dish("d1", "Paneer Tikka"), dish("d2", "Dal Makhani", { tags: ["sold-out"] }), dish("d3", "Chicken 65", { category: "Starters" })] }) } });
  await P.page.click("#boardBtn");
  const dr = await P.ev(() => ({ open: !document.getElementById("drawerOverlay").hidden, rows: [...document.querySelectorAll("#dishList [data-86]")].map((b) => b.closest(".dish-row").querySelector(".dtitle").firstChild.textContent + "=" + b.textContent), oc: document.querySelector("#outOnlyBtn .oc").textContent }));
  k("P180901", "🚫 opens the sold-out drawer: every dish with its state, and the switch says how many are sold out", dr.open && JSON.stringify(dr.rows) === '["Paneer Tikka=available","Dal Makhani=SOLD OUT","Chicken 65=available"]' && dr.oc === "1", JSON.stringify(dr));
  await P.page.click('[data-86="d1"]'); await sleep(300);
  const t86 = await P.ev(() => ({ b: document.querySelector('[data-86="d1"]').textContent, oc: document.querySelector("#outOnlyBtn .oc").textContent, bar: document.getElementById("lfh-undobar").querySelector(".lfh-undo-title").textContent }));
  const w86 = P.writes(/^\/dishes\/d1\/sold-out$/);
  k("P180902", "marking a dish sold out flips it AT ONCE, the count follows (2), one write { value: true } is sent, and the take-back bar names the dish",
    t86.b === "SOLD OUT" && t86.oc === "2" && w86.length === 1 && w86[0].body.value === true && /Paneer Tikka marked sold out/.test(t86.bar), JSON.stringify(t86));
  await P.ev(() => document.querySelector("#lfh-undobar .lfh-undo-btn").click()); await sleep(400);
  k("P180903", "UNDO puts it back on the menu (one write { value: false }) and the count back to 1", P.writes(/^\/dishes\/d1\/sold-out$/).map((c) => c.body.value).join() === "true,false" && await P.ev(() => document.querySelector('[data-86="d1"]').textContent === "available" && document.querySelector("#outOnlyBtn .oc").textContent === "1"));
  await P.page.fill("#dishSearch", "  pan "); await sleep(300);
  const s1 = await P.ev(() => [...document.querySelectorAll("#dishList [data-86]")].length);
  await P.page.fill("#dishSearch", "zzz"); await sleep(300);
  const s2 = await P.ev(() => document.getElementById("dishList").textContent);
  await P.page.click("#outOnlyBtn"); await sleep(100);
  const s3 = await P.ev(() => document.getElementById("dishList").textContent);
  await P.page.fill("#dishSearch", ""); await sleep(300);
  const s4 = await P.ev(() => [...document.querySelectorAll("#dishList [data-86]")].map((b) => b.dataset["86"]));
  k("P180904", "search trims spaces and matches part of a name; no match is said in words; 'Sold out only' shows just the sold-out dishes (and says so when a search finds none)",
    s1 === 1 && /No dishes match “zzz”/.test(s2) && /No sold-out dish matches “zzz”/.test(s3) && JSON.stringify(s4) === '["d2"]', JSON.stringify([s1, s2.slice(-40), s3.slice(-40), s4]));
  await P.page.click("#drawerClose"); await P.page.click("#boardBtn");
  k("P180905", "✕ closes the drawer, and reopening it starts with the filter OFF (a forgotten filter would hide the dish a cook came for)", await P.ev(() => !document.getElementById("drawerOverlay").hidden && document.getElementById("outOnlyBtn").getAttribute("aria-pressed") === "false" && document.querySelectorAll("#dishList [data-86]").length === 3));
  await P.page.mouse.click(5, 400); await sleep(100);
  k("P180906", "tapping outside the drawer closes it", await P.ev(() => document.getElementById("drawerOverlay").hidden));
  P.S.answer = () => ({ status: 404, body: { error: "That dish isn't on this restaurant's menu." } });
  await P.page.click("#boardBtn"); await P.page.click('[data-86="d3"]'); await sleep(400);
  k("P180907", "a refused sold-out tap rolls the dish back and says why", await P.ev(() => document.querySelector('[data-86="d3"]').textContent === "available" && document.querySelector("#outOnlyBtn .oc").textContent === "1") && (await P.ev(toasts)).some((x) => x === "Failed: That dish isn't on this restaurant's menu."), JSON.stringify(await P.ev(toasts)));
  P.S.answer = () => ({ status: 503, body: { error: "busy", busy: true } });
  await P.page.click('[data-86="d3"]'); await sleep(400);
  k("P180908", "a sold-out tap on a busy server is kept on this device and said so; the dish stays marked", (await P.ev(toasts)).some((x) => /Saved on this device/.test(x)) && await P.ev(() => document.querySelector('[data-86="d3"]').textContent === "SOLD OUT"));
  await P.close();

  // ── the toast itself ──────────────────────────────────────────────────────────────────────────
  P = await open({ S: { board: T() } });
  await P.ev(() => toast("hello"));
  const tx = await P.ev(() => !!document.querySelector("#toasts .toast .toast-x") && !document.querySelector("#toasts .toast .undo"));
  await P.ev(() => document.querySelector("#toasts .toast .toast-x").click());
  k("P180909", "every message can be dismissed with ✕ at once, and a plain message carries no UNDO button", tx && await P.ev(() => !document.querySelector("#toasts .toast")));
  await P.ev(() => toast("x")); await sleep(4300);
  k("P180910", "…and leaves by itself after four seconds", await P.ev(() => !document.querySelector("#toasts .toast")));
  await P.close();
}
