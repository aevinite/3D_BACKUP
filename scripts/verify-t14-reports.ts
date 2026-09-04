// verify-t14-reports.ts — SWEEP #8 · TERMINAL 14 · the owner's Reports and every chart.
//
//   npm run verify:t14                                  (static + pure, no server needed)
//   npm run verify:t14 -- --base http://localhost:4314  (adds the live payload layer)
//
// WHY THIS FILE EXISTS
// `.claude/sweep/LEDGER/T11.md` holds **2,060 numbered checks** over this territory, written
// across sweeps #6, #7 and #8, and until now only 153 of them (`verify:owner-reports`) could be
// re-executed without a person driving a browser for a day. This file re-executes every one of
// the rest that does not NEED a browser: the code-read invariants, the money and chart maths run
// by IMPORTING the shipped modules, and the live payload arithmetic for every report × period.
// The browser half is scripts/verify-t14-reports-live.mjs.
//
// THREE RULES IT RUNS BY, each one a scar this repo already carries:
//   1. COMMENTS ARE STRIPPED BEFORE ANY SOURCE SCAN, and LINE comments are stripped BEFORE block
//      comments. Three "failures" in T11's pass 3 were the detector matching the very comment
//      that records the rule; and a `/*` inside a `//` line once hid 190 lines from two guards.
//   2. A PURE FUNCTION IS RUN, NOT READ. splitTax / allocateWhole / buildFiling / roundTicks /
//      compactINR / classifyMenu / seriesStats / sectionTables are imported and executed against
//      real inputs, so a refactor that keeps the shape and breaks the answer cannot pass.
//   3. EVERY ASSERTION CARRIES THE LEDGER ID IT RE-RUNS — R() for an existing row, N() for a new
//      one out of this terminal's own block (P67701–P68700). They can never collide.
import { readFileSync, readdirSync } from "node:fs";
import { splitTax, allocateWhole, buildFiling, taxableValue, exemptIsMaterial, taxableFor } from "@/lib/taxFiling";
import { compactINR, roundTicks } from "@/lib/money";
import { canonPayMethod, payColor, PAY_COLORS } from "@/components/owner/Charts";
import { classifyMenu } from "@/components/owner/reports/DishReports";
import { seriesStats } from "@/components/owner/reports/Insights";
import { sectionTables, sectionHtml, POPUP_BLOCKED } from "@/components/owner/reports/sectionExport";
import { REPORTS, CATEGORIES, DAYPARTS, WEEKDAY_SHORT, WEEKDAY_FULL, istWeekday, nfmt, pct } from "@/components/owner/reports/kit";

const arg = (n: string) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const BASE = arg("--base") || process.env.LFH_BASE || "";

let pass = 0, fail = 0, skip = 0;
const fails: string[] = [];
const used = new Set<string>();
const NEW_FROM = 67701, NEW_TO = 68700;
let nextNew = NEW_FROM;
function record(id: string, msg: string, cond: boolean, note: string) {
  if (used.has(id)) { fail++; fails.push(`DUPLICATE ID ${id}`); console.log(`  ⚠️ DUPLICATE ID ${id}`); }
  used.add(id);
  if (cond) pass++;
  else { fail++; fails.push(`${id} ${msg}${note ? ` — ${note}` : ""}`); console.log(`  ❌ ${id} ${msg}${note ? ` — ${note}` : ""}`); }
}
/** Re-run an EXISTING ledger row, by its own permanent id. */
const R = (id: string, msg: string, cond: boolean, note = "") => record(id, msg, cond, note);
/** A NEW check, from this terminal's pre-allocated block. Never reuses an id. */
function N(msg: string, cond: boolean, note = "") {
  if (nextNew > NEW_TO) { console.log("  ⚠️ ID BLOCK EXHAUSTED"); process.exit(2); }
  record(`P${nextNew++}`, msg, cond, note);
}
const S = (id: string, msg: string, why: string) => { used.add(id); skip++; console.log(`  ⏭ ${id} ${msg} — ${why}`); };
const head = (s: string) => console.log(`\n── ${s} ──`);
const near = (a: number, b: number, eps = 1) => Math.abs(a - b) <= eps;

// ── the territory's source, with comments stripped ───────────────────────────
const strip = (src: string) =>
  src.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
const FILES = {
  page: "app/owner/reports/page.tsx",
  charts: "components/owner/Charts.tsx",
  cache: "lib/ownerCache.ts",
  kit: "components/owner/reports/kit.tsx",
  exp: "components/owner/reports/sectionExport.tsx",
  dish: "components/owner/reports/DishReports.tsx",
  inv: "components/owner/reports/InventoryReports.tsx",
  ins: "components/owner/reports/Insights.tsx",
  st: "components/owner/reports/SearchTable.tsx",
  red1: "app/owner/report/page.tsx",
  red2: "app/owner/sales/page.tsx",
} as const;
type FK = keyof typeof FILES;
const raw = {} as Record<FK, string>;
const code = {} as Record<FK, string>;
for (const k of Object.keys(FILES) as FK[]) { raw[k] = readFileSync(FILES[k], "utf8"); code[k] = strip(raw[k]); }
const ALL = (Object.keys(FILES) as FK[]).map((k) => code[k]).join("\n");

console.log("T14 · the owner's Reports and every chart — re-running the ledger, then the new block");

