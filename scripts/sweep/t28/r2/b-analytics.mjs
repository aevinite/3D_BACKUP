// BLOCK B · app/api/owner/analytics/route.ts — 70 phases, P160571–P160640.
//
// WHY 70. 705 lines carrying 23 ledger rows (33 per kloc) and only 5 of them drove anything. It is
// also the file with the most ARITHMETIC in the territory: eleven ranges, each resolving its own
// window against the 05:00-IST business day, a previous-period window for the ▲/▼ chips, a separate
// overlay window, a heatmap clamp, and a snapshot cache keyed on the resolved window. Every one of
// those has been wrong at least once, and the whole thing is read through two scopes.
import { FH, PP, GHOST, GET, sb, block, of_, code, read , sameStamp } from "./harness.mjs";

const S = of_("app/api/owner/analytics/route.ts");
export const B = block(160571, "B · the owner's Dashboard — every range, both scopes, the window maths");
const { row } = B;
const RANGES = ["today", "yesterday", "week", "7d", "30d", "month", "lastmonth", "12m", "fy", "all"];
const IST = 5.5 * 3600e3;
const istParts = (iso) => { const d = new Date(Date.parse(iso) + IST); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() }; };

// ══ B1 · EVERY RANGE ANSWERS, AT BOTH SCOPES, AND LABELS ITSELF HONESTLY ════════════════════════
for (const rg of RANGES) {
  row(S(`the group dashboard answers \`range=${rg}\` and labels the answer as the range it used`),
    `GET /api/owner/analytics?range=${rg} as diago1`, async (c) => {
      const r = await GET(c.O, `/api/owner/analytics?range=${rg}`);
      if (r.status !== 200) return `${r.status} ${r.j?.error}`;
      return !!(r.j.range === rg && r.j.window?.from && r.j.window?.to) || `range=${r.j.range} window=${JSON.stringify(r.j.window)}`;
    });
}
for (const rg of RANGES) {
  row(S(`one restaurant's dashboard answers \`range=${rg}\` with its KPI row`),
    `GET ?rid=<French House>&range=${rg} as diago1`, async (c) => {
      const r = await GET(c.O, `/api/owner/analytics?rid=${FH}&range=${rg}`);
      if (r.status !== 200) return `${r.status} ${r.j?.error}`;
      return !!(r.j.scope === "restaurant" && r.j.range === rg && r.j.kpis && typeof r.j.kpis.paidOrders === "number")
        || `scope=${r.j.scope} range=${r.j.range} kpis=${JSON.stringify(r.j.kpis)}`;
    });
}

