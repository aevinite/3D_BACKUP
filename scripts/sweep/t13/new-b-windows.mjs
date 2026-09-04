// scripts/sweep/t13/new-b-windows.mjs — NEW block, ids P66801–P66980.
//
// Band B: the analytics route's WINDOW MATHS, driven against the live route rather than read.
//
// WHY DRIVEN. `windowFor()`, `prevWindowFor()`, `prevTsWindowFor()`, `heatFrom()` and `rangeKey`
// decide what period every figure on the dashboard covers. The measurement that planned this
// block found 38 named things in this route that no ledger row anywhere mentions, and all five of
// those helpers are among them — three sweeps read the dashboard's JSX in detail and never once
// asked the route what window it actually resolved. It will TELL us: since v6 the payload carries
// `window: { from, to }`, so every boundary below is checked against the route's own answer, in
// IST, for all eleven range values plus the ones it must refuse.
//
// ONE login for the whole run, and every request is a plain GET the dashboard itself makes.
import { chk, skip, code, report, setOnly, writeLedger, count, executedIds } from "./lib.mjs";
import { loginAs } from "../login.mjs";
import { chromium } from "playwright";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg("base", "http://localhost:4313").replace(/\/$/, "");
const argOnly = process.argv.find((x) => x.startsWith("--only="));
if (argOnly) setOnly(argOnly.slice(7).split(","));
const a = code("app/api/owner/analytics/route.ts");

const browser = await chromium.launch();
const ctx = await browser.newContext();
await loginAs(ctx, "owner", BASE);
const RID = "00000000-0000-0000-0000-000000000001";