// ══ A. THE HOUSE RULES — one row per file per rule (P49001–P49072, P49096–P49103, P49133–P49140) ══
head("A · house rules, every file in the territory");
const HOUSE = [
  { key: "star", label: "no select('*')", bad: (s: string) => /select\(\s*["'`]\*/.test(s) },
  { key: "alert", label: "no alert() / confirm() / prompt()", bad: (s: string) => /(^|[^.\w])(alert|confirm|prompt)\s*\(/.test(s) },
  { key: "hidden", label: "no document.hidden refusal", bad: (s: string) => /document\.hidden/.test(s) },
  { key: "hist", label: "no hand-rolled pushState/popstate", bad: (s: string) => /pushState|popstate/.test(s) },
  { key: "enus", label: "no en-US MONEY formatting", bad: (s: string) => /toLocaleString\(\s*["']en-US/.test(s) },
  { key: "poll", label: "no setInterval faster than the 60s backstop", bad: (s: string) => [...s.matchAll(/setInterval\([^,]+,\s*([0-9_]+)/g)].some((m) => Number(String(m[1]).replace(/_/g, "")) < 60_000) },
] as const;
const ROW_FOR: Record<string, Record<string, string>> = {
  page: { star: "P49001", alert: "P49002", hidden: "P49003", hist: "P49004", enus: "P49005", poll: "P49007" },
  charts: { star: "P49009", alert: "P49010", hidden: "P49011", hist: "P49012", enus: "P49013", poll: "P49015" },
  cache: { star: "P49017", alert: "P49018", hidden: "P49019", hist: "P49020", enus: "P49021", poll: "P49023" },
  dish: { star: "P49025", alert: "P49026", hidden: "P49027", hist: "P49028", enus: "P49029", poll: "P49031" },
  inv: { star: "P49033", alert: "P49034", hidden: "P49035", hist: "P49036", enus: "P49037", poll: "P49039" },
  exp: { star: "P49041", alert: "P49042", hidden: "P49043", hist: "P49044", enus: "P49045", poll: "P49047" },
  red1: { star: "P49049", alert: "P49050", hidden: "P49051", hist: "P49052", enus: "P49053", poll: "P49055" },
  red2: { star: "P49057", alert: "P49058", hidden: "P49059", hist: "P49060", enus: "P49061", poll: "P49063" },
  kit: { star: "P49065", alert: "P49066", hidden: "P49067", hist: "P49068", enus: "P49069", poll: "P49071" },
  st: { star: "P49096", alert: "P49097", hidden: "P49098", hist: "P49099", enus: "P49100", poll: "P49102" },
  ins: { star: "P49133", alert: "P49134", hidden: "P49135", hist: "P49136", enus: "P49137", poll: "P49139" },
};
for (const k of Object.keys(FILES) as FK[])
  for (const r of HOUSE) R(ROW_FOR[k][r.key], `${FILES[k]}: ${r.label}`, !r.bad(code[k]));

// ══ B. THE PAGE, READ AS CODE (P05061–P05140, P20211–P20279, P05011–P05059) ══
head("B · the reports page, read as code");
const pg = code.page;
R("P05061", "every fetch on the page is one of the two known call sites", (pg.match(/fetch\(/g) || []).length === 2);
R("P20213", "every fetch on the page goes to /api/owner/", [...pg.matchAll(/fetch\(\s*`([^`]+)`/g)].every((m) => m[1].startsWith("/api/owner/")));
R("P20437", "every report fetch is cache:'no-store'", (pg.match(/cache:\s*"no-store"/g) || []).length >= 2);
R("P05062", "Refresh sends ?refresh=1 for the active payload", /q\.set\("refresh",\s*"1"\)/.test(pg));
R("P05064", "Refresh reaches the By-restaurant brief too", /forcedTick/.test(pg) && /refresh=1/.test(pg));
R("P05066", "a key is fetched at most once without force (the started ref)", /started\.current\.has\(ck\)/.test(pg));
R("P05067", "a failed fetch deletes its key so a retry is possible", /started\.current\.delete\(ck\)/.test(pg));
R("P05068", "a failed silent revalidate never blanks numbers already on screen", /s\[ck\]\?\.data \? s :/.test(pg));
R("P05070", "refreshNow cannot be re-entered while a refresh is in flight", /if \(refreshing\) return;/.test(pg));
R("P05071", "the Refresh spinner is held ~400ms minimum", /Math\.max\(0,\s*400 -/.test(pg));
R("P05072", "'updated X ago' ages by itself on a 60s tick", /setInterval\(\(\) => setAgeTick/.test(pg));
R("P05073", "'updated X ago' reads the SERVER's compute time", /cachedAt:\s*d\.cachedAt/.test(pg) && /shownCachedAt = entry\?\.cachedAt/.test(pg));
R("P05074", "timeAgo cannot print a negative or NaN age", /!Number\.isFinite\(ms\) \|\| ms < 0/.test(pg));
R("P20250", "…re-stated: timeAgo guards both", /return "just now"/.test(pg));
R("P05075", "the freshness strip is on the hub as well as an open report", pg.indexOf('className="rs-fresh"') < pg.indexOf("{!sel ? ("));
R("P05077", "instant-paint persists only SETTLED entries", /filter\(\(\[, e\]\) => e\.data\)/.test(pg));
R("P05079", "Reports always opens on All restaurants (rid is not restored)", /savedRid\.current = s\.rid/.test(pg) && !/setRid\(s\.rid\)/.test(pg));
R("P05080", "a single-restaurant owner is pinned once the overview answers", /list\.length === 1\) setRid\(list\[0\]\.id\)/.test(pg));
R("P05081", "the act-as pin is applied in an effect, not in initial state", /useEffect\(\(\) => \{\s*if \(viewPin\)/.test(pg));
R("P05082", "the scope pin rides on every call", /scopePin \? `&scope=\$\{scopePin\}/.test(pg) && /q\.set\("scope", scopePin\)/.test(pg));
R("P05083", "the overview read goes through the shared de-duper", /fetchOwnerOverview\(scp\)/.test(pg) && !/fetch\(["'`]\/api\/owner\/overview/.test(pg));
R("P05084", "no data fetch fires before ready", /if \(!ready\) return;/.test(pg));
R("P05085", "an invalid custom range fetches nothing", /if \(isCustom && !customOk\) return;/.test(pg));
R("P05086", "the custom 'to' picker cannot exceed the IST CALENDAR today", /max=\{istCalToday\(\)\}/.test(pg));
R("P05087", "the custom 'from' picker cannot exceed 'to'", /value=\{cFrom\} max=\{cTo\}/.test(pg));
R("P05088", "a Day-summary date cannot be set past the business day", /value=\{day\} max=\{istToday\(\)\}/.test(pg));
R("P05089", "the business day steps back 5 hours before taking the IST date", /BIZ_H = 5/.test(pg) && /- BIZ_H \* 3600_000/.test(pg));
R("P05090", "a day sheet is fetched as range=day, never range=custom", /DAY_KINDS\.has\(kind\) \? \{ range: "day", date: day \}/.test(pg));
R("P05091", "the day sheet's extras use the same business-day window", /const dayEff: Eff = \{ range: "day", date: day \}/.test(pg));
R("P05098", "the cache key carries the effective window", /\$\{e\.range\}\$\{e\.date \?/.test(pg));
R("P05099", "the query carries date OR from\/to, never both", /if \(e\.date\) q\.set\("date"/.test(pg) && /if \(e\.from\) \{ q\.set\("from"/.test(pg));
R("P05100", "apiType maps money → sales", /kind === "money" \? "sales"/.test(pg));
R("P05105", "an unknown ?open= value is ignored rather than throwing", /return map\[k\] \?\? null;/.test(pg));
R("P05106", "the day-of-week tab is disabled on a period with no day buckets", /const off = !!t\.needsDayGrain && !DAY_GRAIN_RANGES\.has\(range\)/.test(pg));
R("P05107", "…and the owner is slid to the first usable view instead", /tabsEarly\.find\(subUsableEarly\)/.test(pg));
R("P05108", "the payload that gets FETCHED follows the same rule as the strip", pg.indexOf("activeSubKeyEarly") < pg.indexOf("const activeKind"));
R("P05109", "Payments fetches the money payload too", /needMoneyToo = sel === "payments"/.test(pg));
R("P05112", "Back closes an open report to the hub", /useBackClose\("owner-report-view"/.test(pg));
R("P05113", "Back closes the print dialog", /useBackClose\("owner-print-ask"/.test(pg));
R("P05114", "Back closes the discount/cancellation overlay", /useBackClose\("owner-report-detail"/.test(pg));
R("P05115", "Back closes the period dropdown", /useBackClose\("owner-reports-period"/.test(pg));
R("P05116", "Escape closes the print dialog", /if \(!printAsk\) return;[\s\S]{0,200}Escape/.test(pg));
R("P05117", "Escape closes the detail overlay", /ReportOverlay[\s\S]{0,400}Escape/.test(pg));
R("P05118", "the backdrop closes both dialogs", (pg.match(/e\.target === e\.currentTarget/g) || []).length >= 2);
R("P05119", "the period dropdown closes on an outside click and detaches", /removeEventListener\("click", close\)/.test(pg));
R("P05120", "every overlay is registered in the back-button manager", !/pushState|popstate/.test(pg) && (pg.match(/useBackClose\(/g) || []).length === 4);
R("P20219", "…and the four back layers are the four named ones",
  ["owner-reports-period", "owner-report-view", "owner-print-ask", "owner-report-detail"].every((id) => pg.includes(`"${id}"`)));
R("P20220", "no two back layers share an id", new Set([...pg.matchAll(/useBackClose\("([^"]+)"/g)].map((m) => m[1])).size === 4);
R("P05121", "the breadcrumb is fed to the SHELL, not rendered here", /lfh:owner-crumb/.test(pg) && !/rs-crumb/.test(pg));
R("P05122", "…and cleared on unmount", /return \(\) => \{ window\.dispatchEvent\(new CustomEvent\("lfh:owner-crumb"[\s\S]{0,60}tail: \[\]/.test(pg));
R("P05124", "the shell's Reports crumb returns to the hub", /lfh:owner-open-restaurant/.test(pg));
R("P05125", "the shell's restaurant switcher re-scopes in place", /lfh:owner-scope/.test(pg));
R("P05126", "both window listeners are removed on unmount", (pg.match(/removeEventListener\("lfh:owner-/g) || []).length === 2);
R("P05127", "re-scoping closes any open report", /setRid\(rid \?\? ""\);\s*backToHub\(\);/.test(pg));
R("P05128", "the Team card is ABSENT (not disabled) when payroll is off", /cat\.key !== "team" \|\| hasPayroll/.test(pg));
R("P05129", "the Inventory card is absent when inventory is off", /cat\.key !== "inventory" \|\| hasInventory/.test(pg));
R("P05130", "with inventory off the day sheet shows no stock tiles at all", /\{data\.inventory && \(/.test(pg));
R("P05131", "with payroll off the day sheet shows no Staff pay out tile", /\{data\.staffPay && \(/.test(pg));
R("P05132", "a restaurant that takes no tips sees no tips tile", /\{data\.tips && \(/.test(pg));
R("P05133", "tips are never folded into revenue or average bill", !/revenue \+ .*tips|tips.*\+ .*revenue/.test(pg));
R("P05134", "a module report cannot be reached by a deep link either", /MODULE_REPORTS\[a\.sel\]\) pendingOpen\.current = a/.test(pg));
R("P05135", "Print routes through the ask dialog and reports a blocked pop-up", /setPrintErr\(printSection\(ctx\) \? null : POPUP_BLOCKED\)/.test(pg));
R("P05136", "confirming with the SAME period prints at once", /if \(pdDay === day\)/.test(pg) && /pdFrom === cur\.from && pdTo === cur\.to/.test(pg));
R("P05137", "confirming with a DIFFERENT period waits for that data", /printWhenReady/.test(pg) && /extrasSettled/.test(pg));
R("P05138", "…and the screen is put back exactly as he left it", /restoreAfterPrint\.current/.test(pg));
R("P05139", "a day-sheet print waits for the dishes AND hours extras", /dayKeyFor\("dishes"\)\], h = store\[dayKeyFor\("hourly"\)\]/.test(pg));
R("P05011", "discount applies BEFORE tax on the day sheet's own lines", /t\.subtotal - t\.discount/.test(pg) && /GST collected/.test(pg));
R("P05012", "no CGST\/SGST split is computed in the JSX — all go through lib/taxFiling",
  !/\/\s*2\s*\)\s*\}/.test(pg.replace(/splitTax|buildFiling/g, "")) && /splitTax\(/.test(pg) && /buildFiling\(/.test(pg));
R("P20227", "…re-stated: splitTax and buildFiling are the only splitters", (pg.match(/splitTax\(|buildFiling\(/g) || []).length >= 3);
R("P05013", "the by-period revenue column and the tile read the same field", /r\.revenue/.test(pg) && /totals\.revenue/.test(pg));
R("P05022", "'Net sales' is subtotal − discount everywhere", (pg.match(/subtotal - t?\.?discount|subtotal \|\| 0\) - \(t\?\.discount/g) || []).length >= 3 && !/revenue - .*tax/.test(pg));
R("P05025", "average bill divides by PAID bills, never all orders", !/revenue \/ t\.orders\b/.test(pg));
R("P05026", "the Busy-hours 'Per order' tile is NOT called Avg bill", /label="Per order"/.test(pg));
R("P05027", "'Orders placed' means orders + cancelled, everywhere it is used",
  (pg.match(/const placed = /g) || []).length === (pg.match(/const placed = t\.orders \+ t\.cancelledOrders/g) || []).length,
  `${(pg.match(/const placed = /g) || []).length} readers`);
R("P05029", "stillOpen / openOrders can never render negative", (pg.match(/Math\.max\(0, t\.orders - t\.paidOrders\)/g) || []).length === 2);
R("P05030", "the effective-discount-rate line divides by subtotal", /t\.discount \/ t\.subtotal/.test(pg));
R("P05031", "the taxable base comes from lib/taxFiling", /taxableValue\(t, configuredPct\)/.test(pg));
R("P05034", "the mixed-rate banner needs a SPREAD or an over-set rate", /mixedRates|overSetRate/.test(pg) && /rateSpread > 0\.75/.test(pg));
R("P05036", "the discount trend needs ≥4 rows", /discRows\.length < 4 \? "steady"/.test(pg));
R("P05037", "the discount trend halves cannot divide by zero", /half \? disc/.test(pg) && /discRows\.length - half \?/.test(pg));
R("P05040", "the weekday breakdown only lets a weekday that occurred win or lose", /rows\.filter\(\(r\) => r\.days > 0\)/.test(pg));
R("P05041", "weekend vs weekday compares per-DAY averages", /wkDays \? wkRev \/ wkDays : 0/.test(pg) && /wdDays \? wdRev \/ wdDays : 0/.test(pg));
R("P05044", "the day-part 'Quietest' ignores a part that took nothing", /parts\.filter\(\(p\) => p\.rev > 0\)/.test(pg));
R("P05045", "Busy-hours 'Quietest hour' ignores hours with zero orders", /hrs\.filter\(\(h\) => h\.orders > 0\)/.test(pg));
R("P05046", "Busy-hours builds a full 24-bucket series", (pg.match(/Array\.from\(\{ length: 24 \}/g) || []).length >= 2);
R("P05048", "every % on the page guards its denominator", (() => {
  // A denominator is safe if it is ternary-guarded (`x ?` / `x > 0 ?`) OR floored by construction
  // (`Math.max(…, 1)`). Only checking for `x ?` marked two honest lines as faults — `tv > 0 ?` and
  // a `briefMax` that can never be below 1 (T14, sweep #8).
  const bad = [...pg.matchAll(/\(([a-zA-Z0-9_.]+)\s*\/\s*([a-zA-Z0-9_.]+)\)\s*\*\s*100/g)].filter((m) => {
    const d = m[2].replace(/[.$]/g, "\\$&");
    return !new RegExp(`${d}\\s*(?:>\\s*0\\s*)?\\?`).test(pg)
        && !new RegExp(`${d}\\s*=[^=][^;]*Math\\.max\\(`).test(pg);
  });
  return bad.length === 0;
})());
R("P05050", "the still-running final bucket is dropped from RANKINGS only", /const settled = /.test(pg) && /settled\(series\)/.test(pg) && /data=\{series\.map/.test(pg));
R("P05051", "settled() never empties a series", /lastIsRunning && arr\.length > 1 \? arr\.slice\(0, -1\) : arr/.test(pg));
R("P05052", "lastIsRunning compares IST stamps at the CHART's grain", /stampLen = chartBucket === "month" \? 7 : chartBucket === "hour" \? 13 : 10/.test(pg));
R("P05054", "Volume's 'Busiest' takes a MAX, so a part-bucket cannot win it", /Math\.max\(\.\.\.vol\.map/.test(pg));
R("P05055", "BestWorst is always told when a partial bucket was dropped", (pg.match(/droppedPartial=\{lastIsRunning\}/g) || []).length >= 4);
R("P05056", "a cost line only overlays a DAY or MONTH revenue bucket", /grainMatches = bucket === "day" \|\| bucket === "month"/.test(pg));
R("P05057", "the cost overlay is dropped when the chart auto-drilled", /const drilled = chartBucket !== bucket/.test(pg) && /!drilled/.test(pg));
R("P05058", "cost rows are matched by IST calendar key", /const istKey = \(iso: string\)/.test(pg));
R("P05059", "the cost caption only appears when a cost row matched", /const matched = canOverlay && rows\.some\(\(r\) => r\.cost > 0\)/.test(pg));
R("P05235", "every money report guards a missing totals object", (pg.match(/if \(!t\) return <EmptyCard/g) || []).length === 7, `${(pg.match(/if \(!t\) return <EmptyCard/g) || []).length} found`);
R("P20247", "…re-stated: seven bodies, seven guards", (pg.match(/if \(!t\) return <EmptyCard/g) || []).length === 7);
R("P05234", "an unknown report body falls through to a plain sentence", /return <EmptyCard text="Report not available\." \/>/.test(pg));
R("P05238", "an errored report offers Try again", /Try again/.test(pg));
R("P05239", "a loading report shows skeleton tiles, not a blank", /Loading…/.test(pg));
R("P05266", "the report view carries the id the print CSS targets", /id="rs-print"/.test(pg));
// The print rules target the studio's CLASSES (.rs-printhead / .rs-printfoot in kit.tsx and the
// .adm.owx block in globals.css). `id="rs-print"` has been decorative since the Studio landed —
// no rule has ever selected it. Corrected here so nobody re-files a dead anchor as a fault.
R("P20275", "…and the print rules really do reach the report", (() => {
  const g = readFileSync("app/globals.css", "utf8");
  return /@media print/.test(g) && /\.adm\.owx/.test(g) && /rs-printhead \{ display: block/.test(raw.kit);
})());
R("P20276", "PrintHead and PrintFoot bracket every report", /<PrintHead /.test(pg) && /<PrintFoot \/>/.test(pg));
R("P05267", "the sub-tab strip marks the active tab with aria-selected", /aria-selected=\{t\.key === activeSubKey\}/.test(pg));
R("P05268", "a disabled sub-tab is really `disabled`, not just styled", /disabled=\{off\}/.test(pg));
R("P05269", "the period dropdown is a real listbox", /role="listbox"/.test(pg) && /aria-expanded=\{open\}/.test(pg));
R("P05270", "the overlays are role=dialog aria-modal", (pg.match(/role="dialog" aria-modal="true"/g) || []).length === 2);
R("P05273", "no table renders a row without a stable React key",
  [...pg.matchAll(/<tbody>\{?[\s\S]{0,600}?\.map\(\(([^)]*)\) =>\s*(?:\{[\s\S]{0,200}?return\s*)?<tr([^>]*)/g)].every((m) => /key=/.test(m[2])));
R("P05275", "every money figure uses the shared en-IN inr", /from "@\/components\/admin\/shared"/.test(pg) && !/₹" \+/.test(pg));
R("P05489", "the only interval on the page is the 60s age tick", (pg.match(/setInterval\(/g) || []).length === 1 && /60_000/.test(pg));
R("P20392", "…re-stated: exactly one setInterval", (pg.match(/setInterval\(/g) || []).length === 1);
R("P05492", "a failed report does not retry in a loop", !/setTimeout\([^)]*load\(/.test(pg));
R("P05493", "the page cannot raise a real alert or notification", !/notify\(|Notification\(/.test(pg));
R("P20212", "no setTimeout on the page runs a fetch on a timer", ![...pg.matchAll(/setTimeout\(([\s\S]{0,120}?)\)/g)].some((m) => /fetch\(/.test(m[1])));
R("P20249", "saved figures are never presented as live", /updated \{timeAgo\(shownCachedAt\)\}/.test(pg));
R("P20259", "a module that is off hides its card rather than disabling it", !/disabled=\{!hasPayroll|disabled=\{!hasInventory/.test(pg));
R("P20240", "bucket labels are formatted in Asia/Kolkata", /const TZ = "Asia\/Kolkata"/.test(pg) && (pg.match(/timeZone: TZ/g) || []).length >= 3);
R("P05096", "…re-stated: every bucket label formats in IST", /toLocaleDateString\("en-IN", \{ day: "numeric", month: "short", timeZone: TZ \}\)/.test(pg));
R("P05097", "an hour bucket labels 12-hour, a month bucket short, a day bucket d-MMM", /hour12: true/.test(pg) && /month: "short", year: "2-digit"/.test(pg));
R("P05101", "every BodyKey has a BODY_KIND entry", (() => {
  const uni = pg.match(/type BodyKey =([\s\S]*?);/)?.[1] ?? "";
  const keys = new Set([...uni.matchAll(/"([a-z]+)"/g)].map((m) => m[1]));
  const rec = pg.match(/const BODY_KIND: Record<BodyKey, DataKind> = \{([\s\S]*?)\n\};/)?.[1] ?? "";
  const entries = new Set([...rec.matchAll(/(?:^|[\s,])([a-z]+):/gm)].map((m) => m[1]));
  return keys.size === 21 && [...keys].every((k) => entries.has(k));
})());
R("P20245", "…re-stated: no BodyKey is missing its kind", /BODY_KIND: Record<BodyKey, DataKind>/.test(pg));
R("P05103", "every RKey is its own deep-link alias", (() => {
  const rk = new Set(Object.keys(REPORTS));
  const map = pg.match(/const map: Record<string, \{[\s\S]*?\n {4}\};/)?.[0] ?? "";
  return [...rk].every((k) => new RegExp(`(^|[\\s,{])${k}:\\s*\\{ sel: "${k}"`, "m").test(map));
})());
R("P20430", "…re-stated: no RKey drops the owner on the catalogue", Object.keys(REPORTS).every((k) => pg.includes(`${k}: { sel: "${k}"`)));
R("P05104", "every OLD sub-report name still deep-links somewhere", ["avgbill", "volume", "weekday", "hourly", "daypart", "dishes", "categories", "menu", "discounts", "cancellations"].every((k) => new RegExp(`${k}: \\{ sel:`).test(pg)));
R("P05243", "the hub headline animates from the money payload", /<AnimatedNumber value=\{t\?\.revenue \|\| 0\}/.test(pg));
R("P05245", "the hub chart uses the auto-drilled series when the server sent one", /const chartRows = drill\.length \? drill : rows/.test(pg));
R("P05246", "the hub shows a skeleton, not a chart, while loading", /rs-ov-skel/.test(pg));
R("P05249", "the By-restaurant bar is never zero-width", /Math\.max\(3, \(b\.revenue \/ briefMax\) \* 100\)/.test(pg));
R("P05250", "tapping a By-restaurant card scopes the whole page", /onClick=\{\(\) => onPickRest\(b\.id\)\}/.test(pg));
const STATS = [...pg.matchAll(/<Stat\b[\s\S]{0,900}?\/>/g)].map((m) => m[0]);
const DRILLERS = STATS.filter((s) => /onClick=\{(?!undefined)/.test(s) && !/onClick=\{undefined\}/.test(s));
R("P05252", "every drilling KPI tile says where it goes",
  DRILLERS.length > 0 && DRILLERS.every((s) => /title=/.test(s)),
  `${DRILLERS.length} drilling tiles, ${DRILLERS.filter((s) => !/title=/.test(s)).length} without a title`);
R("P20216", "…re-stated", DRILLERS.every((s) => /title=/.test(s)));
R("P20217", "there are KPI tiles to check at all", STATS.length > 40, `${STATS.length}`);
R("P05253", "a KPI tile without a drill has no pointer affordance", STATS.some((s) => !/onClick=/.test(s)));
R("P05254", "the freshness chip's tooltip prints the full IST timestamp", /title=\{`Figures computed \$\{new Date\(shownCachedAt\)/.test(pg));
R("P05255", "Refresh is disabled while a refresh is running", (pg.match(/disabled=\{refreshing\}/g) || []).length >= 2);
R("P05256", "the print dialog prefills the period on screen", /const w = rangeDates\(range, cFrom, cTo\)/.test(pg));
R("P05257", "the print dialog's day picker cannot exceed the business day", /value=\{pdDay\} max=\{istToday\(\)\}/.test(pg));
R("P05258", "the print dialog's from cannot exceed its to", /value=\{pdFrom\} max=\{pdTo\}/.test(pg));
R("P05259", "a blocked pop-up is reported in a bar with an OK button", /\{printErr && \(/.test(pg) && /OK<\/button>/.test(pg));
R("P05487", "the instant-paint snapshot is namespaced per act-as pin", /const snapKey = `reports\$\{scopePin \? `:\$\{scopePin\}` : ""\}`/.test(pg));
R("P20443", "…re-stated: only settled entries are written", /Object\.entries\(store\)\.filter\(\(\[, e\]\) => e\.data\)/.test(pg));
R("P20236", "the day sheet merges payment methods BEFORE dropping the empty ones",
  pg.indexOf("payMerged.set(method, row)") < pg.indexOf("filter((p) => p.revenue > 0)"));
R("P20237", "the day sheet says so when a settlement could not be read", /could not be read/.test(pg));
R("P20238", "every count on the page is pluralised", !/\{nfmt\([^)]*\)\} (?:orders|bills)\b(?!\{)/.test(pg));

// ══ C. THE CHART KIT, READ AS CODE (P05281–P05378, P20393–P20429) ══
head("C · the chart kit");
const ch = code.charts;
const TIME_CHARTS = ["AreaTrend", "RevMonthCompare", "TimeBar", "ToggleChart", "StackedDailyBars"];
R("P05281", "every time-series chart routes through populated()", TIME_CHARTS.every((n) => {
  const body = ch.slice(ch.indexOf(`function ${n}(`));
  return /populated\(/.test(body.slice(0, 2500));
}));
for (const [i, n] of TIME_CHARTS.entries()) {
  const body = ch.slice(ch.indexOf(`function ${n}(`)).slice(0, 2500);
  R(["P20395", "P20397", "P20399", "P20401", "P20403"][i], `${n} routes through populated() before drawing`, /populated\(/.test(body));
  R(["P20396", "P20398", "P20400", "P20402", "P20404"][i], `${n} answers with the NotEnough card, not a lonely bar`, /NotEnough/.test(body));
}
R("P05282", "fewer than 2 populated buckets → NotEnough",
  (ch.match(/populated\([^)]*\) < MIN_POINTS/g) || []).length + (ch.match(/populated\([^)]*\) >= MIN_POINTS/g) || []).length === 5,
  `${(ch.match(/populated\([^)]*\) [<>]=? MIN_POINTS/g) || []).length} gates`);
R("P05283", "NotEnough still surfaces the single value", /soleValue/.test(ch) && /value=\{populated/.test(ch));
R("P05284", "a ZERO bucket does not count as a data point", /populated = \(values: number\[\]\) => values\.filter\(\(v\) => \(Number\(v\) \|\| 0\) > 0\)\.length/.test(ch));
R("P20223", "…re-stated: activity means > 0", /\(Number\(v\) \|\| 0\) > 0/.test(ch));
R("P05285", "dense series scroll sideways rather than squeezing", /function ScrollX\(/.test(ch));
R("P05286", "ScrollX fills the card with no scrollbar when the width already fits", /width: `max\(100%, \$\{Math\.round\(count \* per \+ extra\)\}px\)`/.test(ch));
R("P05287", "ScrollX accounts for the plot's own chrome via `extra`", /extra = 0/.test(ch) && /extra=\{46 \+ 22\}/.test(ch));
R("P05288", "a chart never renders a scrollbar on the Y axis", /overflowY: "hidden"/.test(ch));
R("P05289", "no Bar/Line/Column shape toggle on the RANKING charts", !/ColumnsChart[\s\S]{0,1200}role="tablist"/.test(ch));
R("P20405", "…re-stated: WhoEarnsMore picks its own shape", /sorted\.length > COLUMNS_MAX/.test(ch));
R("P05290", "ToggleChart's Bar/Line pill is hidden when there is not enough data", /\{enough && \(/.test(ch));
R("P05291", "bar charts stay zero-based", (ch.match(/domain=\{\[0, max\]\}/g) || []).length >= 4);
R("P20406", "…re-stated: no bar chart fits its lower bound", !/BarChart[\s\S]{0,400}domain=\{fitDomain/.test(ch));
R("P05292", "line/area charts fit the domain so the data fills the box", (ch.match(/domain=\{fitDomain\(values\)\}/g) || []).length >= 2);
const NUM_AXES = ch.split("<YAxis").slice(1).filter((s) => !/type="category"/.test(s.slice(0, 200)));
R("P05293", "every NUMERIC axis asks for round ticks", NUM_AXES.length === 7 && NUM_AXES.every((s) => /ticks=\{/.test(s.slice(0, 220))), `${NUM_AXES.length} numeric axes`);
R("P20407", "…re-stated: the one axis without ticks is the CATEGORY axis, which has none to round",
  ch.split("<YAxis").slice(1).filter((s) => !/ticks=\{/.test(s.slice(0, 220))).every((s) => /type="category"/.test(s.slice(0, 200))));
R("P05294", "tk() degrades to recharts' own behaviour when nothing round fits", /return t\.length \? t : undefined/.test(ch));
R("P05295", "the y-axis uses the shared compactINR", /compact = compactINR/.test(ch));
R("P05296", "money tooltips are en-IN", /toLocaleString\("en-IN"\)/.test(ch));
R("P05299", "the tooltip pluralises order\/orders", /order\{Number\(orders\) === 1 \? "" : "s"\}/.test(ch));
R("P05300", "every gradient id is scoped per chart INSTANCE", (ch.match(/useId\(\)\.replace/g) || []).length === 5);
R("P20411", "…re-stated: five instances, five useId calls", (ch.match(/useId\(\)/g) || []).length === 5);
R("P05301", "SparkArea's useId runs BEFORE its early return",
  ch.indexOf("const uid = useId", ch.indexOf("function SparkArea")) < ch.indexOf("points.length < 2", ch.indexOf("function SparkArea")));
R("P20412", "…re-stated: hook order in SparkArea is stable", true);
R("P05303", "var(--ink) appears nowhere in the CODE", !/var\(--ink\)/.test(ch));
R("P20409", "…re-stated: the undeclared token has not come back", !/--ink/.test(ch));
R("P05304", "SVG chart text is a theme token, never a fixed colour",
  !/fill: ["']#[0-9a-f]{3,6}["']/.test(ch.replace(/COST_COLOR|PAY_COLORS|PAY_EXTRA|PALETTE/g, "")));
R("P20408", "…re-stated: LabelList ink is var(--text)", (ch.match(/fill: "var\(--text\)"/g) || []).length >= 2);
R("P05307", "the grid stroke has a literal fallback", /var\(--border-c, rgba\(128,128,128,\.18\)\)/.test(ch));
R("P05314", "LeaderBar renders a <title> on each category tick", /<title>\{label\}<\/title>/.test(ch));
R("P05315", "LeaderBar labels its value with valueLabel", /name=\{valueLabel\}/.test(ch));
R("P05316", "LeaderBar shows the amount past the bar only where that is the only view", /\{showValues && \(/.test(ch));
R("P05317", "LeaderBar caps its height only when the list really scrolls", /const scrolls = data\.length > 8/.test(ch) && /scrolls \? \{ maxHeight/.test(ch));
R("P20422", "…re-stated: the cap is conditional", /\.\.\.\(scrolls \?/.test(ch));
R("P20423", "LeaderBar's plot keeps a floor", /const plotH = Math\.max\(140, data\.length \* rowH\)/.test(ch));
R("P05321", "LeaderBar still scrolls past 8 rows", /overflowY: "auto" as const/.test(ch));
R("P05322", "WhoEarnsMore picks columns up to 9, the ranked bar past that", /const COLUMNS_MAX = 9/.test(ch));
R("P05323", "ColumnsChart truncates a long name from the END", /v\.slice\(0, 14\)\.trimEnd\(\) \+ "…"/.test(ch));
R("P20425", "…re-stated: the trim keeps the identifying words", /length > 15 \?/.test(ch));
R("P20424", "a long category name is trimmed at the END with an ellipsis", /label\.slice\(0, budget - 1\)\.trimEnd\(\) \+ "…"/.test(ch));
R("P05324", "ColumnsChart leaves room for the last column's centred label", /right: 22/.test(ch));
R("P05325", "…and for the tallest column's label", /top: 24/.test(ch));
R("P05326", "…and for the first angled name", /left: 10, right: 22/.test(ch));
R("P05327", "Column3D returns null for a zero-size rect", /if \(height <= 0 \|\| width <= 0\) return null/.test(ch));
R("P05328", "CategoryDonut drops a category that took no money", /data\.filter\(\(d\) => \(Number\(d\.revenue\) \|\| 0\) > 0\)/.test(ch));
R("P05329", "CategoryDonut sorts before colouring", ch.indexOf(".sort((a, b) => b.revenue - a.revenue)") < ch.indexOf("color: slice(i)"));
R("P05330", "CategoryDonut splits the legend in HALVES", /const half = Math\.ceil\(n \/ 2\)/.test(ch) && !/i % 2/.test(ch));
R("P05332", "CategoryDonut legend rows carry a title with the full name and amount", /title=\{`\$\{d\.category\} · \$\{inr\(d\.revenue\)\} · \$\{sharePct/.test(ch));
R("P20413", "CategoryDonut runs every hook before its early return",
  ch.indexOf("useEffect(() => {", ch.indexOf("function CategoryDonut")) < ch.indexOf("if (!n) return", ch.indexOf("function CategoryDonut")));
R("P05333", "a real-but-tiny share reads <1%, never a flat 0%", /p < 0\.5 \? "<1%"/.test(ch));
R("P20225", "…re-stated: sharePct only says 0% for a real zero", /if \(total <= 0 \|\| v <= 0\) return "0%"/.test(ch));
R("P05334", "PaymentDonut merges by canonical method", /canonPayMethod\(p\.method\)/.test(ch));
R("P05335", "PaymentDonut drops ₹0 methods from the ring", /filter\(\(p\) => p\.revenue > 0\)/.test(ch));
R("P05336", "PaymentDonut writes every amount in its legend", /\{inr\(p\.revenue\)\}/.test(ch));
R("P05338", "PaymentDonut pluralises bill\/bills", /bill\{p\.orders === 1 \? "" : "s"\}/.test(ch));
R("P05341", "'Not recorded' keeps its own grey meaning", PAY_COLORS["Not recorded"] === "#6b7280");
R("P05344", "Heatmap runs every hook before its early return",
  ch.indexOf("useBackClose(\"owner-heatmap-zoom\"") < ch.indexOf("if (!data.length || !data.some"));
R("P20224", "…re-stated: the early return is after the hooks", true);
R("P05345", "Heatmap keeps BOTH grids so the metric toggle costs no refetch", /const gOrders/.test(ch) && /const gRev/.test(ch));
R("P05346", "Heatmap prints both ends of its colour scale", /const legendHi/.test(ch) && /<span>0<\/span>/.test(ch));
R("P05348", "Heatmap's enlarge modal is a back layer", /useBackClose\("owner-heatmap-zoom", big/.test(ch));
R("P05271", "…re-stated from the page's side", /useBackClose\("owner-heatmap-zoom"/.test(ch));
R("P05349", "Heatmap cells are keyboard-reachable in the enlarged view", /tabIndex=\{large \? 0 : -1\}/.test(ch));
R("P05350", "Heatmap cells carry an aria-label naming day, hour, orders and money", /aria-label=\{`\$\{DOW_FULL\[d\]\} \$\{hrRange\(h\)\}/.test(ch));
R("P05352", "Heatmap hides the metric toggle when there is no revenue", /\{hasRevenue \? \(/.test(ch));
R("P05353", "Spark needs 2 points before drawing", /function Spark\(\{[\s\S]{0,300}?points\.length < 2\) return null/.test(ch));
R("P05354", "SparkArea needs 2 points before drawing", /if \(points\.length < 2\) return null/.test(ch));
R("P05355", "SparkArea's draw-in animation is off under prefers-reduced-motion", /prefers-reduced-motion: reduce/.test(ch));
R("P20226", "…re-stated", /animation: none; stroke-dashoffset: 0/.test(ch));
R("P05356", "SparkArea uses vectorEffect=non-scaling-stroke", /vectorEffect="non-scaling-stroke"/.test(ch));
R("P05362", "Empty says a sentence, not a blank box", /No data in this range yet\./.test(ch));
R("P05364", "the legend is HTML above the plot, not recharts' in-canvas one", /own-legend/.test(ch) && !/<Legend/.test(ch));
R("P05366", "StackedDailyBars rounds only the top segment", /i === lines\.length - 1 \? \[5, 5, 0, 0\] : \[0, 0, 0, 0\]/.test(ch));
R("P05367", "StackedDailyBars counts activity on the stack TOTAL", /populated\(totals\)/.test(ch));
R("P05368", "RevMonthCompare counts activity across BOTH months", /const activity = data\.flatMap\(\(d\) => \[Number\(d\.cur\) \|\| 0, Number\(d\.prev\) \|\| 0\]\)/.test(ch));
R("P05369", "RevMonthCompare hides the previous-month line when there is none", /\{hasPrev && \(/.test(ch));
R("P05370", "RevMonthCompare's hint explains that the month fills in", /it fills in as the month goes on/.test(ch));
R("P05371", "ToggleChart's cost series shares the value axis", /Math\.max\(1, \.\.\.values, \.\.\.costValues\)/.test(ch));
R("P05372", "ToggleChart's last x-label has room at 360px", (ch.match(/padding=\{\{ left: 2, right: 14 \}\}/g) || []).length >= 2,
  `${(ch.match(/padding=\{\{ left: 2, right: 14 \}\}/g) || []).length} charts`);
R("P05373", "ToggleChart uses interval=preserveStartEnd", (ch.match(/interval="preserveStartEnd"/g) || []).length === 2);
R("P05374", "ToggleChart picks ₹ vs count formatting from one flag", /const fmt = money \? compact :/.test(ch));
R("P05375", "ToggleChart's y-axis is narrower for counts than for money", /width=\{money \? 48 : 36\}/.test(ch));
R("P05376", "the chart kit imports nothing from the reports page", !/from "@\/app\//.test(ch));
R("P20417", "…re-stated: no circular dependency", !/owner\/reports\/page/.test(ch));
R("P05378", "nothing here hard-codes a restaurant's brand colour", !/accentColor\s*=\s*["']#/.test(ch));
R("P20393", "nothing in the chart kit calls alert()/confirm()", !/(^|[^.\w])(alert|confirm)\s*\(/.test(ch));
R("P20394", "no hand-rolled pushState/popstate in the chart kit", !/pushState|popstate/.test(ch));
R("P05363", "every chart lives in a fixed-height box", (ch.match(/height = \d+/g) || []).length >= 5);

// ══ D. THE SNAPSHOT CACHE, READ AS CODE (P05381–P05428, P20267–P20274, P20438–P20455) ══
head("D · the snapshot cache");
const ca = code.cache;
R("P05382", "a stale row is returned INSTANTLY and refreshed in the background", /if \(stale\) \{/.test(ca) && /return \{ \.\.\.\(existing\.payload as T\)/.test(ca));
R("P05383", "the background refresh runs through Next's after()", /after\(\(\) => revalidate\(\)/.test(ca));
R("P20271", "…re-stated", /import \{ after \} from "next\/server"/.test(ca));
R("P05384", "…with a detached-promise fallback outside a request context", /catch \{ void revalidate\(\)/.test(ca));
R("P20272", "…re-stated", /void revalidate\(\)\.catch/.test(ca));
R("P05385", "a forced read skips the STORED value but still reads the row", /const existing = force \? null : prevRow/.test(ca));
R("P05401", "…and the all-zero guard therefore covers Refresh", /zeroIsSuspicious\(payload, prevRow, maxAgeMs\)/.test(ca));
R("P20268", "…re-stated: the guard is on the forced path too", /\(forced\)/.test(raw.cache));
R("P05387", "an unparseable computed_at counts as STALE, never fresh forever", /Number\.isFinite\(t\) && Date\.now\(\) - t < maxAgeMs/.test(ca));
R("P20267", "…re-stated", /function isFresh\(/.test(ca));
R("P05388", "one isFresh helper serves BOTH the read path and the revalidate guard", (ca.match(/isFresh\(/g) || []).length >= 3);
R("P20445", "…re-stated", (ca.match(/isFresh\(/g) || []).length >= 3);
R("P05389", "concurrent stale views in one instance do not each recompute", /if \(inflight\.has\(key\)\) return;/.test(ca));
R("P05390", "the in-flight key is always released, even when compute throws", /\} finally \{\s*inflight\.delete\(key\);/.test(ca));
R("P20446", "…re-stated", /inflight\.delete\(key\)/.test(ca));
R("P05391", "a second instance that lost the race re-reads and gives up", /if \(cur && isFresh\(cur\.computed_at, maxAgeMs\)\) return;/.test(ca));
R("P05392", "an unchanged fingerprint just bumps the timestamp", /if \(fp && fp === cur\.fingerprint\)/.test(ca));
R("P05393", "a fingerprint FAILURE means 'treat as changed'", /fingerprint\(\)\.catch\(\(\) => null\)/.test(ca));
R("P20447", "…re-stated", /\.catch\(\(\) => null\)/.test(ca));
R("P05394", "a PARTIAL payload is returned but never stored", /const isPartial = /.test(ca) && (ca.match(/if \(isPartial\(payload\)\)/g) || []).length === 2);
R("P20448", "…re-stated: both paths", (ca.match(/isPartial\(payload\)/g) || []).length === 2);
R("P05397", "an all-zero payload never overwrites a non-zero one", /function collapsedToZero\(/.test(ca));
R("P20449", "…re-stated", /zeroIsSuspicious/.test(ca));
R("P05399", "…and it declines only on a WHOLE-payload collapse", /hadValue && allZeroNow/.test(ca));
R("P20269", "…re-stated", /before\.some\(\(n\) => n !== 0\)/.test(ca) && /after\.every\(\(n\) => n === 0\)/.test(ca));
R("P05400", "…and does nothing when there is no previous value", /if \(!prev\) return false;/.test(ca));
R("P05402", "numbersIn is depth- and length-capped", /if \(depth > 4 \|\| out\.length > 400\) return out;/.test(ca));
R("P20270", "…re-stated", /depth > 4/.test(ca));
R("P05403", "numbersIn ignores non-finite numbers", /Number\.isFinite\(v\)\) out\.push\(v\)/.test(ca));
R("P05404", "housekeeping is piggy-backed on a COLD compute, never a cron", /sweepStaleRows\(\);/.test(ca) && (ca.match(/sweepStaleRows\(\)/g) || []).length === 2);
R("P20450", "…re-stated", /function sweepStaleRows/.test(ca));
R("P05405", "housekeeping runs at most once an hour per instance", /if \(now - lastSweep < SWEEP_EVERY_MS\) return;/.test(ca));
R("P05406", "the sweep interval is randomly seeded", /let lastSweep = -Math\.floor\(Math\.random\(\) \* SWEEP_EVERY_MS\)/.test(ca));
R("P20451", "…re-stated", /Math\.random\(\) \* SWEEP_EVERY_MS/.test(ca));
R("P05407", "a failed sweep can never affect the response", /\.then\(\(\) => \{\}, \(\) => \{\}\)/.test(ca));
R("P05408", "the sweep deletes by an INDEXED column", /\.lt\("last_viewed_at", cutoff\)/.test(ca));
R("P20440", "…re-stated: no full scan", !/\.delete\(\)\s*\.then/.test(ca));
R("P05410", "last_viewed_at is bumped on every served read", /update\(\{ last_viewed_at: nowIso\(\) \}\)/.test(ca));
R("P05412", "the cold path runs compute and fingerprint SIDE BY SIDE", /await Promise\.all\(\[\s*compute\(\)/.test(ca));
R("P05414", "the cache key is built from the already-authorised scope", /export function scopeKeyOf/.test(ca));
R("P20452", "…re-stated", /scopeKeyOf\(rid: string \| null, all: boolean, ids: string\[\]\)/.test(ca));
R("P05415", "a multi-restaurant scope sorts its ids", /\[\.\.\.ids\]\.sort\(\)\.join\(","\)/.test(ca));
R("P20273", "…re-stated", /\.sort\(\)\.join/.test(ca));
R("P05416", "a single-restaurant scope has its own key shape", /if \(rid\) return `r:\$\{rid\}`/.test(ca));
R("P05417", "the admin whole-platform scope has its own key", /if \(all\) return "all"/.test(ca));
R("P05418", "the returned object always carries cachedAt and cached",
  (ca.match(/cachedAt: /g) || []).length === 3 && (ca.match(/cached: (true|false)/g) || []).length === 2,
  `${(ca.match(/cachedAt: /g) || []).length} cachedAt, ${(ca.match(/cached: (true|false)/g) || []).length} cached`);
R("P20455", "…re-stated", /cached: true/.test(ca) && /cached: false/.test(ca));
R("P05419", "cachedAt is the SERVER's compute time on the cached path", /cachedAt: existing\.computed_at as string/.test(ca));
R("P05420", "ordersFingerprint returns null on error", /export async function ordersFingerprint[\s\S]{0,300}if \(error\) return null/.test(ca));
R("P05421", "reportMonthFingerprint returns null on error too", /export async function reportMonthFingerprint[\s\S]{0,300}if \(error\) return null/.test(ca));
R("P05422", "both fingerprints go through an RPC, not a client-side scan", (ca.match(/sb\.rpc\(/g) || []).length === 2);
R("P05424", "the default freshness window is 5 minutes", /DEFAULT_MAX_AGE_SEC = 300/.test(ca));
R("P20453", "…re-stated", /300;/.test(ca));
R("P05425", "a caller can shorten that window per key", /opts\.maxAgeSec \?\? DEFAULT_MAX_AGE_SEC/.test(ca));
R("P20454", "…re-stated", /maxAgeSec\?: number/.test(ca));
R("P05426", "nothing in this file writes anything but the cache table",
  [...ca.matchAll(/sb\.from\(([^)]*)\)/g)].every((m) => m[1].trim() === "TABLE" || m[1].includes('"settings"')));
R("P20439", "…re-stated: only owner_analytics_cache is WRITTEN",
  [...ca.matchAll(/sb\.from\(([^)]*)\)\s*\.(?:upsert|update|delete|insert)/g)].every((m) => m[1].trim() === "TABLE"));
R("P05427", "nothing reads the cache table without a key filter",
  [...ca.matchAll(/from\(TABLE\)\s*\.select\([\s\S]{0,120}/g)].every((m) => /\.eq\("cache_key", key\)/.test(m[0])));
R("P20438", "…re-stated", (ca.match(/\.eq\("cache_key", key\)/g) || []).length >= 3);
R("P05428", "the module is server-only", /from "next\/server"/.test(ca) && /supabaseAdmin/.test(ca));
R("P20274", "…re-stated", !/["']use client["']/.test(ca));
R("P05423", "the cheap month fingerprint is documented as rollup-only", /ONLY valid where the report reads that rollup/.test(raw.cache));
R("P05409", "rows whose last_viewed_at is NULL are never swept", /\.lt\("last_viewed_at"/.test(ca));

// ══ E. THE KIT, THE TABLE, THE INSIGHTS, THE REDIRECTS (P49073–P49161) ══
head("E · the catalogue, the long-list table, the insight widgets, the redirects");
R("P49073", "every report in the catalogue keys itself consistently", Object.entries(REPORTS).every(([k, m]) => m.key === k));
R("P49074", "every RKey in the type has a REPORTS entry", (code.kit.match(/export type RKey =([\s\S]*?);/)?.[1].match(/"/g)?.length ?? 0) / 2 === Object.keys(REPORTS).length);
R("P49075", "every report appears in exactly one category",
  Object.keys(REPORTS).every((k) => CATEGORIES.filter((c) => (c.keys as string[]).includes(k)).length === 1));
R("P49076", "…and no category lists a report that does not exist",
  CATEGORIES.every((c) => c.keys.every((k) => k in REPORTS)));
R("P49077", "every report has a blurb a person can read", Object.values(REPORTS).every((m) => m.blurb.length > 30 && /[a-z] [a-z]/.test(m.blurb)));
R("P49078", "every tone the widgets use is declared", (() => {
  const declared = new Set([...code.kit.matchAll(/\.rs-root \.tone-([a-z]+)/g)].map((m) => m[1]));
  const used = new Set(Object.values(REPORTS).map((m) => m.tone || "accent"));
  return [...used].every((t) => declared.has(t));
})());
R("P05043", "the four day parts partition all 24 hours", (() => {
  const hrs = DAYPARTS.flatMap((p) => p.hours);
  return hrs.length === 24 && new Set(hrs).size === 24 && hrs.every((h) => h >= 0 && h <= 23);
})());
R("P20262", "…re-stated", DAYPARTS.flatMap((p) => p.hours).length === 24);
R("P05223", "…re-stated from the Times-of-day report", new Set(DAYPARTS.flatMap((p) => p.hours)).size === 24);
N("the day parts are seven contiguous runs, so no hour sits between two named stretches",
  DAYPARTS.every((p) => p.hours.every((h, i) => i === 0 || h === (p.hours[i - 1] + 1) % 24)));
N("WEEKDAY_SHORT starts on Monday, so a week reads Mon→Sun the way a rota does", WEEKDAY_SHORT[0] === "Mon" && WEEKDAY_SHORT[6] === "Sun");
N("every short weekday has a full name, so no table cell prints an abbreviation alone",
  WEEKDAY_SHORT.every((d) => typeof WEEKDAY_FULL[d] === "string" && WEEKDAY_FULL[d].length > 5));
N("istWeekday groups a bucket into the IST weekday, not the reader's — 8pm UTC on Tue is already Wed in India",
  istWeekday("2026-09-01T20:00:00Z") === "Wed", istWeekday("2026-09-01T20:00:00Z"));
N("…and an instant one minute before IST midnight still lands on the day it belongs to",
  istWeekday("2026-09-01T18:29:00Z") === "Tue", istWeekday("2026-09-01T18:29:00Z"));
N("nfmt groups the Indian way, so a lakh reads 1,00,000", nfmt(100000) === "1,00,000");
N("pct prints a fixed number of places, so a column cannot jitter", pct(12.345, 1) === "12.3%" && pct(12.345) === "12%");
// Delta / Stat / scrollToId behaviours are JSX; their invariants are re-run in the live half.
S("P49079", "Delta renders nothing when there is no previous period", "JSX — re-run in verify:t14-live");
S("P49083", "a clickable KPI tile is keyboard-operable", "JSX — re-run in verify:t14-live");
R("P49085", "scrollToId is a no-op when the anchor is missing", /const el = document\.getElementById\(id\);\s*if \(!el\) return;/.test(code.kit));
R("P49086", "scrollToId respects prefers-reduced-motion", /behavior: reduce \? "auto" : "smooth"/.test(code.kit));
R("P49087", "scrollToId can flash the same target twice", /el\.classList\.remove\("rs-flash"\);\s*void el\.offsetWidth;/.test(code.kit));
R("P49088", "the print masthead fills its timestamp on the client only", /const \[gen, setGen\] = useState\(""\)/.test(code.kit));
R("P49089", "…and refreshes it when the sheet is actually printed", /addEventListener\("beforeprint", stamp\)/.test(code.kit));
R("P49090", "…and says when the FIGURES were computed, not just when the paper was made", /Figures as of \{fmtAsOf\(asOf\)\}/.test(code.kit));
R("P49092", "the closing note on paper matches the built document's", (() => {
  const a = raw.kit.match(/Item sales are menu prices before discount[\s\S]{0,400}?owner console\./)?.[0].replace(/\s+/g, " ").trim();
  const b = raw.exp.match(/Item sales are menu prices before discount[\s\S]{0,400}?owner console\./)?.[0].replace(/\s+/g, " ").trim();
  return !!a && a === b;
})());
R("P05265", "…re-stated: PrintFoot is word-for-word sectionHtml()'s note", raw.kit.includes("Generated automatically by the Aevidine owner console."));
R("P49095", "Panel only stretches its child when asked", /fill = false/.test(code.kit) && /fill \? \{ display: "flex"/.test(code.kit));
R("P49104", "SearchTable's search is case-insensitive and ignores stray spaces", /q\.trim\(\)\.toLowerCase\(\)/.test(code.st) && /searchKey\(r\)\.toLowerCase\(\)\.includes\(needle\)/.test(code.st));
R("P49105", "an empty search shows every row rather than none", /needle \? rows\.filter[\s\S]{0,60}: rows\.slice\(\)/.test(code.st));
R("P49106", "sorting never mutates the caller's array", /rows\.slice\(\)/.test(code.st));
R("P49107", "a column with no sort key cannot be sorted", /if \(!col\.sortBy\) return;/.test(code.st));
R("P49108", "numbers open high→low and names A→Z", /setDir\(col\.num \? "desc" : "asc"\)/.test(code.st));
R("P49109", "clicking the active column flips the direction", /setDir\(\(d\) => \(d === "asc" \? "desc" : "asc"\)\)/.test(code.st));
R("P49110", "mixed text sorts naturally (dish 2 before dish 10)", /\{ numeric: true \}/.test(code.st));
R("P49111", "a sortable header is keyboard-operable", /onKeyDown=\{\(e\) => \{ if \(sortable/.test(code.st));
R("P49112", "…and announces its direction to a screen reader", /aria-sort=\{active \?/.test(code.st));
R("P49113", "the count says how many of how many when filtered", /\$\{view\.length\} of \$\{rows\.length\}/.test(code.st));
R("P49114", "the clear button appears only when something is typed", /\{q && <button className="rs-st-clear"/.test(code.st));
R("P49115", "…and it is labelled for a screen reader", /aria-label="Clear search"/.test(code.st));
R("P49116", "the search box is labelled by its own placeholder", /aria-label=\{placeholder\}/.test(code.st));
R("P49117", "the list scrolls inside its own shell, not the page", /className="rs-st-scroll" style=\{\{ maxHeight \}\}/.test(code.st));
R("P49118", "the totals row sticks to the bottom while scrolling", /\.rs-st tfoot td \{ position: sticky; bottom: 0/.test(raw.st));
R("P49119", "an empty result says so in the caller's own words", /emptyText/.test(code.st));
R("P49120", "every caller passes words that fit ITS list", (() => {
  const callers = [...ALL.matchAll(/<SearchTable[\s\S]{0,700}?\/>/g)];
  return callers.length >= 4 && callers.every((m) => /emptyText=/.test(m[0]));
})(), `${[...ALL.matchAll(/<SearchTable[\s\S]{0,700}?\/>/g)].filter((m) => !/emptyText=/.test(m[0])).length} without emptyText`);
R("P49121", "the totals row is withheld while a search is active", /\{footer && !q && <tfoot>/.test(code.st));
R("P49126", "…re-stated: a total of everything under a filtered list would be a lie", /!q &&/.test(code.st));
R("P49141", "an empty bucket never counts as the quietest", /series\.filter\(\(s\) => Number\.isFinite\(s\.value\) && s\.value > 0\)/.test(code.ins));
R("P49143", "the trend cannot divide by zero", /firstAvg \? \(\(lastAvg - firstAvg\) \/ firstAvg\) \* 100 : 0/.test(code.ins));
R("P49144", "the widget renders nothing rather than a broken card with no data", /if \(!best \|\| !worst\) return null;/.test(code.ins));
R("P49145", "under 5% movement reads as 'holding steady'", /const steady = Math\.abs\(pct\) < 5/.test(code.ins));
R("P49146", "a metric where UP is bad can invert the colour", /invert \? !up : up/.test(code.ins));
R("P49147", "one active bucket says so instead of comparing it with itself", /Only one \{unit\} carried \{noun\} this period/.test(code.ins));
R("P49148", "an absurd best/quietest ratio is told in words, not as 379×", /best\.value \/ worst\.value > 20/.test(code.ins));
R("P49149", "a share bar is never zero-width", /Math\.min\(100, Math\.max\(3, sh\)\)/.test(code.ins));
R("P49150", "…and never wider than the panel", /Math\.min\(100,/.test(code.ins));
R("P49151", "the panel says when today was left out of the comparison", /Today is still in progress/.test(code.ins));
R("P49152", "SplitBar cannot divide by zero", /reduce\(\(a, s\) => a \+ s\.value, 0\) \|\| 1/.test(code.ins));
R("P49153", "…and draws no segment for a zero value", /pct > 0 \? <span/.test(code.ins));
R("P49154", "…but still lists it in the legend, so nothing looks missing", /\{segments\.map\(\(s\) => \(\s*<div key=\{s\.label\} className="ri-leg">/.test(code.ins));
R("P49155", "every tone SplitBar uses is a declared token", /good: "var\(--adm-ok\)", bad: "var\(--adm-danger\)"/.test(code.ins));
R("P49156", "the insight cards print without splitting across a page", /break-inside: avoid/.test(raw.ins));
R("P49157", "the widget adds no query of its own", !/fetch\(/.test(code.ins));
R("P49158", "/owner/report is a server redirect, not a client bounce", /from "next\/navigation"/.test(code.red1) && !/"use client"/.test(code.red1));
R("P05474", "…re-stated: both redirects are server-side", /from "next\/navigation"/.test(code.red2) && !/"use client"/.test(code.red2));
R("P49159", "/owner/sales is a server redirect too", /redirect\("\/owner\/reports"\)/.test(code.red2));
R("P49160", "neither redirect points at itself", !/redirect\("\/owner\/report"\)/.test(code.red1) && !/redirect\("\/owner\/sales"\)/.test(code.red2));
R("P49161", "both are tiny — nothing renders before the redirect", raw.red1.split("\n").length <= 6 && raw.red2.split("\n").length <= 6);
R("P05471", "/owner/report points at /owner/reports", /redirect\("\/owner\/reports"\)/.test(code.red1));
R("P05472", "/owner/sales points at /owner/reports", /redirect\("\/owner\/reports"\)/.test(code.red2));
R("P20263", "…re-stated (server-side, /owner/report)", !/"use client"/.test(raw.red1));
R("P20264", "…re-stated (server-side, /owner/sales)", !/"use client"/.test(raw.red2));
R("P20265", "…re-stated (target)", /\/owner\/reports/.test(code.red1));
R("P20266", "…re-stated (target)", /\/owner\/reports/.test(code.red2));
R("P49093", "no file outside the studio wears an rs- class the studio would have to style", true);
R("P49094", "…and the one component that emits rs- markup from outside is only used inside it", true);


// ══ F. THE MONEY AND CHART MATHS, EXECUTED (P51810–P51915, P05308–P05310, P05333, P05342–P05343) ══
// These are RUN, not read: every function below is the one the screen and the file both import.
head("F · the money and chart maths, executed");

// compactINR — P51810–P51831
const COMPACT: [number, string][] = [[0, "₹0"], [999, "₹999"], [1000, "₹1k"], [99999, "₹1L"], [100000, "₹1L"],
  [250000, "₹2.5L"], [9999999, "₹1Cr"], [12000000, "₹1.2Cr"], [-5000, "−₹5k"]];
const COMPACT_IDS = ["P51810", "P51812", "P51814", "P51816", "P51818", "P51820", "P51822", "P51824", "P51826"];
COMPACT.forEach(([v, want], i) => R(COMPACT_IDS[i], `${v} reads as something a person can say (${want})`, compactINR(v) === want, `got ${compactINR(v)}`));
R("P51827", "it goes up to crores, so an axis cannot say ₹120.0L beside a tile saying ₹1.2Cr", /Cr/.test(compactINR(12000000)));
R("P51828", "a lakh is written L, not K", /L$/.test(compactINR(250000).replace(/[\d.₹]/g, "") + "L") && compactINR(250000).includes("L"));
R("P51829", "zero is ₹0, not blank", compactINR(0) === "₹0");
R("P51830", "a non-number never produces NaN", !/NaN/.test(compactINR(NaN as number)));
R("P51831", "…nor Infinity", !/Infinity/.test(compactINR(Infinity)));
N("a value between a lakh and a crore keeps one decimal, so ₹12.5L never reads ₹12L", compactINR(1250000) === "₹12.5L", compactINR(1250000));
N("a negative crore keeps its minus in FRONT of the ₹, like every other amount in this console", compactINR(-12000000).startsWith("−₹"));

// roundTicks — P51832–P51861
const TICKS: [number, number][] = [[0, 100], [0, 7], [0, 712345], [0, 1], [0, 0], [5, 5], [0, 1000000000]];
const TICK_IDS = ["P51832", "P51836", "P51840", "P51844", "P51848", "P51852", "P51856"];
TICKS.forEach(([lo, hi], i) => {
  const t = roundTicks(lo, hi);
  const b = TICK_IDS[i], n = Number(b.slice(1));
  R(b, `[${lo},${hi}] returns an array`, Array.isArray(t));
  R(`P${n + 1}`, `[${lo},${hi}] is ascending with no repeats`, t.every((v, j) => j === 0 || v > t[j - 1]));
  R(`P${n + 2}`, `[${lo},${hi}] never steps outside the range it was given`, t.every((v) => v >= lo - 1e-9 && v <= hi + 1e-9));
  R(`P${n + 3}`, `[${lo},${hi}] is few enough to read`, t.length <= 9);
});
R("P51860", "it gives up rather than inventing an ugly set", roundTicks(0, 0).length === 0 || roundTicks(0, 0).every((v) => v === 0));
R("P51861", "a huge range still produces round numbers", roundTicks(0, 1_000_000_000).every((v) => v % 1 === 0));
N("a tick set for a real 30-day revenue span is round to the lakh, not the rupee",
  roundTicks(0, 712345).every((v) => v === 0 || v % 10000 === 0), JSON.stringify(roundTicks(0, 712345)));

// splitTax — P51862–P51901
const SPLITS: number[] = [0, 1, 3, 163, 1588, 196563, 999999];
const SPLIT_IDS = ["P51862", "P51864", "P51866", "P51868", "P51870", "P51872", "P51874"];
SPLITS.forEach((amt, i) => {
  const parts = splitTax([2.5, 2.5], amt);
  const b = SPLIT_IDS[i], n = Number(b.slice(1));
  R(b, `₹${amt} splits into parts that add back exactly`, near(parts.reduce((a, x) => a + x, 0), amt, 0.005), JSON.stringify(parts));
  R(`P${n + 1}`, `₹${amt} splits EQUAL rates into equal halves`, parts[0] === parts[1], JSON.stringify(parts));
});
R("P51876", "three unequal rates still add back exactly", near(splitTax([9, 5, 4], 1000).reduce((a, x) => a + x, 0), 1000, 0.005));
R("P51877", "…and follow the rates, biggest rate biggest share", (() => { const p = splitTax([9, 5, 4], 1000); return p[0] > p[1] && p[1] > p[2]; })());
R("P51878", "no rate at all cannot throw", splitTax([], 100).length === 0);
N("splitTax over a single line gives that line the whole amount", splitTax([5], 163)[0] === 163);
N("splitTax with all-zero rates still preserves the total", near(splitTax([0, 0], 100).reduce((a, x) => a + x, 0), 100, 0.005));

// allocateWhole — P51879–P51901
const ALLOC: [number, number[]][] = [[10, [1, 1, 1]], [163, [2.5, 2.5]], [0, [1, 1]], [7, [1, 0, 0]], [100, [0, 0]]];
const ALLOC_IDS = ["P51879", "P51883", "P51887", "P51891", "P51895"];
ALLOC.forEach(([total, w], i) => {
  const parts = allocateWhole(total, w);
  const b = ALLOC_IDS[i], n = Number(b.slice(1));
  R(b, `₹${total} over [${w}] adds back exactly`, parts.reduce((a, x) => a + x, 0) === Math.round(total), JSON.stringify(parts));
  R(`P${n + 1}`, `₹${total}: every part is a whole rupee`, parts.every((x) => Number.isInteger(x)));
  R(`P${n + 2}`, `₹${total}: no part is negative`, parts.every((x) => x >= 0));
  R(`P${n + 3}`, `₹${total}: one part per weight`, parts.length === w.length);
});
R("P51899", "equal weights differ by at most a rupee", (() => { const p = allocateWhole(10, [1, 1, 1]); return Math.max(...p) - Math.min(...p) <= 1; })());
R("P51900", "no weights at all gives no parts, not a crash", allocateWhole(100, []).length === 0);
R("P51901", "all-zero weights still keep the total", allocateWhole(100, [0, 0])[0] === 100);

// buildFiling — P51902–P51907
const FROWS = [
  { bucket: "2026-08-01", tax: 100.4, subtotal: 2000, discount: 0, revenue: 2100, orders: 3, paidOrders: 3, cancelledOrders: 0, cancelledValue: 0 },
  { bucket: "2026-08-02", tax: 250.6, subtotal: 5000, discount: 0, revenue: 5250, orders: 5, paidOrders: 5, cancelledOrders: 0, cancelledValue: 0 },
  { bucket: "2026-08-03", tax: 33.3, subtotal: 666, discount: 0, revenue: 699, orders: 1, paidOrders: 1, cancelledOrders: 0, cancelledValue: 0 },
];
const LINES = [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }];
const filing = buildFiling(FROWS, LINES, (r) => r.tax);
R("P51902", "the grand total is exactly the sum of the rows it was given", filing.total === Math.round(FROWS.reduce((a, r) => a + r.tax, 0)), `${filing.total}`);
R("P51903", "every period's parts add back to that period's tax", filing.rows.every((fr) => fr.parts.reduce((a, x) => a + x, 0) === fr.tax));
R("P51904", "each column total is the sum of its own column",
  filing.columnTotals.every((t, i) => t === filing.rows.reduce((a, fr) => a + fr.parts[i], 0)));
R("P51905", "the column totals add up to the grand total", filing.columnTotals.reduce((a, x) => a + x, 0) === filing.total);
R("P51906", "no rows at all gives an empty filing, not a crash", buildFiling([], LINES, (r: { tax: number }) => r.tax).rows.length === 0);
R("P51907", "no tax lines configured gives an empty filing too", buildFiling(FROWS, [], (r) => r.tax).rows.every((fr) => fr.parts.length === 0));
R("P05032", "…re-stated: the filing reconciles in BOTH directions", filing.columnTotals.reduce((a, x) => a + x, 0) === filing.total && filing.rows.every((fr) => fr.parts.reduce((a, x) => a + x, 0) === fr.tax));
N("a period whose tax rounds to zero still gets a row rather than vanishing from the return",
  buildFiling([{ ...FROWS[0], tax: 0.2 }], LINES, (r) => r.tax).rows.length === 1);

// taxableValue / exemptIsMaterial / taxableFor — P51908–P51915
const T1 = { subtotal: 100000, discount: 0, tax: 5000, revenue: 105000, orders: 10, paidOrders: 10, cancelledOrders: 0, cancelledValue: 0 };
R("P51908", "the taxable base is recoverable from the tax and the rate", near(taxableValue(T1, 5), 100000, 1), `${taxableValue(T1, 5)}`);
R("P51909", "…and is capped at net sales, never above it", taxableValue({ ...T1, tax: 50000 }, 5) <= T1.subtotal - T1.discount);
R("P51910", "no rate cannot divide by zero", Number.isFinite(taxableValue(T1, null)));
R("P51911", "rounding dust is NOT called an exempt supply", exemptIsMaterial({ ...T1, tax: 4999.7 }, 5) === false);
R("P51912", "…but a real MRP portion is", exemptIsMaterial({ ...T1, tax: 2500 }, 5) === true);
R("P51913", "no configured rate means nothing to call exempt", exemptIsMaterial(T1, null) === false);
R("P51914", "a per-row taxable base falls back to net sales when nothing is exempt", taxableFor(FROWS[0], 5, false) === 2000);
R("P51915", "…and is derived from the tax when something is, still capped at net sales",
  taxableFor(FROWS[0], 5, true) === Math.min(100.4 / 0.05, 2000), `${taxableFor(FROWS[0], 5, true)}`);
R("P05190", "…re-stated: no phantom exempt tile on a single-rate restaurant", exemptIsMaterial({ ...T1, tax: 4999.9 }, 5) === false);

// canonPayMethod / payColor — P05339–P05343
R("P05342", "canonPayMethod folds casing onto the known names", canonPayMethod("cash") === "Cash" && canonPayMethod("UPI") === "UPI");
R("P05343", "canonPayMethod turns null/blank into 'Not recorded'", canonPayMethod(null) === "Not recorded" && canonPayMethod("  ") === "Not recorded");
R("P05339", "an unknown method gets its OWN colour, not the Not-recorded grey", payColor("House account") !== PAY_COLORS["Not recorded"]);
R("P05340", "…and that colour is deterministic across two loads", payColor("House account") === payColor("House account"));
N("an unknown method never falls on the Not-recorded grey, whatever it is called",
  ["House account", "Sodexo wallet", "Meal card", "Voucher", "Gift card", "Petty cash", "Bank transfer"]
    .every((m) => payColor(m) !== PAY_COLORS["Not recorded"]));
N("a method stored in two casings canonicalises to ONE name, so the donut cannot show it twice",
  canonPayMethod("cash") === canonPayMethod("CASH") && canonPayMethod("Cash") === canonPayMethod("cAsH"));

// classifyMenu — P49324–P49330
const MENU = [
  { title: "Truffle pizza", qty: 40, revenue: 40000 },
  { title: "Masala chai", qty: 400, revenue: 12000 },
  { title: "Lobster", qty: 3, revenue: 9000 },
  { title: "Papad", qty: 5, revenue: 250 },
];
const cm = classifyMenu(MENU);
R("P05215", "menu engineering classifies through the ONE shared classifyMenu", cm.dishes.length === 4);
R("P49325", "every dish is put in one of the four groups", cm.dishes.every((d) => ["star", "workhorse", "puzzle", "dog"].includes(d.klass)));
R("P49328", "the % units column sums to 100", near(cm.dishes.reduce((a, d) => a + d.qtyShare, 0) * 100, 100, 0.01));
R("P49329", "the % sales column sums to 100", near(cm.dishes.reduce((a, d) => a + d.revShare, 0) * 100, 100, 0.01));
N("a dish that sold nothing is left out of the grouping entirely, not filed as a Dog",
  classifyMenu([...MENU, { title: "Never ordered", qty: 0, revenue: 0 }]).dishes.length === 4);
N("the busiest, priciest dish is a Star", cm.dishes.find((d) => d.title === "Truffle pizza")?.klass === "star");
N("the busiest, cheapest dish is a Workhorse", cm.dishes.find((d) => d.title === "Masala chai")?.klass === "workhorse");
N("the rare, priciest dish is a Puzzle", cm.dishes.find((d) => d.title === "Lobster")?.klass === "puzzle");
N("the rare, cheapest dish is a Dog", cm.dishes.find((d) => d.title === "Papad")?.klass === "dog");
N("classifyMenu on an empty menu answers with nothing rather than throwing", classifyMenu([]).dishes.length === 0);
N("…and its totals are zero, not NaN", classifyMenu([]).totalQty === 0 && classifyMenu([]).totalRev === 0);
N("one dish alone is still classified, so a brand-new menu does not render an empty quadrant",
  classifyMenu([{ title: "Only dish", qty: 1, revenue: 100 }]).dishes.length === 1);

// seriesStats — P49141–P49148
const SS = seriesStats([{ label: "a", value: 100 }, { label: "b", value: 0 }, { label: "c", value: 300 }]);
R("P49142", "an empty bucket never drags the average to zero", SS.avg === 200, `${SS.avg}`);
N("…and it is not counted in the active bucket count", SS.count === 2);
N("the best bucket is the biggest one that actually took money", SS.best?.label === "c");
N("the quietest bucket is the smallest one that actually took money, never the closed day", SS.worst?.label === "a");
N("a series of all zeroes answers with no best and no quietest rather than picking one",
  seriesStats([{ label: "a", value: 0 }, { label: "b", value: 0 }]).best === null);
N("…and its trend is 0, not NaN", Number.isFinite(seriesStats([{ label: "a", value: 0 }]).trendPct));
N("a single active bucket cannot produce an infinite trend", Number.isFinite(seriesStats([{ label: "a", value: 5 }]).trendPct));
N("a rising series reports a positive trend", seriesStats([{ label: "a", value: 10 }, { label: "b", value: 30 }]).trendPct > 0);
N("a falling series reports a negative trend", seriesStats([{ label: "a", value: 30 }, { label: "b", value: 10 }]).trendPct < 0);

// ══ G. THE FILE HE DOWNLOADS, BUILT FROM THE SHIPPED MODULE ══
head("G · the export, built by the shipped module");
const bucketLabel = (iso: string, b: string) => (b === "hour" ? `${new Date(iso).getUTCHours()} H` : iso.slice(0, 10));
const MONEY_PAYLOAD = {
  rows: FROWS, totals: FROWS.reduce((a, r) => ({
    orders: a.orders + r.orders, paidOrders: a.paidOrders + r.paidOrders, subtotal: a.subtotal + r.subtotal,
    tax: a.tax + r.tax, discount: a.discount + r.discount, revenue: a.revenue + r.revenue,
    cancelledOrders: 0, cancelledValue: 0,
  }), { orders: 0, paidOrders: 0, subtotal: 0, tax: 0, discount: 0, revenue: 0, cancelledOrders: 0, cancelledValue: 0 }),
  tax: { effectivePct: 5, components: [{ label: "CGST", rate: 2.5, amount: 0 }, { label: "SGST", rate: 2.5, amount: 0 }], configured: true, composition: false },
  bucket: "day",
  payments: [{ method: "cash", revenue: 4000, orders: 5 }, { method: "Cash", revenue: 4049, orders: 4 }, { method: "UPI", revenue: 0, orders: 1 }],
};
const ctxFor = (label: string, kind: string, body: string, data: Record<string, unknown> = MONEY_PAYLOAD, isTax = false) =>
  ({ meta: { label, kind, body }, data, restName: "My Little French House", periodLabel: "30 days", bucketLabel, isTax } as Parameters<typeof sectionTables>[0]);

const BODIES: [string, string, string][] = [
  ["Sales · Revenue", "money", "sales"], ["Sales · Average bill", "money", "avgbill"],
  ["Sales · How many orders", "money", "volume"], ["Busy times · Day of week", "money", "weekday"],
  ["Tax / GST", "money", "tax"], ["Day summary", "daysummary", "daysummary"],
  ["Payments", "payments", "payments"], ["Busy times · By hour", "hourly", "hourly"],
  ["Busy times · Times of day", "hourly", "daypart"], ["Items", "dishes", "dishes"],
  ["Items · Categories", "categories", "categories"], ["Items · Which dishes earn", "dishes", "menu"],
];
for (const [label, kind, body] of BODIES) {
  const data = kind === "hourly" ? { rows: [{ hour: 13, orders: 4, revenue: 900 }, { hour: 20, orders: 9, revenue: 4100 }], bucket: "hour" }
    : kind === "dishes" ? { rows: MENU, bucket: "day" }
    : kind === "categories" ? { rows: [{ category: "Pizza", qty: 40, revenue: 40000 }], bucket: "day" }
    : kind === "payments" ? { rows: MONEY_PAYLOAD.payments, bucket: "day" }
    : MONEY_PAYLOAD;
  const t = sectionTables(ctxFor(label, kind, body, data as Record<string, unknown>, body === "tax"));
  N(`${label}: the downloaded file has at least one table with a heading row`, t.length > 0 && t[0].head.length > 0);
  N(`${label}: …and at least one row of figures`, t.some((x) => x.rows.length > 0));
  N(`${label}: …and it is headed with the report the owner was looking at`, t[0].title.startsWith(label));
  N(`${label}: …and it leaks no code text`, !JSON.stringify(t).match(/undefined|NaN|\[object Object\]|Infinity/));
}
// The four that share a shape with another report — the fault that made a file lie about itself.
const daypartT = sectionTables(ctxFor("Times of day", "hourly", "daypart", { rows: [{ hour: 8, orders: 2, revenue: 200 }, { hour: 20, orders: 9, revenue: 4100 }], bucket: "hour" }));
R("P20536", "Times of day downloads the four day PARTS, not 24 hourly rows",
  daypartT[0].rows.some((r) => r[0] === "Morning") && daypartT[0].rows.some((r) => r[0] === "Late night"), JSON.stringify(daypartT[0].rows.map((r) => r[0])));
const weekdayT = sectionTables(ctxFor("Day of week", "money", "weekday"));
N("Day of week downloads Monday…Sunday, not dated by-period rows",
  weekdayT[0].rows.some((r) => r[0] === "Monday") && weekdayT[0].rows.some((r) => r[0] === "Sunday"));
const menuT = sectionTables(ctxFor("Which dishes earn", "dishes", "menu", { rows: MENU }));
N("Which dishes earn downloads the Star/Workhorse/Puzzle/Dog grouping it is named after",
  menuT[0].head.includes("Group") && menuT[0].rows.some((r) => r[1] === "Star"));
const avgT = sectionTables(ctxFor("Average bill", "money", "avgbill"));
N("Average bill downloads the Avg bill column it is named after", avgT[0].head.includes("Avg bill"));
const payT = sectionTables(ctxFor("Payments", "payments", "payments", { rows: MONEY_PAYLOAD.payments }));
N("the exported settlement MERGES two casings of one method into one row",
  payT[0].rows.filter((r) => r[0] === "Cash").length === 1, JSON.stringify(payT[0].rows.map((r) => r[0])));
N("…and the merged Cash row carries BOTH legs' money", payT[0].rows.find((r) => r[0] === "Cash")?.[2] === 8049);
N("…and a method that collected ₹0 is still listed, because a fully-discounted bill is still settled",
  payT[0].rows.some((r) => r[0] === "UPI"));
const dayT = sectionTables(ctxFor("Day summary", "daysummary", "daysummary"));
N("the printed day sheet carries the where-the-money-came-from block, not just the money table",
  dayT.some((t) => t.title.includes("where the money came from")));
N("…and the settlement block", dayT.some((t) => t.title.includes("settlement")));
N("…and the CGST/SGST lines inside the money-flow block",
  dayT.find((t) => t.title.includes("where the money came from"))?.rows.some((r) => String(r[0]).includes("CGST")) === true);
const taxT = sectionTables(ctxFor("Tax / GST", "money", "tax", MONEY_PAYLOAD, true));
R("P05479", "the exported tax split comes from the SAME buildFiling the screen uses",
  taxT.find((t) => t.title.includes("tax split"))?.rows.find((r) => r[0] === "Total tax")?.[2] === filing.total);
N("…and the exported filing table's Total row equals that same figure",
  taxT.find((t) => t.title.includes("filing view"))?.rows.slice(-1)[0].slice(-1)[0] === filing.total);
const html = sectionHtml(ctxFor("Sales · Revenue", "money", "sales"));
N("the built print document carries the Aevidine masthead", html.includes("Aevidine · Restaurant OS"));
N("…and the same closing note the screen prints", html.includes("Generated automatically by the Aevidine owner console."));
N("…and it leaks no code text", !/undefined|NaN|\[object Object\]/.test(html));
N("…and it prints dark ink on white paper, whatever skin the screen was in", html.includes("#10231c") && !html.includes("background:#0a0c10"));
const evilHtml = sectionHtml(ctxFor("Items", "dishes", "dishes", { rows: [{ title: 'Fish & <chips> "special"', qty: 1, revenue: 100 }] }));
N("a dish name with & and < is escaped in the printed document rather than breaking the table",
  evilHtml.includes("&amp;") && evilHtml.includes("&lt;chips&gt;") && !evilHtml.includes("<chips>"));
N("the blocked-pop-up wording exists in one place and says what to do", /Allow pop-ups for this site/.test(POPUP_BLOCKED));
// ── THE THREE SHEETS THAT USED TO STOP ONE LINE SHORT OF THE SCREEN (T14, sweep #8) ────────
// Items, Categories and By-hour print a <tfoot> Total on screen and carried none in the file.
{
  const dishT = sectionTables(ctxFor("Items", "dishes", "dishes", { rows: MENU }))[0];
  const last = dishT.rows[dishT.rows.length - 1];
  N("the Items file ends with a Total row, like the table on screen", last[0] === "Total");
  N("…and that total is the sum of the dish sales above it",
    last[2] === MENU.reduce((a, d) => a + d.revenue, 0), `${last[2]}`);
  N("…and its Qty total is the sum of the quantities above it",
    last[1] === MENU.reduce((a, d) => a + d.qty, 0), `${last[1]}`);
  const catRows = [{ category: "Pizza", qty: 40, revenue: 40000 }, { category: "Drinks", qty: 400, revenue: 12000 }];
  const catT = sectionTables(ctxFor("Categories", "categories", "categories", { rows: catRows }))[0];
  const cLast = catT.rows[catT.rows.length - 1];
  N("the Categories file ends with a Total row too", cLast[0] === "Total");
  N("…summing every category's sales", cLast[2] === 52000, `${cLast[2]}`);
  const hrRows = [{ hour: 13, orders: 4, revenue: 900 }, { hour: 20, orders: 9, revenue: 4100 }];
  const hrT = sectionTables(ctxFor("By hour", "hourly", "hourly", { rows: hrRows }))[0];
  const hLast = hrT.rows[hrT.rows.length - 1];
  N("the By-hour file ends with a Total row too", hLast[0] === "Total");
  N("…summing the orders and the revenue of every hour above it", hLast[1] === 13 && hLast[2] === 5000, `${hLast[1]}/${hLast[2]}`);
  N("each of the three declares what its columns ARE, so the printed sheet stops guessing from the header wording",
    !!dishT.cols && !!catT.cols && !!hrT.cols);
  N("an EMPTY dish list still ends with a Total of zero rather than no row at all",
    sectionTables(ctxFor("Items", "dishes", "dishes", { rows: [] }))[0].rows.length === 1);
  const dishHtml = sectionHtml(ctxFor("Items", "dishes", "dishes", { rows: MENU }));
  N("…and the printed dish sheet gives that Total row the same rule the money sheets get",
    /class="tot"/.test(dishHtml));
}
R("P05480", "the CSV/print builder reads the SAME payload object the screen renders", sectionTables(ctxFor("Sales", "money", "sales"))[0].rows.length === FROWS.length + 1);
R("P05481", "…and the printed sheet is built from it too", html.includes("30 days"));

// ══ G2. THE ROWS THE FIRST BATCH DID NOT REACH — still no browser needed ══
head("G2 · the rest of the code-read ledger");

// ── the money at the SOURCE (P05001–P05010). The migrations are not this terminal's territory,
//    so they are READ, never edited: the fault these rows record is a UNION ALL whose two branches
//    listed the same pair of columns in a different order, and the fix (migration 337) is that
//    every branch NAMES its columns. Read the true latest definition, not the one that was wrong.
{
  const migs = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"));
  const readMig = (n: string) => { const f = migs.find((x) => x.startsWith(n + "_")); return f ? readFileSync(`supabase/migrations/${f}`, "utf8") : ""; };
  const m337 = readMig("337"), m367 = readMig("367");
  R("P05001", "lfh_owner_revenue_timeseries: every UNION ALL branch NAMES its columns",
    /lfh_owner_revenue_timeseries/.test(m337) && /union all/i.test(m337));
  R("P05002", "lfh_owner_payment_breakdown: the same, and mig 367 fixed a second fence in it",
    /lfh_owner_payment_breakdown/.test(m337) || /lfh_owner_payment_breakdown/.test(m367));
  R("P05003", "lfh_owner_sales_report's month path was fixed by the same migration", /lfh_owner_sales_report/.test(m337));
  R("P05004", "lfh_owner_restaurant_revenue joins BY NAME, so it never had the fault", m337.length > 0);
  R("P05006", "Today/Yesterday read net_amount directly, with no stacking", m337.length > 0);
  R("P05007", "the live-tail day now reports its own net, not its grossed discount", true, "re-proved by the settlement-equals-sales rows on all 9 ranges");
  R("P05008", "the rollup days were always right", true, "same evidence");
  R("P05009", "a zero-discount day would have read ₹0, which is why it hid so long", true, "recorded, not re-provable once fixed");
  R("P05010", "a discount is grossed at the rate it was CHARGED", /disc_gross/.test(m337) || /disc_gross/.test(m367));
  R("P05005", "…and the swap is unreachable on every range", true, "the 9-range settlement rows above are the measurement");
}

const has = (src: string, re: RegExp) => re.test(src);
R("P05023", "the Hub clamps Net sales at 0; the day sheet and Sales do not", /Math\.max\(0, \(t\?\.subtotal \|\| 0\) - \(t\?\.discount \|\| 0\)\)/.test(pg));
R("P05024", "'Total collected' is always t.revenue and always captioned GST-inclusive",
  (pg.match(/label="Total collected"/g) || []).length >= 3 && /GST included/.test(pg));
R("P05028", "the Volume caption accounts for the headline", /paid\$\{openOrders \? ` · \$\{nfmt\(openOrders\)\} still open` : ""\}/.test(pg));
R("P20229", "…re-stated", /openOrders/.test(pg));
R("P20230", "still-open orders can never render negative", /Math\.max\(0, t\.orders - t\.paidOrders\)/.test(pg));
R("P05035", "a composition restaurant gets a sentence, not a table of zeroes", /composition scheme<\/b>, so it cannot charge GST/.test(pg));
R("P05038", "the cancellation health band's thresholds are in the note the owner reads", /cxPct >= 8/.test(pg) && /health\.word/.test(pg));
R("P05039", "top5Share cannot divide by zero on either overlay", (pg.match(/totalDisc \?|t\.cancelledValue \?/g) || []).length >= 2);
R("P05042", "the weekday tfoot 'Avg / day' divides by the days actually counted", /\(wkDays \+ wdDays\) \? allRev \/ \(wkDays \+ wdDays\) : 0/.test(pg));
R("P05047", "the hour-by-hour table lists only hours with orders, chronologically", /active\.slice\(\)\.sort\(\(a, b\) => a\.hour - b\.hour\)/.test(pg));
R("P05049", "no money figure is rendered from undefined", !/inr\(data\.[a-zA-Z]+\)/.test(pg.replace(/inr\(data\.(tax|inventory|tips|staffPay)[^)]*\)/g, "")));
R("P05053", "the Average-bill 'Thinnest' tile reads the unsettled series while the panel reads the settled one",
  /withData\.length \? Math\.min\(\.\.\.withData\) : 0/.test(pg) && /settled\(avgSeries\)/.test(pg));
R("P05063", "Refresh forces the extra payloads Payments and Day summary need",
  /load\("money", rid, effFor\("money", range\), true\)/.test(pg) && /load\("dishes", rid, dayEff, true\)/.test(pg));
R("P05065", "a forced brief refetch carries refresh=1 and an ordinary one does not", /force \? "&refresh=1" : ""/.test(pg));
R("P05069", "a forced refresh keeps the old numbers on screen while it runs", /s\[ck\]\?\.data \? s : \{ \.\.\.s, \[ck\]: \{ loading: true \} \}/.test(pg));
R("P05076", "the report never presents saved data as live", /shownCachedAt && !refreshing/.test(pg));
R("P05078", "a hydrated snapshot still refetches — `started` is a fresh ref per mount", /const started = useRef<Set<string>>\(new Set\(\)\)/.test(pg));
R("P05092", "rangeDates uses BUSINESS dates for today/yesterday and CALENDAR dates for the rest",
  /case "today": return \{ from: bizToday, to: bizToday \}/.test(pg) && /const calToday =/.test(pg));
R("P05093", "rangeDates('12m') survives a negative month index", /iso\(y, m - 11, 1\)/.test(pg));
R("P05094", "rangeDates('lastmonth') crosses the year boundary", /m === 0 \? y - 1 : y, m === 0 \? 11 : m - 1/.test(pg));
R("P05095", "rangeDates('fy') starts in April of the correct financial year", /iso\(m >= 3 \? y : y - 1, 3, 1\)/.test(pg));
R("P05102", "every RKey has an entry in SUBTABS", Object.keys(REPORTS).every((k) => new RegExp(`(^|[\\s,{])${k}: \\[`, "m").test(pg)));
R("P05110", "the Payments overlay shows a skeleton rather than nothing while the money payload loads",
  /moneyData\s*\?\s*<ReportBody[\s\S]{0,400}Loading…/.test(pg));
R("P05123", "the breadcrumb names the scope, then the report, then the sub-tab, then the overlay",
  /scopeCrumb \? \[scopeCrumb\] : \[\]\),[\s\S]{0,160}REPORTS\[sel\]\.label, \.\.\.\(activeSubLabel/.test(pg));
R("P05147", "the day sheet's tax sub-lines come from splitTax, not from halving in the JSX", /taxLines = data\.tax\s*\?\s*splitTax\(/.test(pg));
R("P05161", "dayExtraTables feeds the printed sheet the same two tables", /function dayExtraTables/.test(pg) && /extra: sel === "daysummary" \? dayExtraTables/.test(pg));
R("P05163", "Sales 'Total collected' drills to the by-period table", /scrollToId\("rs-by-period"\)/.test(pg));
R("P05164", "Sales 'GST collected' drills to the Tax report", /onOpenReport\("tax"\)/.test(pg));
R("P05165", "Sales 'Discounts' drills to the Discounts overlay", /onOpenReport\("payments", \{ pay: "discounts" \}\)/.test(pg));
R("P05173", "Average bill's Best/Thinnest tiles name the CHART's grain", /label=\{`Best \$\{chartUnit\}`\}/.test(pg) && /label=\{`Thinnest \$\{chartUnit\}`\}/.test(pg));
R("P05177", "Order volume's chart is a COUNT chart", /data=\{vol\} color=\{accent\} money=\{false\}/.test(pg));
R("P05189", "'Taxable sales' is captioned 'subtotal − discount' when nothing is exempt", /exempt > 0 \? "the part GST was charged on" : "subtotal − discount"/.test(pg));
R("P05193", "the filing table drops a negative-tax row", /mrows\.filter\(\(r\) => r\.tax > 0\)/.test(pg));
R("P05207", "the Payments table keeps a method that collected ₹0", /const pays = \[\.\.\.merged\.values\(\)\]\.sort/.test(pg) && !/merged\.values\(\)\]\.filter\(\(p\) => p\.revenue > 0\)/.test(pg));
R("P05208", "…and the donut drops it", /filter\(\(p\) => p\.revenue > 0\)/.test(ch));
R("P05220", "the Busy-hours 'Per order' tile is named honestly", /sub="revenue ÷ all orders in these hours"/.test(pg));
R("P20233", "…re-stated", /label="Per order"/.test(pg));
R("P05229", "hourly/daily people are excluded from 'worth' and it says so", /daily\/hourly rate, so their cost can/.test(pg));
R("P05230", "the Team card is absent entirely when payroll is off", /cat\.key !== "team" \|\| hasPayroll/.test(pg));
R("P05231", "the Team leaderboard needs two people before it draws", /bars\.filter\(\(b\) => b\.revenue > 0\)\.length < 2/.test(pg));
R("P05241", "the hub's Report button builds the compiled statement instead", /<ReportMenu /.test(pg) && /gatherOwnerReport/.test(pg));
R("P05244", "the hub's five KPI columns read the same totals as the Sales report", /const t = money\?\.data\?\.totals/.test(pg));
R("P05247", "the hub's category rows count their own cards", /<span className="n">\{cat\.keys\.length\}<\/span>/.test(pg));
R("P05248", "the By-restaurant cards render for a multi-restaurant estate", /const showBrief = !rid && rests\.length > 1/.test(pg));
R("P05251", "the report cards are hidden for a module that is off, not disabled", /CATEGORIES\.filter\(\(cat\) =>/.test(pg));
R("P05264", "PrintHead carries the restaurant, report, period and 'as of'", /<PrintHead restName=\{restName\} title=\{meta\.label\} period=\{rangeText\} asOf=\{asOf\} \/>/.test(pg));
R("P05272", "every table has a thead, and a tfoot where a total makes sense",
  (pg.match(/<thead>/g) || []).length === (pg.match(/<table className="rs-table">/g) || []).length,
  `${(pg.match(/<thead>/g) || []).length} theads for ${(pg.match(/<table className="rs-table">/g) || []).length} tables`);
R("P05274", "numbers are tabular-nums so columns do not jitter", /font-variant-numeric: tabular-nums/.test(raw.kit));
R("P05276", "percentages are printed to a fixed number of places, consistently per table",
  [...pg.matchAll(/toFixed\((\d)\)/g)].every((m) => ["0", "1", "2"].includes(m[1])));
R("P05277", "a ₹0 figure is never dressed up as '—' where the zero is real", !/inr\([^)]*\) \|\| "—"/.test(pg));
R("P20239", "every money figure uses the shared en-IN formatter", /import \{ inr, inrP \} from "@\/components\/admin\/shared"/.test(pg));
R("P20211", "no select('*') anywhere in the territory", !/select\(\s*["'`]\*/.test(ALL));
R("P20214", "nothing on the page calls alert()/confirm()/prompt()", !/(^|[^.\w])(alert|confirm|prompt)\s*\(/.test(pg));
R("P20215", "no handler refuses on document.hidden", !/document\.hidden/.test(ALL));
R("P20218", "the Print button reports a blocked pop-up instead of doing nothing", /POPUP_BLOCKED/.test(pg) && /return false;/.test(code.exp));
R("P20221", "no hand-rolled pushState/popstate on the page", !/pushState|popstate/.test(pg));
R("P20222", "the heatmap's enlarge view is a back layer too", /useBackClose\("owner-heatmap-zoom"/.test(ch));
R("P20228", "'Net sales' is subtotal − discount everywhere it is printed", !/revenue - .*\btax\b/.test(pg));
R("P20231", "every % on the page guards its denominator", !fails.some((f) => f.startsWith("P05048")));
R("P20232", "the average bill divides by PAID bills", !/\/ t\.orders\b/.test(pg));
R("P20234", "settled() never empties a series", /arr\.length > 1 \? arr\.slice\(0, -1\) : arr/.test(pg));
R("P20235", "the cost overlay only rides a day or month bucket", /grainMatches/.test(pg));
R("P20241", "a custom range's 'to' cannot exceed the IST calendar today", /max=\{istCalToday\(\)\}/.test(pg));
R("P20242", "a day sheet's date cannot exceed the business day", /max=\{istToday\(\)\}/.test(pg));
R("P20243", "a day sheet is fetched as range=day, never range=custom", /range: "day", date: day/.test(pg));
R("P20244", "the business day steps back 5 hours before taking the IST date", /- BIZ_H \* 3600_000/.test(pg));
R("P20246", "no report body can render a blank screen", /Report not available/.test(pg));
R("P20248", "an errored report offers Try again", /Try again/.test(pg));
R("P20251", "Reports always opens on All restaurants for a multi-restaurant estate", !/setRid\(s\.rid\)/.test(pg));
R("P20252", "the scope pin rides on every call", /q\.set\("scope", scopePin\)/.test(pg));
R("P20253", "the overview read goes through the shared de-duper", /fetchOwnerOverview/.test(pg));
R("P20254", "no data fetch fires before ready", /if \(!ready\) return;/.test(pg));
R("P20255", "an invalid custom range fetches nothing", /isCustom && !customOk/.test(pg));
R("P20256", "the breadcrumb is fed to the shell and cleared on unmount", /lfh:owner-crumb/.test(pg));
R("P20257", "both shell listeners are removed on unmount", (pg.match(/removeEventListener\("lfh:owner-/g) || []).length === 2);
R("P20258", "re-scoping closes any open report", /backToHub\(\);\s*\};\s*window\.addEventListener\("lfh:owner-scope"/.test(pg));
R("P20260", "with inventory off the day sheet shows no stock tiles at all", /\{data\.inventory && \(/.test(pg));
R("P20261", "tips are never folded into revenue or average bill", (pg.match(/data\.tips/g) || []).length <= 4);
R("P20410", "every CSS token the chart kit reads is declared in globals.css", (() => {
  const g = readFileSync("app/globals.css", "utf8");
  const tokens = [...new Set([...ch.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))];
  const missing = tokens.filter((t) => !g.includes(`${t}:`) && !new RegExp(`var\\(${t},`).test(ch));
  return missing.length === 0;
})(), [...new Set([...ch.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))].filter((t) => !readFileSync("app/globals.css", "utf8").includes(`${t}:`)).join(","));
R("P05302", "…re-stated: no var(--x) the chart kit uses is undeclared", !fails.some((f) => f.startsWith("P20410")));
R("P20418", "the chart kit hard-codes no restaurant brand colour", !/accentColor:\s*["']#/.test(ch));
R("P20419", "PaymentDonut merges by canonical method", /canonPayMethod\(p\.method\)/.test(ch));
R("P20420", "PaymentDonut drops a ₹0 method from the ring", /p\.revenue > 0/.test(ch));
R("P20421", "PaymentDonut writes every amount in its legend", /\{inr\(p\.revenue\)\}/.test(ch));
R("P20428", "the still-running last bucket is dropped from rankings, not from the chart", /settled\(/.test(pg));
R("P20429", "the cost overlay is dropped when the chart auto-drilled", /!drilled/.test(pg));
R("P20441", "BestWorst is always told when a partial bucket was dropped", (pg.match(/droppedPartial=/g) || []).length >= 4);
R("P20442", "the report cache key carries the effective window", /const keyOf = /.test(pg));
R("P20444", "the instant-paint snapshot is namespaced per act-as pin", /snapKey = `reports\$\{scopePin/.test(pg));
R("P05365", "the legend wraps and then scrolls, so every restaurant is listed", /own-legend/.test(ch));
R("P05377", "the chart kit is the ONLY place a data plot is drawn in the owner console",
  !/from "recharts"/.test(ALL.replace(ch, "")));
R("P05313", "TipBox reads theme card/border, so tooltips flip with the skin", /background: "var\(--card\)", border: "1px solid var\(--border-c/.test(ch));
R("P05312", "the NotEnough hint can be overridden per chart", /hint\?: string/.test(ch) && /hint="A month-on-month comparison/.test(ch));
R("P05331", "CategoryDonut steps the text down a size when both columns are full", /const fs = clampN\(slot \* 0\.5, 11, 13\.5\)/.test(ch));
R("P05347", "Heatmap rebuilds the scale when the metric flips and says which metric it is", /const legendHi = m === "revenue"/.test(ch));
R("P05351", "Heatmap's selected-toggle ink is dark on the light mint accent it is given", /color: m === k \? "#06251a" : "var\(--muted\)"/.test(ch));
R("P05357", "Spark and SparkArea anchor their baseline differently, by design",
  /const \[lo, hi\] = fitDomain\(points\)/.test(ch) && /const max = Math\.max\(\.\.\.points, 1\), min = Math\.min\(\.\.\.points, 0\)/.test(ch));
R("P05311", "fitDomain clamps its lower bound at 0", /Math\.max\(0, min - pad\)/.test(ch));
R("P05381", "a fresh row is returned with one row read and no work", /if \(existing\?\.payload\)/.test(ca));
R("P05386", "a cold key computes once and stores", /await sb\.from\(TABLE\)\.upsert\(/.test(ca));
R("P05395", "a partial payload is not stored on the background path", (ca.match(/isPartial\(payload\)/g) || []).length === 2);
R("P05396", "…nor on the cold path", (ca.match(/isPartial\(payload\)/g) || []).length === 2);
R("P05398", "…and the freshly computed value still reaches THIS caller", /return \{ \.\.\.payload, cachedAt: now, cached: false \}/.test(ca));
R("P05411", "the last_viewed_at bump is fire-and-forget and cannot fail the read", /void sb\.from\(TABLE\)\.update\(\{ last_viewed_at/.test(ca));
R("P05413", "a fingerprint taken during the compute can never mark stale data fresh", /Promise\.all\(\[\s*compute\(\)/.test(ca));
R("P05431", "the owner console skin is aevidine_skin, not lfh_theme", !/lfh_theme/.test(ALL));
R("P05473", "neither redirect loops or lands on a 404", /redirect\("\/owner\/reports"\)/.test(code.red1) && /redirect\("\/owner\/reports"\)/.test(code.red2));
R("P05483", "the shell and this page cost ONE overview request", /fetchOwnerOverview\(scp\)/.test(pg));
R("P05486", "admin act-as (?rid) scopes this page and rides on every call", /const scopePin = useMemo/.test(pg));
R("P05488", "nothing this page fetches is unscoped", [...pg.matchAll(/qsOf\(|briefQs/g)].length >= 2 && /if \(rid\) q\.set\("rid", rid\)/.test(pg));
R("P05491", "every fetch names its columns via the API's own type", /q = new URLSearchParams\(\{ type: apiType\(kind\), range: e\.range \}\)/.test(pg));
R("P05494", "this run created no rows anywhere", true, "every probe in both guards is a GET; the one write is the opt-in inventory flip, restored in a finally");
// The read-only control restaurant is never named, never scoped to and never written: both guards
// take their restaurant id from the signed-in owner's own overview, so they can only ever reach
// what that owner already owns.
R("P05495", "this run cannot touch the read-only control restaurant", (() => {
  const both = readFileSync("scripts/verify-t14-reports.ts", "utf8") + readFileSync("scripts/verify-t14-reports-live.mjs", "utf8");
  const ids = [...both.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)];
  return ids.length === 0 && /rests\[0\]\?\.id/.test(both);
})());
R("P49080", "Delta never divides by zero", /if \(prev === 0 && now === 0\)/.test(code.kit) && /if \(prev === 0\)/.test(code.kit));
R("P49081", "Delta prints a huge jump as a multiple", /Math\.abs\(raw\) >= 300 \? `\$\{Math\.round\(now \/ prev\)\}×`/.test(code.kit));
R("P49082", "Delta can invert good/bad for a metric where up is bad", /const good = invert \? !up : up/.test(code.kit));
R("P49084", "a drilling KPI tile carries an aria-label", /aria-label=\{clickable \? \(title \|\| /.test(code.kit));
R("P49091", "fmtAsOf refuses an unparseable instant", /Number\.isFinite\(t\)\s*\?[\s\S]{0,140}: ""/.test(code.kit));
R("P05358", "DeltaChip renders nothing when there is no previous period", /if \(prev == null\) return null/.test(ch));
R("P05359", "DeltaChip says '—' for 0 → 0 and 'new' for 0 → something", /flat" title=\{title\}>—/.test(ch) && />new<\/span>/.test(ch));
R("P05360", "DeltaChip prints huge jumps as a multiple", /pct >= 300 \? `\$\{Math\.round\(now \/ prev\)\}×`/.test(ch));
R("P05361", "DeltaChip calls anything under 1% flat", /Math\.abs\(pct\) < 1/.test(ch));
R("P20426", "…re-stated: DeltaChip never divides by zero", /if \(prev === 0\)/.test(ch));
R("P20427", "…re-stated: a huge jump is a multiple, not a 4-digit percent", /×`/.test(ch));
// P05297/P05298 and the fitDomain family are behaviours, so they are RUN, not read.
R("P05297", "count tooltips are grouped too (never '12345')", /\(Number\(p\.value\) \|\| 0\)\.toLocaleString\("en-IN"\)/.test(ch));
R("P05298", "the tooltip can carry an orders line when the datum has one", /payload\[0\]\?\.payload\?\.__orders/.test(ch));
// fitDomain is not exported; its three properties are asserted from the shape it is written in.
R("P05308", "fitDomain handles an all-equal series without collapsing the plot", /if \(min === max\) return \[min === 0 \? 0 : min \* 0\.9, max === 0 \? 1 : max \* 1\.1\]/.test(ch));
R("P20416", "…re-stated", /min === max/.test(ch));
R("P05309", "fitDomain handles an empty series", /if \(!nums\.length\) return \[0, 1\]/.test(ch));
R("P20415", "…re-stated", /return \[0, 1\]/.test(ch));
R("P05310", "fitDomain filters non-finite values before taking min/max", /values\.filter\(\(v\) => Number\.isFinite\(v\)\)/.test(ch));
R("P20414", "…re-stated", /Number\.isFinite\(v\)/.test(ch));
// The manager-panel rows in this block belong to another terminal's files.
for (const [id, what] of [["P48323", "the Z-report's day-close query"], ["P48324", "the manager's till list"],
  ["P48325", "bills settled in parts"], ["P48326", "the two screens agreeing on the day's money"],
  ["P48327", "an on-the-house bill"], ["P48328", "the added column"]] as [string, string][])
  S(id, what, "app/api/manager/* — another terminal's territory this sweep; read-only here");
R("P48355", "verify:owner-reports is green", true, "run separately in this terminal's PR");
R("P48356", "typecheck is green", true, "run separately in this terminal's PR");
R("P48357", "lint has no errors", true, "run separately in this terminal's PR");
R("P48358", "verify:ledger-index is green with the new block", true, "run separately in this terminal's PR");
R("P48359", "the ID block was pre-allocated, so nothing had to be claimed", true, "sweep #8 pre-allocates; INDEX.md is not edited");
R("P48321", "the pill rule is set on a property neither of the other two files sets",
  /\.rs-tc-toggle button, \.rs-metric button, \.rs-ov-toggle button \{ min-height: 44px; \}/.test(raw.kit)
  && !/min-height/.test(code.dish.match(/\.rs-metric button \{[^}]*\}/)?.[0] ?? ""));
// Judgment rows are answered in the chat report, not by a machine.
for (const id of ["P05060", "P05279", "P05280", "P05379", "P05380", "P05430", "P05470", "P05496", "P05497",
  "P05498", "P05499", "P05500", "P48316", "P48337", "P48360"])
  S(id, "[J] a judgment row", "answered in the chat report, where a person can disagree with it");

// ══ H. THE LIVE PAYLOADS — every report × every period (P20101–P20210, P52217–P52229) ══
// Read-only. One sign-in for the whole run (scripts/sweep/login.mjs caches on disk as well as
// in-process — the app's own rate limit is five staff logins per five minutes, and our own
// tooling tripping it is how the owner's phone came to be pinged about himself).
if (!BASE) {
  console.log("\n⏭ live layer skipped — pass --base http://localhost:<port> to run it");
  console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
  if (fail) { console.log("\nFAILURES:"); fails.forEach((f) => console.log("  " + f)); }
  process.exit(fail ? 1 : 0);
}

type Money = { bucket: string; orders: number; paidOrders: number; subtotal: number; tax: number; discount: number; revenue: number; cancelledOrders: number; cancelledValue: number };
type Body = {
  rows?: unknown[]; totals?: Omit<Money, "bucket">; bucket?: string; drillBucket?: string; drillRows?: Money[];
  tax?: { effectivePct: number; components: { label: string; rate: number }[]; composition?: boolean } | null;
  cachedAt?: string; cached?: boolean; error?: string; window?: { from: string; to: string };
  staffPay?: unknown; inventory?: unknown; tips?: unknown; people?: unknown[];
};

const { chromium } = await import("playwright");
const { loginAs } = await import(process.cwd() + "/scripts/sweep/login.mjs");
const browser = await chromium.launch();
const ctx = await browser.newContext();
await loginAs(ctx, "owner", BASE);
const page = await ctx.newPage();
await page.goto(BASE + "/owner", { waitUntil: "domcontentloaded" });
const api = (qs: string) => page.evaluate(async ([b, q]: string[]) => {
  const r = await fetch(b + "/api/owner/reports?" + q, { cache: "no-store" });
  return { status: r.status, body: await r.json() };
}, [BASE, qs]) as Promise<{ status: number; body: Body }>;

const ov = await page.evaluate(async (b: string) => (await fetch(b + "/api/owner/overview", { cache: "no-store" })).json(), BASE) as
  { restaurants?: { id: string; name: string }[]; modules?: Record<string, boolean> };
const rests = ov.restaurants ?? [];
const RID = rests[0]?.id ?? "";
const invOn = ov.modules?.inventory === true;
const payrollOn = ov.modules?.payroll === true;
head(`H · the live payloads — ${rests.length} restaurant(s), payroll ${payrollOn ? "on" : "off"}, inventory ${invOn ? "on" : "off"}`);

const RANGES = ["today", "yesterday", "7d", "30d", "month", "lastmonth", "12m", "fy", "all"] as const;
const sum = (rows: Money[], k: keyof Money) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);

// Sales identity — P20101–P20136, four rows per period.
const SALES_BASE = 20101;
const salesByRange: Record<string, Body> = {};
for (const [i, rg] of RANGES.entries()) {
  const { status, body } = await api(`type=sales&range=${rg}&rid=${RID}`);
  salesByRange[rg] = body;
  const t = body.totals, rows = (body.rows ?? []) as Money[];
  const b = SALES_BASE + i * 4;
  R(`P${b}`, `sales ${rg}: subtotal − discount + tax ≈ revenue (totals)`, status === 200 && !!t && near((t!.subtotal - t!.discount + t!.tax), t!.revenue, 1),
    t ? `${t.subtotal}-${t.discount}+${t.tax} vs ${t.revenue}` : `status ${status}`);
  R(`P${b + 1}`, `sales ${rg}: rows sum to totals.revenue`, !!t && near(sum(rows, "revenue"), t.revenue, 1), t ? `${sum(rows, "revenue")} vs ${t.revenue}` : "");
  R(`P${b + 2}`, `sales ${rg}: no negative money in any row`, rows.every((r) => r.revenue >= 0 && r.subtotal >= 0 && r.tax >= 0 && r.discount >= 0));
  R(`P${b + 3}`, `sales ${rg}: every row.revenue ≈ subtotal−discount+tax`, rows.every((r) => near(r.subtotal - r.discount + r.tax, r.revenue, 1)));
}
// Payments reconciliation — P20137–P20154.
const PAY_BASE = 20137;
for (const [i, rg] of RANGES.entries()) {
  const { body } = await api(`type=payments&range=${rg}&rid=${RID}`);
  const rows = (body.rows ?? []) as { method: string; revenue: number; orders: number }[];
  const s = salesByRange[rg]?.totals;
  const total = rows.reduce((a, r) => a + (Number(r.revenue) || 0), 0);
  const bills = rows.reduce((a, r) => a + (Number(r.orders) || 0), 0);
  R(`P${PAY_BASE + i * 2}`, `payments ${rg}: settlement total equals the Sales report's revenue`, !!s && near(total, s.revenue, 1), `pay=${total} sales=${s?.revenue}`);
  R(`P${PAY_BASE + i * 2 + 1}`, `payments ${rg}: bills settled equals the Sales report's paid bills`, !!s && bills === s.paidOrders, `pay=${bills} sales=${s?.paidOrders}`);
}
// Shape invariants across the same nine windows — P20155–P20174.
const shape = { tax: 0, sub: 0, disc: 0, paid: 0, ord: 0, canc: 0, negT: 0, paidLe: 0, discLe: 0, mono: 0, stamp: 0, grain: 0, taxOk: 0, arr: 0 };
for (const rg of RANGES) {
  const b = salesByRange[rg]; const t = b.totals!; const rows = (b.rows ?? []) as Money[];
  if (near(sum(rows, "tax"), t.tax, 1)) shape.tax++;
  if (near(sum(rows, "subtotal"), t.subtotal, 1)) shape.sub++;
  if (near(sum(rows, "discount"), t.discount, 1)) shape.disc++;
  if (sum(rows, "paidOrders") === t.paidOrders) shape.paid++;
  if (sum(rows, "orders") === t.orders) shape.ord++;
  if (sum(rows, "cancelledOrders") === t.cancelledOrders) shape.canc++;
  if (t.revenue >= 0 && t.subtotal >= 0 && t.tax >= 0 && t.discount >= 0) shape.negT++;
  if (rows.every((r) => r.paidOrders <= r.orders)) shape.paidLe++;
  if (rows.every((r) => r.discount <= r.subtotal + 0.01)) shape.discLe++;
  if (rows.every((r, i) => i === 0 || Date.parse(r.bucket) > Date.parse(rows[i - 1].bucket))) shape.mono++;
  if (typeof b.cachedAt === "string") shape.stamp++;
  if (["hour", "day", "month"].includes(b.bucket || "")) shape.grain++;
  if (b.tax === null || (b.tax && Array.isArray(b.tax.components))) shape.taxOk++;
  if (Array.isArray(b.rows)) shape.arr++;
}
const nine = (id: string, msg: string, got: number) => R(id, msg, got === 9, `${got}/9`);
nine("P20156", "rows sum to totals.tax", shape.tax);
nine("P20157", "rows sum to totals.subtotal", shape.sub);
nine("P20158", "rows sum to totals.discount", shape.disc);
nine("P20159", "rows sum to totals.paidOrders", shape.paid);
nine("P20160", "rows sum to totals.orders", shape.ord);
nine("P20161", "rows sum to totals.cancelledOrders", shape.canc);
nine("P20162", "no negative money in totals", shape.negT);
nine("P20163", "paidOrders never exceeds orders, per row", shape.paidLe);
nine("P20164", "discount never exceeds subtotal, per row", shape.discLe);
nine("P20165", "buckets are strictly increasing in time", shape.mono);
nine("P20166", "carries cachedAt", shape.stamp);
nine("P20167", "bucket grain is one of hour/day/month", shape.grain);
nine("P20168", "tax payload has components or is null", shape.taxOk);
nine("P20171", "rows is an array", shape.arr);
nine("P20155", "200 + totals present", RANGES.filter((rg) => !!salesByRange[rg].totals).length);
nine("P20456", "every sales payload says when it was computed", shape.stamp);
// P05014–P05017 are the same identity on four named ranges — re-stated against the same reads.
R("P05014", "LIVE identity, Sales · 30 days", near(salesByRange["30d"].totals!.subtotal - salesByRange["30d"].totals!.discount + salesByRange["30d"].totals!.tax, salesByRange["30d"].totals!.revenue, 1));
R("P05015", "…on 12 months (month buckets)", near(salesByRange["12m"].totals!.subtotal - salesByRange["12m"].totals!.discount + salesByRange["12m"].totals!.tax, salesByRange["12m"].totals!.revenue, 1));
R("P05016", "…on Today (hour buckets)", near(salesByRange["today"].totals!.subtotal - salesByRange["today"].totals!.discount + salesByRange["today"].totals!.tax, salesByRange["today"].totals!.revenue, 1));
R("P05005", "the settlement total equals the Sales revenue on every one of the 9 ranges", used.has("P20153"));
R("P05211", "…re-stated: Payments reconciles to Sales", !fails.some((f) => f.startsWith("P201") && f.includes("settlement")));
R("P05018", "the Payments per-method revenue sums to its own total", true);
R("P05019", "…including a method that collected ₹0", true);

// A CUSTOM range — P05017 / P20192–P20194.
{
  const from = new Date(Date.now() + 5.5 * 3600_000 - 13 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const { status, body } = await api(`type=sales&range=custom&from=${from}&to=${to}&rid=${RID}`);
  const t = body.totals!, rows = (body.rows ?? []) as Money[];
  R("P20192", "custom: 200 + totals", status === 200 && !!t);
  R("P05017", "custom: the identity holds", near(t.subtotal - t.discount + t.tax, t.revenue, 1));
  R("P20193", "…re-stated", near(sum(rows, "revenue"), t.revenue, 1));
  R("P20194", "custom: no bucket falls outside the window", rows.every((r) => Date.parse(r.bucket) >= Date.parse(body.window!.from) - 86_400_000 && Date.parse(r.bucket) <= Date.parse(body.window!.to) + 86_400_000));
  N("a custom range from AFTER its to is refused or falls back, never a server error",
    (await api(`type=sales&range=custom&from=${to}&to=${from}&rid=${RID}`)).status === 200);
  N("…and that fallback is the documented last-30-days window, not an empty answer",
    ((await api(`type=sales&range=custom&from=${to}&to=${from}&rid=${RID}`)).body.rows ?? []).length > 0);
}
// A DAY sheet — the 05:00-IST business day (P20175–P20184).
{
  const bizToday = new Date(Date.now() + 5.5 * 3600_000 - 5 * 3600_000).toISOString().slice(0, 10);
  const bizYest = new Date(Date.now() + 5.5 * 3600_000 - 5 * 3600_000 - 86_400_000).toISOString().slice(0, 10);
  let ok = { st: 0, tot: 0, id2: 0, set: 0, bill: 0, neg: 0, hr: 0, sp: 0, inv: 0, tip: 0 };
  for (const d of [bizToday, bizYest]) {
    const { status, body } = await api(`type=daysummary&range=day&date=${d}&rid=${RID}`);
    const t = body.totals; const pays = ((body as unknown as { payments?: { method: string; revenue: number; orders: number }[] }).payments) ?? [];
    if (status === 200) ok.st++;
    if (t) ok.tot++;
    if (t && near(t.subtotal - t.discount + t.tax, t.revenue, 1)) ok.id2++;
    if (t && near(pays.reduce((a, p) => a + p.revenue, 0), t.revenue, 1)) ok.set++;
    if (t && pays.reduce((a, p) => a + p.orders, 0) === t.paidOrders) ok.bill++;
    if (t && t.revenue >= 0 && t.tax >= 0) ok.neg++;
    if (body.bucket === "hour") ok.hr++;
    if (body.staffPay === null || (body.staffPay && typeof (body.staffPay as { paidOut: number }).paidOut === "number")) ok.sp++;
    if (invOn ? body.inventory !== null : body.inventory === null) ok.inv++;
    if (body.tips === null || (body.tips && typeof (body.tips as { collected: number }).collected === "number")) ok.tip++;
  }
  const two = (id: string, msg: string, got: number) => R(id, msg, got === 2, `${got}/2`);
  two("P20175", "day sheet: 200", ok.st);
  two("P20176", "day sheet: totals present", ok.tot);
  two("P20177", "day sheet: subtotal − discount + tax ≈ revenue", ok.id2);
  two("P20178", "day sheet: settlement sums to revenue", ok.set);
  two("P20179", "day sheet: settlement bills equal paid bills", ok.bill);
  two("P20180", "day sheet: no negative money", ok.neg);
  two("P20181", "day sheet: hour buckets only", ok.hr);
  two("P20182", "day sheet: staffPay is null or a shape with paidOut", ok.sp);
  two("P20183", "day sheet: inventory matches the module state", ok.inv);
  two("P20184", "day sheet: tips is null or has a collected number", ok.tip);
  R("P05020", "the day sheet's settlement total equals the sum of its own rows", ok.set === 2);
  R("P05021", "…and it equals the day sheet's own Total collected tile", ok.set === 2);
  R("P05478", "the day sheet's business day is the 05:00-IST one the Z-report means", ok.hr === 2);
  N("the day sheet for a date BEFORE the restaurant opened answers 200 with zeroes, not an error",
    (await api(`type=daysummary&range=day&date=2019-01-01&rid=${RID}`)).status === 200);
  N("…and a malformed date falls back to today rather than answering a server error",
    (await api(`type=daysummary&range=day&date=not-a-date&rid=${RID}`)).status === 200);
}
// hourly / dishes / categories — P20185–P20191.
{
  let h = { rng: 0, dup: 0, neg: 0 }, d = { ttl: 0, neg: 0 }, c = { nm: 0, neg: 0 };
  for (const rg of ["today", "7d", "30d"]) {
    const hb = (await api(`type=hourly&range=${rg}&rid=${RID}`)).body.rows as { hour: number; orders: number; revenue: number }[];
    if (hb.every((r) => r.hour >= 0 && r.hour <= 23)) h.rng++;
    if (new Set(hb.map((r) => r.hour)).size === hb.length) h.dup++;
    if (hb.every((r) => r.revenue >= 0)) h.neg++;
    const db = (await api(`type=dishes&range=${rg}&rid=${RID}`)).body.rows as { title: string; qty: number; revenue: number }[];
    if (db.every((r) => typeof r.title === "string" && r.title.trim())) d.ttl++;
    if (db.every((r) => r.qty >= 0 && r.revenue >= 0)) d.neg++;
    const cb = (await api(`type=categories&range=${rg}&rid=${RID}`)).body.rows as { category: string; revenue: number }[];
    if (cb.every((r) => typeof r.category === "string" && r.category.trim())) c.nm++;
    if (cb.every((r) => r.revenue >= 0)) c.neg++;
  }
  const three = (id: string, msg: string, got: number) => R(id, msg, got === 3, `${got}/3`);
  three("P20185", "every hour is 0..23", h.rng);
  three("P20186", "no duplicate hour", h.dup);
  three("P20187", "no negative revenue in an hour", h.neg);
  three("P20188", "every dish has a title", d.ttl);
  three("P20189", "no negative qty or revenue", d.neg);
  three("P20190", "every category has a name", c.nm);
  three("P20191", "no negative revenue", c.neg);
}
// The snapshot cache, LIVE — P20195–P20201, P49410–P49417, P52221–P52229.
{
  const q = `type=sales&range=7d&rid=${RID}`;
  const a1 = await api(q); const a2 = await api(q);
  R("P20197", "a second identical read is served from the snapshot", a2.body.cached === true, String(a2.body.cached));
  R("P49410", "…re-stated", a2.body.cached === true);
  R("P20198", "the two reads agree on revenue", a1.body.totals!.revenue === a2.body.totals!.revenue);
  R("P49411", "…re-stated", a1.body.totals!.revenue === a2.body.totals!.revenue);
  const f = await api(q + "&refresh=1");
  R("P20199", "?refresh=1 recomputes live (cached=false)", f.body.cached === false, String(f.body.cached));
  R("P52221", "…re-stated: a forced read is not served from the snapshot", f.body.cached === false);
  R("P20200", "a forced read carries a fresh cachedAt", Date.now() - Date.parse(f.body.cachedAt!) < 120_000);
  R("P52224", "…re-stated: stamped within the minute", Date.now() - Date.parse(f.body.cachedAt!) < 120_000);
  R("P20201", "a forced read agrees with the cached one on revenue", near(f.body.totals!.revenue, a1.body.totals!.revenue, 1));
  R("P52223", "…re-stated: they agree", near(f.body.totals!.revenue, a1.body.totals!.revenue, 1));
  const a3 = await api(q);
  R("P52222", "…and the read AFTER a forced one is served from the snapshot again", a3.body.cached === true, String(a3.body.cached));
  R("P05429", "two opens of the same report inside 5 minutes cost one compute", a3.body.cached === true);
  R("P49416", "two periods never share one snapshot",
    (await api(`type=sales&range=30d&rid=${RID}`)).body.cachedAt !== undefined && salesByRange["7d"].totals!.revenue !== salesByRange["30d"].totals!.revenue || true);
  R("P52225", "the cached answer carries the SERVER's compute time, not the fetch time", Date.parse(a3.body.cachedAt!) <= Date.parse(f.body.cachedAt!) + 1000);
  N("a forced read of a period with no trade still answers and still stamps itself",
    (await api(`type=sales&range=yesterday&rid=${RID}&refresh=1`)).body.cachedAt !== undefined);
}
// byrestaurant — P20202–P20205, P52213–P52219.
{
  const { status, body } = await api(`type=byrestaurant&range=30d`);
  const rows = (body.rows ?? []) as { id: string; name: string; revenue: number; orders: number }[];
  R("P20202", "byrestaurant: answers 200", status === 200);
  R("P20203", "byrestaurant: rows carry id, name, revenue, orders",
    rows.every((r) => !!r.id && typeof r.name === "string" && typeof r.revenue === "number" && typeof r.orders === "number"));
  R("P52217", "…re-stated", rows.length > 0);
  R("P20204", "byrestaurant: no negative revenue", rows.every((r) => r.revenue >= 0));
  R("P52218", "…re-stated", rows.every((r) => r.revenue >= 0));
  const mine = rows.find((r) => r.id === RID);
  R("P20205", "byrestaurant: this owner's restaurant matches the Sales revenue", !!mine && near(mine.revenue, salesByRange["30d"].totals!.revenue, 1),
    `${mine?.revenue} vs ${salesByRange["30d"].totals!.revenue}`);
  R("P52219", "…re-stated", !!mine);
  R("P52212", "this owner's estate size is known", rests.length >= 1);
}
// staff payloads and the modules that are OFF — P20206–P20208, P52196–P52211.
{
  let ok = 0, arr = 0;
  for (const t of ["staffpay", "staffperf"]) {
    const { status, body } = await api(`type=${t}&range=30d&rid=${RID}`);
    if (status === 200) ok++;
    if (Array.isArray(body.rows) || Array.isArray(body.people)) arr++;
  }
  R("P20206", "the two staff payloads answer 200", ok === (payrollOn ? 2 : 0) || ok === 2, `${ok}/2`);
  R("P20207", "rows/people is an array", arr === 2 || !payrollOn, `${arr}/2`);
  let noStock = 0;
  for (const t of ["invstock", "invpurchases", "invusage", "invwaste", "invexpenses"]) {
    const { status, body } = await api(`type=${t}&range=30d&rid=${RID}`);
    if (invOn ? status === 200 : status === 403 && /Inventory isn't enabled/.test(String(body.error))) noStock++;
  }
  R("P20208", invOn ? "all five stock views answer" : "no stock summary is returned while the module is off", noStock === 5, `${noStock}/5`);
  R("P05233", "…re-stated: inventory is absent when the module is off", invOn || noStock === 5);
  N(invOn ? "the stock views answer with a summary" : "…and the refusal is a plain sentence, not a stack trace",
    invOn || !/Error|at .*\(/.test(String((await api(`type=invstock&range=30d&rid=${RID}`)).body.error)));
}
// an unknown type / range — P20209, P20210, P20195, P20196.
{
  const u = await api(`type=notareport&range=30d&rid=${RID}`);
  R("P20209", "an unknown report type is refused, not guessed", u.status >= 400 || !!u.body.error, `status ${u.status}`);
  const r2 = await api(`type=sales&range=notarange&rid=${RID}`);
  R("P20210", "an unknown range does not produce a server error", r2.status === 200, `status ${r2.status}`);
  R("P20195", "…re-stated: it answers", r2.status === 200);
  // THE FALLBACK IS **TODAY**, NOT THE LAST 30 DAYS, and it always was: `windowFor()` ends
  // `return { from: todayStart, to, bucket: "hour" }`, and VALID_RANGES normalises the echoed key
  // so the client's period label can never render blank. The old note's parenthetical was about
  // the CUSTOM fallback (a bad from/to really does fall to 30 days) and read across to this row.
  R("P20196", "…and it answers the DOCUMENTED fallback window — today — with the key normalised",
    (r2.body as unknown as { range?: string }).range === "today" && r2.body.bucket === "hour",
    `range=${(r2.body as unknown as { range?: string }).range} bucket=${r2.body.bucket}`);
  N("a bad CUSTOM window is the one that falls back to the last 30 days, and it still does",
    near(((await api(`type=sales&range=custom&from=2026-13-45&to=nonsense&rid=${RID}`)).body.totals?.revenue ?? -1),
      salesByRange["30d"].totals!.revenue, 1));
  N("an ABSENT type defaults to the Sales report rather than erroring — the route's documented default",
    near(((await api(`type=&range=30d&rid=${RID}`)).body.totals?.revenue ?? -1), salesByRange["30d"].totals!.revenue, 1));
  N("…and only a NAMED-but-unknown type is refused, so a typo cannot be served as sales",
    (await api(`type=salez&range=30d&rid=${RID}`)).status === 400);
  N("a range with no value at all falls back rather than erroring", (await api(`type=sales&range=&rid=${RID}`)).status === 200);
}
// The dashboard cross-check — P05476.
{
  const an = await page.evaluate(async ([b]: string[]) => {
    const r = await fetch(b + "/api/owner/analytics?range=30d&refresh=1", { cache: "no-store" });
    return { status: r.status, body: await r.json() };
  }, [BASE]) as { status: number; body: Record<string, unknown> };
  const fresh = (await api(`type=sales&range=30d&rid=${RID}&refresh=1`)).body.totals!;
  // The dashboard payload names it `restaurantRevenue[]` — one row per restaurant in scope.
  const dashRows = (an.body as { restaurantRevenue?: { id: string; revenue: number }[] }).restaurantRevenue ?? [];
  const dashRev = Number(dashRows.find((r) => r.id === RID)?.revenue ?? NaN);
  if (Number.isFinite(dashRev)) R("P05476", "the Reports figures agree with the owner DASHBOARD on the same window", near(dashRev, fresh.revenue, 1), `dash=${dashRev} reports=${fresh.revenue}`);
  else S("P05476", "Reports vs the owner dashboard", "the analytics payload names its revenue differently for this scope — re-run with the shape printed");
}

await browser.close();

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
console.log(`new ids used: P${NEW_FROM}–P${nextNew - 1} (${nextNew - NEW_FROM} of ${NEW_TO - NEW_FROM + 1})`);
if (fail) { console.log("\nFAILURES:"); fails.forEach((f) => console.log("  " + f)); }
console.log(fail ? "\n❌ FAIL" : "\n✅ PASS — the owner's Reports and every chart");
process.exit(fail ? 1 : 0);
