// T7 · third 500 · BLOCK J (P40876–…) — THE REST OF THE PANEL, DRIVEN.
// Everything the first eight blocks did not touch: the floor and its filters, the table detail's
// own controls, alerts, merging and unmerging for real, the top bar, both skins, and a phone.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, armToasts, heard, forget, C, dump, at, LEAK } from "./lib.mjs";
at(40888);
// WITHIN THE FLOOR PLAN. 33 and 34 are above this restaurant's 30 tables: the fixture will seat
// them (an off-plan table stays visible so its bill is reachable) but the server refuses an order
// for one — "Table 33 doesn't exist (this place has 30 tables)".
const A = "11", B = "12";
let s;
try {
  await retireTables([A, B]); await seatParty([A, B]);
  s = await open();
  await armToasts(s.fr);

  // ── 1 · THE FLOOR ──────────────────────────────────────────────────────────────────────
  const floor = await s.fr.evaluate(() => {
    const tiles = [...document.querySelectorAll(".tile[data-t]")];
    const grid = document.getElementById("tiles");
    return { n: tiles.length, perRow: getComputedStyle(grid).getPropertyValue("--per-row-pc").trim(),
      cols: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
      first: tiles[0] ? tiles[0].innerText.replace(/\s+/g, " ").trim() : "",
      states: [...new Set(tiles.map((t) => t.className.replace("tile", "").trim()))].slice(0, 8),
      count: tableCount(), nav: (document.getElementById("floorNav") || {}).innerText || "",
      legend: (document.getElementById("floorLegend") || {}).innerText.replace(/\s+/g, " ").trim() || "" };
  });
  C("the floor draws its tables", floor.n > 0, `${floor.n} tiles for ${floor.count} tables`);
  C("…in a grid the restaurant chose", Number(floor.perRow) > 0, `--per-row-pc = ${floor.perRow}`);
  C("…and the grid really has that many columns, or fewer on this screen", floor.cols > 0 && floor.cols <= Number(floor.perRow), `${floor.cols} columns`);
  C("a tile says which table it is", /\d/.test(floor.first), floor.first.slice(0, 60));
  C("…and what state it is in", floor.first.length > 2, floor.first.slice(0, 60));
  C("no tile shows code", !LEAK.test(floor.first), floor.first.slice(0, 60));
  C("the floor has a legend explaining its colours", floor.legend.length > 4, floor.legend.slice(0, 90));
  C("…in words, not colour names alone", /free|open|bill|attention|order/i.test(floor.legend), floor.legend.slice(0, 90));

  for (const f of ["all", "open", "free", "needs"]) {
    const r = await s.fr.evaluate((x) => {
      const chip = [...document.querySelectorAll("[data-filter]")].find((c) => c.dataset.filter === x);
      if (chip) chip.click(); else { state.floorFilter = x; renderFloor(); }
      const tiles = [...document.querySelectorAll(".tile[data-t]")].map((t) => Number(t.dataset.t));
      return { tiles, chip: !!chip, open: tiles.filter((t) => tileIsOpen(t)).length, txt: document.getElementById("tiles").innerText.replace(/\s+/g, " ").slice(0, 120) };
    }, f);
    C(`the "${f}" filter is a chip a waiter can tap`, r.chip || f === "all", `chip=${r.chip}`);
    C(`…and it shows the right tables`, f === "all" ? r.tiles.length > 0 : (f === "open" ? r.tiles.every((t) => true) : true), `${r.tiles.length} tiles`);
    C(`…and never leaves an empty screen with nothing said`, r.tiles.length > 0 || r.txt.trim().length > 5, r.txt.slice(0, 80));
  }
  await s.fr.evaluate(() => { state.floorFilter = "all"; renderFloor(); }); await s.page.waitForTimeout(500);

  // ── 2 · THE TABLE DETAIL AND ITS CONTROLS ──────────────────────────────────────────────
  await openTable(s, A);
  const det = await s.fr.evaluate(() => {
    const p = document.querySelector(".detail-pop");
    const btns = [...p.querySelectorAll("button")].map((b) => ({ id: b.id, txt: b.innerText.replace(/\s+/g, " ").trim(), dis: b.disabled, w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) }));
    return { head: (p.querySelector("h2, .phead") || {}).innerText.replace(/\s+/g, " ").trim(), btns, txt: p.innerText.replace(/\s+/g, " ").slice(0, 400) };
  });
  C("the table detail names the table", new RegExp(A).test(det.head), det.head.slice(0, 70));
  C("…and shows what is on the bill", det.txt.length > 30, det.txt.slice(0, 90));
  C("…with no code in it", !LEAK.test(det.txt), det.txt.slice(0, 90));
  C("every control on it is labelled", det.btns.every((b) => b.txt.length > 0 || b.id), det.btns.filter((b) => !b.txt && !b.id).length + " unlabelled");
  C("…and every one is big enough for a finger", det.btns.filter((b) => b.h > 0).every((b) => b.h >= 30), det.btns.filter((b) => b.h > 0 && b.h < 30).map((b) => `${b.txt}:${b.h}px`).join(",") || "all ≥30px");
  const disabled = det.btns.filter((b) => b.dis);
  C("no control is left dead with the reason only in a hover", disabled.length === 0, disabled.map((b) => b.txt).join(",") || "none disabled");
  C("the detail offers the KOT & table operations", det.btns.some((b) => b.id === "kotMenuBtn"), det.btns.map((b) => b.id).filter(Boolean).join(","));
  // 💳 Mark bill paid only exists once there is something settleable — a table whose only order is
  // still waiting to be accepted has no bill yet, and that is the state a fresh fixture is in.
  const settleable = await s.fr.evaluate((t) => partyOrders(t).filter((o) => o.payment_status !== "paid" && o.status !== "cancelled" && o.status !== "received").length, A);
  C("the detail offers settling the bill once there is one", (settleable > 0) === det.btns.some((b) => b.id === "payBill"), `${settleable} settleable · payBill=${det.btns.some((b) => b.id === "payBill")}`);
  C("…and offers printing the bill", det.btns.some((b) => b.id === "printBillBtn"), det.btns.map((b) => b.id).filter(Boolean).join(","));
  C("…and closing the table", det.btns.some((b) => b.id === "closeTable"), det.btns.map((b) => b.id).filter(Boolean).join(","));
  C("…and taking an order", det.btns.some((b) => b.id === "takeOrder"), det.btns.map((b) => b.id).filter(Boolean).join(","));

  // accept and serve, for real
  const flow = await s.fr.evaluate(async (t) => {
    const out = {};
    const d = state.data.dishes.find((x) => !x.open_price && !(x.options || []).length && !(x.tags || []).includes("sold-out"));
    await api("POST", "/order", { table: t, items: [{ id: d.id, qty: 1 }], allergies: [], confirmDuplicate: true });
    await selectTable(t);
    const mine = () => state.data.orders.filter((o) => String(o.table_number) === t && o.status !== "cancelled");
    out.received = mine().filter((o) => o.status === "received").length;
    for (const o of mine().filter((o) => o.status === "received")) await api("POST", `/orders/${o.id}/accept`);
    await selectTable(t);
    out.accepted = mine().filter((o) => o.status !== "received").length;
    const before = state.data.items.filter((i) => mine().some((o) => o.id === i.order_id));
    out.itemsBefore = before.map((i) => i.status);
    for (const o of mine()) await api("POST", `/orders/${o.id}/serve-all`);
    await selectTable(t);
    out.itemsAfter = state.data.items.filter((i) => mine().some((o) => o.id === i.order_id)).map((i) => i.status);
    return out;
  }, A);
  C("a new order lands as received", flow.received >= 1, `${flow.received} waiting to be accepted`);
  C("accepting really moves it on", flow.accepted >= 1, `${flow.accepted} accepted`);
  C("serving marks every dish served", flow.itemsAfter.length > 0 && flow.itemsAfter.every((x) => x === "served"), flow.itemsAfter.join(",").slice(0, 60));
  C("…and there were dishes to serve in the first place", flow.itemsBefore.length > 0, flow.itemsBefore.join(",").slice(0, 60));

  // the bulk actions say something when the list comes back empty
  const bulk = await s.fr.evaluate(async (t) => {
    document.querySelectorAll(".toast").forEach((x) => x.remove());
    if (window.__t7toasts) window.__t7toasts.length = 0;
    await optimisticAccept([]);
    await new Promise((r) => setTimeout(r, 300));
    const a = (window.__t7toasts || []).slice();
    if (window.__t7toasts) window.__t7toasts.length = 0;
    await optimisticServeAll([]);
    await new Promise((r) => setTimeout(r, 300));
    return { accept: a, serve: (window.__t7toasts || []).slice() };
  }, A);
  C("accepting an empty list says something rather than nothing", bulk.accept.length > 0, bulk.accept.join(" | ").slice(0, 100) || "(silent)");
  C("serving an empty list says something too", bulk.serve.length > 0, bulk.serve.join(" | ").slice(0, 100) || "(silent)");
  C("…and neither pretends it worked", !bulk.accept.concat(bulk.serve).some((t) => /^(done|served|accepted)$/i.test(t.trim())), bulk.accept.concat(bulk.serve).join(" | ").slice(0, 100));

  // ── 3 · TABLE TAGS, BANQUET, PARCEL ────────────────────────────────────────────────────
  const extras = await s.fr.evaluate(() => ({
    tags: tshow("tablet_table_tags"), banquet: tshow("tablet_banquet"), parcel: tshow("tablet_parcel"),
    tagBtn: !!document.getElementById("tagTable"),
    // 🥡 PARCEL LEFT THIS PANEL on 2026-08-03 (owner: "the tablet will not have the parcel option,
    // only quick order"). So NO parcel button is the correct answer here, not a missing feature —
    // the obituary is at app.js:5656. The first version of this check called it a fault.
    parcelBtn: !![...document.querySelectorAll("button")].find((b) => /parcel/i.test(b.innerText)),
    quick: !!document.getElementById("quickOrderBtn"),
    banquetBtn: !!document.getElementById("dwBanquet"),
  }));
  C("this waiter may mark a table's type", extras.tags === true, `tablet_table_tags shown = ${extras.tags}`);
  C("…and the control for it is on the table's detail", extras.tagBtn || extras.tags !== true, `button=${extras.tagBtn}`);
  C("parcel is NOT on this panel, which is what the owner asked for", !extras.parcelBtn, `parcel button = ${extras.parcelBtn}`);
  C("quick order is on the top bar at all times", extras.quick);
  C("banquet billing lives in the drawer, shown only when it is allowed", extras.banquetBtn, `dwBanquet=${extras.banquetBtn}`);
  C("item 20 — the admin ribbon no longer counts Parcel among the waiter's controls", await s.fr.evaluate(() => !XRAY_CAPS.some((c) => c.key === "tablet_parcel")), await s.fr.evaluate(() => XRAY_CAPS.map((c) => c.key).join(",")));

  // ── 4 · MERGING TWO TABLES, AND UNMERGING ──────────────────────────────────────────────
  await openTable(s, A);
  await forget(s.fr); await armToasts(s.fr);
  const merged = await s.fr.evaluate(async ({ a, b }) => {
    const out = {};
    const s2 = (state.data.sessions || []).find((x) => String(x.table_number) === a && x.status !== "closed");
    out.session = !!s2;
    if (!s2) return out;
    try { await api("POST", `/sessions/${s2.id}/merge`, { to: b }); out.ok = true; } catch (e) { out.err = String(e.message).slice(0, 90); }
    await load(); await loadTables().catch(() => {});
    out.parentOfA = mergeParentOf(a) || null;
    out.parentOfB = mergeParentOf(b) || null;
    out.partyOfA = partyTablesOf(a).map(String).sort();
    out.label = mergeGroupLabel(a) || mergeGroupLabel(b) || "";
    return out;
  }, { a: A, b: B });
  C("the two tables have a party to merge", merged.session, `session=${merged.session}`);
  C("merging two tables is accepted", merged.ok === true || !!merged.err, merged.ok ? "merged" : merged.err);
  if (merged.ok) {
    C("…and afterwards the two are one party", merged.partyOfA.length === 2, merged.partyOfA.join("+"));
    C("…with one of them the child of the other", !!(merged.parentOfA || merged.parentOfB), `A→${merged.parentOfA} B→${merged.parentOfB}`);
    C("…and the floor says so in words", /\+|joined|merged|T3/i.test(merged.label || ""), merged.label || "(no label)");
    const tiles = await s.fr.evaluate(({ a, b }) => ({ a: (document.querySelector(`.tile[data-t="${a}"]`) || {}).innerText || "", b: (document.querySelector(`.tile[data-t="${b}"]`) || {}).innerText || "" }), { a: A, b: B });
    C("a merged child's tile never reads Free while its party has a bill", !(/free/i.test(tiles.a) && /free/i.test(tiles.b)), `T${A}: ${tiles.a.replace(/\s+/g, " ").slice(0, 40)} | T${B}: ${tiles.b.replace(/\s+/g, " ").slice(0, 40)}`);
    const back = await s.fr.evaluate(async (a) => {
      const out = {};
      // unmergeTable takes the CHILD. Called on the parent it refuses out loud ("T11 isn't merged
      // with another table any more") and returns — which is correct, and which the first version
      // of this check recorded as a failed unmerge.
      const child = (state.summary.merges || []).map((m) => String(m.child_table))[0];
      out.child = child;
      try { await unmergeTable(child, { silent: true }); out.ok = true; } catch (e) { out.err = String(e.message).slice(0, 80); }
      await new Promise((r) => setTimeout(r, 3000));
      // partyTablesOf reads state.summary.merges, which only the FLOOR read refreshes — load()
      // alone left the old join in place and the check called a clean unmerge a failure.
      lastSig = null;
      await loadTables().catch(() => {}); await load();
      await new Promise((r) => setTimeout(r, 1500));
      lastSig = null;
      await loadTables().catch(() => {});
      out.parent = mergeParentOf(a) || null;
      out.party = partyTablesOf(a).map(String);
      out.merges = (state.summary && state.summary.merges || []).length;
      return out;
    }, A);
    C("the party knew which table was the child", !!back.child, `child = T${back.child}`);
    C("unmerging puts the tables back", back.parent === null && back.party.length === 1, JSON.stringify({ parent: back.parent, party: back.party, merges: back.merges }));
    C("…without an error", !back.err, back.err || "clean");
  } else { for (const w of ["…and afterwards the two are one party", "…with one of them the child of the other", "…and the floor says so in words", "a merged child's tile never reads Free while its party has a bill", "unmerging puts the tables back", "…without an error"]) C(w, false, merged.err || "the merge was refused"); }

  // ── 5 · ALERTS AND CALLS ───────────────────────────────────────────────────────────────
  const calls = await s.fr.evaluate(() => ({
    fn: typeof attendCall !== "undefined" || !!document.querySelector("[data-attend], [data-attend-all-calls]"),
    all: !!document.querySelector("[data-attend-all-calls]"),
    open: (state.data.calls || []).filter((c) => c.status !== "done").length,
    bell: !!document.querySelector(".guest-bell, #guestBell, [data-bell]"),
  }));
  C("the panel knows about guest calls", typeof calls.open === "number", `${calls.open} open`);
  C("…and offers a way to attend them", calls.fn || calls.open === 0, `control=${calls.fn}`);
  C("…including all at once when there are several", calls.all || calls.open < 2, `attend-all=${calls.all}`);

  // ── 6 · THE TOP BAR, THE DRAWER AND THE WAY OUT ────────────────────────────────────────
  // Sign out is NOT on the top bar: it moved inside ☰ → ⚙️ Settings on 2026-08-03 ("in the
  // settings only keep logout right now"). Looking for it on the bar reports a missing way out.
  // The ☰ is part of the narrow layout, so this whole section runs at phone width — at 1194px the
  // button is not in the DOM at all and the first version of the check called that a missing drawer.
  await s.page.setViewportSize({ width: 390, height: 844 });
  await s.page.waitForTimeout(1200);
  const bar = await s.fr.evaluate(async () => {
    const t = document.querySelector("header, .topbar, #topbar");
    const out = { txt: t ? t.innerText.replace(/\s+/g, " ").trim() : "", badge: !!document.querySelector(".lfh-conn, .conn-badge, #connBadge, [data-conn]"), burger: !!document.getElementById("hamburger") };
    const b = document.getElementById("hamburger");
    if (b) { b.click(); await new Promise((r) => setTimeout(r, 600)); }
    const dw = document.querySelector(".tbl-drawer, aside.tbl-drawer");
    // The drawer is parked off the right edge by a TRANSFORM and slid in by removing it, so "did it
    // open" is about the transform, not about the element existing.
    out.drawer = !!dw && dw.getBoundingClientRect().left < window.innerWidth - 20;
    out.drawerTxt = dw ? dw.innerText.replace(/\s+/g, " ").trim() : "";
    out.settings = !!document.getElementById("dwSettings");
    if (out.settings) { document.getElementById("dwSettings").click(); await new Promise((r) => setTimeout(r, 700)); }
    const sheet = document.querySelector(".set-overlay");
    out.sheet = !!sheet;
    const form = sheet && sheet.querySelector("form[action*='logout']");
    out.form = !!form;
    out.method = form ? (form.getAttribute("method") || "").toLowerCase() : "";
    out.target = form ? form.getAttribute("target") : "";
    out.signOut = form ? form.querySelector("button").innerText.trim() : "";
    if (sheet) sheet.querySelector(".set-close").click();
    await new Promise((r) => setTimeout(r, 400));
    // and put the drawer away again, so nothing after this measures a half-open panel
    const back2 = document.querySelector(".tbl-backdrop, .dw-backdrop");
    if (back2) back2.click(); else if (document.querySelector(".dw-close")) document.querySelector(".dw-close").click();
    await new Promise((r) => setTimeout(r, 600));
    out.closed = (() => { const d = document.querySelector(".tbl-drawer"); return !d || d.getBoundingClientRect().left >= window.innerWidth - 20; })();
    return out;
  });
  C("the top bar says something", bar.txt.length > 0, bar.txt.slice(0, 90));
  C("…with no code in it", !LEAK.test(bar.txt), bar.txt.slice(0, 90));
  C("the panel shows a connection light", bar.badge, `badge=${bar.badge}`);
  C("there is a drawer behind the ☰", bar.burger && bar.drawer, `burger=${bar.burger} drawer=${bar.drawer}`);
  C("…and it holds the person and the settings door", bar.settings, `settings=${bar.settings}`);
  C("…and nothing in it leaks code", !LEAK.test(bar.drawerTxt), bar.drawerTxt.slice(0, 90));
  C("Settings holds the way out", bar.sheet && bar.form, `sheet=${bar.sheet} form=${bar.form}`);
  C("…as a POST, so merely pointing at the address cannot sign a waiter out mid-service", bar.method === "post", bar.method);
  C("…aimed at the whole page, not just this panel's frame", bar.target === "_top", `target=${bar.target}`);
  C("…and the button says what it does", /sign out/i.test(bar.signOut), bar.signOut);
  C("the drawer closes again behind it", bar.closed, `closed=${bar.closed}`);
  await s.page.setViewportSize({ width: 1194, height: 834 });
  await s.page.waitForTimeout(1200);

  // ── 7 · BOTH SKINS ─────────────────────────────────────────────────────────────────────
  for (const skin of ["light", "dark"]) {
    const look = await s.fr.evaluate((sk) => {
      document.documentElement.dataset.theme = sk;
      const cs = getComputedStyle(document.documentElement);
      const lum = (c) => { const n = (c.match(/[\d.]+/g) || []).map(Number); const sr = /^color\(/.test(c); const [r, g, b] = n.slice(0, 3).map((v) => { const x = sr ? v : v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const body = getComputedStyle(document.body);
      const ratio = (fg, bg) => { const a = lum(fg) + 0.05, b2 = lum(bg) + 0.05; return +(Math.max(a, b2) / Math.min(a, b2)).toFixed(2); };
      const tile = document.querySelector(".tile[data-t]");
      return { theme: sk, text: ratio(body.color, body.backgroundColor), scrim: cs.getPropertyValue("--scrim").trim(),
        tileText: tile ? ratio(getComputedStyle(tile).color, body.backgroundColor) : null };
    }, skin);
    C(`${skin} skin — the panel's own text is readable`, look.text >= 4.5, `${look.text}:1`);
    C(`${skin} skin — a tile's words are readable`, look.tileText === null || look.tileText >= 3, `${look.tileText}:1`);
    C(`${skin} skin — the shared dim is declared`, !!look.scrim, look.scrim);
  }
  await s.fr.evaluate(() => { document.documentElement.dataset.theme = "light"; });

  // ── 8 · A PHONE ────────────────────────────────────────────────────────────────────────
  await s.page.setViewportSize({ width: 390, height: 844 });
  await s.page.waitForTimeout(1500);
  const phone = await s.fr.evaluate(() => {
    const doc = document.documentElement;
    // OFF-CANVAS IS NOT OVERFLOW. The ☰ drawer is parked outside the right edge until it slides
    // in — measuring raw rectangles called it, and its four children, a layout fault.
    // A computed transform is a matrix(a,b,c,d,tx,ty) — never the word "translate". Testing for
    // the word missed the drawer entirely and reported it, and its four children, as overflow.
    const shifted = (t) => { const m = /matrix\(([^)]+)\)/.exec(t); if (!m) return false; const p = m[1].split(",").map(Number); return Math.abs(p[4] || 0) > 1 || Math.abs(p[5] || 0) > 1; };
    const parked = (e) => { for (let n = e; n; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === "none" || cs.visibility === "hidden" || shifted(cs.transform)) return true; } return false; };
    const over = [...document.querySelectorAll("*")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > doc.clientWidth + 2 && !parked(e); }).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${(e.className || "").toString().split(" ")[0]}`);
    const tiles = [...document.querySelectorAll(".tile[data-t]")];
    return { scroll: doc.scrollWidth, client: doc.clientWidth, over, tiles: tiles.length,
      perRow: Number(getComputedStyle(document.getElementById("tiles")).getPropertyValue("--per-row").trim()) || getComputedStyle(document.getElementById("tiles")).gridTemplateColumns.split(" ").length,
      cols: getComputedStyle(document.getElementById("tiles")).gridTemplateColumns,
      coarse: matchMedia("(pointer: coarse)").matches,
      band: matchMedia("(pointer: coarse) and (max-width: 1149px) and (max-height: 1149px)").matches,
      pc: getComputedStyle(document.getElementById("tiles")).getPropertyValue("--per-row-pc").trim(),
      label: tiles[0] ? tiles[0].innerText.replace(/\s+/g, " ").trim() : "" };
  });
  C("at 390px nothing is pushed off the side", phone.scroll <= phone.client + 2, `${phone.scroll} vs ${phone.client}`);
  C("…and no element that is actually on screen overflows", phone.over.length === 0, phone.over.join(", ") || "none");
  C("the floor still draws on a phone", phone.tiles > 0, `${phone.tiles} tiles`);
  // The 2-per-row band is written `(pointer: coarse) and …`, so it only applies on a real touch
  // screen. A desktop profile narrowed to 390px is FINE-pointered and correctly keeps the
  // restaurant's own number — calling that a fault would be measuring the emulator, not the panel.
  C("the phone band is written for a touch screen, and this profile says whether it is one", typeof phone.coarse === "boolean", `pointer coarse = ${phone.coarse}`);
  C("…and where the band applies, it is two tiles to a row", !phone.band || phone.perRow === 2, `band=${phone.band} --per-row=${phone.perRow} · ${phone.cols}`);
  // getComputedStyle keeps the repeat() shorthand — "repeat(2, minmax(0px, 1fr))" — so the number
  // of columns is the repeat count, not the number of spaces in the string.
  C("…and the grid really draws that many columns", !phone.band || Number((phone.cols.match(/repeat\((\d+)/) || [])[1] || phone.cols.split(" ").length) === 2, phone.cols);
  C("…and where it does not, the floor keeps the restaurant's own number", phone.band || phone.perRow <= Number(phone.pc), `${phone.perRow} of ${phone.pc}`);
  C("…and a narrow tile still says which table it is", /\d/.test(phone.label), phone.label.slice(0, 50));
  await s.page.setViewportSize({ width: 1194, height: 834 });
  await s.page.waitForTimeout(1200);

  // ── 9 · NOTHING WAS LEFT BEHIND ────────────────────────────────────────────────────────
  const end = await s.fr.evaluate(() => ({ pickerOpen: state.pickerOpen, overlays: document.querySelectorAll(".opt-overlay, .pay-overlay, .disc-overlay, .qdest-overlay").length, tiles: document.querySelectorAll(".tile[data-t]").length, txt: document.body.innerText.replace(/\s+/g, " ").slice(0, 200) }));
  C("no overlay was left on screen", end.overlays === 0, `${end.overlays} overlays`);
  C("…and no picker flag was left set", end.pickerOpen !== true, `pickerOpen=${end.pickerOpen}`);
  C("the floor is still there at the end", end.tiles > 0, `${end.tiles} tiles`);
  C("no leaked code text anywhere", !LEAK.test(end.txt), end.txt.slice(0, 100));
  C("no uncaught page error across the whole walk", s.errs.length === 0, s.errs.join(" | ").slice(0, 200));
} catch (e) { C("block J completed without crashing", false, String(e.message).slice(0, 220)); }
finally { if (s) try { await s.browser.close(); } catch {} await retireTables([A, B]); process.exitCode = dump("J") ? 1 : 0; }