const cache = new Map();
/** GET the analytics route as the signed-in owner and return its JSON. */
async function get(qs) {
  if (cache.has(qs)) return cache.get(qs);
  const askedAt = Date.now();
  const r = await ctx.request.get(`${BASE}/api/owner/analytics?${qs}`, { timeout: 120000 });
  let j;
  try { j = await r.json(); } catch { j = { __status: r.status(), __text: (await r.text()).slice(0, 200) }; }
  j.__status = r.status();
  j.__askedAt = askedAt;      // "to = now" means now AT THE REQUEST, not when the check runs
  cache.set(qs, j);
  return j;
}
// IST helpers for asserting boundaries — the route works in IST and so must the check.
const IST_MS = 5.5 * 3600_000;
const istParts = (iso) => {
  const d = new Date(Date.parse(iso) + IST_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
};
const istDay = (iso) => { const p = istParts(iso); return `${p.y}-${String(p.m + 1).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`; };
const spanDays = (w) => (Date.parse(w.to) - Date.parse(w.from)) / 86400000;
const now = Date.now();

// ── every range answers, and answers with the window it used ─────────────────────────────────
const RANGES = ["today", "yesterday", "week", "7d", "30d", "month", "lastmonth", "12m", "fy", "all"];
const payloads = {};
for (const r of RANGES) payloads[r] = await get(`range=${r}&rid=${RID}&compare=1`);

// ── THE IDS IN THIS BAND ARE POSITIONAL, SO THE COUNT IS LOCKED ───────────────────────────────
// `nextId()` hands out P66801 onwards in execution order. That is fine for a band that is run,
// never edited — and dangerous the moment a row is INSERTED in the middle, because every id after
// it silently shifts and the ledger's promise ("an id means one specific check, forever") breaks.
// I found this the honest way: a sabotage pass asserted ids I had written down before adding two
// rows mid-band, and ten of eighteen cases looked like a guard staying green when in fact the
// guard fired on a different number.
// So the count is declared. Insert a row and this refuses to run, which forces a decision:
// either append at the END (ids stay put), or renumber deliberately and update the ledger.
//
// IT ALREADY EARNED ITS KEEP. Adding two staleness rows mid-band pushed this band's last id from
// P66932 to P66933 — which is band C's FIRST id, a real collision I had just created and could not
// see. The lock refused to run, and the two rows moved to P67295/P67296 in the unused tail
// instead, so every id written down before that edit still means the same check.
const results_count = () => executedIds().length;
const EXPECT_ROWS = 133;   // 131 from the counter (P66801-P66932) + P67295 and P67296
let id = 66801;
const nextId = () => `P${id++}`;

for (const r of RANGES) {
  const p = payloads[r];
  await chk(nextId(), `range=${r} answers 200 and reports the window it resolved`, () => {
    if (p.__status !== 200) return `status ${p.__status}: ${JSON.stringify(p.error || p.__text).slice(0, 120)}`;
    return p.window && p.window.from && p.window.to ? true : `no window in the payload: ${Object.keys(p).join(",")}`;
  });
  await chk(nextId(), `range=${r} echoes the range back as itself, never a raw or unknown label`, () =>
    p.range === r ? true : `asked for ${r}, told "${p.range}"`);
  await chk(nextId(), `range=${r} resolves a window whose start is before its end`, () =>
    Date.parse(p.window.from) < Date.parse(p.window.to) ? true : `from ${p.window.from} to ${p.window.to}`);
  await chk(nextId(), `range=${r} never resolves a window that ends in the future`, () =>
    Date.parse(p.window.to) <= now + 120000 ? true : `to = ${p.window.to}, now = ${new Date(now).toISOString()}`);
}

// ── the exact boundaries each range promises ─────────────────────────────────────────────────
await chk(nextId(), "today starts at 05:00 IST — the business day, not midnight", () => {
  const p = istParts(payloads.today.window.from);
  return p.h === 5 && p.mi === 0 ? true : `today starts at ${p.h}:${String(p.mi).padStart(2, "0")} IST`;
});
await chk("P67295", "…and its window never ends in the future; a freshly computed one ends at now", () => {
  // THE CONTRACT, read rather than assumed (lib/ownerCache). A stored snapshot is served
  // stale-while-revalidate: `if (existing?.payload)` returns it IMMEDIATELY and refreshes behind
  // the response, with no upper bound on how old the served copy may be. So "ends at now" is only
  // true of a FRESH compute, and the payload says which it is — `cached: true` when it came from
  // the store.
  // Two earlier versions of this row got this wrong and went red on a correctly working cache:
  // first by comparing against Date.now() at assert time (measuring its own nine-minute run), then
  // by allowing 15 minutes of staleness against a cache that is allowed more.
  // What must ALWAYS hold is that the window does not end in the future.
  const p = payloads.today;
  const to = Date.parse(p.window.to);
  if (to > p.__askedAt + 5000) return `today's window ends ${Math.round((to - p.__askedAt) / 1000)}s in the FUTURE`;
  if (p.cached) return true;                       // a stored snapshot may legitimately be older
  const age = p.__askedAt - to;
  return age <= 90000 ? true : `a FRESHLY computed today window ends ${Math.round(age / 1000)}s before the request`;
});
await chk("P67296", "…and a forced recompute really does end at now", async () => {
  const f = await get(`range=today&rid=${RID}&compare=1&refresh=1`);
  if (f.__status !== 200) return `status ${f.__status}`;
  const age = f.__askedAt - Date.parse(f.window.to);
  return age >= -5000 && age <= 90000
    ? true : `a forced today window ends ${Math.round(age / 1000)}s from the request`;
});
await chk(nextId(), "yesterday is the WHOLE previous business day, 05:00 IST to 05:00 IST", () => {
  const w = payloads.yesterday.window;
  const f = istParts(w.from), t = istParts(w.to);
  const oneDay = Math.abs(spanDays(w) - 1) < 0.001;
  return f.h === 5 && t.h === 5 && oneDay ? true : `from ${f.h}h to ${t.h}h, span ${spanDays(w).toFixed(3)} days`;
});
await chk(nextId(), "…and it ends exactly where today begins, so no hour is counted twice or lost", () =>
  payloads.yesterday.window.to === payloads.today.window.from
    ? true : `yesterday ends ${payloads.yesterday.window.to}, today starts ${payloads.today.window.from}`);
await chk(nextId(), "this week starts on a MONDAY at 00:00 IST", () => {
  const f = payloads.week.window.from;
  const dow = new Date(Date.parse(f) + IST_MS).getUTCDay();
  const p = istParts(f);
  return dow === 1 && p.h === 0 && p.mi === 0 ? true : `week starts on day ${dow} at ${p.h}:${p.mi} IST`;
});
await chk(nextId(), "…and never more than 7 days ago", () =>
  spanDays(payloads.week.window) <= 7.01 ? true : `this week spans ${spanDays(payloads.week.window).toFixed(2)} days`);
await chk(nextId(), "7d is EXACTLY 7 whole IST days ending today, aligned to 00:00 IST", () => {
  const w = payloads["7d"].window, p = istParts(w.from);
  const span = spanDays(w);
  return p.h === 0 && p.mi === 0 && span > 6 && span <= 7.001
    ? true : `7d starts at ${p.h}:${p.mi} IST and spans ${span.toFixed(3)} days`;
});
await chk(nextId(), "30d is EXACTLY 30 whole IST days, aligned the same way", () => {
  const w = payloads["30d"].window, p = istParts(w.from);
  const span = spanDays(w);
  return p.h === 0 && p.mi === 0 && span > 29 && span <= 30.001
    ? true : `30d starts at ${p.h}:${p.mi} IST and spans ${span.toFixed(3)} days`;
});
await chk(nextId(), "…which is what makes the chart total equal the KPI above it by construction", () =>
  istDay(payloads["30d"].window.from) === istDay(new Date(now - 29 * 86400000).toISOString())
    ? true : `30d starts on ${istDay(payloads["30d"].window.from)}, expected ${istDay(new Date(now - 29 * 86400000).toISOString())}`);
await chk(nextId(), "this month starts on the 1st at 00:00 IST", () => {
  const p = istParts(payloads.month.window.from);
  return p.d === 1 && p.h === 0 && p.mi === 0 ? true : `month starts on day ${p.d} at ${p.h}:${p.mi} IST`;
});
await chk(nextId(), "…and it is the CURRENT month, not last one", () => {
  const f = istParts(payloads.month.window.from), n = istParts(new Date(now).toISOString());
  return f.y === n.y && f.m === n.m ? true : `month resolved to ${f.y}-${f.m + 1}, now is ${n.y}-${n.m + 1}`;
});
await chk(nextId(), "last month is a WHOLE calendar month, 1st to 1st", () => {
  const w = payloads.lastmonth.window, f = istParts(w.from), t = istParts(w.to);
  return f.d === 1 && t.d === 1 && f.h === 0 && t.h === 0 ? true : `from day ${f.d} ${f.h}h to day ${t.d} ${t.h}h`;
});
await chk(nextId(), "…and it ends exactly where this month begins", () =>
  payloads.lastmonth.window.to === payloads.month.window.from
    ? true : `lastmonth ends ${payloads.lastmonth.window.to}, month starts ${payloads.month.window.from}`);
await chk(nextId(), "…and it is exactly one month before this one, wrapping the year in January", () => {
  const f = istParts(payloads.lastmonth.window.from), n = istParts(payloads.month.window.from);
  const expect = n.m === 0 ? { y: n.y - 1, m: 11 } : { y: n.y, m: n.m - 1 };
  return f.y === expect.y && f.m === expect.m ? true : `lastmonth is ${f.y}-${f.m + 1}, expected ${expect.y}-${expect.m + 1}`;
});
await chk(nextId(), "12m covers the twelve whole IST months ending this one", () => {
  const w = payloads["12m"].window, f = istParts(w.from);
  const span = spanDays(w);
  return f.d === 1 && f.h === 0 && span > 330 && span < 370
    ? true : `12m starts on day ${f.d} and spans ${span.toFixed(0)} days`;
});
await chk(nextId(), "the financial year starts on 1 APRIL — the Indian FY, not January", () => {
  const f = istParts(payloads.fy.window.from);
  return f.m === 3 && f.d === 1 && f.h === 0 ? true : `fy starts ${f.y}-${f.m + 1}-${f.d} at ${f.h}h IST`;
});
await chk(nextId(), "…and it is the FY we are currently in", () => {
  const f = istParts(payloads.fy.window.from), n = istParts(new Date(now).toISOString());
  const expectYear = n.m >= 3 ? n.y : n.y - 1;
  return f.y === expectYear ? true : `fy starts in ${f.y}, expected ${expectYear}`;
});
await chk(nextId(), "all time starts at the fixed floor, not at an unbounded scan of everything", () =>
  Date.parse(payloads.all.window.from) === Date.parse("2020-01-01T00:00:00Z")
    ? true : `all-time starts ${payloads.all.window.from}`);
await chk(nextId(), "…and uses DAY buckets, never hour, so it cannot return a year of hourly rows", () => {
  const ts = payloads.all.timeseries || [];
  if (ts.length < 2) return true;   // nothing to prove on an empty tenant
  const gaps = ts.slice(1, 12).map((r, i) => Date.parse(r.bucket) - Date.parse(ts[i].bucket));
  return gaps.every((g) => g >= 3600_000 * 20 || g === 0)
    ? true : `all-time buckets are ${Math.min(...gaps) / 3600000}h apart — that is hourly`;
});
await chk(nextId(), "today and yesterday use HOUR buckets, so an intraday chart has shape", () => {
  const ts = payloads.today.timeseries || [];
  if (ts.length < 2) return true;
  const gaps = ts.slice(1, 8).map((r, i) => Date.parse(r.bucket) - Date.parse(ts[i].bucket));
  return gaps.every((g) => g <= 3600_000 * 2) ? true : `today's buckets are ${Math.min(...gaps) / 3600000}h apart`;
});

// ── an unknown range is answered as today, AND SAYS SO ───────────────────────────────────────
const junk = await get(`range=NOT_A_RANGE&rid=${RID}&compare=1`);
await chk(nextId(), "an unknown range is answered as today rather than refused", () =>
  junk.__status === 200 ? true : `status ${junk.__status}`);
await chk(nextId(), "…and the payload SAYS 'today', never echoing the junk back as a label", () =>
  junk.range === "today" ? true : `the payload calls it "${junk.range}" — a chart title would print the junk`);
await chk(nextId(), "…and resolves today's real window, not a window of nothing", () =>
  junk.window && junk.window.from === payloads.today.window.from
    ? true : `junk window ${JSON.stringify(junk.window)} vs today ${JSON.stringify(payloads.today.window)}`);
for (const bad of ["", "1; DROP", "../../etc", "%%%", "TODAY", "Today", "30D", "null", "undefined"]) {
  const j = await get(`range=${encodeURIComponent(bad)}&rid=${RID}&compare=1`);
  await chk(nextId(), `range=${JSON.stringify(bad)} is answered as today and labelled today`, () =>
    j.__status === 200 && j.range === "today"
      ? true : `status ${j.__status}, labelled "${j.range}"`);
}
await chk(nextId(), "the valid-range list in the route is exactly the eleven the page and the dialog can send", () => {
  const m = /const VALID_RANGES = new Set\(\[([^\]]*)\]\)/.exec(a);
  if (!m) return "VALID_RANGES not found";
  const got = [...m[1].matchAll(/"(\w+)"/g)].map((x) => x[1]).sort();
  const want = ["today", "yesterday", "week", "7d", "30d", "month", "lastmonth", "12m", "fy", "all", "custom"].sort();
  return got.join(",") === want.join(",") ? true : `route accepts [${got}], page+dialog send [${want}]`;
});

