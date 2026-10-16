// SWEEP #10 T11 ROUND 2 · THE KITCHEN SCREEN, SECTION A — opening the screen and drawing the board. P180861–P180882.
// The real panel in Chromium, every server answer played by the test (p-lib.mjs). Exported as a function so run-panel.mjs
// can run every section in one browser and merge their coverage.
import { open, board, order, item, plat, AGO, k } from "./p-lib.mjs";

export default async function sectionA() {
  // ── one board with every kind of ticket ────────────────────────────────────────────────────────
  const B = board({
    orders: [
      order("n1", { status: "received", kot_no: 11, table_number: 2, created_at: AGO(3 * 60000) }),
      order("c1", { kot_no: 12, table_number: 7, created_at: AGO(40 * 60000), allergies: ["nuts"] }),
      order("r1", { kot_no: 13, table_number: 9, created_at: AGO(2 * 60000) }),
      order("s1", { kot_no: 14, table_number: 3 }),
      order("x1", { status: "cancelled", kot_no: 15 }),
      order("l1", { kot_no: 16, table_number: 5, created_at: AGO(30 * 3600000), items: [{ title: "Old Soup", qty: 2, status: "preparing" }] }),
    ],
    items: [item("n1a", "n1", { status: "received" }), item("c1a", "c1", { title: "Naan", qty: 3 }), item("c1b", "c1", { status: "ready", title: "Rice" }),
      item("r1a", "r1", { status: "ready" }), item("s1a", "s1", { status: "served" })],
    platform: [plat("p1", { status: "new", created_at: AGO(50 * 60000) }), plat("p2", { status: "accepted", source: "swiggy", kot_no: 901 }), plat("p3", { status: "ready", source: "parcel", customer_name: "" })],
    tableNames: { 7: "Patio" }, tableTags: { 9: "vip" },
  });
  const P = await open({ S: { board: B } });
  const lane = (key) => P.ev((k1) => [...document.querySelectorAll(`#list-${k1} .ticket`)].map((t) => t.dataset.ticket), key);
  const [N, C, R] = [await lane("new"), await lane("cooking"), await lane("ready")];
  k("P180861", "the board opens with each ticket in the lane its DISHES put it in: new / cooking / ready; served and cancelled leave the board",
    JSON.stringify(N) === '["plat-p1","n1"]' && C.includes("c1") && C.includes("l1") && C.includes("plat-p2") && JSON.stringify(R) === '["r1","plat-p3"]' && ![...N, ...C, ...R].some((x) => x === "s1" || x === "x1"),
    JSON.stringify({ N, C, R }));
  k("P180862", "every lane's count is the number of tickets in it, '0' never blank", await P.ev(() => ["new", "cooking", "ready"].every((k1) => document.getElementById("count-" + k1).textContent === String(document.querySelectorAll(`#list-${k1} .ticket`).length))));
  k("P180863", "inside a lane, dine-in and delivery tickets are ONE queue, oldest first (the 50-min Zomato order sits above the 3-min table)", JSON.stringify(N) === '["plat-p1","n1"]', JSON.stringify(N));
  k("P180864", "the header names the restaurant from the board (never blank, never a hardcoded brand)", (await P.ev(() => document.getElementById("restName").textContent)) === "French House");
  const head = await P.ev(() => { const t = document.querySelector('.ticket[data-ticket="c1"]'); return { kot: t.querySelector(".kot").textContent, tbl: t.querySelector(".tbl").textContent, title: t.querySelector(".tbl").getAttribute("title"), age: t.querySelector(".age").className, ageTitle: t.querySelector(".age").title }; });
  k("P180865", "a ticket's header: KOT number, the table's OWN name (title keeps T7), and a 40-minute ticket wears the half-hour warning", head.kot === "#12" && head.tbl === "Patio" && head.title === "T7" && /age-warn/.test(head.age) && /half an hour/.test(head.ageTitle), JSON.stringify(head));
  const lines = await P.ev(() => [...document.querySelectorAll('.ticket[data-ticket="c1"] .line')].map((l) => l.textContent.replace(/\s+/g, " ").trim()));
  k("P180866", "each dish line: quantity ×, title, the table's allergy on EVERY dish, and a ✓ only on the dish still cooking", lines.length === 2 && /^3× Naan ?NO NUTS ✓$/.test(lines[0]) && /^1× Rice ?NO NUTS ready$/.test(lines[1]), JSON.stringify(lines));
  k("P180867", "a cooking ticket offers ALL READY; a new one says it is waiting for the waiter; a fully ready one says the waiter is serving",
    await P.ev(() => !!document.querySelector('.ticket[data-ticket="c1"] [data-ready]') && /waiting for the waiter/.test(document.querySelector('.ticket[data-ticket="n1"] .awaiting').textContent) && /waiter serving/.test(document.querySelector('.ticket[data-ticket="r1"] .awaiting').textContent)));
  k("P180868", "a VIP table's ticket carries the 👑 VIP badge", (await P.ev(() => (document.querySelector('.ticket[data-ticket="r1"] .ttag') || {}).textContent)) === "👑 VIP");
  const legacy = await P.ev(() => { const t = document.querySelector('.ticket[data-ticket="l1"]'); return [t.textContent.replace(/\s+/g, " "), t.querySelector(".age").className, !!t.querySelector(".tick")]; });
  k("P180869", "an OLD-style ticket (dishes inside the order) still draws its dishes; a ticket from yesterday wears the DAY box; no ✓ on a dish with no id",
    /2× Old Soup/.test(legacy[0]) && /age-stale/.test(legacy[1]) && /DAY1d 6h/.test(legacy[0]) && legacy[2] === false, JSON.stringify(legacy));
  const p = await P.ev(() => ["p1", "p2", "p3"].map((id) => { const t = document.querySelector(`.ticket[data-ticket="plat-${id}"]`); return { badge: t.querySelector(".src-badge").textContent, act: (t.querySelector("[data-plat-accept],[data-plat-ready],[data-plat-hand],.awaiting") || {}).textContent, cust: (t.querySelector(".plat-cust-line") || {}).textContent || "", reprint: !!t.querySelector("[data-plat-reprint]") }; }));
  k("P180870", "delivery tickets: the channel badge, the customer's name, 🖨 on each; NEW says the manager accepts (kitchen not allowed), accepted offers ALL READY, ready offers HANDED OVER",
    /ZOMATO/i.test(p[0].badge) && p[0].cust === "Ramesh" && /manager will accept/.test(p[0].act) && p[1].act === "ALL READY" && p[2].act === "HANDED OVER" && p[2].cust === "" && p.every((x) => x.reprint), JSON.stringify(p));
  k("P180871", "every dine-in ticket on the board carries its own 🖨", await P.ev(() => [...document.querySelectorAll(".ticket:not(.plat)")].every((t) => !!t.querySelector("[data-reprint]"))));

  // ── the wall view ─────────────────────────────────────────────────────────────────────────────
  await P.page.click("#viewBtn");
  const wall = await P.ev(() => ({ ids: [...document.querySelectorAll("#wall .ticket")].map((t) => t.dataset.ticket), cols: document.getElementById("cols").hidden, wall: document.getElementById("wall").hidden, word: document.querySelector("#viewBtn .bw").textContent, saved: localStorage.getItem("kds_view"), colsEmpty: document.getElementById("list-new").children.length }));
  const ready = wall.ids.indexOf("r1"), firstReady = Math.min(wall.ids.indexOf("r1"), wall.ids.indexOf("plat-p3"));
  k("P180872", "Wall view: every live ticket in ONE grid, oldest first, ready ones sunk to the end; the columns are emptied and the choice is remembered on this device",
    wall.cols === true && wall.wall === false && wall.ids.length === 7 && wall.ids[0] === "l1" && firstReady >= 5 && ready >= 5 && wall.word === "Columns" && wall.saved === "wall" && wall.colsEmpty === 0, JSON.stringify(wall));
  await P.page.click("#viewBtn");
  k("P180873", "…and back to columns: the wall is emptied and the three lanes are drawn again", await P.ev(() => document.getElementById("wall").children.length === 0 && document.querySelectorAll("#cols .ticket").length === 7 && localStorage.getItem("kds_view") === "columns"));

  // ── a board read that changes nothing redraws nothing ─────────────────────────────────────────
  const before = await P.ev(() => window.__lfhPerf.fullRenders);
  await P.setBoard(JSON.parse(JSON.stringify(B)));
  const after = await P.ev(() => window.__lfhPerf.fullRenders);
  const hb = JSON.parse(JSON.stringify(B)); hb.orders[1].updated_at = new Date().toISOString(); hb.orders[1].last_activity_at = new Date().toISOString();
  await P.setBoard(hb); const after2 = await P.ev(() => window.__lfhPerf.fullRenders);
  k("P180874", "a board read that changes nothing a cook can see (same rows, or only heartbeat columns) does not redraw the tickets", after === before && after2 === before, `${before}→${after}→${after2}`);
  const ren = JSON.parse(JSON.stringify(B)); ren.tableNames = { 7: "Garden" };
  await P.setBoard(ren);
  k("P180875", "renaming a table on the manager panel repaints its ticket here (the name is part of what is drawn)", (await P.ev(() => document.querySelector('.ticket[data-ticket="c1"] .tbl').textContent)) === "Garden");
  const keep = await P.ev(() => document.querySelector('.ticket[data-ticket="n1"]'));
  const ch = JSON.parse(JSON.stringify(ren)); ch.orders.find((o) => o.id === "c1").allergies = ["dairy"];
  await P.ev(() => { window.__n1 = document.querySelector('.ticket[data-ticket="n1"]'); window.__c1 = document.querySelector('.ticket[data-ticket="c1"]'); });
  await P.setBoard(ch);
  const same = await P.ev(() => [window.__n1 === document.querySelector('.ticket[data-ticket="n1"]'), window.__c1 === document.querySelector('.ticket[data-ticket="c1"]'), /NO DAIRY/.test(document.querySelector('.ticket[data-ticket="c1"]').textContent)]);
  k("P180876", "an allergy edit repaints ONLY that ticket — every other card keeps its node (a cook mid-tap elsewhere is not disturbed)", keep !== undefined && JSON.stringify(same) === "[true,false,true]", JSON.stringify(same));

  // ── empties, odd values, markup ───────────────────────────────────────────────────────────────
  await P.setBoard(board({ restaurant: { name: { hi: "फ्रेंच हाउस" }, logo_text: "  " } }));
  k("P180877", "an empty board shows 'Nothing here.' in all three lanes, counts 0, and the name falls back to any language the restaurant has",
    await P.ev(() => ["new", "cooking", "ready"].every((k1) => document.querySelector(`#list-${k1} .empty`) && document.getElementById("count-" + k1).textContent === "0") && document.getElementById("restName").textContent === "फ्रेंच हाउस"));
  await P.setBoard(board({ restaurant: { name: "*Café* Rouge", logo_text: "" }, orders: [order("q1", { kot_no: null, table_number: null, created_at: "not a date" }), order("q2", { created_at: null })],
    items: [item("q1a", "q1", { title: "<img src=x onerror=window.__pwn=1>", qty: undefined, note: null, options: [{ label: "extra cheese" }, "no ice"] })] }));
  const odd = await P.ev(() => ({ name: document.getElementById("restName").textContent, t: document.querySelector('.ticket[data-ticket="q1"]').textContent.replace(/\s+/g, " "), img: !!document.querySelector('.ticket[data-ticket="q1"] img'), pwn: !!window.__pwn, order: [...document.querySelectorAll("#list-cooking .ticket")].map((x) => x.dataset.ticket) }));
  k("P180878", "odd values never leak: no KOT → '#—', no table → 'T?', a bad date → no age at all, markup in a title is shown as text and never runs; the brand's *accent* stars are stripped",
    odd.name === "Café Rouge" && /#—/.test(odd.t) && /T\?/.test(odd.t) && !/undefined|null|NaN|Infinity|\[object/.test(odd.t) && !odd.img && !odd.pwn && /\+ extra cheese · \+ no ice/.test(odd.t), JSON.stringify(odd).slice(0, 220));
  k("P180879", "two tickets that cannot be dated keep a stable order and never jump the queue (no NaN comparator)", JSON.stringify(odd.order) === '["q1","q2"]', JSON.stringify(odd.order));
  await P.setBoard(board({ orders: [order("w1", { created_at: AGO(5 * 86400000 + 3 * 3600000) })], items: [item("w1a", "w1")] }));
  k("P180880", "a five-day-old ticket says '5d 3h', not '123h' — and is marked as from an earlier day", await P.ev(() => { const a = document.querySelector('.ticket[data-ticket="w1"] .age'); return /5d 3h/.test(a.textContent) && /earlier day/.test(a.title); }));
  const errs = P.logs.filter((l) => !/rt-config|503 \(Service Unavailable\)/.test(l));
  k("P180881", "opening and redrawing the board raised no page error and wrote nothing to the error log", errs.length === 0 && P.S.errlog.length === 0, JSON.stringify([errs, P.S.errlog]).slice(0, 200));
  k("P180882", "every call the screen made went to a kitchen address this test knows, and a real staff screen never adds ?rid", P.S.unknown.length === 0 && P.S.calls.every((c) => !("rid" in c.query)), JSON.stringify(P.S.unknown));
  await P.close();
}