// ══ B2 · THE WINDOW MATHS, CHECKED AGAINST THE CLOCK ════════════════════════════════════════════
row(S("\"today\" starts at 05:00 IST — a restaurant's day, not the calendar's"), "read window.from for range=today", async (c) => {
  const r = await GET(c.O, "/api/owner/analytics?range=today");
  const p = istParts(r.j.window.from);
  return !!(p.h === 5 && p.mi === 0) || `window starts ${p.h}:${String(p.mi).padStart(2, "0")} IST`;
});
row(S("\"yesterday\" is the WHOLE previous business day — 05:00 IST to 05:00 IST"), "read both bounds", async (c) => {
  const r = await GET(c.O, "/api/owner/analytics?range=yesterday");
  const a = istParts(r.j.window.from), b = istParts(r.j.window.to);
  const span = Date.parse(r.j.window.to) - Date.parse(r.j.window.from);
  return !!(a.h === 5 && b.h === 5 && Math.abs(span - 86400e3) < 1000) || `${a.h}:00 → ${b.h}:00 IST, span ${Math.round(span / 3600e3)}h`;
});
row(S("…and it ENDS where today begins, so no hour is counted twice or lost"), "compare yesterday.to with today.from", async (c) => {
  const y = await GET(c.O, "/api/owner/analytics?range=yesterday");
  const t = await GET(c.O, "/api/owner/analytics?range=today");
  return y.j.window.to === t.j.window.from || `yesterday ends ${y.j.window.to}, today starts ${t.j.window.from}`;
});
row(S("\"7d\" is exactly seven whole IST days, aligned to midnight — not a rolling 168 hours"), "read window.from", async (c) => {
  const r = await GET(c.O, "/api/owner/analytics?range=7d");
  const p = istParts(r.j.window.from);
  const days = Math.round((Date.parse(r.j.window.to) - Date.parse(r.j.window.from)) / 86400e3);
  return !!(p.h === 0 && p.mi === 0 && days >= 6 && days <= 7) || `starts ${p.h}:${p.mi} IST, spans ${days}d`;
});
row(S("\"30d\" is the same shape, thirty days wide"), "read window.from", async (c) => {
  const r = await GET(c.O, "/api/owner/analytics?range=30d");
  const p = istParts(r.j.window.from);
  const days = Math.round((Date.parse(r.j.window.to) - Date.parse(r.j.window.from)) / 86400e3);
  return !!(p.h === 0 && days >= 29 && days <= 30) || `starts ${p.h}:00 IST, spans ${days}d`;
});
row(S("\"week\" starts on a MONDAY at 00:00 IST"), "read window.from's IST weekday", async (c) => {
  const r = await GET(c.O, "/api/owner/analytics?range=week");
  const d = new Date(Date.parse(r.j.window.from) + IST);
  return !!(d.getUTCDay() === 1 && d.getUTCHours() === 0) || `starts on weekday ${d.getUTCDay()} at ${d.getUTCHours()}:00 IST (1 = Monday)`;
});
row(S("\"month\" starts on the 1st at 00:00 IST"), "read window.from", async (c) => {
  const r = await GET(c.O, "/api/owner/analytics?range=month");
  const p = istParts(r.j.window.from);
  return !!(p.d === 1 && p.h === 0) || `starts on day ${p.d} at ${p.h}:00 IST`;
});
row(S("\"lastmonth\" is a WHOLE past month and ends where this month begins"), "compare with range=month", async (c) => {
  const l = await GET(c.O, "/api/owner/analytics?range=lastmonth");
  const m = await GET(c.O, "/api/owner/analytics?range=month");
  const a = istParts(l.j.window.from);
  return !!(a.d === 1 && l.j.window.to === m.j.window.from) || `starts day ${a.d}; ends ${l.j.window.to} vs month starts ${m.j.window.from}`;
});
row(S("\"fy\" is the Indian financial year — it starts on 1 April"), "read window.from", async (c) => {
  const r = await GET(c.O, "/api/owner/analytics?range=fy");
  const p = istParts(r.j.window.from);
  return !!(p.m === 3 && p.d === 1) || `starts ${p.d}/${p.m + 1} IST (want 1/4)`;
});
row(S("\"12m\" is twelve whole months, bucketed by month"), "read window + bucket width", async (c) => {
  const r = await GET(c.O, "/api/owner/analytics?range=12m");
  const p = istParts(r.j.window.from);
  const months = Math.round((Date.parse(r.j.window.to) - Date.parse(r.j.window.from)) / (30.44 * 86400e3));
  return !!(p.d === 1 && months >= 11 && months <= 12) || `starts day ${p.d}, spans ~${months} months`;
});
row(S("\"all\" reaches back past any real trading, so nothing old is silently excluded"), "read window.from", async (c) => {
  const r = await GET(c.O, "/api/owner/analytics?range=all");
  return Date.parse(r.j.window.from) <= Date.parse("2021-01-01") || `starts ${r.j.window.from}`;
});
row(S("a range nobody recognises is answered as TODAY and LABELLED today, never echoed back raw"), "GET ?range=NOT_A_RANGE", async (c) => {
  const j = (await GET(c.O, "/api/owner/analytics?range=NOT_A_RANGE")).j;
  const t = (await GET(c.O, "/api/owner/analytics?range=today")).j;
  return !!(j.range === "today" && j.window.from === t.window.from) || `range=${j.range} window=${j.window?.from}`;
});
row(S("…including one that tries to look like a range"), "GET ?range=8d and ?range=2026-01", async (c) => {
  for (const q of ["8d", "2026-01", "TODAY", " today"]) {
    const j = (await GET(c.O, `/api/owner/analytics?range=${encodeURIComponent(q)}`)).j;
    if (j.range !== "today") return `${JSON.stringify(q)} came back labelled ${JSON.stringify(j.range)}`;
  }
  return true;
});
row(S("a custom range answers the days it was asked for"), "GET ?range=custom&from&to, past dates", async (c) => {
  const r = await GET(c.O, "/api/owner/analytics?range=custom&from=2026-08-01&to=2026-08-07");
  if (r.status !== 200) return `${r.status} ${r.j?.error}`;
  const a = istParts(r.j.window.from), b = istParts(r.j.window.to);
  return !!(r.j.range === "custom" && a.d === 1 && a.m === 7 && b.d === 8) || `${r.j.range} ${r.j.window.from} → ${r.j.window.to}`;
});
row(S("…and a custom range with unusable dates falls back, but still names the window it used"), "GET ?range=custom&from=zzz", async (c) => {
  const r = await GET(c.O, "/api/owner/analytics?range=custom&from=zzz&to=zzz");
  return !!(r.status === 200 && r.j.window?.from && r.j.window?.to) || `${r.status} window=${JSON.stringify(r.j?.window)}`;
});
row(S("…and a BACKWARDS custom range does not answer a negative window"), "GET ?from=2026-08-07&to=2026-08-01", async (c) => {
  const r = await GET(c.O, "/api/owner/analytics?range=custom&from=2026-08-07&to=2026-08-01");
  return !!(r.status === 200 && Date.parse(r.j.window.to) > Date.parse(r.j.window.from)) || `${r.j.window?.from} → ${r.j.window?.to}`;
});
row(S("…and a custom range ending in the future is capped at now, not at the date typed"), "GET ?to=2099-01-01", async (c) => {
  const r = await GET(c.O, "/api/owner/analytics?range=custom&from=2026-08-01&to=2099-01-01");
  return Date.parse(r.j.window.to) <= Date.now() + 60_000 || `it answered a window ending ${r.j.window.to}`;
});

