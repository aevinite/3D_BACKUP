#!/usr/bin/env node
// verify:owner-reports — static guards for the owner REPORTS / CHARTS / DASHBOARD area.
//
// Every check below is one fault that actually reached the owner's screen in the 2026-08-04
// owner-panel sweep. They are all STATIC (read the shipped files, no database, no login, no
// browser) so this runs in ~50ms and can sit in front of a commit.
//
// Add a check here whenever you fix something in this area — a fault with no check is a fault
// that comes back.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
let pass = 0;
const fails = [];
const check = (name, cond, why) => {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fails.push({ name, why }); console.log("  ✗", name, "\n      →", why); }
};

const reportsRoute = read("app/api/owner/reports/route.ts");
const analyticsRoute = read("app/api/owner/analytics/route.ts");
const reportsPage = read("app/owner/reports/page.tsx");
const dashPage = read("app/owner/page.tsx");
const charts = read("components/owner/Charts.tsx");
const kit = read("components/owner/reports/kit.tsx");
const sectionExport = read("components/owner/reports/sectionExport.tsx");
const taxFiling = read("lib/taxFiling.ts");
const invReports = read("components/owner/reports/InventoryReports.tsx");

console.log("\n── 1. THE DAY SHEET IS THE SAME DAY EVERY OTHER SCREEN MEANS ──");
// The sheet was a CALENDAR day (00:00 IST) while Sales "Today", the dashboard tile, the manager
// dashboard and the Z-report are the 05:00-IST BUSINESS day: ₹38,640 vs ₹30,324 for one "today".
check("the reports route understands range=day",
  /range === "day"/.test(reportsRoute) && /businessDayWindow/.test(reportsRoute),
  "windowFor() must handle `range=day&date=…` as ONE 05:00-IST business day");
check("range=day is a VALID range",
  /VALID_RANGES[\s\S]{0,240}"day"/.test(reportsRoute),
  "an unlisted range silently falls back to today");
check("the business day starts at 05:00 IST",
  /BIZ_START_H\s*=\s*5/.test(reportsRoute),
  "the boundary must match lib/businessDay (businessDayStartIso) — 05:00 IST");
check("a day-kind report asks for range=day, never a calendar custom day",
  /DAY_KINDS\.has\(kind\)\s*\?\s*\{\s*range:\s*"day",\s*date:\s*day\s*\}/.test(reportsPage),
  "effFor() must send range=day; `custom` from=to=D is a CALENDAR day and disagrees with every other screen");
check("the day sheet's dishes + hours use the SAME window as its money",
  /const dayEff: Eff = \{ range: "day", date: day \}/.test(reportsPage),
  "a calendar-day extras window puts a 2am order's dish on a different sheet than its money");
check("the day-sheet cache key carries the date",
  /range === "day" \? `day:\$\{sp\.get\("date"\)\}`/.test(reportsRoute),
  "two different days would share one snapshot row");

console.log("\n── 2. NEVER PRESENT A SAVED FIGURE AS A LIVE ONE ──");
// The page rendered a snapshot of ₹12,285 while the live figure was ₹38,640, with no age and
// no way to ask for the truth. The dashboard has done this correctly since mig 196.
check("the reports page reads cachedAt off the payload",
  /cachedAt: d\.cachedAt/.test(reportsPage),
  "without it the page cannot know how old its own numbers are");
check("the reports page shows 'updated X ago'",
  /updated \{timeAgo\(shownCachedAt\)\}/.test(reportsPage) && /rs-fresh-t/.test(kit),
  "the project rule: the response carries cachedAt so the UI shows 'updated X ago' next to Refresh");
check("the reports page has a Refresh that forces a live recompute",
  /q\.set\("refresh", "1"\)/.test(reportsPage) && /onClick=\{refreshNow\}/.test(reportsPage),
  "Refresh must send ?refresh=1 — otherwise there is no way to get past a stale snapshot");
check("a printed report states when its FIGURES were computed",
  /Figures as of/.test(kit) && /Figures as of/.test(sectionExport),
  "'Generated <now>' alone puts a current timestamp over numbers that may be hours old");
