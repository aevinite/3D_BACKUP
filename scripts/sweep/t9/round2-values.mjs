// SWEEP #8 · T9 · ROUND 2, block A — THE TICKET, DRIVEN WITH HOSTILE VALUES. P63313–P63578.
//
// WHY THIS BLOCK AND NOT ANOTHER 500 STATIC ONES. Round 1 left 974 mechanical rows, and a fresh
// measurement says only 33 named things in this territory are unnamed by any check — so another
// pass along that axis would be padding. The real gap is a different one: **93% of round 1 is
// static.** It reads the code and confirms a guard is written. It does not put a value through the
// guard and look at the pixels.
//
// Every fault this file's history records is of that shape — "Tnull" in a ticket header,
// "496071h 45m" from a null timestamp, "NaNh NaNm", the VIP badge that read a column that does not
// exist, the PARCEL branch that could never run. Each was invisible to a source read and obvious
// the moment a value went through.
//
// So this block drives the REAL panel and asserts the RENDERED DOM. It injects values into the
// panel's own `state` and calls the panel's own `render()` — no mocks, no re-implementation — then
// reads what a cook would actually see. Nothing is written to the database: the injected board
// never leaves the browser tab, and a reload restores the real one.
import { chromium } from "playwright";
import { loginAs } from "../login.mjs";

const BASE = (process.argv.find((a) => a.startsWith("--base=")) || "").slice(7) || "http://localhost:4309";
const PANEL = "iframe[src*='/panels/kitchen/index.html']";
const FILE = "round2-values";
const results = [];
const rec = (id, label, ok, note = "") => results.push({ id, label, ok: ok === true, note: ok === true ? note : (typeof ok === "string" ? ok : note) });