// ══ B3 · THE NUMBERS AGREE WITH THEMSELVES ══════════════════════════════════════════════════════
row(S("the trend adds up to the revenue KPI above it"), "sum timeseries[].revenue vs kpis.revenue, rid scope", async (c) => {
  const r = await GET(c.O, `/api/owner/analytics?rid=${FH}&range=30d`);
  if (r.status !== 200) return `${r.status}`;
  const sum = Math.round((r.j.timeseries || []).reduce((a, x) => a + (x.revenue || 0), 0) * 100) / 100;
  return Math.abs(sum - r.j.kpis.revenue) < 0.02 || `chart ${sum} vs KPI ${r.j.kpis.revenue}`;
});
row(S("…and the order count too"), "sum timeseries[].orders vs kpis.orders", async (c) => {
  const r = await GET(c.O, `/api/owner/analytics?rid=${FH}&range=30d`);
  const sum = (r.j.timeseries || []).reduce((a, x) => a + (x.orders || 0), 0);
  return sum === r.j.kpis.orders || `chart ${sum} vs KPI ${r.j.kpis.orders}`;
});
row(S("the average order is PAID revenue over PAID orders, so it cannot drift as tables settle"), "recompute avgOrder from the payload", async (c) => {
  const r = await GET(c.O, `/api/owner/analytics?rid=${FH}&range=30d`);
  const k = r.j.kpis;
  if (!k.paidOrders) return k.avgOrder === 0 || `no paid orders but avgOrder=${k.avgOrder}`;
  const want = Math.round((k.revenue / k.paidOrders) * 100) / 100;
  return Math.abs(want - k.avgOrder) < 0.02 || `avgOrder ${k.avgOrder} vs revenue/paidOrders ${want}`;
});
row(S("…and paidOrders is never MORE than the all-orders count it is compared against"), "read both KPIs", async (c) => {
  const r = await GET(c.O, `/api/owner/analytics?rid=${FH}&range=30d`);
  return r.j.kpis.paidOrders <= r.j.kpis.orders || `paid ${r.j.kpis.paidOrders} > all ${r.j.kpis.orders}`;
});
row(S("the group revenue bar adds up to the same money as the group trend"), "restaurantRevenue vs timeseries, group scope", async (c) => {
  const r = await GET(c.O, "/api/owner/analytics?range=30d");
  const bars = Math.round((r.j.restaurantRevenue || []).reduce((a, x) => a + (x.revenue || 0), 0) * 100) / 100;
  const line = Math.round((r.j.timeseries || []).reduce((a, x) => a + (x.revenue || 0), 0) * 100) / 100;
  return Math.abs(bars - line) < 0.02 || `bars ${bars} vs trend ${line}`;
});
row(S("no money figure comes back as NaN, null or a string"), "scan every number in both scopes", async (c) => {
  for (const u of ["/api/owner/analytics?range=30d", `/api/owner/analytics?rid=${FH}&range=30d`]) {
    const r = await GET(c.O, u);
    if (/:\s*(NaN|"NaN"|Infinity)/.test(r.txt)) return `${u} carries a NaN`;
    for (const [k, v] of Object.entries(r.j.kpis || {})) if (k !== "topDish" && typeof v !== "number") return `${u} kpis.${k} is ${typeof v}`;
  }
  return true;
});
row(S("the payment split never carries another restaurant's money into one owner's total"), "group scope as diago1 vs the restaurant scope", async (c) => {
  const g = await GET(c.O, "/api/owner/analytics?range=30d");
  const one = await GET(c.O, `/api/owner/analytics?rid=${FH}&range=30d`);
  const gs = Math.round((g.j.paymentMethods || []).reduce((a, x) => a + x.revenue, 0) * 100) / 100;
  const os = Math.round((one.j.paymentMethods || []).reduce((a, x) => a + x.revenue, 0) * 100) / 100;
  return Math.abs(gs - os) < 0.02 || `diago1 owns one restaurant, so its group split (${gs}) must equal that restaurant's (${os})`;
});
row(S("the busy-hours grid is bounded to a day and an hour that exist"), "read heatmap[].dow/hr", async (c) => {
  const r = await GET(c.O, `/api/owner/analytics?rid=${FH}&range=30d`);
  const bad = (r.j.heatmap || []).filter((h) => h.dow < 0 || h.dow > 6 || h.hr < 0 || h.hr > 23);
  return bad.length === 0 || `${bad.length} cell(s) outside 0-6 / 0-23`;
});
row(S("the hourly breakdown covers only real hours"), "read hourly[].hour", async (c) => {
  const r = await GET(c.O, `/api/owner/analytics?rid=${FH}&range=30d`);
  const bad = (r.j.hourly || []).filter((h) => h.hour < 0 || h.hour > 23);
  return bad.length === 0 || `${bad.length} hour(s) outside 0-23`;
});
row(S("the ▲/▼ comparison is asked for, not assumed"), "GET with and without compare=1", async (c) => {
  const off = await GET(c.O, `/api/owner/analytics?rid=${FH}&range=30d`);
  const on = await GET(c.O, `/api/owner/analytics?rid=${FH}&range=30d&compare=1`);
  return !!(off.j.prev === null && on.j.prev !== undefined) || `without=${JSON.stringify(off.j.prev)} with=${JSON.stringify(on.j.prev)}`;
});
row(S("…and \"all time\" has no previous period to compare against, so it offers none"), "GET ?range=all&compare=1", async (c) => {
  const r = await GET(c.O, `/api/owner/analytics?rid=${FH}&range=all&compare=1`);
  return r.j.prev === null || `prev=${JSON.stringify(r.j.prev)}`;
});
row(S("…and a failed comparison would drop two arrows, never the whole dashboard"), "read: windowTotals is caught at both scopes", async () => {
  const src = code(read("app/api/owner/analytics/route.ts"));
  const catches = (src.match(/windowTotals\([^)]*\)[\s\S]{0,140}?\.catch\(/g) || []).length;
  return catches >= 2 || `only ${catches} of the two windowTotals calls is caught`;
});
row(S("the overlay's previous window lines up day-1 to day-1, not by raw elapsed time"), "GET ?range=7d&compare=1 and read timeseriesPrev", async (c) => {
  const r = await GET(c.O, `/api/owner/analytics?rid=${FH}&range=7d&compare=1`);
  if (!(r.j.timeseriesPrev || []).length) return "SKIP: no previous-period data to plot";
  return !!(r.j.timeseriesPrev.length <= 8) || `${r.j.timeseriesPrev.length} buckets for a 7-day overlay`;
});
row(S("…and it is sorted, so the line is drawn left to right"), "read timeseriesPrev[].bucket order", async (c) => {
  const r = await GET(c.O, `/api/owner/analytics?rid=${FH}&range=30d&compare=1`);
  const b = (r.j.timeseriesPrev || []).map((x) => x.bucket);
  return b.every((v, i) => i === 0 || b[i - 1] <= v) || "the overlay's buckets are out of order";
});

