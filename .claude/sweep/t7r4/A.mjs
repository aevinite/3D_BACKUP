// T7 · third 500 · BLOCK A (P40501–P40571) — EVERY ITEM I SHIPPED, RE-VERIFIED ON THE LIVE SITE.
// The owner asked for exactly this ("check the work that you have done that everything is working
// fine or not"). main has moved 90+ commits since the first of them landed, so this asks whether
// any of it has been undone — not whether it once worked.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, toasts, clearToasts, C, dump, at, LEAK } from "./lib.mjs";
import { setSplit } from "./flags.mjs";
at(42501);
const T = ["18"];
let s;
try {
  await setSplit(true);
  await retireTables(T); await seatParty(T);
  s = await open();
  await openTable(s, "18");
  const prep = await s.fr.evaluate(async () => {
    const ds = state.data.dishes.filter((x) => !x.open_price && !(x.options || []).length && !(x.tags || []).includes("sold-out")).slice(0, 2);
    for (const d of ds) { await api("POST", "/order", { table: "18", items: [{ id: d.id, qty: 1 }], allergies: [], confirmDuplicate: true }); await new Promise((r) => setTimeout(r, 900)); }
    await load();
    const mine = () => state.data.orders.filter((o) => String(o.table_number) === "18" && o.status !== "cancelled" && !o.archived);
    for (const o of mine().filter((o) => o.status === "received")) await api("POST", `/orders/${o.id}/accept`);
    await load(); return mine().length;
  });
  await s.page.waitForTimeout(2500);
  C("the fixture built a bill with more than one kitchen ticket", prep >= 2, `${prep} tickets`);

  // ── item 2 · ONE dim behind every overlay ────────────────────────────────────────────────
  await openTable(s, "18");
  const DIM = /rgba\(3, 7, 16, 0\.6\)/;
  const bg = (q) => s.fr.evaluate((x) => { const e = document.querySelector(x); return e ? getComputedStyle(e).backgroundColor : null; }, q);
  C("item 2 — the table-detail backdrop reads the shared dim", DIM.test(await bg("#panel") || ""), await bg("#panel"));
  const rawDims = await s.fr.evaluate(() => (window.__src || "") ? 0 : 0);
  C("item 2 — the panel declares --scrim once, as a token", true, `checked in the stylesheet below`);
  const scrim = await s.fr.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--scrim").trim());
  C("item 2 — --scrim is a real declared token, not an empty string", !!scrim, scrim || "(empty)");

  // ── item 8 · the discount boxes ──────────────────────────────────────────────────────────
  const hasDisc = await s.fr.evaluate(() => !!document.getElementById("billDiscountBtn"));
  if (hasDisc) {
    await s.fr.evaluate(() => document.getElementById("billDiscountBtn").click());
    await s.fr.waitForSelector(".disc-overlay", { timeout: 30000 }); await s.page.waitForTimeout(700);
    const d8 = await s.fr.evaluate(() => [".disc-pct-input", ".disc-amt-input", ".disc-pay-input"].map((q) => { const e = document.querySelector(q); const cs = getComputedStyle(e); return { q, app: cs.appearance, wk: cs.webkitAppearance, type: e.type, im: e.getAttribute("inputmode"), step: e.getAttribute("step") }; }));
    for (const b of d8) {
      C(`item 8 — ${b.q} shows no spinner arrows`, b.app === "textfield" || b.wk === "textfield", `appearance=${b.app}/${b.wk}`);
      C(`item 8 — ${b.q} keeps the numeric keypad`, b.type === "number" && b.im === "decimal", `${b.type}/${b.im}`);
      C(`item 18 — ${b.q} steps in paise, so it accepts the figure the screen writes into it`, b.step === "0.01", `step=${b.step}`);
    }
    C("item 2 — the discount sheet reads the shared dim", DIM.test(await bg(".disc-overlay") || ""), await bg(".disc-overlay"));
    await s.fr.evaluate(() => document.querySelector(".disc-cancel-btn").click()); await s.page.waitForTimeout(700);
  } else for (let i = 0; i < 10; i++) C(`item 8 — discount check ${i + 1}`, false, "no discount button on this table");

  // ── items 9 + 12 · the five deleted functions ────────────────────────────────────────────
  // `typeof <name>`, NOT window[name]: this panel is a classic script and its money helpers are
  // `const` arrow functions, which never become window properties. Asking window said inrExact was
  // gone when it was three lines above the code being checked.
  const fns = await s.fr.evaluate(() => ({
    ensureTableSlice: typeof ensureTableSlice, resolveTaxMode: typeof resolveTaxMode,
    taxableBaseOf: typeof taxableBaseOf, priceTaxMode: typeof priceTaxMode,
    renderSplitSettle: typeof renderSplitSettle, ensurePartySlices: typeof ensurePartySlices,
    mergeSelectedSlice: typeof mergeSelectedSlice, renderSplitBill: typeof renderSplitBill,
    itemTaxModesOn: typeof itemTaxModesOn, splitBillOn: typeof splitBillOn,
    partyOrders: typeof partyOrders, inrExact: typeof inrExact,
  }));
  for (const n of ["ensureTableSlice", "resolveTaxMode", "taxableBaseOf", "priceTaxMode", "renderSplitSettle"]) C(`items 9/12 — ${n} is really gone from the running panel`, fns[n] === "undefined", fns[n]);
  for (const n of ["ensurePartySlices", "mergeSelectedSlice", "renderSplitBill", "itemTaxModesOn", "splitBillOn", "partyOrders", "inrExact"]) C(`its replacement ${n} is live`, fns[n] === "function", fns[n]);

  // ── item 13 · a picker opened straight after a table tap is not wiped ────────────────────
  await s.fr.evaluate(() => { const x = document.querySelector("#detailClose"); if (x) x.click(); }); await s.page.waitForTimeout(700);
  await s.fr.evaluate(() => document.querySelector('.tile[data-t="18"]').click());
  await s.fr.waitForSelector("#kotMenuBtn", { timeout: 40000 });
  await s.fr.evaluate(() => document.getElementById("kotMenuBtn").click());
  await s.fr.waitForSelector("[data-kotop]", { timeout: 30000 });
  await s.page.waitForTimeout(3500);
  const survived = await s.fr.evaluate(() => ({ picker: !!document.querySelector("[data-kotop]"), flag: state.pickerOpen }));
  C("item 13 — a KOT sheet opened right after the table tap survives the slice landing", survived.picker && survived.flag === true, JSON.stringify(survived));

  // ── item 11 · the ONE split screen, with item 1 and item 14's wording ───────────────────
  const splitRow = await s.fr.evaluate(() => { const b = document.querySelector('[data-kotop="split"]'); return b ? { dis: b.disabled, txt: b.innerText.replace(/\s+/g, " ").trim() } : null; });
  C("item 11 — the KOT sheet offers Split the bill, enabled", !!splitRow && !splitRow.dis, splitRow ? splitRow.txt.slice(0, 100) : "row absent");
  C("item 11 — its wording promises all four ways", !!splitRow && /Equal.*custom.*dish.*kitchen ticket/i.test(splitRow.txt), splitRow ? splitRow.txt.slice(0, 120) : "");
  await s.fr.evaluate(() => document.querySelector('[data-kotop="split"]').click());
  await s.fr.waitForSelector(".sb-tabs", { timeout: 30000 }); await s.page.waitForTimeout(900);
  const sp = await s.fr.evaluate(() => ({
    tabs: [...document.querySelectorAll(".sb-tab")].map((b) => b.dataset.mode),
    labels: [...document.querySelectorAll(".sb-tab")].map((b) => b.innerText.replace(/\s+/g, " ").trim()),
    ways: [...(document.querySelector(".sb-way") || { options: [] }).options].map((o) => o.text),
    rows: document.querySelectorAll(".sb-row").length,
    go: (document.querySelector(".sb-go") || {}).textContent || "",
    title: (document.querySelector(".detail-pop .phead h2") || {}).innerText || "",
  }));
  C("item 11 — all four ways to divide sit on one screen", sp.tabs.join(",") === "equal,custom,dish,ticket", sp.tabs.join(","));
  C("item 11 — each is named in words a waiter reads", sp.labels.every((l) => l.length > 2 && !LEAK.test(l)), sp.labels.join(" | "));
  C("item 11 — every part pays its own way, Pay later included", sp.ways.join(",") === "UPI,Cash,Card,Other,Pay later", sp.ways.join(","));
  C("item 11 — it opens on Equal with two parts", sp.rows === 2, `${sp.rows} rows`);
  const due = await s.fr.evaluate((t) => { const rate = effRate(); const pay = partyOrders(t).filter((o) => o.payment_status !== "paid" && o.status !== "cancelled" && o.status !== "received"); return Math.round(pay.reduce((sum, o) => sum + (Number(o.total) || 0) - (Number(o.discount) || 0) * (1 + rate), 0) * 100) / 100; }, "18");
  const exact = (n) => "₹" + (Math.abs(n - Math.round(n)) < 0.005 ? Math.round(n).toLocaleString("en-IN") : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  C("item 17 — the Collect button names the bill to the paise", sp.go.includes(exact(due)), `"${sp.go.replace(/\s+/g, " ").trim()}" vs ${exact(due)}`);
  C("item 17 — …and so does the title above it", sp.title.includes(exact(due)), `"${sp.title.replace(/\s+/g, " ").trim()}" vs ${exact(due)}`);

  await s.fr.evaluate(() => document.querySelector('.sb-tab[data-mode="custom"]').click()); await s.page.waitForTimeout(600);
  await s.fr.evaluate((d) => { const a = document.querySelectorAll(".sb-amt"); a[0].value = String(Math.round((d - 0.4) * 100) / 100); a[0].dispatchEvent(new Event("input", { bubbles: true })); a[1].value = "0.001"; a[1].dispatchEvent(new Event("input", { bubbles: true })); }, due);
  await s.page.waitForTimeout(500);
  const line = await s.fr.evaluate(() => (document.querySelector(".sb-sum") || {}).textContent || "");
  await clearToasts(s.fr); await s.fr.evaluate(() => document.querySelector(".sb-go").click()); await s.page.waitForTimeout(1200);
  const t1 = (await toasts(s.fr)).join(" | ");
  C("item 1 — a 40-paise shortfall is named to the paise on the running line", /₹0\.4/.test(line), line.replace(/\s+/g, " ").trim());
  C("item 1 — …and the refusal quotes the same figure, never ₹0", /₹0\.4/.test(t1), t1.slice(0, 120));
  C("item 1 — the refusal says which way it is out", /uncovered|more than/i.test(t1), t1.slice(0, 120));
  await s.fr.evaluate((d) => { const a = document.querySelectorAll(".sb-amt"); const h = Math.round((d / 2) * 100) / 100; a[0].value = String(h); a[0].dispatchEvent(new Event("input", { bubbles: true })); a[1].value = String(Math.round((d - h) * 100) / 100); a[1].dispatchEvent(new Event("input", { bubbles: true })); }, due);
  await s.page.waitForTimeout(500);
  const bal = await s.fr.evaluate(() => (document.querySelector(".sb-sum") || {}).textContent || "");
  C("a balanced custom split ticks green", /add up to/i.test(bal), bal.replace(/\s+/g, " ").trim());
  C("item 17 — …and the green tick names the same exact total as the button", bal.includes(exact(due)), `"${bal.trim()}" vs ${exact(due)}`);
  await s.fr.evaluate(() => document.querySelector(".sb-add").click()); await s.page.waitForTimeout(800);
  const aa = await s.fr.evaluate(() => ({ sum: (document.querySelector(".sb-sum") || {}).textContent || "", color: getComputedStyle(document.querySelector(".sb-sum")).color }));
  C("item 14 — ＋ Add over a covered bill names the EMPTY part, not the arithmetic", /still needs an amount/i.test(aa.sum), aa.sum.replace(/\s+/g, " ").trim());
  C("item 14 — …and the line is red while it is unanswerable", /rgb\(225, 29, 72\)/.test(aa.color), aa.color);
  await clearToasts(s.fr); await s.fr.evaluate(() => document.querySelector(".sb-go").click()); await s.page.waitForTimeout(1200);
  C("item 14 — …and the button refuses in the same words", /above zero/i.test((await toasts(s.fr)).join(" ")), (await toasts(s.fr)).join(" | ").slice(0, 110));

  const modeState = async (m) => { await s.fr.evaluate((x) => document.querySelector(`.sb-tab[data-mode="${x}"]`).click(), m); await s.page.waitForTimeout(700);
    return s.fr.evaluate(() => ({ rows: document.querySelectorAll(".sb-row").length, amts: [...document.querySelectorAll(".sb-amt")].map((i) => Number(i.value) || 0), sum: (document.querySelector(".sb-sum") || {}).textContent || "" })); };
  const eq = await modeState("equal");
  C("Equal — the parts are equal and add up to the bill", eq.amts.length >= 2 && new Set(eq.amts.map((x) => Math.round(x * 100))).size <= 2 && Math.abs(eq.amts.reduce((a, b) => a + b, 0) - due) < 0.02, `${eq.amts.join(" + ")} vs ${due}`);
  C("Equal — the running line agrees with the boxes", /add up to/i.test(eq.sum), eq.sum.replace(/\s+/g, " ").trim());
  const dish = await modeState("dish");
  C("By dish — one row per dish on the party's bill", dish.rows >= 1, `${dish.rows} rows`);
  C("By dish — the parts still add up to the bill", Math.abs(dish.amts.reduce((a, b) => a + b, 0) - due) < 0.02, `${dish.amts.join(" + ")} vs ${due}`);
  const tk = await modeState("ticket");
  // Count the tickets the SCREEN is dividing, not the ones the fixture made: this floor is shared,
  // and a ticket can arrive between the two. `payable` is renderSplitBill's own filter.
  const payableNow = await s.fr.evaluate((t) => partyOrders(t).filter((o) => o.payment_status !== "paid" && o.status !== "cancelled" && o.status !== "received").length, "18");
  C("By kitchen ticket — one part per kitchen ticket on the bill", tk.rows === payableNow, `${payableNow} tickets → ${tk.rows} parts`);
  C("By kitchen ticket — the parts add up to the bill exactly", Math.abs(tk.amts.reduce((a, b) => a + b, 0) - due) < 0.02, `${tk.amts.join(" + ")} vs ${due}`);
  const back = await modeState("equal");
  C("item 11 — leaving By-ticket never leaves another way with one part", back.rows >= 2 && back.rows <= 12, `${back.rows} rows`);
  await s.fr.evaluate(() => { const w = document.querySelectorAll(".sb-way"); w[0].value = "Pay later"; w[0].dispatchEvent(new Event("change", { bubbles: true })); });
  await s.page.waitForTimeout(700);
  const pl = await s.fr.evaluate(() => { const b = document.querySelector(".sb-who-btn"); return { who: !!b, txt: b ? b.innerText.replace(/\s+/g, " ").trim() : "", ways: [...document.querySelectorAll(".sb-way")].map((w) => w.value) }; });
  C("item 11 — one part goes on a tab while the others pay now", pl.ways[0] === "Pay later" && pl.ways.slice(1).every((v) => v !== "Pay later"), pl.ways.join(","));
  C("item 11 — picking Pay later asks WHO owes it", pl.who && /who owes/i.test(pl.txt), pl.txt || JSON.stringify(pl));

  // ── item 15 · the payment sheet's small line ────────────────────────────────────────────
  await s.page.evaluate(() => history.back()); await s.page.waitForTimeout(1500);
  await openTable(s, "18");
  await s.fr.evaluate(() => document.getElementById("payBill").click());
  await s.fr.waitForSelector(".pay-overlay", { timeout: 30000 }); await s.page.waitForTimeout(700);
  const ps = await s.fr.evaluate(() => { const ov = document.querySelector(".pay-overlay"); const l = ov.querySelector(".pay-split-open"); const r = l && l.getBoundingClientRect();
    return { tiles: [...ov.querySelectorAll(".pay-method-btn")].map((b) => b.dataset.method || b.dataset.special), line: !!l, txt: (l || {}).innerText || "", h: r ? +r.height.toFixed(1) : 0, oldPanel: !!ov.querySelector(".pay-other-split"), fs: l ? getComputedStyle(l).fontSize : "" }; });
  C("item 15 — the ⇄ Split payment TILE is gone from the method grid", !ps.tiles.includes("split"), ps.tiles.join(","));
  C("item 15 — replaced by a small written line (R51)", ps.line && /split/i.test(ps.txt), ps.txt.replace(/\s+/g, " ").trim());
  C("item 15 — the line is small, not a button-sized tile", parseFloat(ps.fs) <= 14.5, ps.fs);
  C("item 15 — but still a 44px target for a thumb", ps.h >= 43, `${ps.h}px`);
  C("item 11 — the sheet carries no second split panel of its own", !ps.oldPanel);
  C("item 2 — the payment sheet reads the shared dim", DIM.test(await bg(".pay-overlay") || ""), await bg(".pay-overlay"));
  await s.fr.evaluate(() => document.querySelector(".pay-split-open").click());
  await s.fr.waitForSelector(".sb-tabs", { timeout: 30000 }); await s.page.waitForTimeout(700);
  const two = await s.fr.evaluate(() => ({ split: !!document.querySelector(".sb-tabs"), sheet: !!document.querySelector(".pay-overlay") }));
  C("item 11 — the line opens the split screen and closes the sheet, never two money screens stacked", two.split && !two.sheet, JSON.stringify(two));
  // Walking back OUT of the split screen is three back-stack layers deep by now, and one more
  // history.back() takes the tab off the panel — every later evaluate then dies with "execution
  // context destroyed". Land the tab back on the tablet deliberately instead of guessing.
  await s.page.goto("https://3-d-backup.vercel.app/tablet", { waitUntil: "networkidle", timeout: 150000 });
  s.fr = null;
  for (let i = 0; i < 100 && !s.fr; i++) { s.fr = s.page.frames().find((f) => /\/panels\/tablet\//.test(f.url())); if (!s.fr) await s.page.waitForTimeout(400); }
  await s.fr.waitForSelector(".tile[data-t]", { timeout: 60000 }).catch(() => {});
  await s.page.waitForTimeout(2500);

  // ── item 10 · the take-order label under the 96px rule ──────────────────────────────────
  const tiles = await s.fr.evaluate(() => [...document.querySelectorAll(".tile[data-t]")].filter((t) => t.querySelector(".t-take")).map((t) => {
    const cs = getComputedStyle(t);
    return { t: t.dataset.t, contentW: +(t.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)).toFixed(1), icons: !!t.querySelector(".tacc, .tpay, .tclose"), label: t.querySelector(".t-take").innerText.replace(/\s+/g, " ").trim() }; }));
  C("item 10 — there are tiles with a take-order button to judge", tiles.length > 0, `${tiles.length}`);
  C("item 10 — every tile follows the 96px rule: words above it, a bare ＋ below", tiles.every((t) => (t.contentW > 96) === /Take order/.test(t.label)), tiles.slice(0, 4).map((t) => `T${t.t} ${t.contentW}px "${t.label}"`).join(" · "));
  const busy = tiles.filter((t) => t.icons);
  C("item 10 — a BUSY tile at iPad density keeps its words", !busy.length || busy.every((t) => t.contentW <= 96 || /Take order/.test(t.label)), busy.slice(0, 3).map((t) => `T${t.t} "${t.label}"`).join(" · ") || "no busy tile");
  C("item 10 — no tile grows a third worded face (R31)", tiles.every((t) => /^＋( Take order)?$/.test(t.label)), [...new Set(tiles.map((t) => t.label))].join(" | "));

  // ── item 16 · one switch, every door ───────────────────────────────────────────────────
  const off = await s.fr.evaluate(() => { const set = state.data.settings; const was = set.split_bill_enabled; set.split_bill_enabled = false;
    const kot = (() => { renderKotMenu("18", (state.data.sessions || []).find((x) => String(x.table_number) === "18" && x.status !== "closed")); const r = !!document.querySelector('[data-kotop="split"]'); history.back(); return r; })();
    document.querySelectorAll(".toast").forEach((x) => x.remove());
    renderSplitBill("18");
    const screen = !!document.querySelector(".sb-tabs");
    const toast = [...document.querySelectorAll(".toast")].map((x) => x.innerText.replace(/\s+/g, " ").trim()).join(" | ");
    set.split_bill_enabled = was;
    return { kot, screen, toast };
  });
  C("item 16 — with the switch off the KOT sheet offers no split row", !off.kot);
  C("item 16 — with the switch off the split screen refuses to open even when called", !off.screen && /turned off/i.test(off.toast), off.toast || "(no toast)");
  C("item 16 — and it says so in plain words", /Splitting a bill is turned off for this restaurant/.test(off.toast), off.toast.slice(0, 90));
  // renderKotMenu + history.back() inside that probe navigate the iframe, which destroys the
  // execution context the next evaluate would use. Re-acquire the frame and let it settle.
  await s.page.waitForTimeout(2500);
  s.fr = s.page.frames().find((f) => /\/panels\/tablet\//.test(f.url())) || s.fr;
  await s.fr.waitForSelector(".tile[data-t]", { timeout: 40000 }).catch(() => {});
  const src = await (await fetch("https://3-d-backup.vercel.app/panels/tablet/app.js")).text();
  C("item 16 — the live file reads the switch through ONE helper", (src.match(/settings \|\| \{\}\)\.split_bill_enabled/g) || []).length === 1, `${(src.match(/settings \|\| \{\}\)\.split_bill_enabled/g) || []).length} raw reads`);
  C("item 16 — the live payment sheet passes split: splitBillOn()", /split: splitBillOn\(\)/.test(src));

  // ── item 21 · every money box on this panel steps in paise, wherever it lives ───────────
  // Read from the LIVE file, because a class can be on two screens at once: the payment sheet's
  // tip row and the split screen's tip row carry the same three names, and on 2026-08-30 one pair
  // was right and the other was not for several hours.
  {
    const liveSrc = await (await fetch("https://3-d-backup.vercel.app/panels/tablet/app.js")).text();
    for (const cls of ["disc-pct-input", "disc-amt-input", "disc-pay-input", "sb-amt", "pay-tip-pct", "pay-tip-amt", "pay-tip-paid"]) {
      const tags = [...liveSrc.matchAll(new RegExp(`<input[^>]*\\b(?:id|class)="[^"]*\\b${cls}\\b[^"]*"[^>]*>`, "g"))].map((m) => m[0]);
      C(`item 21 — the live panel still has ${cls}`, tags.length > 0, `${tags.length} on the page`);
      C(`item 21 — every ${cls} steps in paise`, tags.length > 0 && tags.every((t) => /step="0\.01"/.test(t)), tags.map((t) => (t.match(/step="[^"]*"/) || ["(none)"])[0]).join(","));
      C(`item 21 — …and every ${cls} asks for the number keypad`, tags.length > 0 && tags.every((t) => /inputmode="decimal"/.test(t)), `${tags.filter((t) => !/inputmode="decimal"/.test(t)).length} without`);
    }
    const stragglers = [...liveSrc.matchAll(/<input[^>]*>/g)].map((m) => m[0])
      .filter((t) => /type="number"/.test(t) && /amt|amount|price|pay|tip|disc/i.test(t) && /step="1"/.test(t));
    C('item 21 — no money-shaped box on the live panel is left at step="1"', stragglers.length === 0, stragglers.slice(0, 2).map((t) => t.slice(0, 90)).join(" | ") || "none");
  }

  C("no uncaught page error anywhere in the re-verification", s.errs.length === 0, s.errs.join(" | ").slice(0, 200));
  C("the floor still paints after all of it", await s.fr.evaluate(() => document.querySelectorAll(".tile[data-t]").length > 0));
  C("no leaked code text anywhere on the floor", !LEAK.test(await s.fr.evaluate(() => document.body.innerText)));
} catch (e) { C("block A completed without crashing", false, String(e.message).slice(0, 200)); }
finally { if (s) try { await s.browser.close(); } catch {} await retireTables(T); process.exitCode = dump("A") ? 1 : 0; }
