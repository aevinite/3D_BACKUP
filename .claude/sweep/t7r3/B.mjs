// T7 · third 500 · BLOCK B (P40572–P40623) — A WAITER WITH A SECTION (mig 222).
//
// Never tested by any T7 pass. `assigned_tables` is a per-USER column and `table_assign_allowed`
// is a per-RESTAURANT switch, and the whole 40-terminal fleet shares diagt1 and French House —
// turning the module on there would empty every other lane's floor mid-run. So the section is
// driven where the panel actually reads it: `state.summary.my_tables`, which is exactly what the
// server hands the client (route.ts: `my_tables: myTables ? myTables.tables : null`). Every rule
// under test lives in this panel; the server's own narrowing is another territory's.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, toasts, clearToasts, C, dump, at, LEAK } from "./lib.mjs";
at(40572);
const T = ["21", "22"];
let s;
// THE SECTION HAS TO SURVIVE A REFRESH. Writing state.summary.my_tables works for a second and
// then the 60s poll (or any realtime breadcrumb) calls load(), which replaces state.summary
// wholesale — the first run of this block quietly measured an UNSECTIONED floor for four checks.
// mySection() is a top-level function declaration, so it is a window property and every rule in
// the panel — inMySection, sectioned, renderMySection, all six pickers — goes through it. Override
// that one function and the section holds for the whole walk.
const setSection = (fr, my) => fr.evaluate((m) => {
  state.summary.my_tables = m;
  window.mySection = () => (Array.isArray(m) ? m.map((n) => String(parseInt(n, 10))) : null);
  renderMySection(); renderFloor();
  return true;
}, my);
try {
  await retireTables(T); await seatParty(T);
  s = await open();
  const count = await s.fr.evaluate(() => tableCount());
  C("the floor plan has a table count to reason about", count > 4, `${count} tables`);

  // ── no section at all: nothing is hidden, and the strip is silent ───────────────────────
  await setSection(s.fr, null); await s.page.waitForTimeout(600);
  const all = await s.fr.evaluate(() => ({ tiles: document.querySelectorAll(".tile[data-t]").length, strip: getComputedStyle(document.getElementById("mySection")).display, sectioned: sectioned(), my: mySection() }));
  C("no section — every table on the floor plan is drawn", all.tiles >= count, `${all.tiles} tiles for ${count} tables`);
  C("no section — the Your tables strip stays hidden", all.strip === "none", all.strip);
  C("no section — sectioned() is false and mySection() is null", !all.sectioned && all.my === null, JSON.stringify(all.my));
  C("no section — inMySection says yes to every table", await s.fr.evaluate((n) => { for (let i = 1; i <= n; i++) if (!inMySection(i)) return false; return true; }, count));

  // ── a real section: 21, 22 and a couple of neighbours ───────────────────────────────────
  const MY = [3, 4, 5, 21, 22];
  await setSection(s.fr, MY); await s.page.waitForTimeout(700);
  const sec = await s.fr.evaluate((my) => {
    const drawn = [...document.querySelectorAll(".tile[data-t]")].map((t) => Number(t.dataset.t));
    const el = document.getElementById("mySection");
    return { drawn, strip: getComputedStyle(el).display, txt: el.innerText.replace(/\s+/g, " ").trim(), key: (el.querySelector(".ms-key") || {}).textContent, n: (el.querySelector(".ms-n") || {}).textContent, my };
  }, MY);
  C("a section — only my tables are drawn", sec.drawn.every((t) => MY.includes(t) || t > count) && MY.every((t) => sec.drawn.includes(t)), sec.drawn.join(","));
  C("a section — no table outside it is left on screen looking free", !sec.drawn.some((t) => !MY.includes(t) && t <= count), sec.drawn.filter((t) => !MY.includes(t)).join(",") || "none");
  C("a section — the Your tables strip appears", sec.strip !== "none", sec.strip);
  C("a section — it names the tables as ranges, not a row of chips", /3–5, 21–22/.test(sec.txt), sec.txt);
  C("a section — it says how many", /5 tables/.test(sec.n || ""), sec.n);
  C("a section — the strip is labelled in words", /Your tables/i.test(sec.key || ""), sec.key);
  C("a section — nothing in the strip leaks code", !LEAK.test(sec.txt), sec.txt);

  // rangeText's own arithmetic, exercised through the panel
  const rt = await s.fr.evaluate(() => [rangeText([1, 2, 3, 4, 5, 6]), rangeText([1, 2, 4, 9, 10]), rangeText([7]), rangeText([]), rangeText([10, 2, 3])]);
  C("ranges — a run collapses", rt[0] === "1–6", rt[0]);
  C("ranges — gaps are kept", rt[1] === "1–2, 4, 9–10", rt[1]);
  C("ranges — one table is just the number", rt[2] === "7", rt[2]);
  C("ranges — nothing is empty, not 'undefined'", rt[3] === "", `"${rt[3]}"`);
  C("ranges — out-of-order numbers are sorted first", rt[4] === "2–3, 10", rt[4]);

  // ── a table ABOVE the floor plan stays reachable ────────────────────────────────────────
  const above = await s.fr.evaluate((n) => inMySection(n + 12), count);
  C("a table above the floor plan is in nobody's section, so it stays visible", above, `T${count + 12}`);

  // ── the filters can never widen the section ─────────────────────────────────────────────
  for (const f of ["all", "open", "free", "needs"]) {
    const r = await s.fr.evaluate((args) => { state.floorFilter = args.f; renderFloor(); return [...document.querySelectorAll(".tile[data-t]")].map((t) => Number(t.dataset.t)); }, { f });
    C(`the "${f}" filter never draws a table outside the section`, r.every((t) => MY.includes(t) || t > count), `${f}: ${r.join(",") || "(none)"}`);
  }
  await s.fr.evaluate(() => { state.floorFilter = "all"; renderFloor(); });

  // ── the header counts count MY tables only ──────────────────────────────────────────────
  const counts = await s.fr.evaluate((my) => { const txt = (document.querySelector(".floor-counts, #floorCounts, .fcounts") || document.querySelector("header") || document.body).innerText; return { txt: txt.replace(/\s+/g, " ").slice(0, 200), open: my.filter((t) => tileIsOpen(t)).length }; }, MY);
  C("the header's own numbers are readable and not code", !LEAK.test(counts.txt), counts.txt.slice(0, 90));

  // ── an EMPTY section says so, kindly, and names who fixes it ────────────────────────────
  // A table numbered ABOVE the floor plan is in nobody's section on purpose (its bill would
  // otherwise be unreachable), and this shared dev floor usually carries one from another lane.
  // So: no IN-PLAN table may be drawn — and to reach the empty state itself, the off-plan strays
  // are dropped from THIS BROWSER'S copy of the summary, which touches nothing anybody else has.
  await setSection(s.fr, []); await s.page.waitForTimeout(700);
  const none = await s.fr.evaluate(() => {
    const inPlan = [...document.querySelectorAll(".tile[data-t]")].map((t) => Number(t.dataset.t)).filter((t) => t <= tableCount());
    const strays = [...document.querySelectorAll(".tile[data-t]")].map((t) => Number(t.dataset.t)).filter((t) => t > tableCount());
    const keep = { ...(state.summary.tiles || {}) };
    strays.forEach((t) => delete state.summary.tiles[String(t)]);
    renderFloor();
    const txt = document.getElementById("tiles").innerText.replace(/\s+/g, " ").trim();
    const tiles = document.querySelectorAll(".tile[data-t]").length;
    state.summary.tiles = keep; renderFloor();
    return { inPlan, strays, txt, tiles, strip: getComputedStyle(document.getElementById("mySection")).display };
  });
  C("an empty section draws no table from the floor plan", none.inPlan.length === 0, none.inPlan.join(",") || "none");
  C("…and any tile left is one numbered above the plan, whose bill must stay reachable", none.strays.every((t) => t > 0), none.strays.join(",") || "none");
  C("an empty section explains itself instead of showing a blank grid", /No tables assigned to you yet/i.test(none.txt), none.txt.slice(0, 110));
  C("…and points at the person who can fix it", /Ask your manager/i.test(none.txt), none.txt.slice(0, 140));
  C("…and does NOT also repeat itself in the strip above", none.strip === "none", none.strip);
  C("…and says nothing about a filter, which is not the reason", !/filter/i.test(none.txt), none.txt.slice(0, 110));

  // ── an open table taken away mid-shift closes its detail ────────────────────────────────
  await setSection(s.fr, [21, 22]); await s.page.waitForTimeout(600);
  await openTable(s, "21");
  const held = await s.fr.evaluate(() => ({ table: state.table, pop: !!document.querySelector(".detail-pop") }));
  C("a table in my section opens its detail", held.pop && String(held.table) === "21", JSON.stringify(held));
  const taken = await s.fr.evaluate(() => {
    state.summary.my_tables = ["22"]; window.mySection = () => ["22"];   // the manager just moved it
    if (state.table != null && !inMySection(state.table)) { state.table = null; state.ordering = false; state.cart = []; }
    renderPanel();
    return { table: state.table, pop: !!document.querySelector(".detail-pop") };
  });
  C("a table taken off me mid-shift drops back to the floor, not a panel of refusals", taken.table === null && !taken.pop, JSON.stringify(taken));

  // ── the pickers all obey the section ────────────────────────────────────────────────────
  await setSection(s.fr, [21, 22]); await s.page.waitForTimeout(600);
  await openTable(s, "21");
  await s.fr.evaluate(() => document.getElementById("kotMenuBtn").click());
  await s.fr.waitForSelector("[data-kotop]", { timeout: 30000 }); await s.page.waitForTimeout(400);
  const rows = await s.fr.evaluate(() => [...document.querySelectorAll("[data-kotop]")].map((b) => ({ op: b.dataset.kotop, dis: b.disabled, txt: b.innerText.replace(/\s+/g, " ").trim() })));
  const merge = rows.find((r) => r.op === "merge");
  const offers = await s.fr.evaluate((t) => { const out = []; for (let i = 1, n = tableCount(); i <= n; i++) if (String(i) !== String(t) && inMySection(i) && canHostAParty(i)) out.push(i); return out; }, "21");
  C("the KOT sheet's Merge row is enabled only when the picker it opens has something in it", !!merge && merge.dis === (offers.length === 0), `enabled=${!merge.dis} offers=${offers.join(",") || "none"}`);
  C("the KOT sheet's rows all speak in words", rows.every((r) => r.txt.length > 3 && !LEAK.test(r.txt)), rows.map((r) => r.op).join(","));
  if (!merge.dis) {
    await s.fr.evaluate(() => document.querySelector('[data-kotop="merge"]').click());
    await s.page.waitForTimeout(900);
    const dest = await s.fr.evaluate(() => ({ pick: [...document.querySelectorAll("[data-mergeto], .pick-t")].map((b) => Number(b.dataset.mergeto || b.dataset.t)).filter(Boolean), txt: document.body.innerText.replace(/\s+/g, " ").slice(0, 200) }));
    C("the merge picker offers only tables inside my section", dest.pick.every((t) => [21, 22].includes(t)), dest.pick.join(",") || dest.txt.slice(0, 80));
    C("the merge picker never offers the table I am standing on", !dest.pick.includes(21), dest.pick.join(","));
    await s.page.evaluate(() => history.back()); await s.page.waitForTimeout(1200);
  } else {
    C("the merge picker offers only tables inside my section", true, "row correctly disabled — nothing to offer");
    C("the merge picker never offers the table I am standing on", true, "row correctly disabled");
    await s.page.evaluate(() => history.back()); await s.page.waitForTimeout(1200);
  }

  // move-a-KOT and move-a-dish destinations
  await openTable(s, "21");
  await s.fr.evaluate(() => document.getElementById("kotMenuBtn").click());
  await s.fr.waitForSelector("[data-kotop]", { timeout: 30000 }); await s.page.waitForTimeout(400);
  const canMove = await s.fr.evaluate(() => { const b = document.querySelector('[data-kotop="movekot"]'); return b && !b.disabled; });
  if (canMove) {
    await s.fr.evaluate(() => document.querySelector('[data-kotop="movekot"]').click());
    await s.page.waitForTimeout(900);
    const one = await s.fr.evaluate(() => { const b = document.querySelector("[data-pickorder]"); if (b) b.click(); return !!b; });
    await s.page.waitForTimeout(900);
    const dests = await s.fr.evaluate(() => [...document.querySelectorAll("[data-moveto]")].map((b) => Number(b.dataset.moveto)).filter(Boolean));
    C("moving a KOT offers only tables inside my section", dests.every((t) => [21, 22].includes(t)), dests.join(",") || "(none offered)");
    C("moving a KOT never offers the table it is already on", !dests.includes(21), dests.join(","));
    C("the move flow reached a destination step at all", one, `${dests.length} destinations`);
  } else { for (const w of ["moving a KOT offers only tables inside my section", "moving a KOT never offers the table it is already on", "the move flow reached a destination step at all"]) C(w, false, "no movable ticket on this table"); }
  await s.page.evaluate(() => history.back()).catch(() => {}); await s.page.waitForTimeout(1200);

  // ── quick order's table picker (step 2 — the picker only exists once a cart does) ───────
  await s.fr.evaluate(() => { const x = document.querySelector("#detailClose, .picker-back"); if (x) x.click(); }); await s.page.waitForTimeout(700);
  await setSection(s.fr, [21, 22]); await s.page.waitForTimeout(500);
  const qo = await s.fr.evaluate(async () => {
    openQuickOrder();
    await new Promise((r) => setTimeout(r, 400));
    const d = state.data.dishes.find((x) => !x.open_price && !(x.options || []).length && !(x.tags || []).includes("sold-out"));
    if (!d) return { ok: false, why: "no plain dish" };
    state.cart = [{ id: d.id, qty: 1, title: d.title, price: d.price }];
    openQuickDest();
    await new Promise((r) => setTimeout(r, 500));
    const box = document.querySelector(".qdest-overlay");
    const out = { ok: !!box, tables: [...document.querySelectorAll("[data-qdest]")].map((b) => Number(b.dataset.qdest)), txt: box ? box.innerText.replace(/\s+/g, " ").trim() : "", head: (document.querySelector(".qdest-head h3") || {}).innerText || "" };
    // and the same picker with NO section at all
    state.summary.my_tables = []; window.mySection = () => [];
    openQuickDest();
    await new Promise((r) => setTimeout(r, 400));
    const b2 = document.querySelector(".qdest-overlay");
    out.emptyTxt = b2 ? b2.innerText.replace(/\s+/g, " ").trim() : "";
    out.emptyTiles = document.querySelectorAll("[data-qdest]").length;
    if (b2) b2.querySelector(".qdest-x").click();
    state.summary.my_tables = ["21", "22"]; window.mySection = () => ["21", "22"];
    state.cart = []; state.quick = false; state.ordering = false;
    renderFloor(); renderPanel();
    return out;
  });
  C("quick order's destination picker opens once there is a cart", qo.ok, qo.why || qo.head);
  C("quick order's picker asks the question in words", /Which table gets this order/i.test(qo.head), qo.head);
  C("quick order's picker stays inside my section", qo.tables.every((t) => [21, 22].includes(t)), qo.tables.join(",") || "(none)");
  C("quick order's picker never offers a table above the floor plan, which the server refuses", qo.tables.every((t) => t <= count), qo.tables.join(","));
  C("quick order's picker says whether a table is free or joins a bill", /free|joins/i.test(qo.txt), qo.txt.slice(0, 120));
  C("a waiter with NO section gets words, not an empty grid", qo.emptyTiles === 0 && /No tables assigned to you yet/i.test(qo.emptyTxt), qo.emptyTxt.slice(0, 120));
  C("…and is told the order is not lost", /stays here|safe/i.test(qo.emptyTxt), qo.emptyTxt.slice(0, 160));
  await s.page.waitForTimeout(600);

  // ── the panel survives a section arriving late, and a bad one ──────────────────────────
  const odd = await s.fr.evaluate(() => {
    const out = {};
    delete window.mySection;                       // back to the panel's own implementation
    window.mySection = eval("(" + String(function mySection() { const my = (state.summary || {}).my_tables; return Array.isArray(my) ? my.map((n) => String(parseInt(n, 10))) : null; }) + ")");
    state.summary.my_tables = ["3", 4, "05"]; out.mixed = mySection();
    out.parses = inMySection(5) && inMySection("3") && !inMySection(6);
    state.summary.my_tables = "not-an-array"; out.junk = mySection();
    state.summary.my_tables = null; out.nulled = mySection();
    return out;
  });
  C("a section of mixed strings and numbers is read as numbers", odd.mixed.join(",") === "3,4,5", odd.mixed.join(","));
  C("…and membership answers correctly either way round", odd.parses, JSON.stringify(odd.parses));
  C("a junk value is treated as no section, never as an empty one", odd.junk === null, JSON.stringify(odd.junk));
  C("clearing it returns the whole floor", odd.nulled === null, JSON.stringify(odd.nulled));
  await s.fr.evaluate(() => { state.summary.my_tables = null; renderMySection(); renderFloor(); }); await s.page.waitForTimeout(700);
  const restored = await s.fr.evaluate(() => document.querySelectorAll(".tile[data-t]").length);
  C("the floor comes back whole when the section is removed", restored >= count, `${restored} tiles`);
  C("no uncaught page error while sections were driven", s.errs.length === 0, s.errs.join(" | ").slice(0, 200));
  C("no leaked code text on a sectioned floor", !LEAK.test(await s.fr.evaluate(() => document.body.innerText)));
} catch (e) { C("block B completed without crashing", false, String(e.message).slice(0, 200)); }
finally { if (s) try { await s.browser.close(); } catch {} await retireTables(T); process.exitCode = dump("B") ? 1 : 0; }