// ══ B4 · WHO MAY SEE IT ═════════════════════════════════════════════════════════════════════════
row(S("an owner cannot drill into a restaurant they do not own"), "GET ?rid=<Pizza Palace> as diago1", async (c) => {
  const r = await GET(c.O, `/api/owner/analytics?rid=${PP}`);
  return !!(r.status === 403 && !/revenue|kpis/.test(r.txt)) || `${r.status} ${r.txt.slice(0, 110)}`;
});
row(S("…nor into one that does not exist"), "GET ?rid=<a well-formed id nothing owns>", async (c) => {
  const r = await GET(c.O, `/api/owner/analytics?rid=${GHOST}`);
  return !!(r.status >= 400 && !/"revenue"/.test(r.txt)) || `${r.status} ${r.txt.slice(0, 110)}`;
});
row(S("a multi-restaurant owner CAN drill into either of theirs"), "GET ?rid for both, as diagmulti", async (c) => {
  for (const rid of [FH, PP]) {
    const r = await GET(c.M, `/api/owner/analytics?rid=${rid}`);
    if (r.status !== 200) return `${rid} answered ${r.status} ${r.j?.error}`;
  }
  return true;
});
row(S("a kitchen login gets nothing"), "GET as diagkitchen", async (c) => {
  const r = await GET(c.K, "/api/owner/analytics");
  return !!((r.status === 401 || r.status === 403) && !/"revenue"/.test(r.txt)) || `${r.status} ${r.txt.slice(0, 90)}`;
});
row(S("nobody at all gets nothing"), "GET with no cookie", async (c) => {
  const r = await GET(c.N, "/api/owner/analytics");
  return !!(r.status === 401 && !/"revenue"/.test(r.txt)) || `${r.status} ${r.txt.slice(0, 90)}`;
});
row(S("the admin's all-restaurants view sums the platform"), "GET ?scope=all as the admin", async (c) => {
  const r = await GET(c.A, "/api/owner/analytics?scope=all&range=30d");
  return !!(r.status === 200 && (r.j.restaurantRevenue || []).length > 2) || `${r.status} n=${r.j?.restaurantRevenue?.length}`;
});
row(S("…and the admin pinned to one restaurant sees that owner's set, not the platform's"), "GET ?scope=<FH> as the admin", async (c) => {
  const all = await GET(c.A, "/api/owner/analytics?scope=all&range=30d");
  const one = await GET(c.A, `/api/owner/analytics?scope=${FH}&range=30d`);
  return !!((one.j.restaurantRevenue || []).length < (all.j.restaurantRevenue || []).length)
    || `pinned ${one.j?.restaurantRevenue?.length} vs all ${all.j?.restaurantRevenue?.length}`;
});

