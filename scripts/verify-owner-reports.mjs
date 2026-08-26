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
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
// Migrations get RENUMBERED when parallel branches merge (this one shipped as 290 and landed as
// 294), so find it by CONTENT. A guard that hard-codes a filename breaks for everyone the moment
// someone else's migration lands first.
const migrationsWith = (needle) => {
  const dir = join(root, "supabase/migrations");
  return readdirSync(dir).filter((f) => f.endsWith(".sql") && readFileSync(join(dir, f), "utf8").includes(needle));
};
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
// WHICH date, and why this accepts two spellings (fixed 2026-08-12, T10 sweep). The thing that must
// hold is that the `day` cache key carries A date — with no date, two different days share one
// snapshot row and the sheet shows yesterday. It used to read the RAW query param
// (`sp.get("date")`); ef34f2d7 changed it to the RESOLVED window (`from`), which is strictly better,
// because windowFor() validates and falls back while the raw string did not, so a junk date could
// mint a cache row of its own. This check kept demanding the old spelling, so it failed on the
// improvement — and since verify:static is one `&&` chain, that took SEVEN later guards and CI's
// whole access-model step down with it for a day. Match either; refuse a `day` key with no date.
check("the day-sheet cache key carries the date",
  /range === "day" \? `day:\$\{(?:from|sp\.get\("date"\))\}`/.test(reportsRoute),
  "two different days would share one snapshot row");

console.log("\n── 1b. BETWEEN MIDNIGHT AND 5AM, 'TODAY' IS STILL LAST NIGHT'S SHIFT ──");
// The T5 re-run at 00:29 IST: the day sheet defaulted to the NEW calendar date, whose business
// day has not started, so it showed ₹0 "Today" while the dashboard tile beside it read ₹46,935
// for the shift still in progress. The server was right; the picker's default was a calendar date.
check("the day picker's 'Today' is the BUSINESS date",
  /const istToday = \(\) => new Date\(Date\.now\(\) \+ 5\.5 \* 3600_000 - BIZ_H \* 3600_000\)/.test(reportsPage),
  "a calendar date makes the sheet read 0 between midnight and 5am");
check("'Yesterday' steps back from the business date too",
  /const yesterdayIso = \(\) => new Date\(Date\.now\(\) \+ 5\.5 \* 3600_000 - BIZ_H \* 3600_000 - 86_400_000\)/.test(reportsPage),
  "otherwise Yesterday lands on the shift that is still open");
check("a CUSTOM range still has the CALENDAR date as its ceiling",
  /const istCalToday = \(\)/.test(reportsPage) && (reportsPage.match(/max=\{istCalToday\(\)\}/g) || []).length === 2,
  "a GST filing period is calendar-based; the custom pickers must still reach today's date");
