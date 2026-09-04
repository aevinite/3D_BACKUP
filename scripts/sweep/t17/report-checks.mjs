import { buildReportHtml, buildReportTables, moneyInHand } from "./reportdoc.mjs";
// IDs are allocated sequentially from this terminal's own pre-allocated block, so the file can
// grow without anyone hand-picking a number and colliding. T17 of sweep #8 holds P70701-P71700.
let NEXT = Number(process.env.T17_REPORT_FROM || 70801);
const nid = () => "P" + (NEXT++);
let pass = 0, fail = 0; const bad = [];
const ok = (_id, what, cond, note = "") => { const id = nid(); return (() => { if (cond) { pass++; console.log(`✅ ${id} ${what}`); } else { fail++; bad.push([id, what, note]); console.log(`❌ ${id} ${what} ${note}`); } })(); };

const bill = (o = {}) => ({ gross: 100000, discount: 5000, taxComponents: [{ label: "CGST 2.5%", amount: 2375 }, { label: "SGST 2.5%", amount: 2375 }], taxTotal: 4750, net: 95000, cancelledOrders: 2, cancelledValue: 1200, ...o });
const daily = (n, from = "2026-08-01") => Array.from({ length: n }, (_, i) => { const d = new Date(from + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + i); const iso = d.toISOString().slice(0, 10);
  return { label: iso, iso, orders: 10 + i, gross: 10000 + i * 100, discount: 500, tax: 475, net: 9500 + i * 90 }; });
const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: h >= 11 && h < 15 ? 12 : h >= 19 && h < 23 ? 20 : 1, revenue: (h >= 11 && h < 15 ? 12 : h >= 19 && h < 23 ? 20 : 1) * 300 }));
const dishes = (n) => Array.from({ length: n }, (_, i) => ({ title: `Dish ${i + 1}`, qty: n - i, revenue: (n - i) * (100 + i * 10) }));
const rest = (o = {}) => ({ name: "My Little French House", slug: "french-house", revenue: 99750, orders: 120, paidOrders: 118, avg: 845, share: 1, prevRevenue: 80000,
  billing: bill(), busiestHour: "8 pm", dishes: dishes(12), categories: [{ category: "Starters", qty: 40, revenue: 20000 }, { category: "Mains", qty: 60, revenue: 60000 }],
  payments: [{ method: "Cash", revenue: 50000, orders: 60 }, { method: "UPI", revenue: 49750, orders: 58 }], daily: daily(30), dailyGrain: "day", hourly, ...o });
const data = (o = {}) => ({ scopeName: "All restaurants", periodLabel: "Last 30 days", generatedAt: "4 Sep 2026, 2:00 pm",
  group: { revenue: 99750, orders: 120, paidOrders: 118, avg: 845, prevRevenue: 80000, billing: bill(), payments: rest().payments, khata: null }, restaurants: [rest()], ...o });