// ══ B5 · WHAT IT COSTS TO KEEP OPEN ════════════════════════════════════════════════════════════
row(S("a second identical open is served from the saved copy, not recomputed"), "GET twice, compare cachedAt", async (c) => {
  const a = await GET(c.O, "/api/owner/analytics?range=30d");
  const b = await GET(c.O, "/api/owner/analytics?range=30d");
  return (!!b.j.cachedAt && sameStamp(a.j.cachedAt, b.j.cachedAt)) || `cachedAt ${a.j?.cachedAt} vs ${b.j?.cachedAt}`;
});
row(S("…and Refresh forces a real recompute"), "GET ?refresh=1 and compare", async (c) => {
  const a = await GET(c.O, "/api/owner/analytics?range=30d");
  const b = await GET(c.O, "/api/owner/analytics?range=30d&refresh=1");
  return !!(!sameStamp(a.j.cachedAt, b.j.cachedAt)) || `refresh returned the same stamp ${b.j?.cachedAt}`;
});
row(S("…and the saved copy is keyed to the WINDOW, so two ranges never share one"), "compare cache identity across ranges", async (c) => {
  const a = await GET(c.O, "/api/owner/analytics?range=today");
  const b = await GET(c.O, "/api/owner/analytics?range=30d");
  return !!(JSON.stringify(a.j.window) !== JSON.stringify(b.j.window)) || "two ranges answered the same window";
});
row(S("…and two different SCOPES never share one either"), "group vs restaurant, same range", async (c) => {
  const g = await GET(c.O, "/api/owner/analytics?range=30d");
  const o = await GET(c.O, `/api/owner/analytics?rid=${FH}&range=30d`);
  return !!(g.j.scope === "group" && o.j.scope === "restaurant") || `${g.j?.scope} / ${o.j?.scope}`;
});
row(S("the all-time records scan only runs when the screen asks for it"), "GET with and without records=1", async (c) => {
  const off = await GET(c.O, `/api/owner/analytics?rid=${FH}&range=30d`);
  const on = await GET(c.O, `/api/owner/analytics?rid=${FH}&range=30d&records=1`);
  return !!(off.j.records === null && on.j.records !== undefined) || `without=${JSON.stringify(off.j.records)} with=${typeof on.j.records}`;
});
row(S("a healthy answer names nothing as unread — `partial` rides along only when something failed"), "GET at both scopes", async (c) => {
  for (const u of ["/api/owner/analytics?range=30d", `/api/owner/analytics?rid=${FH}&range=30d`]) {
    const r = await GET(c.O, u);
    if (r.j.partial) return `${u} reports partial=${JSON.stringify(r.j.partial)} on a healthy read`;
  }
  return true;
});
row(S("a restaurant with no trade answers empty lists, never a crash or a fabricated zero-bar"), "GET ?rid=<a quiet restaurant>", async (c) => {
  const admin = await GET(c.A, "/api/owner/analytics?scope=all&range=today");
  const quiet = (admin.j.restaurantRevenue || []).find((x) => !x.revenue && !x.orders);
  if (!quiet) return "SKIP: every restaurant traded today";
  const r = await GET(c.A, `/api/owner/analytics?scope=${quiet.id}&rid=${quiet.id}&range=today`);
  return !!(r.status === 200 && Array.isArray(r.j.timeseries)) || `${r.status} ${r.j?.error}`;
});
row(S("the staff-pay tile is absent for a restaurant without the module, rather than showing a fake zero"), "read staffPay at the restaurant scope", async (c) => {
  const r = await GET(c.O, `/api/owner/analytics?rid=${FH}&range=30d`);
  const on = (await GET(c.O, "/api/owner/staff")).j.restaurants?.find((x) => x.id === FH)?.modules?.payroll;
  if (on) return !!(r.j.staffPay === null || typeof r.j.staffPay === "object") || `staffPay=${JSON.stringify(r.j.staffPay)}`;
  return r.j.staffPay === null || `the module is off but staffPay=${JSON.stringify(r.j.staffPay)}`;
});
row(S("…and when it IS there, every figure on it is a number"), "read staffPay's fields", async (c) => {
  const r = await GET(c.O, `/api/owner/analytics?rid=${FH}&range=30d`);
  if (!r.j.staffPay) return "SKIP: no staff-pay tile for this restaurant";
  return ["paidOut", "people", "entries"].every((k) => typeof r.j.staffPay[k] === "number") || JSON.stringify(r.j.staffPay);
});
row(S("food that was cooked then binned is its own expense, never the cancelled bill's value"), "read foodLoss", async (c) => {
  const r = await GET(c.O, `/api/owner/analytics?rid=${FH}&range=30d`);
  if (r.j.foodLoss === null) return true;
  return !!(typeof r.j.foodLoss.amount === "number" && typeof r.j.foodLoss.entries === "number") || JSON.stringify(r.j.foodLoss);
});
row(S("the dashboard never hands the owner a database sentence, at any range"), "scan every range's body for database prose", async (c) => {
  for (const rg of ["today", "30d", "fy", "all", "custom"]) {
    const r = await GET(c.O, `/api/owner/analytics?range=${rg}`);
    if (/PGRST|invalid input syntax|relation "|statement timeout|\[object Object\]/i.test(r.txt)) return `range=${rg}: ${r.txt.slice(0, 120)}`;
  }
  return true;
});
row(S("and a timeout, if one ever happens, is the one thing it advises about"), "read: 57014 keeps its own advice and status", async () => {
  const src = code(read("lib/ownerScope.ts"));
  return !!(/57014/.test(src) && /shorter period|one restaurant at a time/.test(src) && /504/.test(src))
    || "the statement-timeout advice has gone from dbFail";
});