check("the two DAY pickers keep the business ceiling",
  (reportsPage.match(/max=\{istToday\(\)\}/g) || []).length === 2,
  "you cannot file a day sheet for a shift that has not started");

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
// `taxableFor` joined `taxableValue` on 2026-08-06 (T5 sweep): the per-ROW figure now depends on
// whether the period has a MATERIAL exempt portion at all, so both files call taxableFor and both
// get that yes/no from the same exemptIsMaterial. Accept either name — what matters is that
// neither file derives it locally.
const derivesTaxable = (src) => /\btaxable(Value|For)\(/.test(src);
check("the taxable value has one shared derivation",
  /export function taxableValue/.test(taxFiling) && derivesTaxable(reportsPage) && derivesTaxable(sectionExport),
  "screen, CSV and paper must agree on what is taxable");
// A rounding residue is not exempt supply. `taxable` is recovered as tax ÷ rate and both sides are
// already rounded, so net − taxable never lands on zero — a restaurant selling nothing exempt was
// permanently told it had ₹111 of MRP sales to file separately (T5 sweep, 2026-08-06). The
// materiality test has to live in lib/ and be asked by BOTH renderers, or the tile, the filing
// table and the exported sheet go back to printing three different taxable bases.
check("'exempt sales' has a tolerance, and it is shared",
  /export function exemptIsMaterial/.test(taxFiling) && /export function taxableFor/.test(taxFiling)
    && /exemptIsMaterial\(/.test(reportsPage) && /exemptIsMaterial\(/.test(sectionExport),
  "rounding dust must never be printed as a GST-exempt supply");

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
const docDateMigs = migrationsWith("lfh_doc_date_hi");
check("the SQL side has the same rule",
  docDateMigs.length > 0,
  "the hero band and the detail list must describe the same window — a migration must define lfh_doc_date_hi");
check("the SQL helper steps back the business-day offset",
  docDateMigs.some((f) => /interval '5 hours'[\s\S]{0,60}interval '1 microsecond'/.test(read("supabase/migrations/" + f))),
  "without the 5-hour step-back a window ending at 05:00 IST lands on the next calendar date");
check("every inventory function that filters a document date uses the helper",
  docDateMigs.some((f) => (read("supabase/migrations/" + f).match(/lfh_doc_date_hi\(p_to\)/g) || []).length >= 5),
  "one function left on the old rule makes the band and the list disagree");

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

console.log("\n── 11. ONE MONEY, ONE GROUPING (T5 sweep, 2026-08-06) ──");
// This console writes INDIAN money: components/admin/shared → inr is en-IN and so is nfmt.
// AnimatedNumber's parseFormatted took an already-formatted string apart and re-grouped it as
// en-US "because ₹ means inr and inr is en-US" — it isn't — so every <Stat> in the Studio printed
// ₹8,359,670 above a table saying ₹83,59,670, and the Tax report's headline disagreed with its own
// CGST/SGST split on a panel captioned "ready to copy into a return".
const animNum = read("components/owner/AnimatedNumber.tsx");
// Match the CODE, not the prose: this file keeps a note explaining what en-US did here, and a
// guard that forbids the word would force the next author to delete the explanation.
check("AnimatedNumber never regroups money as en-US",
  !/toLocaleString\("en-US"\)/.test(animNum) && !/locale: "en-US"/.test(animNum),
  "the Studio's headline number must match the table under it");
check("the chart kit groups rupees the same way as the tiles",
  /toLocaleString\("en-IN"\)/.test(charts) && !/toLocaleString\("en-US"\)/.test(charts),
  "a tooltip that disagrees with the tile above it is two answers to one question");

console.log("\n── 12. A COST LINE ONLY SITS BESIDE A MATCHING GRAIN ──");
// lfh_inv_cost_series is always day- or month-grained and returns a "YYYY-MM-DD" STRING. On an
// HOUR window the client's istKey sliced each hour down to its day, so all 24 hourly bars matched
// the one cost row and the chart drew the whole day's supplier spend twenty-four times.
check("the sales cost overlay refuses an hour-grain window",
  /grainMatches/.test(reportsPage) && /bucket === "day" \|\| bucket === "month"/.test(reportsPage),
  "a daily cost row repeated under every hour is not a cost line");

console.log("\n── 13. A CACHE KEY CARRIES ITS WINDOW, NOT JUST ITS NAME ──");
// "today" and "30d" were the SAME analytics key today as yesterday, and snapshots ship stale-first
// — so the first open after the 05:00 rollover showed yesterday's completed day labelled "Today".
check("the analytics key embeds the resolved window start",
  /\$\{range\}:\$\{from\.slice\(0, 10\)\}/.test(analyticsRoute),
  "a sliding range must mint a new key when the window slides");
check("a corrupt cache timestamp counts as STALE",
  /function isFresh/.test(read("lib/ownerCache.ts")) && /Number\.isFinite\(t\)/.test(read("lib/ownerCache.ts")),
  "NaN >= maxAge is false, which made an unparseable row fresh forever");
check("the snapshot table gets swept",
  /sweepStaleRows/.test(read("lib/ownerCache.ts")),
  "one payload row per scope per report per range per DAY, kept forever");

console.log("\n── 14. ONE SLOW RESTAURANT IS NOT A BROKEN DASHBOARD ──");
// These two fan-outs threw on the FIRST failing restaurant, out of the cached compute and into a
// 500 — every chart and every OTHER restaurant's numbers gone. The reports route has degraded
// gracefully since the 2026-07-09 audit and the heatmap here is excluded from its throw loop.
check("the payment fan-out degrades gracefully",
  /const pmOk = pmRes\.filter/.test(analyticsRoute) && !/for \(const r of pmRes\) \{\s*\n\s*if \(r\.error\) throw/.test(analyticsRoute),
  "one restaurant's slow RPC must not blank the whole dashboard");
check("the category fan-out degrades gracefully",
  /const catOk = catRes\.filter/.test(analyticsRoute),
  "same rule as its sibling above");

console.log("\n── 15. YOU CAN READ WHICH OPTION IS SELECTED ──");
// The owner accent is a LIGHT emerald: white on it is 2.54:1 dark / 3.77:1 light. --accent-on
// (#06251a) exists for exactly this and .rs-tc-toggle was moved to it on 2026-08-05; four
// siblings kept hard-coding #fff.
for (const [label, src] of [["the dish-ranking toggle", read("components/owner/reports/DishReports.tsx")],
                            ["the inventory toggles", invReports],
                            ["the hub overview toggle", kit],
                            ["the dashboard dish sort", dashPage]])
  check(`${label} uses --accent-on, not white`,
    !/background: var\(--accent\); color: #fff/.test(src),
    "white on the light emerald accent is unreadable in both skins");

console.log("\n── 16. A DEEP LINK LANDS ON THE REPORT IT NAMES ──");
// The dashboard's staff-pay tiles link to ?open=team and say "Open the full report"; openAlias had
// no `team` key, so `map[k] ?? null` dropped the owner on the catalogue instead.
check("openAlias covers every report key",
  ["daysummary", "sales", "payments", "tax", "items", "timing", "team", "inventory"]
    .every((k) => new RegExp(String.raw`\b${k}: \{ sel:`).test(reportsPage)),
  "a KPI tile that promises a report must open that report");

console.log("\n── 17. A HALF-FINISHED TODAY IS NOT THE QUIETEST DAY ──");
// Every ranged report ends at `now`, so its last bucket is part-finished — handed to BestWorst it
// always won "Quietest day" and dragged the trend pill down with it (measured: "6 Aug · ₹5,124 ·
// 0% of the period" under "Trending down · 34%"). The chart still draws it; the ranking doesn't.
check("the best/quietest ranking drops the still-running bucket",
  /const settled = /.test(reportsPage) && /lastIsRunning/.test(reportsPage),
  "the current day must not be ranked against finished ones");
check("and the panel says it left it out",
  /droppedPartial/.test(read("components/owner/reports/Insights.tsx")) && /droppedPartial/.test(reportsPage),
  "dropping a bucket silently is its own kind of wrong");

console.log("\n── 18. STAFF PAY LANDS ON THE DAY IT LEFT ──");
// A business-day window ends at 05:00 IST the NEXT morning, so istDateOf(to) handed back TOMORROW
// and a salary recorded the next morning was counted on the previous day's sheet.
check("a shared business-day high bound exists",
  /export function businessDateHi/.test(read("lib/businessDay.ts")),
  "three copies of this rule is how they drift");
check("both routes use it for the pay window",
  /businessDateHi\(to\)/.test(analyticsRoute) && /p_to: docDateHi\(to\)/.test(reportsRoute),
  "istDateOf on a 05:00-ending window returns tomorrow");

console.log("\n── 19. A HELPER-BUILT HEADER IS STILL REACHABLE BY CSS ──");
// Every <th> in the estate table comes out of the th() arrow helper, and styled-jsx only stamps
// its scope class onto JSX in the component's OWN function body — so those th elements ship with
// no jsx- class. A scoped ".hq-table th" rule compiles to ".hq-table.jsx-X th.jsx-X" and matched
// NOTHING: measured live, a header cell computed to fontSize 13px / textTransform none /
// position static, i.e. unstyled since it was written, and the phone column-hiding left 8 header
// columns over 6 body cells. The descendant must be :global.
check("the estate table's header rules reach a helper-built th",
  /\.hq-table :global\(th\) \{/.test(dashPage) && !/^\s*\.hq-table th \{/m.test(dashPage),
  "a scoped th selector cannot match a th the styled-jsx transform never touched");
check("the phone column-hiding reaches the header too",
  /\.hq-table :global\(\.hide-m\), \.hq-table :global\(\.hide-s\)/.test(dashPage),
  "hiding only the body cells leaves the header a column or two too wide");

console.log("\n── 20. THE IMPROVEMENTS STAY IMPROVED (T5, 2026-08-06) ──");
const money = read("lib/money.ts");
const animNum2 = read("components/owner/AnimatedNumber.tsx");
// I1 — one short money form, and it goes to CRORES (the owner's pick: "do 1.2 Cr").
check("there is ONE compact money form, and it reaches crores",
  /export function compactINR/.test(money) && /Cr/.test(money)
    && /compactINR/.test(charts) && /compactINR/.test(dashPage)
    && !/\(n \/ 1e7\)\.toFixed/.test(dashPage),
  "a private copy is how an axis said ₹120.0L while the dropdown beside it said ₹1.2Cr");
// I6 — round ticks, WITHOUT giving up "a chart fills its box".
check("chart axes label round numbers, not the ragged max",
  /export function roundTicks/.test(money) && /ticks=\{tk\(/.test(charts),
  "ending the domain at the data max makes recharts print it beside the last round tick");
check("…and the domain still ends at the data max",
  /fitDomain\(values\)/.test(charts) && /domain=\{\[0, max\]\}/.test(charts),
  "the owner's rule is that the data touches the top — ticks are a label change, not a domain change");
// I4 — the heatmap colour means something.
check("the heatmap legend prints its scale",
  /busiest hour/.test(charts) && /legendHi/.test(charts),
  "'Less … More' with no numbers means one shade is 3 orders on one view and ₹18,000 on the other");
// I5 — say the grid is clamped.
check("the heatmap card says when it only covers 90 days",
  /HEAT_CLAMPED/.test(dashPage) && /HEAT_CLAMP_DAYS/.test(dashPage),
  "the server clamps to 90 days; a chip saying 'All time' overstates it");
// I3 — freshness per card.
check("each card can state its own figures-computed time",
  /const \[ages, setAges\]/.test(dashPage) && /ageTitle\(/.test(dashPage) && /oldestShown/.test(dashPage),
  "one page-level label described whichever request answered last");
// I8 — warm what he'll actually use.
check("the dashboard pre-warms at most the last-used range",
  !/RANGES\.map\(\(r\) => r\.k\)\.filter\(\(k\) => k !== globalRange\)/.test(dashPage),
  "warming all seven cost 14 requests per scope on every visit");
// I11 — no tab that only says "pick something else".
check("a sub-tab the period cannot answer is disabled, not empty",
  /needsDayGrain/.test(reportsPage) && /DAY_GRAIN_RANGES/.test(reportsPage) && /rs-subtab\.off/.test(kit),
  "Day of week on Today could only ever tell you to choose a different period");
// I12 — printing must not change what is on screen.
check("printing restores the period it borrowed",
  /restoreAfterPrint/.test(reportsPage),
  "printing last month used to leave the screen on a custom range");
// I10 — a failed report offers a way out.
check("a failed report has a Try again button",
  /Try again/.test(reportsPage) && /onRetry/.test(reportsPage),
  "Refresh always worked; nothing said so");
// I13 — one sheet, whichever way you print.
check("both print paths share a masthead and a closing note",
  /export function PrintFoot/.test(kit) && /PrintFoot/.test(reportsPage) && /rs-printfoot/.test(kit),
  "Ctrl+P and Export → Print produced two visibly different documents");
// I17 — one colour per restaurant.
check("a restaurant's colour is keyed by its id, not its list position",
  /function portfolioColor\(idOrIndex: string \| number\)/.test(read("lib/restaurantColor.ts"))
    && !/portfolioColor\(i\)/.test(dashPage),
  "sorting the ranking made a bar and its trend line disagree");
// I18 — an unknown payment method is not 'Not recorded'.
check("an unrecognised payment method gets its own colour",
  /export function payColor/.test(charts) && /PAY_EXTRA/.test(charts),
  "two custom methods painted the same grey are one wedge");
// I20 — one fan-out cap.
check("there is ONE mapLimit",
  /export async function mapLimit/.test(read("lib/mapLimit.ts"))
    && /from "@\/lib\/mapLimit"/.test(reportsRoute) && /from "@\/lib\/mapLimit"/.test(analyticsRoute)
    && /from "@\/lib\/mapLimit"/.test(read("lib/ownerReportGather.ts")),
  "four copies with four different limits, and one bare for-await with none");
check("the merged-inventory rung read is capped, not sequential",
  !/for \(const id of invIdsAll\) if \(\(await inventoryLadder/.test(reportsRoute),
  "a bare for-await reads the restaurants strictly one after another");
// I23 — nothing is fetched that nothing renders.
check("the dashboard no longer counts open tables it never shows",
  !/from\("sessions"\)[\s\S]{0,120}status", "open"/.test(analyticsRoute) && !/openTables/.test(analyticsRoute),
  "a ~165ms live count on every request, rendered by nothing (the overview payload has it)");
// the drawer closes the way every other overlay does
check("the restaurant drawer closes on Escape too",
  /if \(e\.key === "Escape"\) setDrawerRid\(null\)/.test(dashPage),
  "it closed on Back, the backdrop and the ✕ — but not the one habit that works everywhere else");

console.log("\n── 21. ONE RESTAURANT, ONE COLOUR — INCLUDING THE SHELL (T5, 2026-08-07) ──");
// The palette lived inside the dashboard page, so the SHELL's sidebar and top-strip switcher kept
// painting each restaurant's own brand accent: one restaurant was orange in the sidebar and blue
// in the chart three inches to its right.
const shell = read("components/owner/OwnerShell.tsx");
check("the palette lives in lib/, not in one page",
  /export function portfolioColor/.test(read("lib/restaurantColor.ts")),
  "a palette inside a page cannot be shared with the shell that frames it");
check("the shell's swatches use it",
  /portfolioColor\(r\.id\)/.test(shell) && !/background: r\.accentColor/.test(shell),
  "the sidebar and the switcher must agree with the charts they sit beside");
check("the dashboard imports the same one",
  /from "@\/lib\/restaurantColor"/.test(dashPage) && !/^const PORTFOLIO_COLORS/m.test(dashPage),
  "two copies of a palette is how they drift");

console.log("\n── 22. EVERY CHART GOES THROUGH THE 'IS THERE ENOUGH DATA' GATE ──");
// CLAUDE.md: "Charts are DYNAMIC, never a lonely 1-bar plot: route through populated() / NotEnough /
// ScrollX in components/owner/Charts.tsx; sparse timelines auto-drill to finer buckets."
//
// Nothing enforced it (T10 sweep, 2026-08-12). Worse, populated/NotEnough/ScrollX are module-PRIVATE
// — not exported — so a chart built in any other file physically CANNOT route through them. The rule
// held only because no chart happened to live anywhere else. That is an accident, not a guarantee,
// and the rule exists because a brand-new restaurant with one day of trade got a single lonely bar.
//
// So: charts live in Charts.tsx. A file that draws its own plot elsewhere is the thing to catch.
// A decorative <svg> (an icon, a logo) is not a chart — what makes it one is plotting DATA, so this
// looks for an <svg> in the same file as the shapes a plot is made of, driven by a mapped array.
{
  const dirs = ["components/owner", "app/owner"];
  const skip = /Charts\.tsx$/;
  // readdirSync, NOT fs.readdirSync — this file imports the function, not the namespace. The first
  // draft used `fs.` and the try/catch swallowed the ReferenceError, so the check scanned nothing and
  // passed on an empty list. A guard that cannot fail is worse than no guard: it reports safety it
  // never established. Hence the scanned-count assertion below.
  const walk = (d, out = []) => {
    let ents = [];
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return out; }
    for (const e of ents) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p, out);
      else if (/\.tsx?$/.test(e.name) && !skip.test(p)) out.push(p);
    }
    return out;
  };
  const scanned = dirs.flatMap((d) => walk(d));
  const offenders = [];
  for (const f of scanned) {
    const src = read(f);
    if (!/<svg/i.test(src)) continue;
    // plot shapes driven by a data array — an icon has neither
    const plots = /<(rect|polyline|circle|path)\b[^>]*\{/i.test(src) && /\.map\(/.test(src);
    if (!plots) continue;
    // …unless it already routes through the gate, or re-uses a charted component
    if (/NotEnough|populated\(|ScrollX|from "@?\/?.*owner\/Charts"/.test(src)) continue;
    offenders.push(f);
  }
  // Prove the walk really walked. This is the check that catches the check.
  check("…and the chart scan really looked at the owner files", scanned.length > 20,
    `only ${scanned.length} file(s) scanned under ${dirs.join(", ")} — the walk found nothing, so the result below means nothing`);
  check(
    "no chart is drawn outside components/owner/Charts.tsx",
    offenders.length === 0,
    offenders.join(", ") +
      " — draws a data plot but never asks whether there is enough data to draw one. Move it into " +
      "Charts.tsx (where populated()/NotEnough/ScrollX live and are private), or export the gate and use it. " +
      "A brand-new restaurant with one day of trade must get an honest 'not enough yet' card, never a single bar.",
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// T11 SWEEP (2026-08-17) — four faults that were on the owner's screen, each with its check
// ═══════════════════════════════════════════════════════════════════════════════════════════
console.log("\nT11-A · the Reports Studio page");
{
  // ── 1 · the day sheet must MERGE the settlement, not just relabel it ──────────────────────
  // 5 Aug 2026 rendered "Cash · 7 bills ₹1,838" directly above "Cash · 2 bills ₹525", because
  // the settlement is grouped in the database by the RAW payment_method and this panel only
  // canonicalised the LABEL. Two rows, one pile of cash, and a React duplicate-key error.
  const dayBlock = reportsPage.slice(
    reportsPage.indexOf('if (bk === "daysummary")'),
    reportsPage.indexOf('if (bk === "sales")'),
  );
  check(
    "the Day summary settlement merges payment methods by canonical name",
    dayBlock.length > 200 && /payMerged|new Map<string, PayRow>/.test(dayBlock),
    "app/owner/reports/page.tsx — the Day summary's `pays` must fold the rows into a Map keyed by " +
      "canonPayMethod() BEFORE rendering. Relabelling alone leaves one method on two lines whenever the " +
      "database holds two casings of it (French House really holds both 'Cash' and 'cash'), with two " +
      "shares, two bars and a duplicate React key.",
  );
  check(
    "…and it merges BEFORE dropping the empty methods",
    /payMerged\.values\(\)\]\s*\.filter/.test(dayBlock.replace(/\s+/g, " ").replace(/\[\.\.\./g, "[...")) ||
      /\[\.\.\.payMerged\.values\(\)\]\.filter/.test(dayBlock.replace(/\s+/g, "")),
    "app/owner/reports/page.tsx — filter `revenue > 0` AFTER the merge, or a method split across two " +
      "casings can be thrown away in halves.",
  );

  // ── 2 · Refresh has to reach the "By restaurant" cards ────────────────────────────────────
  // Every other fetch in refreshNow() passes ?refresh=1; the hub's per-restaurant brief did not,
  // so the headline updated and the cards under it stayed up to five minutes stale (sweep #5 F7).
  const hubBlock = reportsPage.slice(reportsPage.indexOf("function Hub("), reportsPage.indexOf("function ReportView("));
  check(
    "Refresh forces the hub's per-restaurant brief to recompute live",
    /briefQs\}\$\{[^}]*refresh=1/.test(hubBlock) || /refresh=1/.test(hubBlock),
    "app/owner/reports/page.tsx — the `type=byrestaurant` fetch in Hub() must append &refresh=1 when the " +
      "read was triggered by the Refresh button. Without it the server answers from the snapshot cache and " +
      "the 'By restaurant' cards stop adding up to the headline directly above them.",
  );
  check(
    "…but only for the tick Refresh just bumped, so a period change stays a cached read",
    /forcedTick/.test(hubBlock),
    "app/owner/reports/page.tsx — gate the force on the briefTick that has not been answered yet. Forcing on " +
      "every re-run would make each period change pay for a live recompute of the whole estate, which is the " +
      "cost the snapshot cache exists to avoid.",
  );

  // ── 3 · a count of one is "1 order" ───────────────────────────────────────────────────────
  // "QUIETEST HOUR · 10 AM · ₹441 · 1 orders" was on screen most of the time, because a quiet
  // hour with exactly one order is the normal case for a quiet hour.
  const bareOrders = [...reportsPage.matchAll(/\)\}\s*orders`/g)].length
    + [...reportsPage.matchAll(/\}\s+orders`/g)].length;
  check(
    "no count on the Reports page is followed by a bare 'orders'",
    bareOrders === 0,
    "app/owner/reports/page.tsx — write `order${n === 1 ? \"\" : \"s\"}`, the way the day sheet, the volume " +
      "report, the tips line and the staff-pay line in this same file already do. Found " + bareOrders + " place(s).",
  );

  // ── 3b · …AND THE GUARD ITSELF WATCHED ONLY ONE WORD (T11 sweep #7, 2026-08-27) ────────────
  // The check above was written for the word "orders" and nobody widened it, so the SAME fault
  // survived two sweeps in the Payment settlement report's own tiles: "1 bills settled" under
  // TOTAL COLLECTED, and "· 1 bills" under TOP METHOD — on any period a single bill settled,
  // while the day sheet's settlement rows one click away read "1 bill" correctly. Every plural
  // this file counts is watched now, not just the one that was found first.
  const COUNTED = ["orders", "bills", "days", "people", "payments", "items", "dishes", "months", "hours"];
  const bareAny = [];
  for (const w of COUNTED) {
    const n = [...reportsPage.matchAll(new RegExp(`\\)\\}\\s*${w}[\`\\s]`, "g"))].length
      + [...reportsPage.matchAll(new RegExp(`\\}\\s+${w}[\`\\s]`, "g"))].length;
    if (n > 0) bareAny.push(`${w}×${n}`);
  }
  check(
    "no count on the Reports page is followed by ANY bare plural",
    bareAny.length === 0,
    "app/owner/reports/page.tsx — a count of one must read \"1 bill\", \"1 day\", \"1 person\". Write " +
      "`bill${n === 1 ? \"\" : \"s\"}`. Found: " + bareAny.join(", "),
  );
}

console.log("\nT11-B · the chart kit");
{
  // ── 4 · a ranking chart must never paint outside its own box ──────────────────────────────
  // The plot has a 140px floor; the container was capped at rows*42+20 unconditionally (62px at
  // one row) with overflowY visible, so the plot painted 78px out of the bottom of its box and
  // over the sentence underneath it.
  const lb = charts.slice(charts.indexOf("export function LeaderBar("), charts.indexOf("export function WhoEarnsMore("));
  check(
    "LeaderBar caps its height only when the list actually scrolls",
    /const scrolls\s*=/.test(lb) && /scrolls\s*\?\s*\{\s*maxHeight/.test(lb.replace(/\s+/g, " ")),
    "components/owner/Charts.tsx — apply maxHeight/overflowY only when there are more rows than fit " +
      "(data.length > 8). Below that, overflowY is visible, so a cap tighter than the plot's own 140px " +
      "floor does not clip anything — it just lets the bars paint over whatever follows the chart.",
  );
  check(
    "…and the plot height is computed once, from the same floor",
    /const plotH\s*=\s*Math\.max\(140/.test(lb),
    "components/owner/Charts.tsx — keep the 140px floor in one named value so the box and the plot can never " +
      "disagree about how tall the chart is again.",
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// T11 SWEEP, ROUND 2 (2026-08-18) — the money at the source, printing, and the phone
// ═══════════════════════════════════════════════════════════════════════════════════════════
console.log("\nT11-C · a report must read the takings, not the discount");
{
  // The fault: `hist` listed … net, dpg … and the live branch listed … dpg, net …, glued with
  // `SELECT * FROM hist UNION ALL SELECT * FROM tail`. A UNION ALL takes its column NAMES from the
  // FIRST branch only, so every live-tail row had its takings and its grossed discount swapped —
  // the owner's dashboard, day sheet, payment split and 12-month report all printed the discount
  // where the money should be, and the sales report's tax went large and NEGATIVE.
  //
  // The guard reads the TRUE LATEST definition of each function across the whole folder (they get
  // renumbered when branches merge, so a hard-coded filename is worthless) and refuses a bare
  // `SELECT *` on either side of the union.
  const dir = join(root, "supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const latestBodyOf = (fn) => {
    let body = null;
    for (const f of files) {                       // sorted, so the last hit wins
      const src = readFileSync(join(dir, f), "utf8");
      const at = src.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
      if (at < 0) continue;
      const open = src.indexOf("AS $function$", at);
      const end = src.indexOf("$function$;", open + 13);
      if (open < 0 || end < 0) continue;
      body = { file: f, text: src.slice(at, end) };
    }
    return body;
  };
  for (const fn of ["lfh_owner_revenue_timeseries", "lfh_owner_payment_breakdown", "lfh_owner_sales_report"]) {
    const b = latestBodyOf(fn);
    check(
      `${fn} names its UNION ALL columns on both sides`,
      !!b && !/SELECT \* FROM (hist|tail|mtail)/.test(b.text),
      `${b ? b.file : "not found"} — this function stacks a rollup branch on a live branch. Both branches ` +
        "must list the SAME named columns in the SAME order; a bare `SELECT *` lets column ORDER decide, " +
        "and the two halves have already disagreed once (net/disc_gross swapped), which printed the " +
        "discount as the day's takings and made the tax column negative.",
    );
  }
  // …and the correction itself must still be present, i.e. SOMETHING defines them after 315/321.
  const ts = latestBodyOf("lfh_owner_revenue_timeseries");
  check(
    "…and that latest definition is the corrected one",
    !!ts && /SELECT restaurant_id, day, gp, dp, net, dpg, ao FROM hist/.test(ts.text),
    "the newest lfh_owner_revenue_timeseries no longer carries the explicit hist column list — a later " +
      "migration has re-introduced an older body. Take the TRUE LATEST definition before replacing one of these.",
  );
}

console.log("\nT11-D · printing, and the phone");
{
  const css = read("app/globals.css");
  const printBlocks = css.split("@media print");
  const ownerPrint = printBlocks.find((b) => b.includes(".adm.owx") && b.includes("--accent: #047857"));
  check(
    "the owner print block un-clips html and body",
    !!ownerPrint && /html,\s*body[^{]*\{[^}]*overflow:\s*visible\s*!important/s.test(ownerPrint),
    "app/globals.css — the app-shell rule `html, body { height:100%; overflow:hidden }` also clips the " +
      "PRINTED document, so Ctrl+P produced one page and dropped the by-period table. The owner print " +
      "block must reset html/body height and overflow.",
  );
  check(
    "…and paints the paper white at the specificity that actually wins",
    !!ownerPrint && /html\[data-staffdark="1"\]/.test(ownerPrint),
    "app/globals.css — `html[data-staffdark=\"1\"]` sets the dark background with !important, so a plain " +
      "`html` selector loses to it and the surplus paper prints solid dark. Match its specificity.",
  );
  const kit = read("components/owner/reports/kit.tsx");
  check(
    "the report controls are a thumb target on a phone",
    /@media \(max-width: 640px\)[^}]*\{[\s\S]{0,400}?\.rs-btn\s*\{\s*min-height:\s*44px/.test(kit),
    "components/owner/reports/kit.tsx — under 640px the Refresh / Report / Export buttons must reach 44px. " +
      "They measured 34px on an A35, and the day sheet's Today/Yesterday 27px.",
  );
  check(
    "…including the period dropdown",
    /@media \(max-width: 640px\)[\s\S]{0,300}?\.owr-btn\.main\s*\{[^}]*min-height:\s*44px/.test(reportsPage),
    "app/owner/reports/page.tsx — the period control measured 31px on an A35.",
  );
  // ── …AND THE CONTROLS THAT FIX MISSED (T11 sweep #7, 2026-08-27) ──────────────────────────
  // The 2026-08-18 pass raised the control STRIP and stopped there. Re-measured on an A35, the
  // same screen still offered two sizes of the same gesture: "← All reports" 23px (the only way
  // back to the hub), the sub-tab strip 34px, the day sheet's "Full report →" drill 22px and the
  // overlay ✕ 32px, under a row of 44px buttons.
  const phoneNav = [
    [".rs-back", /\.rs-back\s*\{[^}]*min-height:\s*44px/],
    [".rs-subtab", /\.rs-subtab\s*\{[^}]*min-height:\s*44px/],
    [".rs-drill", /\.rs-drill\s*\{[^}]*min-height:\s*44px/],
    [".rs-ovl-x", /\.rs-ovl-x\s*\{[^}]*height:\s*44px/],
  ];
  // Only the phone blocks — a desktop rule matching these would be a false pass.
  const phoneCss = kit.split("@media (max-width: 640px)").slice(1).join("\n@media\n");
  const missed = phoneNav.filter(([, re]) => !re.test(phoneCss)).map(([c]) => c);
  check(
    "…and so are the controls you MOVE with — back, sub-tabs, the drill link, the overlay close",
    missed.length === 0,
    "components/owner/reports/kit.tsx — under 640px these must reach 44px too, or one screen offers two " +
      "sizes of the same gesture. Still small: " + missed.join(", "),
  );
}

console.log("\nT11-E · saying so when a read failed");
{
  const dayBlock = reportsPage.slice(
    reportsPage.indexOf('if (bk === "daysummary")'),
    reportsPage.indexOf('if (bk === "sales")'),
  );
  check(
    "an unreadable settlement is not reported as an empty one",
    /payBills\s*>\s*0/.test(dayBlock),
    "app/owner/reports/page.tsx — when the settlement returns BILLS but every amount reads zero, the panel " +
      "must say the amount could not be read. Printing \"No payments recorded\" beside a Total collected tile " +
      "full of money is what made the swapped-column fault read as a quiet day for months.",
  );
  const cache = read("lib/ownerCache.ts");
  check(
    "a forced Refresh cannot store an all-zero payload over a good one",
    /prevRow/.test(cache) && /collapsedToZero\(payload,\s*prevRow\?\.payload\)/.test(cache),
    "lib/ownerCache.ts — `force` skipped the read of the row it was about to replace, so the all-zero guard " +
      "could never fire on the path most likely to need it (Refresh is pressed BECAUSE the numbers look wrong).",
  );
}

console.log(`\n${fails.length ? "✗ FAIL" : "✓ PASS"} — ${pass} checks passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  · ${f.name}: ${f.why}`); process.exit(1); }