// ── the custom range, and the junk it must refuse ────────────────────────────────────────────
const cGood = await get(`range=custom&from=2026-08-01&to=2026-08-07&rid=${RID}&compare=1`);
await chk(nextId(), "a custom range with two real dates resolves exactly those IST days, inclusive", () => {
  if (cGood.__status !== 200) return `status ${cGood.__status}`;
  const f = istDay(cGood.window.from), t = Date.parse(cGood.window.to);
  const expectTo = Date.parse("2026-08-08T00:00:00+05:30");
  return f === "2026-08-01" && t === expectTo ? true : `from ${f} to ${cGood.window.to} (expected end ${new Date(expectTo).toISOString()})`;
});
await chk(nextId(), "…and it is labelled custom, so the screen can say which dates", () =>
  cGood.range === "custom" ? true : `labelled "${cGood.range}"`);
for (const [f, t, why] of [
  ["not-a-date", "2026-08-07", "a malformed start"],
  ["2026-08-01", "not-a-date", "a malformed end"],
  ["2026-08-07", "2026-08-01", "an end before its start"],
  ["", "", "two empty dates"],
  ["2026-13-45", "2026-13-46", "an impossible month and day"],
]) {
  const j = await get(`range=custom&from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}&rid=${RID}&compare=1`);
  await chk(nextId(), `a custom range with ${why} falls back to the last 30 days rather than answering nothing`, () => {
    if (j.__status !== 200) return `status ${j.__status}`;
    const span = spanDays(j.window);
    return span > 29 && span <= 30.01 ? true : `resolved a ${span.toFixed(2)}-day window`;
  });
}
await chk(nextId(), "…and every junk custom range falls back to the SAME 30-day window start", () => {
  // Compare the window START and the DAY of its end, not the exact end. A 30-day fallback ends at
  // "now", so the millisecond always differs — an earlier version of this row read that as five
  // different windows. What matters is that junk cannot mint a distinct CACHE KEY, and the key is
  // built from these two slices (see rangeKey in the route).
  const seen = [...cache.entries()].filter(([k]) => /range=custom/.test(k) && !/from=2026-08-01&to=2026-08-07/.test(k))
    .map(([, v]) => v.window && `${v.window.from.slice(0, 10)}|${v.window.to.slice(0, 10)}`);
  return new Set(seen).size <= 1
    ? true : `${new Set(seen).size} distinct cache keys from junk input: ${JSON.stringify([...new Set(seen)])}`;
});
await chk(nextId(), "…and a custom range ENDING TODAY can be served from its own snapshot twice", async () => {
  // The fault item 5 fixed: the key carried the resolved end down to the millisecond, so a
  // range including today could never hit its own cache and recomputed on every open.
  const today = new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
  const qs = `range=custom&from=2026-08-01&to=${today}&rid=${RID}&compare=1`;
  const one = await ctx.request.get(`${BASE}/api/owner/analytics?${qs}`, { timeout: 120000 }).then((r) => r.json());
  const two = await ctx.request.get(`${BASE}/api/owner/analytics?${qs}`, { timeout: 120000 }).then((r) => r.json());
  const at = (x) => x.cachedAt && Date.parse(x.cachedAt);   // Z and +00:00 are the same instant
  return at(one) && at(one) === at(two)
    ? true : `two opens computed two snapshots: ${one.cachedAt} vs ${two.cachedAt}`;
});
await chk(nextId(), "…while a custom range wholly in the PAST still caches, as it always did", async () => {
  const qs = `range=custom&from=2026-08-01&to=2026-08-07&rid=${RID}&compare=1`;
  const one = await ctx.request.get(`${BASE}/api/owner/analytics?${qs}`, { timeout: 120000 }).then((r) => r.json());
  const two = await ctx.request.get(`${BASE}/api/owner/analytics?${qs}`, { timeout: 120000 }).then((r) => r.json());
  const at = (x) => x.cachedAt && Date.parse(x.cachedAt);
  return at(one) && at(one) === at(two) ? true : `${one.cachedAt} vs ${two.cachedAt}`;
});
await chk(nextId(), "…and the custom key is built from DAY slices, so it is identity, not a timestamp", () =>
  /\? `custom:\$\{from\.slice\(0, 10\)\}:\$\{to\.slice\(0, 10\)\}`/.test(a)
    ? true : "the custom cache key no longer slices to the day");
