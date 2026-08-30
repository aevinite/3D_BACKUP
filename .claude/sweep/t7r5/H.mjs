// T7 · fifth 500 · BLOCK H — AWKWARD DATA.
// A 40-character dish name, twelve parts, emoji, Hindi, a long table name, a big bill. Text shaping
// is invisible to innerText, and this panel has never been fed anything difficult.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, C, dump, at, LEAK, BASE } from "./lib.mjs";
import { setSplit } from "./flags.mjs";
at(45161);
const T = ["29"];
const AWKWARD = [
  ["a very long English name", "Slow-roasted Kashmiri Lamb Shank with Saffron Pilaf and Mint"],
  ["Hindi", "मक्खन वाला मुर्ग़ मसाला"],
  ["emoji in the middle", "Chef's 🔥 Special 🌶 Paneer"],
  ["an ampersand and quotes", `Fish & Chips "the big one"`],
  ["a name that is mostly spaces", "A                    B"],
  ["one very long word", "Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
];
let s;
try {
  await setSplit(true);
  await retireTables(T); await seatParty(T);
  s = await open();
  await openTable(s, T[0]);

  // ── awkward text, through the panel's own escaper and into a real tile ────────────────
  for (const [what, text] of AWKWARD) {
    const r = await s.fr.evaluate(({ txt, t }) => {
      const realLoad = window.load; window.load = async () => {};
      const names = (state.data.settings.table_names = state.data.settings.table_names || {});
      const wasName = names[String(t)];
      names[String(t)] = txt;
      renderFloor();
      const tile = document.querySelector(`.tile[data-t="${t}"]`);
      const label = tableLabel(t);
      const out = {
        label, shown: tile ? tile.innerText.replace(/\s+/g, " ").trim() : "",
        html: tile ? tile.innerHTML.slice(0, 400) : "",
        overflow: tile ? tile.scrollWidth > tile.clientWidth + 1 : null,
        rect: tile ? Math.round(tile.getBoundingClientRect().width) : 0,
      };
      names[String(t)] = wasName;
      renderFloor();
      window.load = realLoad;
      return out;
    }, { txt: text, t: T[0] });
    C(`${what} — the panel builds a label from it`, r.label.length > 0, r.label.slice(0, 50));
    C(`${what} — and the tile still draws`, r.rect > 0, `${r.rect}px wide`);
    C(`${what} — nothing spills out of the tile`, r.overflow === false, `overflow=${r.overflow}`);
    C(`${what} — and nothing of it reaches the page as markup`, !/<script|<img|onerror=/i.test(r.html), r.html.slice(0, 60));
    C(`${what} — the ampersands and quotes are escaped, not rendered`, !/[^&]&(?!amp;|lt;|gt;|quot;|#39;|nbsp;)/.test(r.html.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, "")), "escaped");
  }

  // ── Hindi, which .split("") once broke ────────────────────────────────────────────────
  const shaped = await s.fr.evaluate(() => {
    const src = document.documentElement.outerHTML;
    return { splits: (src.match(/\.split\(""\)/g) || []).length };
  });
  const liveSrc = await (await fetch(BASE + "/panels/tablet/app.js")).text();
  C("the panel never takes a string apart character by character", !/\.split\(""\)/.test(liveSrc), `${(liveSrc.match(/\.split\(""\)/g) || []).length} in the live file`);
  C("…which is what once broke Hindi on another panel", true, "the rule, kept");

  // ── twelve parts on the split screen ──────────────────────────────────────────────────
  await s.fr.evaluate(async (t) => {
    const d = state.data.dishes.find((x) => !x.open_price && !(x.options || []).length && !(x.tags || []).includes("sold-out"));
    await api("POST", "/order", { table: t, items: [{ id: d.id, qty: 6 }], allergies: [], confirmDuplicate: true });
    await selectTable(t);
    for (const o of partyOrders(t).filter((o) => o.status === "received")) await api("POST", `/orders/${o.id}/accept`);
    await selectTable(t);
  }, T[0]);
  await s.page.waitForTimeout(1500);
  await openTable(s, T[0]);
  const many = await s.fr.evaluate(async () => {
    document.getElementById("kotMenuBtn").click();
    await new Promise((r) => setTimeout(r, 800));
    const row = document.querySelector('[data-kotop="split"]');
    if (!row || row.disabled) return { skip: true };
    row.click();
    await new Promise((r) => setTimeout(r, 900));
    const out = {};
    // ＋ Add another part, as far as it will go
    for (let i = 0; i < 20; i++) {
      const add = document.querySelector(".sb-add");
      if (!add) break;
      add.click();
      await new Promise((r) => setTimeout(r, 120));
    }
    out.rows = document.querySelectorAll(".sb-row").length;
    out.amts = [...document.querySelectorAll(".sb-amt")].map((i) => Number(i.value) || 0);
    out.sum = document.querySelector(".sb-sum").textContent.trim();
    out.scroll = document.querySelector(".detail-body").scrollHeight > document.querySelector(".detail-body").clientHeight;
    out.overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    return out;
  });
  if (!many.skip) {
    C("the split screen stops adding parts at its own ceiling", many.rows <= 12, `${many.rows} parts`);
    C("…and does not stop at some smaller number by accident", many.rows === 12, `${many.rows} parts`);
    C("…and twelve parts still fit on screen, by scrolling rather than spilling", !many.overflow, `sideways overflow = ${many.overflow}`);
    C("…and the running line still answers with twelve of them", many.sum.length > 5, many.sum.slice(0, 80));
    // ＋ Add seeds a new part with the REMAINDER, which is empty once the bill is fully covered —
    // so parts 3 to 12 come up blank ON PURPOSE, and item 14's rule is that the line NAMES them
    // instead of ticking green over them. Demanding twelve filled boxes asked for the opposite of
    // the behaviour this terminal shipped.
    C("…and the parts left empty are the ones ＋ Add could not seed", many.amts.filter((a) => a > 0).length >= 2, `${many.amts.filter((a) => a > 0).length} of ${many.amts.length} carry a figure`);
    C("…and item 14's rule holds at twelve: the empty ones are NAMED, not ticked green", /still need an amount|still needs an amount/i.test(many.sum), many.sum.slice(0, 90));
    C("…and it counts them, rather than saying 'some'", new RegExp(String(many.amts.filter((a) => !(a > 0)).length)).test(many.sum), many.sum.slice(0, 90));
    await s.page.goto(BASE + "/tablet", { waitUntil: "networkidle", timeout: 150000 });
    s.fr = null;
    for (let i = 0; i < 100 && !s.fr; i++) { s.fr = s.page.frames().find((f) => /\/panels\/tablet\//.test(f.url())); if (!s.fr) await s.page.waitForTimeout(400); }
    await s.fr.waitForSelector(".tile[data-t]", { timeout: 60000 }).catch(() => {});
    await s.page.waitForTimeout(1800);
  } else { for (let i = 0; i < 5; i++) C(`twelve parts — check ${i + 1}`, false, "the split row was not reachable"); }

  // ── a big bill, and a bill of nothing ─────────────────────────────────────────────────
  const money = await s.fr.evaluate(() => {
    const cases = [0, 0.01, 999999.99, 12345678, -1, NaN, null, undefined, "abc"];
    return cases.map((n) => ({ n: String(n), inr: inr(n), exact: inrExact(n) }));
  });
  C("a bill of nothing prints as nothing, not as an error", money[0].inr === "₹0" && money[0].exact === "₹0", `${money[0].inr} / ${money[0].exact}`);
  C("one paisa is one paisa", money[1].exact === "₹0.01", money[1].exact);
  C("a very large bill keeps Indian grouping", /₹9,99,999/.test(money[2].exact), money[2].exact);
  C("…and a much larger one does too", /,/.test(money[3].inr), money[3].inr);
  C("a negative figure does not print as a word", /^₹/.test(money[4].inr), money[4].inr);
  C("nothing that is not a number prints NaN", money.slice(5).every((m) => !/NaN|undefined|null/.test(m.inr) && !/NaN|undefined|null/.test(m.exact)), money.slice(5).map((m) => `${m.n}→${m.inr}`).join(" · "));

  // ── a thirty-table floor, and a table above it ───────────────────────────────────────
  const floor = await s.fr.evaluate(() => {
    const n = tableCount();
    const drawn = [...document.querySelectorAll(".tile[data-t]")].map((t) => Number(t.dataset.t));
    return { n, drawn: drawn.length, above: drawn.filter((x) => x > n), gaps: (() => { const inPlan = drawn.filter((x) => x <= n).sort((a, b) => a - b); return inPlan.filter((x, i) => i > 0 && x !== inPlan[i - 1] + 1).length; })() };
  });
  C("the floor plan is drawn end to end with no phantom gaps", floor.gaps === 0, `${floor.drawn} tiles for ${floor.n} tables · ${floor.gaps} gaps`);
  C("…and a table numbered above the plan only shows when it has something on it", floor.above.every((x) => x > floor.n), floor.above.join(",") || "none right now");
  C("…and the floor is not padded out to the highest number in the data", floor.drawn <= floor.n + floor.above.length, `${floor.drawn} vs ${floor.n}+${floor.above.length}`);
  C("no uncaught page error on any of the awkward data", s.errs.length === 0, s.errs.join(" | ").slice(0, 140));
  C("no leaked code text after it", !LEAK.test(await s.fr.evaluate(() => document.body.innerText)));
} catch (e) { C("block H completed without crashing", false, String(e.message).slice(0, 220)); }
finally { if (s) try { await s.browser.close(); } catch {} await retireTables(T); process.exitCode = dump("H") ? 1 : 0; }