check("the freshness line never prints on paper",
  /@media print \{ \.rs-fresh \{ display: none/.test(kit),
  "an on-screen control belongs to the screen");

console.log("\n── 3. THE TAX REPORT RECONCILES TO THE RUPEE ──");
// "The split" rounded the period total once (CGST ₹207,887.50) while the filing table rounded
// every day and summed 30 of them (₹207,888.50, total ₹415,777 vs the tile's ₹415,775).
check("ONE filing computation exists in lib/",
  /export function buildFiling/.test(taxFiling) && /export function allocateWhole/.test(taxFiling),
  "lib/taxFiling.ts is the single source for the split + the per-period allocation");
check("the page uses buildFiling, not its own rounding",
  /buildFiling\(/.test(reportsPage) && !/^function splitTax/m.test(reportsPage),
  "a local splitTax copy is how the two panels drifted apart");
check("the export uses buildFiling too",
  /buildFiling\(/.test(sectionExport) && !/^const splitTax = /m.test(sectionExport),
  "paper must show the same numbers as the screen");
check("'The split' prints the filing table's own column totals",
  /filingRows\.length \? compTotals :/.test(reportsPage),
  "two independent roundings on one page = two different CGST figures");
check("the taxable value has one shared derivation",
  /export function taxableValue/.test(taxFiling) && /taxableValue\(/.test(reportsPage) && /taxableValue\(/.test(sectionExport),
  "screen, CSV and paper must agree on what is taxable");

console.log("\n── 4. NOTHING IS FETCHED THAT NOTHING RENDERS ──");
// Two RPCs ran on every restaurant-dashboard compute, returned 4 and 56 rows, were read by no
// screen, AND sat in the throw-loop — so a failure in dead code blanked the whole dashboard.
// Match the CALL, not the name: the route keeps a comment explaining why these two are gone,
// and a guard that forbids the words would force the next author to delete the explanation.
const rpcCall = (fn) => new RegExp(String.raw`\.rpc\(\s*["'\`]` + fn);
check("the dashboard no longer fetches lfh_owner_samehour_compare",
  !rpcCall("lfh_owner_samehour_compare").test(analyticsRoute),
  "nothing renders sameHour");
check("the dashboard no longer fetches lfh_owner_payment_trend",
  !rpcCall("lfh_owner_payment_trend").test(analyticsRoute),
  "nothing renders payTrend");
check("neither field is shipped in the payload any more",
  !/\bsameHour:/.test(analyticsRoute) && !/\bpayTrend:/.test(analyticsRoute),
  "a field nothing reads is a query nobody notices");
check("the throw-loop only guards queries the screen actually needs",
  /for \(const e of \[ts, dishes, cats, hourly, pm\]\) if \(e\.error\) throw/.test(analyticsRoute),
  "a failure in a query no screen uses must never blank the dashboard (the heatmap is excluded for this reason)");
check("no unreferenced chart exports came back",
  !/export function (HourlyBar|CountBar|SameHourBar|PayTrendStack)\b/.test(charts)
  && !/export const RevenueBar/.test(charts) && !/export function TrendLine/.test(charts),
  "an unused chart makes its dead query look load-bearing");

console.log("\n── 5. A ONE-DAY REPORT COVERS ONE DAY ──");
// `istDay(to − 1ms)` assumes an exclusive IST midnight; range=yesterday ends at 05:00 IST, so
// an inventory "Yesterday" read 2026-08-03 AND 2026-08-04.
check("document dates use the business-day-aware high bound",
  /const docDateHi = \(toIso: string\) => istDay\(toIso, BIZ_START_H \* 3600_000 \+ 1\)/.test(reportsRoute),
  "step back the 5-hour offset before taking the calendar date");
check("both inventory paths use docDateHi",
  (reportsRoute.match(/docDateHi\(to\)/g) || []).length >= 2,
  "the merged and single-restaurant list windows must agree");
check("the SQL side has the same rule",
  /lfh_doc_date_hi/.test(read("supabase/migrations/290_document_dates_follow_the_business_day.sql")),
  "the hero band and the detail list must describe the same window (mig 290)");

console.log("\n── 6. A CHART LABEL IS FOR A HUMAN ──");
check("the group-trend fallback labels its buckets",
  /label: keyLabel\(k\)/.test(dashPage) && /function keyLabel/.test(dashPage),
  "the raw en-CA key printed '2026-08-04' under every bar on 4 of the 8 periods");

console.log("\n── 7. ONE QUESTION, ONE ANSWER ──");
check("Payments counts every settled bill",
  /const pays = \[\.\.\.merged\.values\(\)\]\.sort/.test(reportsPage),
  "filtering out ₹0 methods made 'bills settled' disagree with 'paid bills'");
check("a per-order figure is not called an average bill",
  /label="Per order"/.test(reportsPage) && /revenue ÷ all orders in these hours/.test(reportsPage),
  "dividing paid revenue by ALL orders is not the average bill");

console.log("\n── 8. HONEST EMPTINESS ──");
check("a composition restaurant gets no CGST/SGST split",
  /composition/.test(reportsRoute) && /data\.tax\?\.composition === true/.test(reportsPage),
  "it cannot charge GST to guests, so a zero-value split table is a lie");
check("CategoryDonut drops zero-revenue slices",
  /data\.filter\(\(d\) => \(Number\(d\.revenue\) \|\| 0\) > 0\)/.test(charts),
  "a category that took no money is a legend row to read past");
check("a tiny-but-real share reads '<1%', not '0%'",
  /const sharePct =/.test(charts) && /"<1%"/.test(charts),
  "'0%' beside a non-zero amount contradicts itself");
check("a capped list says it is capped",
  /expensesMore/.test(reportsRoute) && /MoreThanCap/.test(invReports),
  "a list that quietly stops no longer adds up to the total printed above it");
check("the month-compare chart excludes today's part-day",
  /cur: d < todayDom/.test(dashPage) && /Today is still in progress/.test(dashPage),
  "a part-day plotted against full days read as a crash to zero");

console.log("\n── 8b. THE OWNER'S PHONE IS 360px WIDE ──");
// `.adm-main` measured 496px inside a 360px screen: the Busy-heatmap and Payment-methods cards
// ran 136px off the right edge — taking the heatmap's ⤢ Enlarge button with them — with no
// horizontal scrollbar to reveal them. A bare `1fr` grid track is `minmax(auto,1fr)`, and that
// `auto` floor is the item's MIN-CONTENT width, so a card holding the heatmap's 430px grid
// pushed its own track wider than the phone instead of letting its inner scroller do the work.
check("the dashboard's two-up grid tracks can shrink below their content",
  /\.ow2-two \{ display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/.test(dashPage),
  "a bare 1fr track cannot go below min-content, so a wide card overflows the phone");
check("its children may shrink too",
  /\.ow2-two > \* \{ min-width: 0; \}/.test(dashPage),
  "without min-width:0 a grid item still refuses to shrink");
check("the phone breakpoint collapses to a SHRINKABLE single column",
  /\.ow2-two, \.ow2-callouts \{ grid-template-columns: minmax\(0, 1fr\); \}/.test(dashPage),
  "one column is not enough — it has to be a column that can be narrower than its content");

console.log("\n── 9. NO DUPLICATE READS ──");
check("the reports page uses the shared overview de-duper",
  /fetchOwnerOverview\(scp\)/.test(reportsPage) && !/fetch\(`\/api\/owner\/overview/.test(reportsPage),
  "a bare fetch here doubles an uncached aggregate on every Reports open (lib/ownerOverviewCache.ts)");

console.log("\n── 10. THE SNAPSHOT CACHE STAYS THE ONLY CACHE ──");
check("every owner aggregate route is snapshot-cached",
  /cachedOwnerPayload\(/.test(reportsRoute) && /cachedOwnerPayload\(/.test(analyticsRoute),
  "an aggregate outside the cache is a whole-table scan on every open");
check("cache keys are built from the authorized scope",
  /scopeKeyOf\(rid, scope\.all, scopeIds\)/.test(reportsRoute),
  "a key from raw request params would cross one owner's snapshot with another's");

console.log(`\n${fails.length ? "✗ FAIL" : "✓ PASS"} — ${pass} checks passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  · ${f.name}: ${f.why}`); process.exit(1); }