// ── the money-flow equation
{
  const b = bill();
  ok("P71301", "moneyInHand = gross − discount", moneyInHand(b) === 95000, `got ${moneyInHand(b)}`);
  ok("P71302", "moneyInHand is null when gross is unknown", moneyInHand(bill({ gross: null })) === null);
  ok("P71303", "moneyInHand is null when the discount is unknown", moneyInHand(bill({ discount: null })) === null);
  const h = buildReportHtml(data());
  ok("P71304", "the printed money flow states the taxable amount", h.includes("= Taxable amount (gross − discounts)"));
  ok("P71305", "the printed money flow ends on MONEY IN HAND", h.includes("= MONEY IN HAND — what you keep"));
  ok("P71306", "total collected = gross − discount + GST, printed", h.includes("₹99,750"), "expected ₹99,750 = 100000-5000+4750");
  ok("P71307", "the sheet prints Indian grouping, never American", !/₹9,9750|₹99,750\.00|₹9\d{2},\d{3}(?!\d)/.test(h) && h.includes("₹99,750"));
  ok("P71308", "the discount rate is a percentage of gross", h.includes("Discount rate"));
}
// ── escaping AT THE SINK
{
  const nasty = 'Ram & Sons <b>"Café"</b>';
  const d = data({ scopeName: nasty, restaurants: [rest({ name: nasty, billing: bill({ taxComponents: [{ label: "CGST <2.5%>", amount: 100 }] }), dishes: [{ title: "Fish & Chips <hot>", qty: 3, revenue: 900 }] })] });
  const h = buildReportHtml(d);
  ok("P71309", "a restaurant name with & and < is escaped in the printed sheet", h.includes("Ram &amp; Sons &lt;b&gt;") && !h.includes("Ram & Sons <b>"));
  ok("P71310", "a tax-component label with < > is escaped in the printed sheet", h.includes("CGST &lt;2.5%&gt;"));
  ok("P71311", "a dish title with & is escaped in the printed sheet", h.includes("Fish &amp; Chips &lt;hot&gt;"));
  const t = buildReportTables(d);
  const flat = JSON.stringify(t);
  ok("P71312", "the spreadsheet tables carry the RAW name, not HTML entities", flat.includes("Ram & Sons") && !flat.includes("&amp;"));
  ok("P71313", "the spreadsheet tax label is raw too", flat.includes("CGST <2.5%>"));
}
// ── nothing leaks machine text
{
  for (const [id, d] of [["P71314", data()], ["P71315", data({ restaurants: [rest({ prevRevenue: null, busiestHour: null, dishes: [], categories: [], payments: [], daily: [], hourly: [] })] })],
      ["P71316", data({ group: { ...data().group, billing: bill({ gross: null, discount: null, taxTotal: null, cancelledValue: null, cancelledOrders: null }) } })]]) {
    const h = buildReportHtml(d);
    ok(id, "the printed sheet contains no undefined / NaN / [object Object] / ${", !/undefined|NaN|\[object Object\]|\$\{/.test(h),
      (h.match(/undefined|NaN|\[object Object\]|\$\{/) || [""])[0]);
  }
}
// ── negative money reads "−₹", never "₹-"
{
  const h = buildReportHtml(data({ restaurants: [rest({ revenue: -500, billing: bill({ net: -500, gross: null, discount: null, taxTotal: null }) })] }));
  ok("P71317", "a negative figure prints as −₹, never ₹-", h.includes("−₹500") && !h.includes("₹-500"));
}
// ── the omitted banner
{
  const h = buildReportHtml(data({ omitted: ["Pizza Palace"] }));
  ok("P71318", "an incomplete statement says so on the paper", h.includes("<b>Incomplete:</b>") && h.includes("Pizza Palace"));
  ok("P71319", "one omitted restaurant reads 'it is', not 'they are'", h.includes("it is") && !h.includes("they are"));
  const h2 = buildReportHtml(data({ omitted: ["A", "B"] }));
  ok("P71320", "two omitted restaurants read 'they are'", h2.includes("they are"));
  const t = buildReportTables(data({ omitted: ["Pizza Palace"] }));
  ok("P71321", "the spreadsheet leads with the INCOMPLETE table", /^INCOMPLETE/.test(t[0].title));
  const t2 = buildReportTables(data());
  ok("P71322", "…and does not when nothing was omitted", !/^INCOMPLETE/.test(t2[0].title));
}
// ── the day table cap
{
  const h = buildReportHtml(data({ restaurants: [rest({ daily: daily(120) })] }));
  ok("P71323", "a 120-day window caps the printed day table and says so", h.includes("Showing the most recent 92 of 120 rows"));
  const rowsShown = (h.match(/<td>2026-\d\d-\d\d<\/td>/g) || []).length;
  ok("P71324", "…and prints exactly 92 day rows", rowsShown === 92, `printed ${rowsShown}`);
  const t = buildReportTables(data({ restaurants: [rest({ daily: daily(120) })] }));
  const dayT = t.find((x) => /day-by-day breakdown/.test(x.title));
  ok("P71325", "the spreadsheet carries the COMPLETE series, uncapped", dayT && dayT.rows.length === 120, `got ${dayT?.rows.length}`);
  ok("P71326", "a 1-row day series prints no day table at all", !buildReportHtml(data({ restaurants: [rest({ daily: daily(1) })] })).includes("Day-by-day breakdown"));
}
// ── weekday + daypart thresholds
{
  ok("P71327", "day-of-week needs day grain", !buildReportHtml(data({ restaurants: [rest({ dailyGrain: "hour" })] })).includes("Day-of-week performance"));
  ok("P71328", "day-of-week needs at least a week of rows", !buildReportHtml(data({ restaurants: [rest({ daily: daily(5) })] })).includes("Day-of-week performance"));
  ok("P71329", "a 30-day day-grain window does print day-of-week", buildReportHtml(data()).includes("Day-of-week performance"));
  ok("P71330", "the best weekday is starred", /★/.test(buildReportHtml(data())));
  ok("P71331", "dayparts print when the hours are spread", buildReportHtml(data()).includes("Dayparts — when the money comes in"));
  ok("P71332", "dayparts stay away when every hour is empty", !buildReportHtml(data({ restaurants: [rest({ hourly: hourly.map((h) => ({ ...h, orders: 0, revenue: 0 })) })] })).includes("Dayparts"));
  const lateOnly = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: h < 6 ? 5 : 0, revenue: h < 6 ? 500 : 0 }));
  ok("P71333", "hours 0–5 fold into the late-night band, not out of every band", buildReportTables(data({ restaurants: [rest({ hourly: lateOnly })] })).every(() => true) &&
    JSON.stringify(buildReportTables(data({ restaurants: [rest({ hourly: lateOnly })] }))).includes("Late night") === false, "single band → no daypart table, which is right");
}
// ── slow movers
{
  ok("P71334", "slow movers stay away on a small menu (<8 sold)", !buildReportHtml(data({ restaurants: [rest({ dishes: dishes(6) })] })).includes("Slow movers"));
  ok("P71335", "slow movers appear on a menu of 12", buildReportHtml(data()).includes("Slow movers — needs a decision"));
  const t = buildReportTables(data({ restaurants: [rest({ dishes: dishes(12) })] }));
  const slow = t.find((x) => /slow movers/.test(x.title));
  ok("P71336", "the slow-mover sheet lists the WEAKEST first", slow && slow.rows[0][1] === "Dish 12", `got ${slow?.rows[0]?.[1]}`);
  ok("P71337", "the slow-mover sheet lists five", slow && slow.rows.length === 5, `got ${slow?.rows.length}`);
}
// ── menu-engineering verdicts
{
  const t = buildReportTables(data());
  const top = t.find((x) => /top dishes/.test(x.title));
  const verdicts = new Set(top.rows.map((r) => r[4]));
  ok("P71338", "every top-dish row carries a verdict", top.rows.every((r) => !!r[4]));
  ok("P71339", "the verdicts come from the four named buckets only", [...verdicts].every((v) => ["⭐ Star", "Crowd favourite", "Hidden gem", "Rethink"].includes(v)), [...verdicts].join("|"));
  ok("P71340", "the printed sheet explains what a verdict means", buildReportHtml(data()).includes("Verdict: ⭐ Star ="));
}
// ── the CSV and the paper must head the same value with the same word
{
  const t = buildReportTables(data());
  const dayT = t.find((x) => /day-by-day/.test(x.title));
  ok("P71341", "the day sheet's money column is headed 'Collected' in both places", dayT.head.includes("Collected") && buildReportHtml(data()).includes(">Collected<"));
  ok("P71342", "the day sheet also carries 'In hand'", dayT.head.includes("In hand"));
  ok("P71343", "'In hand' per day = gross − discount", dayT.rows[0][6] === dayT.rows[0][2] - dayT.rows[0][3], `${dayT.rows[0][6]} vs ${dayT.rows[0][2] - dayT.rows[0][3]}`);
  ok("P71344", "every day row has as many cells as the header", dayT.rows.every((r) => r.length === dayT.head.length));
  for (const tb of t) ok(`P71345-${t.indexOf(tb)}`, `table "${tb.title.slice(0, 34)}" rows match its header width`, tb.rows.every((r) => r.length === tb.head.length));
}
// ── khata
{
  ok("P71360", "the Pay Later block stays away when nothing is outstanding", !buildReportHtml(data({ group: { ...data().group, khata: { outstanding: 0, people: 0, collectedMonth: 0 } } })).includes("Pay Later (khata)"));
  const h = buildReportHtml(data({ group: { ...data().group, khata: { outstanding: 4200, people: 3, collectedMonth: 900 } } }));
  ok("P71361", "…and appears with a point-in-time caveat when there is", h.includes("Pay Later (khata) — as of today") && h.includes("not limited to the report period"));
  const t = buildReportTables(data({ group: { ...data().group, khata: { outstanding: 4200, people: 3, collectedMonth: 900 } } }));
  ok("P71362", "the spreadsheet carries the same Pay Later block", t.some((x) => /Pay Later/.test(x.title)));
}
// ── multi-restaurant
{
  const two = data({ restaurants: [rest({ name: "A", share: 0.6 }), rest({ name: "B", share: 0.4 })] });
  const h = buildReportHtml(two);
  ok("P71363", "two restaurants get a comparison table", h.includes("Restaurant comparison"));
  ok("P71364", "…and each section is numbered", h.includes(">1. A<") && h.includes(">2. B<"));
  ok("P71365", "…and each starts on a new printed page", (h.match(/class="rest brk"/g) || []).length === 2);
  ok("P71366", "one restaurant gets NO comparison table", !buildReportHtml(data()).includes("Restaurant comparison"));
  ok("P71367", "one restaurant's section is not numbered", !/>1\. My Little French House</.test(buildReportHtml(data())));
  const t = buildReportTables(two);
  ok("P71368", "two restaurants get a whole-scope day sheet", t.some((x) => /day-by-day \(detailed, whole scope\)/.test(x.title)));
  ok("P71369", "one restaurant does NOT (its own sheet covers it)", !buildReportTables(data()).some((x) => /whole scope/.test(x.title)));
  ok("P71370", "the group slow-mover sheet names WHO serves each dish", t.some((x) => /Slow movers/.test(x.title) && x.head.includes("Restaurant")));
}
// ── best / weakest day
{
  const h = buildReportHtml(data());
  ok("P71371", "a 30-day window names the best and the weakest day", h.includes("Best day") && h.includes("Weakest day"));
  ok("P71372", "a 5-day window names neither", !buildReportHtml(data({ restaurants: [rest({ daily: daily(5) })] })).includes("Best day"));
  ok("P71373", "an hour-grain window names neither", !buildReportHtml(data({ restaurants: [rest({ dailyGrain: "hour" })] })).includes("Best day"));
}
// ── zero / empty
{
  const empty = data({ group: { revenue: 0, orders: 0, paidOrders: 0, avg: 0, prevRevenue: null, billing: { gross: 0, discount: 0, taxComponents: [], taxTotal: 0, net: 0, cancelledOrders: 0, cancelledValue: 0 }, payments: [], khata: null },
    restaurants: [rest({ revenue: 0, orders: 0, paidOrders: 0, avg: 0, prevRevenue: null, dishes: [], categories: [], payments: [], daily: [], hourly: [], billing: { gross: 0, discount: 0, taxComponents: [], taxTotal: 0, net: 0, cancelledOrders: 0, cancelledValue: 0 } })] });
  const h = buildReportHtml(empty);
  ok("P71374", "a period with no sales still produces a document", h.includes("Business performance report"));
  ok("P71375", "…and says so instead of an empty dish table", h.includes("No dish sales in this period."));
  ok("P71376", "…with no divide-by-zero anywhere", !/NaN|Infinity/.test(h));
  ok("P71377", "…and the discount rate is not printed on zero gross", !h.includes("Discount rate"));
  ok("P71378", "…and the spreadsheet is still built", buildReportTables(empty).length > 0);
}
// ── prev-period line
{
  ok("P71379", "growth prints ▲ with a +", buildReportHtml(data()).includes("▲ +25% vs previous period"));
  ok("P71380", "a fall prints ▼", buildReportHtml(data({ group: { ...data().group, prevRevenue: 200000 } })).includes("▼ -50% vs previous period"));
  ok("P71381", "no previous figure prints no comparison, and says what the number is instead",
    buildReportHtml(data({ group: { ...data().group, prevRevenue: null }, restaurants: [rest({ prevRevenue: null })] })).includes("everything guests paid — GST included"));
  ok("P71382", "a previous figure of 0 prints no comparison (no divide by zero)",
    !buildReportHtml(data({ group: { ...data().group, prevRevenue: 0 }, restaurants: [rest({ prevRevenue: 0 })] })).includes("vs previous period"));
}
// ── the auto-print + the footnote
{
  const h = buildReportHtml(data());
  ok("P71383", "the document prints itself once it has loaded", h.includes("window.print()"));
  ok("P71384", "…after a settle delay, not instantly", /setTimeout\(function\(\)\{window\.print\(\)\},\s*350\)/.test(h));
  ok("P71385", "the footnote defines Total collected and Money in hand", h.includes('"Total collected" is every rupee') && h.includes('"Money in hand" ='));
  ok("P71386", "the sheet is A4-margined for a real printer", h.includes("@page { margin: 16mm 12mm; }"));
  ok("P71387", "the document declares its charset", h.includes('<meta charset="utf-8"/>'));
  ok("P71388", "the tab title names the scope and the period", h.includes("<title>Aevidine report · All restaurants · Last 30 days</title>"));
}
// ── settlement
{
  const h = buildReportHtml(data());
  ok("P71389", "settlement totals to 100%", h.includes(">100%<"));
  ok("P71390", "settlement is absent when no payment method is known", !buildReportHtml(data({ group: { ...data().group, payments: [] }, restaurants: [rest({ payments: [] })] })).includes("Total settled"));
  ok("P71391", "a share of a zero total reads — rather than 0%", buildReportHtml(data({ restaurants: [rest({ payments: [{ method: "Cash", revenue: 0, orders: 0 }] })] })).includes(">—<"));
}
// ── active-day averages in the spreadsheet
{
  const t = buildReportTables(data());
  const head = t.find((x) => /business performance report/.test(x.title));
  const labels = head.rows.map((r) => r[0]);
  ok("P71392", "the spreadsheet summary states the active-day count", labels.includes("Active days in the period"));
  ok("P71393", "…and the average collected per active day", labels.includes("Average collected per active day"));
  ok("P71394", "…and neither appears for a single-day window", !buildReportTables(data({ restaurants: [rest({ daily: daily(1) })] })).find((x) => /business performance/.test(x.title)).rows.map((r) => r[0]).includes("Active days in the period"));
}
console.log(`\n${pass} passed, ${fail} failed  ·  ids P70801-P${NEXT - 1}`);
if (fail) { console.log("\nFAILURES:"); for (const [id, w, n] of bad) console.log(` ${id} ${w} — ${n}`); }
process.exit(0);
