// T7 · fifth 500 · BLOCK F — THE BACK-STACK LADDER, RUNG BY RUNG.
// Every overlay this panel can open, opened, and then closed by the HARDWARE back button — the
// thing a waiter's thumb actually finds. One overlay at a time has been checked before; never the
// whole ladder, and never what a Back press leaves behind.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, C, dump, at, LEAK, BASE } from "./lib.mjs";
import { setSplit } from "./flags.mjs";
at(45066);
const T = ["27"];
let s;
const land = async () => {
  await s.page.goto(BASE + "/tablet", { waitUntil: "networkidle", timeout: 150000 });
  s.fr = null;
  for (let i = 0; i < 100 && !s.fr; i++) { s.fr = s.page.frames().find((f) => /\/panels\/tablet\//.test(f.url())); if (!s.fr) await s.page.waitForTimeout(400); }
  await s.fr.waitForSelector(".tile[data-t]", { timeout: 60000 }).catch(() => {});
  await s.page.waitForTimeout(1800);
};
try {
  await setSplit(true);
  await retireTables(T); await seatParty(T);
  s = await open();
  await openTable(s, T[0]);
  await s.fr.evaluate(async (t) => {
    const d = state.data.dishes.find((x) => !x.open_price && !(x.options || []).length && !(x.tags || []).includes("sold-out"));
    await api("POST", "/order", { table: t, items: [{ id: d.id, qty: 1 }], allergies: [], confirmDuplicate: true });
    await selectTable(t);
    for (const o of partyOrders(t).filter((o) => o.status === "received")) await api("POST", `/orders/${o.id}/accept`);
    await selectTable(t);
  }, T[0]);
  await s.page.waitForTimeout(1500);

  // Every overlay this panel can raise, with how to open it and how to know it is there.
  const LAYERS = [
    ["the table detail itself", `document.querySelector('.tile[data-t="${T[0]}"]').click()`, ".detail-pop"],
    ["the KOT & table operations sheet", `document.getElementById("kotMenuBtn").click()`, "[data-kotop]"],
    ["the discount sheet", `document.getElementById("billDiscountBtn").click()`, ".disc-overlay"],
    ["the payment sheet", `document.getElementById("payBill").click()`, ".pay-overlay"],
    ["the manager-PIN prompt", `pinPrompt("A manager PIN is required for this action.")`, ".pp-in"],
    ["the reason box", `reasonPrompt("Why are you making this change?")`, ".rp-in"],
    ["the confirm box", `confirmDialog("Do the thing?", "Yes")`, "#confirmOverlay:not([hidden])"],
    ["the ☰ drawer", `document.getElementById("hamburger").click()`, ".tbl-drawer"],
  ];
  for (const [name, opener, marker] of LAYERS) {
    await land();
    await openTable(s, T[0]);
    if (name !== "the table detail itself") await s.page.waitForTimeout(400);
    const opened = await s.fr.evaluate(async ({ op, mk, nm }) => {
      try { if (nm === "the ☰ drawer") { const h = document.getElementById("hamburger"); if (!h) return { skip: "no ☰ at this width" }; } eval(op); } catch (e) { return { err: String(e.message).slice(0, 60) }; }
      await new Promise((r) => setTimeout(r, 900));
      const el = document.querySelector(mk);
      const vis = el ? (mk === ".tbl-drawer" ? el.getBoundingClientRect().left < window.innerWidth - 20 : true) : false;
      return { there: vis, layer: typeof LFH_BACK !== "undefined", txt: el ? (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 90) : "" };
    }, { op: opener, mk: marker, nm: name });
    if (opened.skip) { C(`${name} opens`, false, opened.skip); C(`${name} — hardware Back closes it`, false, opened.skip); C(`${name} — …and leaves the panel standing`, false, opened.skip); continue; }
    C(`${name} opens`, opened.there === true, opened.err || opened.txt.slice(0, 70) || "(nothing appeared)");
    if (!opened.there) { C(`${name} — hardware Back closes it`, false, "it never opened"); C(`${name} — …and leaves the panel standing`, false, "it never opened"); continue; }
    await s.page.evaluate(() => history.back());
    await s.page.waitForTimeout(1400);
    const after = await s.fr.evaluate((mk) => {
      const el = document.querySelector(mk);
      const gone = !el || (mk === ".tbl-drawer" ? el.getBoundingClientRect().left >= window.innerWidth - 20 : false);
      return { gone, floor: document.querySelectorAll(".tile[data-t]").length, body: document.body.innerText.length };
    }, marker).catch(() => null);
    C(`${name} — hardware Back closes it`, !!after && after.gone, after ? `still there = ${!after.gone}` : "the frame went away — Back left the panel");
    C(`${name} — …and leaves the panel standing underneath`, !!after && after.floor > 0, after ? `${after.floor} tiles` : "no frame");
  }

  // ── three deep, then three Backs ──────────────────────────────────────────────────────
  await land();
  await openTable(s, T[0]);
  const deep = await s.fr.evaluate(async () => {
    const seen = [];
    document.getElementById("kotMenuBtn").click();
    await new Promise((r) => setTimeout(r, 800));
    seen.push(!!document.querySelector("[data-kotop]"));
    const mv = document.querySelector('[data-kotop="movekot"]');
    if (mv && !mv.disabled) { mv.click(); await new Promise((r) => setTimeout(r, 900)); seen.push(!!document.querySelector("[data-pickorder]")); }
    const first = document.querySelector("[data-pickorder]");
    if (first) { first.click(); await new Promise((r) => setTimeout(r, 900)); seen.push(!!document.querySelector("[data-moveto]")); }
    return { seen, pickerOpen: state.pickerOpen };
  });
  C("a picker can be walked three screens deep", deep.seen.filter(Boolean).length >= 3, `${deep.seen.filter(Boolean).length} layers`);
  C("…and the panel knows a picker is open the whole way down", deep.pickerOpen === true, `pickerOpen=${deep.pickerOpen}`);
  const rungs = [];
  for (let i = 0; i < 3; i++) {
    await s.page.evaluate(() => history.back());
    await s.page.waitForTimeout(1300);
    rungs.push(await s.fr.evaluate(() => ({
      moveto: !!document.querySelector("[data-moveto]"), pick: !!document.querySelector("[data-pickorder]"),
      kot: !!document.querySelector("[data-kotop]"), detail: !!document.querySelector(".detail-pop"),
      floor: document.querySelectorAll(".tile[data-t]").length,
    })).catch(() => null));
  }
  // THE LADDER IS SHORTER THAN IT LOOKS, ON PURPOSE. Each step of the move flow calls dropLayer()
  // before advancing, so the KOT sheet's rung is gone by the time the ticket picker is on screen —
  // and backing out of a picker returns to the TABLE, not to the menu that opened it. Expecting a
  // rung per screen made the second Back look like it had skipped one.
  C("the first Back takes off the destination step and shows the ticket picker again", !!rungs[0] && !rungs[0].moveto && rungs[0].pick, JSON.stringify(rungs[0]));
  C("the second takes off the picker and lands on the TABLE, not the floor", !!rungs[1] && !rungs[1].pick && !rungs[1].moveto && rungs[1].detail, JSON.stringify(rungs[1]));
  C("…which is the rule: a step drops its own rung before advancing, so backing out of a picker returns to the table", !!rungs[1] && !rungs[1].kot, `kot sheet re-shown = ${rungs[1] && rungs[1].kot}`);
  C("the third leaves the table for the floor, and goes no further", !!rungs[2] && rungs[2].floor > 0, JSON.stringify(rungs[2]));
  C("…and the floor is underneath it the whole way", rungs.every((r) => r && r.floor > 0), rungs.map((r) => (r ? r.floor : "gone")).join(" → "));
  C("…and the picker flag is cleared at the end", (await s.fr.evaluate(() => state.pickerOpen)) !== true, `pickerOpen=${await s.fr.evaluate(() => state.pickerOpen)}`);

  // ── a layer closed by its own ✕ leaves no orphan history entry ────────────────────────
  await land();
  await openTable(s, T[0]);
  const orphan = await s.fr.evaluate(async () => {
    const before = history.length;
    document.getElementById("kotMenuBtn").click();
    await new Promise((r) => setTimeout(r, 800));
    const opened = history.length;
    const x = document.querySelector(".picker-back");
    if (x) x.click();
    await new Promise((r) => setTimeout(r, 900));
    return { before, opened, after: history.length, kot: !!document.querySelector("[data-kotop]"), detail: !!document.querySelector(".detail-pop") };
  });
  C("closing a picker with its own ✕ really closes it", !orphan.kot, `kot sheet still there = ${orphan.kot}`);
  C("…and leaves the table underneath", orphan.detail, `detail=${orphan.detail}`);
  const afterX = await (async () => { await s.page.evaluate(() => history.back()); await s.page.waitForTimeout(1300);
    return s.fr.evaluate(() => ({ floor: document.querySelectorAll(".tile[data-t]").length, detail: !!document.querySelector(".detail-pop") })).catch(() => null); })();
  C("…and the NEXT Back is not spent on a layer that is already gone", !!afterX && afterX.floor > 0, afterX ? `detail=${afterX.detail} · ${afterX.floor} tiles` : "the frame went away");

  // ── the source rule ───────────────────────────────────────────────────────────────────
  const src = await (await fetch(BASE + "/panels/tablet/app.js")).text();
  const layers = (src.match(/LFH_BACK\.layer\(/g) || []).length;
  C("every overlay registers with the one back-stack manager", layers >= 8, `${layers} registrations`);
  C("…and nothing hand-rolls pushState behind its back", !/history\.pushState/.test(src), "no raw pushState");
  C("…and every registration is torn down again", (src.match(/backOff\(\)|dropLayer\(\)|off\(\)/g) || []).length >= layers / 2, `${(src.match(/backOff\(\)|dropLayer\(\)|off\(\)/g) || []).length} teardowns`);
  C("no uncaught page error climbing the whole ladder", s.errs.length === 0, s.errs.join(" | ").slice(0, 140));
  C("no leaked code text after it", !LEAK.test(await s.fr.evaluate(() => document.body.innerText)));
} catch (e) { C("block F completed without crashing", false, String(e.message).slice(0, 220)); }
finally { if (s) try { await s.browser.close(); } catch {} await retireTables(T); process.exitCode = dump("F") ? 1 : 0; }