await chk(nextId(), "the cache key is built from the RESOLVED window, never from the raw query string", () => {
  // Re-pinned after item 5. The earlier version asserted the exact old expression, so it went red
  // for the FIX rather than for a fault — the code-shape trap. What the row is about: the key is
  // derived from `from`/`to`, which windowFor() has already validated, and never from
  // sp.get("from")/sp.get("to"), where every junk value minted its own row.
  const m = /const rangeKey = range === "custom"([\s\S]*?);\n/.exec(a);
  if (!m) return "rangeKey not found";
  const usesResolved = /\bfrom\b/.test(m[1]) && /\bto\b/.test(m[1]);
  const usesRaw = /sp\.get\(/.test(m[1]);
  return usesResolved && !usesRaw ? true : `resolved=${usesResolved} readsRawQuery=${usesRaw}`;
});
await chk(nextId(), "…so the key carries the DAY, and the first open after a rollover cannot serve yesterday", () =>
  /`\$\{range\}:\$\{from\.slice\(0, 10\)\}`/.test(a) ? true : "the date fell out of the cache key");

// ── the comparison windows ───────────────────────────────────────────────────────────────────
await chk(nextId(), "compare=1 returns a previous-period total for every range except all time", () => {
  const missing = RANGES.filter((r) => r !== "all" && payloads[r].prev === undefined);
  const allHasNone = payloads.all.prev === null || payloads.all.prev === undefined;
  return missing.length === 0 && allHasNone
    ? true : `ranges with no prev: ${JSON.stringify(missing)}; all-time prev = ${JSON.stringify(payloads.all.prev)}`;
});
await chk(nextId(), "all time has no previous period, so no comparison chip can be drawn", () =>
  payloads.all.prev === null ? true : `all-time prev = ${JSON.stringify(payloads.all.prev)}`);
await chk(nextId(), "today compares against the SAME HOURS of yesterday, not a whole day", () =>
  /if \(range === "today"\) \{[\s\S]{0,300}?from: new Date\(f - DAY\)\.toISOString\(\), to: new Date\(f - DAY \+ span\)\.toISOString\(\)/.test(a)
    ? true : "the same-hours-yesterday comparison changed");
await chk(nextId(), "…so a check at 11am compares mornings, and the chip is not always down", () => {
  const m = /return \{ from: new Date\(f - DAY\)\.toISOString\(\), to: new Date\(f - DAY \+ span\)\.toISOString\(\) \};/.test(a);
  return m ? true : "the previous window for today is no longer span-limited";
});
await chk(nextId(), "the OVERLAY's previous window steps back by WHOLE days for 7d and 30d", () =>
  /if \(range === "7d"\) return \{ from: new Date\(f - 7 \* DAY\)\.toISOString\(\), to: from \};/.test(a)
    && /if \(range === "30d"\) return \{ from: new Date\(f - 30 \* DAY\)\.toISOString\(\), to: from \};/.test(a)
    ? true : "the overlay's whole-day step-back is gone — the earliest day would draw a fake zero");
await chk(nextId(), "…and by a whole prior WEEK for this week, so it lines up Monday to Monday", () =>
  /if \(range === "week"\) return \{ from: new Date\(f - 7 \* DAY\)\.toISOString\(\), to: from \};/.test(a)
    ? true : "the week overlay no longer steps back a whole week");
await chk(nextId(), "…and by a whole calendar MONTH for month, so it lines up day-1 to day-1", () =>
  /if \(range === "month"\) \{[\s\S]{0,320}?return \{ from: new Date\(start\(y, m - 1\)\)\.toISOString\(\), to: new Date\(start\(y, m\)\)\.toISOString\(\) \};/.test(a)
    ? true : "the month overlay no longer uses whole calendar months");
await chk(nextId(), "the previous-period bucket rows come back sorted oldest-first", () => {
  const rows = payloads["30d"].timeseriesPrev || [];
  if (rows.length < 2) return true;
  const sorted = rows.every((r, i) => i === 0 || String(rows[i - 1].bucket) <= String(r.bucket));
  return sorted ? true : "timeseriesPrev is not in time order — the overlay would zig-zag";
});
await chk(nextId(), "…and none of them falls at or after the previous window's own end", () => {
  const rows = payloads.lastmonth.timeseriesPrev || [];
  if (!rows.length) return true;
  const cut = Date.parse(payloads.lastmonth.window.from);
  const over = rows.filter((r) => Date.parse(r.bucket) >= cut);
  return over.length === 0 ? true : `${over.length} previous-period buckets bleed into the current window`;
});
await chk(nextId(), "the day-grain cap exists because the rollup RPC ignores its upper bound", () =>
  /const prevCut = prevTsWin \? Date\.parse\(prevTsWin\.to\) : Infinity;/.test(a)
    ? true : "the prevCut filter is gone — a past-ending window would run to the watermark");
await chk(nextId(), "…and it is applied in BOTH the group and the restaurant scope", () =>
  count(a, /const prevCut = prevTsWin \? Date\.parse\(prevTsWin\.to\) : Infinity;/g) === 2
    ? true : "only one of the two scopes caps the previous series");

// ── the busy heatmap's clamp ─────────────────────────────────────────────────────────────────
await chk(nextId(), "the busy grid is clamped to the last 90 days of the SELECTED window", () =>
  /return new Date\(Math\.max\(Date\.parse\(from\), Date\.parse\(to\) - HEAT_MAX_DAYS \* DAY\)\)\.toISOString\(\);/.test(a)
    ? true : "the heatmap clamp changed");
await chk(nextId(), "…anchored to the window's own END, so a historical range cannot invert", () => {
  const m = /function heatFrom\(from: string, to: string\): string \{([\s\S]*?)\n\}/.exec(a);
  return m && /Date\.parse\(to\) - HEAT_MAX_DAYS \* DAY/.test(m[1]) && !/Date\.now\(\)/.test(m[1])
    ? true : "the clamp is anchored to wall-clock now, which would invert a past window";
});
await chk(nextId(), "…and the clamp is 90 days in the route and 90 in the page, one number in two files", () => {
  const routeN = /const HEAT_MAX_DAYS = (\d+);/.exec(a);
  const pageN = /const HEAT_CLAMP_DAYS = (\d+);/.exec(code("app/owner/page.tsx"));
  return routeN && pageN && routeN[1] === pageN[1]
    ? true : `route says ${routeN && routeN[1]}, page says ${pageN && pageN[1]} — the caption would lie about the grid`;
});
await chk(nextId(), "an all-time heatmap really does come back bounded, not as six years of grid", () => {
  const h = payloads.all.heatmap;
  if (!Array.isArray(h)) return true;   // non-fatal by design
  return h.length <= 7 * 24 ? true : `${h.length} heatmap cells — more than a 7x24 grid`;
});
await chk(nextId(), "…and every heatmap cell is inside a real day-of-week and hour", () => {
  const h = payloads["30d"].heatmap || [];
  const bad = h.filter((c) => !(c.dow >= 0 && c.dow <= 6) || !(c.hr >= 0 && c.hr <= 23));
  return bad.length === 0 ? true : `cells outside 0-6 / 0-23: ${JSON.stringify(bad.slice(0, 3))}`;
});

// ── the change-detector, and why it switches on width ────────────────────────────────────────
await chk(nextId(), "a window wider than ~35 days uses the cheap rollup fingerprint, not a full scan", () =>
  /Date\.parse\(to\) - Date\.parse\(from\) > WIDE_FP_MS\s*\n?\s*\? reportMonthFingerprint\(ids, from, to\)\s*\n?\s*: ordersFingerprint\(ids, from, to\)/.test(a)
    ? true : "the wide-window fingerprint switch is gone — all-time would hit the statement timeout");
await chk(nextId(), "…and the threshold is 35 days", () => {
  const m = /const WIDE_FP_MS = (\d+) \* DAY;/.exec(a);
  return m && m[1] === "35" ? true : `the threshold is ${m && m[1]} days`;
});
await chk(nextId(), "the fingerprint also watches STAFF PAY, which no order change would move", () =>
  /async function fpWithStaffPay/.test(a) && /staff_payments/.test(a)
    ? true : "recording a salary would leave the cached dashboard stale");
await chk(nextId(), "…and it counts with an exact count and reads only the newest row's stamps", () =>
  /sb\.from\("staff_payments"\)\.select\("created_at, voided_at", \{ count: "exact" \}\)/.test(a)
    && /\.order\("created_at", \{ ascending: false \}\)\.limit\(1\)/.test(a)
    ? true : "the staff-pay fingerprint read grew beyond one row");
await chk(nextId(), "…and an EMPTY scope does not fall through to a platform-wide read", () =>
  /if \(ids && !ids\.length\) return base;/.test(a)
    ? true : "a scoped owner with nothing entitled would fingerprint every restaurant");
await chk(nextId(), "…while a NULL scope (the admin) deliberately does ask without the filter", () =>
  /const q = await \(ids \? q0\.in\("restaurant_id", ids\) : q0\)/.test(a)
    ? true : "the admin's staff-pay fingerprint changed");

// ── refresh, and the cache it is allowed to burst ────────────────────────────────────────────
const fresh = await get(`range=30d&rid=${RID}&compare=1&refresh=1`);
await chk(nextId(), "refresh=1 recomputes and still answers the same window", () =>
  fresh.__status === 200 && fresh.window.from === payloads["30d"].window.from
    ? true : `status ${fresh.__status}, window ${JSON.stringify(fresh.window)}`);
await chk(nextId(), "…and only refresh=1 forces it — nothing else can burst the cache", () => {
  const forces = [...a.matchAll(/force: ([^,\n]*)/g)].map((m) => m[1].trim());
  return forces.length === 2 && forces.every((f) => f === 'sp.get("refresh") === "1"')
    ? true : `force expressions: ${JSON.stringify(forces)}`;
});
await chk(nextId(), "the snapshot key carries a VERSION, so a shape change cannot serve field-less JSON", () => {
  const keys = [...a.matchAll(/key: `analytics:(v\d+):/g)].map((m) => m[1]);
  return keys.length === 2 && new Set(keys).size === 1 ? true : `payload versions: ${JSON.stringify(keys)}`;
});
await chk(nextId(), "…and the version is at least v6, the one that added the resolved window", () => {
  const v = /key: `analytics:v(\d+):/.exec(a);
  return Number(v[1]) >= 6 ? true : `the key is at v${v[1]}, but the window field arrived in v6`;
});
await chk(nextId(), "the group and restaurant scopes use DIFFERENT cache keys", () => {
  const g = /key: `analytics:v\d+:group:/.test(a), r = /key: `analytics:v\d+:rest:\$\{rid\}:/.test(a);
  return g && r ? true : `group key=${g} restaurant key=${r}`;
});
await chk(nextId(), "…and the key carries whether compare was asked for", () =>
  count(a, /:c\$\{compare \? 1 : 0\}`/g) === 2
    ? true : "a compare and a non-compare request would share one cache row");

// ── the payload a chart is actually given ────────────────────────────────────────────────────
await chk(nextId(), "the restaurant payload names the restaurant it is about", () => {
  const r = payloads["30d"].restaurant;
  return r && r.id === RID && r.name ? true : `restaurant block = ${JSON.stringify(r)}`;
});
await chk(nextId(), "…and its revenue is the sum of its own timeseries, to the paisa", () => {
  const p = payloads["30d"];
  const sum = Math.round((p.timeseries || []).reduce((x, r) => x + Number(r.revenue || 0), 0) * 100) / 100;
  return Math.abs(sum - p.kpis.revenue) < 0.02
    ? true : `timeseries sums to ${sum}, kpis.revenue is ${p.kpis.revenue}`;
});
await chk(nextId(), "…and its order count is the sum of its own timeseries too", () => {
  const p = payloads["30d"];
  const sum = (p.timeseries || []).reduce((x, r) => x + Number(r.orders || 0), 0);
  return sum === p.kpis.orders ? true : `timeseries sums to ${sum} orders, kpis.orders is ${p.kpis.orders}`;
});
await chk(nextId(), "the average per paid order really is revenue divided by PAID orders", () => {
  const k = payloads["30d"].kpis;
  if (!k.paidOrders) return k.avgOrder === 0 ? true : `no paid orders but avgOrder is ${k.avgOrder}`;
  const expect = Math.round((k.revenue / k.paidOrders) * 100) / 100;
  return Math.abs(expect - k.avgOrder) < 0.02 ? true : `${k.revenue}/${k.paidOrders} = ${expect}, payload says ${k.avgOrder}`;
});
await chk(nextId(), "…and paid orders never exceed all orders", () => {
  const k = payloads["30d"].kpis;
  return k.paidOrders <= k.orders ? true : `${k.paidOrders} paid of ${k.orders} total`;
});
await chk(nextId(), "the paid count comes from the payment breakdown, which is paid-only by definition", () => {
  const p = payloads["30d"];
  const fromPm = (p.paymentMethods || []).reduce((x, m) => x + Number(m.orders || 0), 0);
  return fromPm === p.kpis.paidOrders ? true : `payments say ${fromPm}, kpis say ${p.kpis.paidOrders}`;
});
await chk(nextId(), "no money figure in the payload is a raw float with more than two decimals", () => {
  const p = payloads["30d"];
  const vals = [p.kpis.revenue, p.kpis.avgOrder, ...(p.timeseries || []).map((r) => r.revenue),
    ...(p.dishes || []).map((d) => d.revenue), ...(p.paymentMethods || []).map((m) => m.revenue)];
  const bad = vals.filter((v) => typeof v === "number" && Math.abs(v * 100 - Math.round(v * 100)) > 1e-6);
  return bad.length === 0 ? true : `unrounded money: ${JSON.stringify(bad.slice(0, 4))}`;
});
await chk(nextId(), "no figure in the payload is NaN, Infinity or null where a number belongs", () => {
  const p = payloads["30d"];
  const nums = [p.kpis.revenue, p.kpis.orders, p.kpis.paidOrders, p.kpis.avgOrder];
  const bad = nums.filter((v) => !Number.isFinite(v));
  return bad.length === 0 ? true : `non-finite KPI figures: ${JSON.stringify(nums)}`;
});
await chk(nextId(), "the dish list comes back sorted, so 'top dish' means the top one", () => {
  const d = payloads["30d"].dishes || [];
  if (d.length < 2) return true;
  const sorted = d.every((x, i) => i === 0 || d[i - 1].revenue >= x.revenue);
  return sorted ? true : "dishes are not in revenue order — the dish list would rank wrongly";
});
await chk(nextId(), "…and topDish names the first of them", () => {
  const p = payloads["30d"];
  const d = p.dishes || [];
  return !d.length || p.kpis.topDish === d[0].title
    ? true : `topDish is "${p.kpis.topDish}" but the list starts with "${d[0].title}"`;
});
await chk(nextId(), "the payment methods come back sorted by revenue", () => {
  const m = payloads["30d"].paymentMethods || [];
  if (m.length < 2) return true;
  return m.every((x, i) => i === 0 || m[i - 1].revenue >= x.revenue)
    ? true : "payment methods are unsorted — the donut's legend order would drift from its slices";
});
await chk(nextId(), "the categories come back sorted by revenue", () => {
  const c = payloads["30d"].categories || [];
  if (c.length < 2) return true;
  return c.every((x, i) => i === 0 || c[i - 1].revenue >= x.revenue) ? true : "categories are unsorted";
});
await chk(nextId(), "the hourly rows cover only real hours", () => {
  const h = payloads["30d"].hourly || [];
  const bad = h.filter((r) => !(r.hour >= 0 && r.hour <= 23));
  return bad.length === 0 ? true : `hours outside 0-23: ${JSON.stringify(bad.slice(0, 3))}`;
});
await chk(nextId(), "records ride ONLY when asked for, never on a plain request", () => {
  const withOut = payloads["30d"];
  return withOut.records === null || withOut.records === undefined
    ? true : "the unbounded all-time records scan rode on a request that did not ask for it";
});
const withRec = await get(`range=30d&rid=${RID}&compare=1&records=1`);
await chk(nextId(), "…and they DO arrive when asked for", () =>
  withRec.__status === 200 && withRec.records !== undefined
    ? true : `status ${withRec.__status}, records = ${JSON.stringify(withRec.records)}`);
await chk(nextId(), "a group request sends no restaurant block and no dish list", async () => {
  const g = await get("range=30d&compare=1");
  return g.scope === "group" && g.restaurant === undefined && g.dishes === undefined
    ? true : `scope=${g.scope}, has restaurant=${!!g.restaurant}, has dishes=${!!g.dishes}`;
});
await chk(nextId(), "…and a group request carries one revenue row per restaurant, ordered by revenue", async () => {
  const g = await get("range=30d&compare=1");
  const rr = g.restaurantRevenue || [];
  if (rr.length < 2) return true;
  return rr.every((x, i) => i === 0 || rr[i - 1].revenue >= x.revenue)
    ? true : "restaurantRevenue is not in revenue order — the page reads [0] as the top performer";
});
await chk(nextId(), "…which is exactly the assumption the top-performer banner makes", () => {
  const page = code("app/owner/page.tsx");
  return /const best = p\.restaurantRevenue\[0\];/.test(page)
    ? true : "the banner no longer reads [0], so this ordering contract has moved";
});

if (results_count() !== EXPECT_ROWS) {
  console.log(`\nID DRIFT: this band executed ${results_count()} rows but declares EXPECT_ROWS = ${EXPECT_ROWS}.\nEvery id after the inserted row has shifted. Append at the end, or renumber deliberately and update the ledger.`);
  process.exit(2);
}
const n = report(`T13 NEW band B · the analytics route's windows, driven (P66801–P${id - 1})`, { minChecks: 90 });
const out = process.argv.find((x) => x.startsWith("--ledger="));
if (out) writeLedger(out.slice(9), {
  how: `GET /api/owner/analytics on ${BASE} as the diag owner, asserting the resolved window it reports`,
  section: `NEW · Band B — the analytics route's window maths, DRIVEN — P66801–P${id - 1}`,
});
await browser.close();