/** Values that have historically broken a staff screen, plus the ones that obviously could. */
const NASTY = [
  ["null", null], ["undefined", undefined], ["empty", ""], ["space", " "], ["zero", 0],
  ["negative", -1], ["huge", 999999999], ["float", 1.5], ["bool", true],
  ["nan", "NaN"], ["literal-undefined", "undefined"], ["literal-null", "null"],
  ["object", { a: 1 }], ["array", [1, 2]],
  ["long", "A".repeat(120)], ["emoji", "🍕🔥🍕🔥"], ["hindi", "पनीर टिक्का मसाला"],
  ["rtl", "مطعم"], ["cjk", "四川辣子鸡"], ["combining", "é́́́"],
  ["html", "<b>x</b>"], ["quote", 'a"b\'c'], ["amp", "a&b"], ["brace", "${x}"], ["arrow", "-->"],
  ["newline", "a\nb"], ["tab", "a\tb"], ["zwj", "a‍b"],
];
/** Things that must NEVER appear in anything a cook reads. */
const LEAKS = [/\bundefined\b/, /\bnull\b/, /\bNaN\b/, /\[object Object\]/, /\$\{/, /-->/, /Infinity/, /&#\d+;/, /&amp;amp;/];

/**
 * DID THE PANEL MANUFACTURE THIS, OR IS IT FAITHFULLY SHOWING WHAT IT WAS GIVEN?
 *
 * The first version of this block flagged 31 "faults" and every one was this distinction missing.
 * If a dish is genuinely CALLED "NaN" in the database, a ticket reading "NaN" is the panel doing
 * its job — and `${x}` or `-->` stored as text and rendered as text is correct escaping, not a
 * broken template or a broken comment. What matters is a leak the panel INVENTED: a value that was
 * not in the data and appeared on screen anyway. That is what "Tnull" and "496071h 45m" were.
 *
 * So a pattern only counts when the injected value does not already contain it.
 */
function invented(rendered, injected) {
  const inj = injected === undefined ? "undefined" : injected === null ? "null" : String(injected);
  return LEAKS.filter((re) => re.test(rendered || "") && !re.test(inj));
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const route = await loginAs(ctx, "kitchen", BASE);
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e && e.message).slice(0, 120)));
  await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60000 });
  const F = await (await page.waitForSelector(PANEL, { timeout: 30000 })).contentFrame();
  await page.waitForTimeout(2500);

  // A helper INSIDE the panel: replace the board with one crafted order, repaint, read it back.
  await F.evaluate(() => {
    window.__t9 = (order, items) => {
      state.orders = [order];
      state.items = items || [];
      state.platform = [];
      lastSig = null;
      render();
      const t = document.querySelector('.ticket[data-ticket="' + (order.id || "") + '"]') || document.querySelector(".ticket");
      if (!t) return { drawn: false };
      return {
        drawn: true,
        text: t.innerText,
        html: t.innerHTML,
        kot: (t.querySelector(".kot") || {}).textContent,
        tbl: (t.querySelector(".tbl") || {}).textContent,
        age: (t.querySelector(".age") || {}).textContent,
        lane: t.parentElement && t.parentElement.id,
        lines: [...t.querySelectorAll(".line")].map((l) => l.innerText),
        titleAttr: (t.querySelector(".tbl") || {}).title,
        badge: (t.querySelector(".ttag") || {}).textContent,
        h: Math.round(t.getBoundingClientRect().height),
        overflows: t.scrollWidth > t.clientWidth + 1,
      };
    };
    window.__t9plat = (p) => {
      state.orders = []; state.items = []; state.platform = [p];
      lastSig = null; render();
      const t = document.querySelector(".ticket.plat");
      if (!t) return { drawn: false };
      return { drawn: true, text: t.innerText, html: t.innerHTML, lane: t.parentElement && t.parentElement.id,
               badge: (t.querySelector(".src-badge") || {}).textContent, kot: (t.querySelector(".kot") || {}).textContent,
               age: (t.querySelector(".age") || {}).textContent, hasTbl: !!t.querySelector(".tbl"),
               overflows: t.scrollWidth > t.clientWidth + 1 };
    };
  });

  const base = (o = {}) => ({ id: "t9-probe", kot_no: 7, table_number: 3, status: "preparing",
                              created_at: new Date(Date.now() - 6e5).toISOString(), items: [], allergies: [], ...o });
  const baseItem = (o = {}) => ({ id: "t9-i1", order_id: "t9-probe", title: "Test Dish", qty: 1, status: "preparing", ...o });
  const clean = (s) => LEAKS.filter((re) => re.test(s || ""));
  let id = 63313;
  const next = () => "P" + id++;

  // ── A1 · table_number, every nasty value — the field "Tnull" came from ──
  for (const [name, v] of NASTY) {
    const r = await F.evaluate(([o, i]) => window.__t9(o, [i]), [base({ table_number: v }), baseItem()]);
    const leaks = invented(r.text, v);
    rec(next(), `a ticket whose table_number is ${name} draws a readable label and invents no leak`,
      r.drawn && leaks.length === 0 ? true : (!r.drawn ? "the ticket did not draw at all" : `leaked ${leaks.join(",")} in "${(r.text||"").replace(/\n/g," ").slice(0,70)}"`),
      `label="${r.tbl}"`);
  }
  // ── A2 · kot_no ──
  for (const [name, v] of NASTY) {
    const r = await F.evaluate(([o, i]) => window.__t9(o, [i]), [base({ kot_no: v }), baseItem()]);
    const leaks = invented(r.kot, v);
    rec(next(), `a ticket whose kot_no is ${name} draws a readable number and invents no leak`,
      r.drawn && leaks.length === 0 ? true : (!r.drawn ? "did not draw" : `kot reads "${r.kot}"`), `kot="${r.kot}"`);
  }
  // ── A3 · created_at — the field that printed "496071h 45m" ──
  for (const [name, v] of [...NASTY, ["epoch0", 0], ["iso-bad", "2026-13-45T99:99:99Z"], ["future", new Date(Date.now()+864e5).toISOString()]]) {
    const r = await F.evaluate(([o, i]) => window.__t9(o, [i]), [base({ created_at: v }), baseItem()]);
    const leaks = invented(r.age, v);
    const insane = /\d{5,}h/.test(r.age || "") || /^-/.test(r.age || "");
    rec(next(), `a ticket whose created_at is ${name} shows an honest age or nothing at all`,
      r.drawn && leaks.length === 0 && !insane ? true : (!r.drawn ? "did not draw" : `age reads "${r.age}"`), `age="${r.age}"`);
  }
  // ── A4 · dish title ──
  for (const [name, v] of NASTY) {
    const r = await F.evaluate(([o, i]) => window.__t9(o, [i]), [base(), baseItem({ title: v })]);
    const leaks = invented(r.lines.join(" "), v);
    rec(next(), `a dish whose title is ${name} renders escaped and invents no leak`,
      r.drawn && leaks.length === 0 ? true : (!r.drawn ? "did not draw" : `line reads "${(r.lines||[]).join("|").slice(0,70)}"`),
      `line="${(r.lines[0]||"").replace(/\n/g," ").slice(0,50)}"`);
  }
  // ── A5 · qty ──
  for (const [name, v] of NASTY) {
    const r = await F.evaluate(([o, i]) => window.__t9(o, [i]), [base(), baseItem({ qty: v })]);
    const leaks = invented(r.lines.join(" "), v);
    rec(next(), `a dish whose qty is ${name} renders without inventing a raw value`,
      r.drawn && leaks.length === 0 ? true : (!r.drawn ? "did not draw" : `line reads "${(r.lines||[]).join("|").slice(0,60)}"`));
  }
  // ── A6 · the per-dish note ──
  for (const [name, v] of NASTY) {
    const r = await F.evaluate(([o, i]) => window.__t9(o, [i]), [base(), baseItem({ note: v })]);
    const leaks = invented(r.lines.join(" "), v);
    rec(next(), `a dish note that is ${name} renders escaped and invents no leak`,
      r.drawn && leaks.length === 0 ? true : (!r.drawn ? "did not draw" : `line reads "${(r.lines||[]).join("|").slice(0,60)}"`));
  }
  // ── A7 · allergies (the line a cook must never misread) ──
  for (const [name, v] of [...NASTY, ["arrayOfNull", [null]], ["arrayOfObj", [{}]], ["arrayOfEmpty", [""]], ["mixed", ["nuts", null, 7]]]) {
    const r = await F.evaluate(([o, i]) => window.__t9(o, [i]), [base({ allergies: v }), baseItem()]);
    const leaks = invented(r.text, JSON.stringify(v));
    rec(next(), `an allergy list that is ${name} renders readably and invents no leak`,
      r.drawn && leaks.length === 0 ? true : (!r.drawn ? "did not draw" : `ticket reads "${(r.text||"").replace(/\n/g," ").slice(0,80)}"`));
  }
  // ── A8 · the table MARK (the badge that read a non-existent column) ──
  for (const [name, v] of [["vip","vip"],["family","family"],["guest","guest"],["unknown","banquet"],["empty",""],["null",null],["number",7],["object",{}],["injection","<b>x</b>"]]) {
    const r = await F.evaluate(([o, i, tag]) => { state.tableTags = tag === undefined ? {} : { "3": tag }; return window.__t9(o, [i]); },
                               [base({ table_number: 3 }), baseItem(), v]);
    const leaks = invented(r.text, v);
    const known = ["vip","family","guest"].includes(v);
    rec(next(), `a table mark of ${name} ${known ? "draws its badge" : "draws NO badge"} and leaks nothing`,
      r.drawn && leaks.length === 0 && (known ? !!r.badge : !r.badge) ? true
        : (!r.drawn ? "did not draw" : `badge="${r.badge}" leaks=${leaks.join(",")}`), `badge="${r.badge || "(none)"}"`);
  }
  await F.evaluate(() => { state.tableTags = {}; });
  // ── A9 · the restaurant's own NAME in the header ──
  for (const [name, v] of [["null",null],["empty",{}],["stringName",{name:"Aangan"}],["objName",{name:{en:"French House"}}],
      ["objNoEn",{name:{fr:"Chez Nous"}}],["logo",{logo_text:"*FH*"}],["logoBlank",{logo_text:"   "}],["emoji",{name:"🍕 Pizza"}],
      ["long",{name:"X".repeat(90)}],["html",{name:"<b>x</b>"}],["numberName",{name:7}],["allEmpty",{name:{en:"",fr:""}}]]) {
    const r = await F.evaluate((rest) => { state.restaurant = rest; setRestName(rest);
      const el = document.getElementById("restName");
      return { txt: el.textContent, w: Math.round(el.getBoundingClientRect().width), overflow: document.documentElement.scrollWidth > window.innerWidth + 1 }; }, v);
    const leaks = invented(r.txt, JSON.stringify(v));
    rec(next(), `the header's restaurant name for ${name} is readable, unstarred and invents no leak`,
      leaks.length === 0 && !/\*/.test(r.txt) && !r.overflow ? true : `header reads "${r.txt}" (overflow ${r.overflow})`, `"${r.txt}"`);
  }
  // ── A10 · a PLATFORM ticket's fields ──
  for (const [name, v] of [["null",null],["empty",""],["unknown","doordash"],["zomato","zomato"],["swiggy","swiggy"],
                           ["takeaway","takeaway"],["parcel","parcel"],["object",{}],["number",7],["html","<b>x</b>"]]) {
    const r = await F.evaluate((s) => window.__t9plat({ id:"t9-p1", source:s, status:"preparing", kot_no:11,
      created_at:new Date(Date.now()-9e5).toISOString(), items:[{title:"Item",qty:1}], customer_name:"Someone" }), v);
    const leaks = invented(r.text, v);
    rec(next(), `a delivery ticket whose source is ${name} draws a badge, no table, and invents no leak`,
      r.drawn && leaks.length === 0 && !!r.badge && !r.hasTbl ? true
        : (!r.drawn ? "did not draw" : `badge="${r.badge}" hasTable=${r.hasTbl} leaks=${leaks.join(",")}`), `badge="${r.badge}"`);
  }
  for (const [name, v] of NASTY.slice(0, 18)) {
    const r = await F.evaluate((c) => window.__t9plat({ id:"t9-p2", source:"zomato", status:"preparing", kot_no:12,
      created_at:new Date(Date.now()-9e5).toISOString(), items:[{title:"Item",qty:1}], customer_name:c }), v);
    const leaks = invented(r.text, v);
    rec(next(), `a delivery ticket whose customer_name is ${name} renders escaped and invents no leak`,
      r.drawn && leaks.length === 0 ? true : (!r.drawn ? "did not draw" : `text "${(r.text||"").replace(/\n/g," ").slice(0,70)}"`));
  }
  // ── A11 · the whole ORDER shape, malformed ──
  for (const [name, o] of [["noItems", base({ items: undefined })], ["itemsString", base({ items: "x" })],
      ["itemsObject", base({ items: {} })], ["itemsNulls", base({ items: [null, undefined] })],
      ["noId", base({ id: undefined })], ["noStatus", base({ status: undefined })],
      ["badStatus", base({ status: "teleporting" })], ["cancelled", base({ status: "cancelled" })],
      ["served", base({ status: "served" })], ["received", base({ status: "received" })],
      ["emptyObject", {}], ["nullOrder", null]]) {
    const r = await F.evaluate(([oo, i]) => { try { return window.__t9(oo || {}, [i]); } catch (e) { return { threw: String(e && e.message) }; } },
                               [o, baseItem()]);
    const leaks = invented(r.text, JSON.stringify(o));
    rec(next(), `an order shaped ${name} either draws cleanly or is dropped — never a broken card`,
      !r.threw && leaks.length === 0 ? true : (r.threw ? `render threw: ${r.threw}` : `leaked ${leaks.join(",")}`),
      r.drawn ? `lane=${r.lane}` : "not drawn (correct for cancelled/served)");
  }
  rec(next(), "no uncaught error was raised by any of the injected values", pageErrors.length === 0 ? true : pageErrors.slice(0,3).join(" | "));

  // restore the real board, so nothing is left injected
  await F.evaluate(() => { state.orders = []; state.items = []; state.platform = []; lastSig = null; });
  await page.reload({ waitUntil: "networkidle" });
  const F2 = await (await page.waitForSelector(PANEL)).contentFrame();
  await page.waitForTimeout(2500);
  const restored = await F2.evaluate(() => ({ tickets: document.querySelectorAll(".ticket").length, rest: (document.getElementById("restName")||{}).textContent }));
  rec(next(), "the real board is back after the injection pass — nothing was left crafted", restored.tickets >= 0 && !!restored.rest ? true : "the board did not come back", `${restored.tickets} tickets, "${restored.rest}"`);

  await browser.close();
  const bad = results.filter((r) => !r.ok);
  console.log("\nROUND 2 · A — THE TICKET, DRIVEN WITH HOSTILE VALUES — " + BASE);
  console.log(`  ${results.length - bad.length} passed · ${bad.length} failed  (of ${results.length})`);
  for (const r of results) if (!r.ok) console.log(`  ✗ ${r.id}  ${r.label}\n      → ${r.note}`);
  // --ledger: emit each executed row as a ledger line, so the permanent record is generated from
  // the run rather than typed out by hand (a typed count is the thing INDEX.md says never to trust).
  if (process.argv.includes("--ledger")) {
    for (const r of results) {
      const how = "`node scripts/sweep/t9/" + FILE + ".mjs --base=<url>` (driven)";
      console.log(`| ${r.id} | ${r.label.replace(/\|/g, "\\|")} | ${how} | ${r.ok ? "✅" : "❌"} | ${(r.note || "").replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 160)} |`);
    }
  }
  console.log(`  (ids ${results[0].id} … ${results[results.length-1].id})`);
  process.exit(bad.length ? 1 : 0);
}
main().catch((e) => { console.error("round2-values threw:", e); process.exit(2); });
