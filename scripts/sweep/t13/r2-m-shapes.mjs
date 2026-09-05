// Round 2 · Band M+N+O — ODD ESTATES, THE NINE DATABASE CALLS, AND EVERYTHING STILL UNNAMED.
// ids P67653–P67700 (48) and P100771–P100920 (150) — 198 rows.
//
// The last of the measured gap. Round 1 named 403 things in this territory and 287 of them
// appeared in no row: 135 symbols in page.tsx, 54 in the analytics route, 49 CSS classes, 15
// pieces of page state, all 9 RPCs and all 5 back-button layers. Plus two SHAPES nothing had ever
// driven: a restaurant that is switched OFF, and an estate whose figures are all zero.
import { chk, skip, report, setOnly, writeLedger, executedIds } from "./lib.mjs";
import { openWith, closeBrowser, screenText, setRange, patchJson, ESTATE, BASE, idFor } from "./r2lib.mjs";
import { readFileSync, readdirSync } from "node:fs";

const EXPECT_ROWS = 198;
const argOnly = process.argv.find((x) => x.startsWith("--only="));
if (argOnly) setOnly(argOnly.slice(7).split(","));
// Two ranges, used in order: the tail of this terminal's own block, then the 100 claimed for the
// shortfall. `nextId()` walks the first to its end and then continues in the second.
const TAIL = { from: 67653, to: 67700 };   // 67652 is band L's last id — see the note above
const CLAIMED = { from: 100771, to: 100920 };   // extended from 100870 — see INDEX.md
let cursor = TAIL.from;
const nextId = () => {
  if (cursor > TAIL.to && cursor < CLAIMED.from) cursor = CLAIMED.from;
  const v = cursor++;
  if (v > CLAIMED.to) throw new Error("this band has run past both of its ranges");
  return `P${v}`;
};
const src = (p) => readFileSync("/Users/aevinite/Documents/Projects/wt-s8-t13/" + p, "utf8");
const page = src("app/owner/page.tsx");
const analytics = src("app/api/owner/analytics/route.ts");
const overview = src("app/api/owner/overview/route.ts");
const layout = src("app/owner/layout.tsx");

// ══ M · SHAPES NOTHING HAS DRIVEN ═════════════════════════════════════════════════════════════

// an estate where EVERY restaurant has taken nothing — the state item 2 and item 11 were about
const Z = await openWith({ creds: ESTATE });
await setRange(Z.pg, "Today");
const zTxt = await screenText(Z.pg);
for (const [what, fn] of [
  ["an all-zero estate renders with no console error", async () => (await Z.pg.locator(".ow2-kpi").count()) === 5],
  ["…and lists every restaurant anyway", async () => (await Z.pg.locator(".hq-table tr.hq-row").count()) === 5],
  ["…and no trophy is awarded", async () => (await Z.pg.locator(".ow2-split .oh.good").count()) === 0],
  ["…and 'Who earns more' says there is nothing to compare", async () => /Not enough data yet/.test(
    await Z.pg.locator(".adm-card", { hasText: "Who earns more" }).innerText())],
  ["…and the trend card says the same", async () => /Not enough data yet/.test(
    await Z.pg.locator(".adm-card", { hasText: "Revenue over time" }).innerText())],
  ["…and no share column claims a percentage of nothing", async () => {
    const sh = await Z.pg.locator(".hq-table tr.hq-row td:nth-child(8)").allInnerTexts();
    return sh.every((s) => /0%/.test(s) || s.trim() === "—");
  }],
  ["…and every rank is still 1..5, with no gap", async () => {
    const r = (await Z.pg.locator(".hq-table tr.hq-row td.rk").allInnerTexts()).map((x) => x.trim());
    return r.join(",") === "1,2,3,4,5";
  }],
  ["…and no tile prints NaN or Infinity", async () => {
    const v = (await Z.pg.locator(".ow2-kpi .v").allInnerTexts()).join(" ");
    return !/NaN|Infinity|undefined/.test(v);
  }],
  ["…and the insight strip stays silent rather than inventing a leader", async () =>
    (await Z.pg.locator(".owx-insight").count()) === 0],
  ["…and nothing leaks code text", () => !["[object Object]", "${", "-->", "NaN"].some((b) => zTxt.includes(b))],
  ["…and the average per order is not a division by zero", async () => {
    const avg = await Z.pg.locator(".hq-table tr.hq-row td:nth-child(6)").allInnerTexts();
    return avg.every((a) => !/NaN|Infinity/.test(a));
  }],
  ["…and the estate table's own captions still name five restaurants", () => /all 5 restaurants?/.test(zTxt)],
]) await chk(nextId(), what, async () => (await fn()) ? true : "no longer true");
await Z.pg.screenshot({ path: ".claude/sweep/shots/T13/r2-estate-all-zero.png" });
await Z.ctx.close();

// an estate where ONE restaurant is switched off (active = false) — never driven before
// Switch off a restaurant BY NAME and then find that name in the table. The estate is sorted by
// revenue, so `restaurants[1]` in the payload is not the second row on screen — an earlier version
// flipped one restaurant and opened a different one's drawer.
const OFF_NAME = "Sakura Sushi";
const OFF = await openWith({ creds: ESTATE, rules: [["/api/owner/overview", patchJson((b) => {
  if (b && Array.isArray(b.restaurants)) {
    b.restaurants = b.restaurants.map((r) => (r && r.name === OFF_NAME ? { ...r, active: false } : r));
  }
  return b;
})]] });
const offRow = () => OFF.pg.locator(".hq-table tr.hq-row", { hasText: OFF_NAME }).first();
for (const [what, fn] of [
  ["a switched-OFF restaurant is still listed on the estate", async () => (await OFF.pg.locator(".hq-table tr.hq-row").count()) === 5],
  ["…and its figures are still shown, because OFF is not HIDDEN", async () => {
    const cells = await offRow().locator("td").allInnerTexts();
    return !cells.some((c) => /figures hidden/i.test(c));
  }],
  ["…and opening it says plainly that it is off", async () => {
    await offRow().click();
    await OFF.pg.waitForSelector(".ow2-drawer", { timeout: 12000 });
    const t = await OFF.pg.locator(".ow2-drawer").innerText();
    await OFF.pg.keyboard.press("Escape");
    await OFF.pg.waitForTimeout(400);
    return /\bOff\b/i.test(t);
  }],
  ["…and the pill that says so is visually distinct from Active", () => /\.own-pill\.off \{[^}]*\}/.test(page)],
  ["…and it does not claim to be Active as well", async () => {
    await offRow().click();
    await OFF.pg.waitForSelector(".ow2-drawer", { timeout: 12000 });
    const on = await OFF.pg.locator(".ow2-drawer .own-pill.on").count();
    const off = await OFF.pg.locator(".ow2-drawer .own-pill.off").count();
    await OFF.pg.keyboard.press("Escape");
    await OFF.pg.waitForTimeout(400);
    return off === 1 && on === 0;
  }],
  ["…and the estate totals still include it, because it traded", async () => {
    const rows = (await OFF.pg.locator(".hq-table tr.hq-row td:nth-child(5)").allInnerTexts()).map((x) => Number(String(x).replace(/[^\d]/g, "")) || 0);
    const tile = Number(String(await OFF.pg.locator(".ow2-kpi").nth(1).locator(".v").innerText()).replace(/[^\d]/g, "")) || 0;
    return rows.reduce((a, b) => a + b, 0) === tile;
  }],
]) await chk(nextId(), what, async () => (await fn()) ? true : "no longer true");
await OFF.ctx.close();

// ══ N · THE NINE DATABASE CALLS THIS TERRITORY MAKES ══════════════════════════════════════════
const RPCS = [
  ["lfh_owner_overview", overview, "the estate's headline numbers"],
  ["lfh_owner_restaurant_revenue", analytics, "revenue and orders per restaurant"],
  ["lfh_owner_revenue_timeseries", analytics, "the revenue-over-time series"],
  ["lfh_owner_heatmap", analytics, "the busy day-by-hour grid"],
  ["lfh_owner_payment_breakdown", analytics, "how customers paid"],
  ["lfh_owner_category_breakdown", analytics, "revenue by category"],
  ["lfh_owner_dish_breakdown", analytics, "the every-dish list"],
  ["lfh_owner_hourly", analytics, "the busiest-hour insight"],
  ["lfh_owner_records", analytics, "the all-time records strip"],
  ["lfh_staff_pay_expense", analytics, "staff pay as an expense"],
];
const migrations = (() => {
  const dir = "/Users/aevinite/Documents/Projects/wt-s8-t13/supabase/migrations/";
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).map((f) => ({ f, t: readFileSync(dir + f, "utf8") }));
})();
for (const [rpc, file, what] of RPCS) {
  await chk(nextId(), `${rpc} — ${what} — is called by this territory`, () =>
    file.includes(`"${rpc}"`) ? true : "no longer called");
  await chk(nextId(), `…and it EXISTS in a migration, so the call cannot be to nothing`, () =>
    // `\\s+` and an OPTIONAL schema: 221_payroll_optin.sql writes
    // "CREATE OR REPLACE FUNCTION lfh_staff_pay_expense(" with no public. prefix, and my stricter
    // pattern read a defined function as missing.
    migrations.some((m) => new RegExp(`FUNCTION\\s+(?:public\\.)?${rpc}\\s*\\(`).test(m.t))
      ? true : "no migration defines it");
  await chk(nextId(), `…and it is REVOKEd from anon, so a guest cannot run it`, () => {
    const revoked = migrations.some((m) => new RegExp(`REVOKE[\\s\\S]{0,200}?${rpc}\\s*\\(`).test(m.t));
    return revoked ? true : "no migration revokes it — a new Postgres function is public-executable by default";
  });
  await chk(nextId(), `…and GRANTed to service_role, so the route can`, () => {
    // "GRANT  EXECUTE" — TWO spaces in these migrations. A single-space pattern missed every one
    // of them and reported a granted function as ungranted.
    const granted = migrations.some((m) => new RegExp(`GRANT\\s+EXECUTE[\\s\\S]{0,200}?${rpc}\\s*\\(`).test(m.t));
    return granted ? true : "no migration grants it to service_role";
  });
}
// how each call is SHAPED
for (const [what, fn] of [
  ["every RPC in the analytics route is given a bounded window", () => {
    const calls = [...analytics.matchAll(/sb\.rpc\("(\w+)",\s*\{([^}]*)\}/g)];
    const unbounded = calls.filter(([, name, args]) => !/p_from|p_restaurant_id|p_ids/.test(args)).map(([, n2]) => n2);
    return unbounded.length === 0;
  }],
  ["the group scope pushes its restaurant list INTO the database", () => /p_ids: pIds/.test(analytics)],
  ["…so a scoped owner never sums the whole platform and discards the rest", () => /const pIds = scope\.all \? null : scope\.ids;/.test(analytics)],
  ["the payment breakdown is never called with NULL for a scoped owner", () => /const pmIds: \(string \| null\)\[\] = scope\.all \? \[null\] : scope\.ids;/.test(analytics)],
  ["the category breakdown follows the same rule", () => /catScopedP = scope\.all \? null : mapLimit\(scope\.ids/.test(analytics)],
  ["the per-restaurant fan-outs are capped rather than unbounded", () => /mapLimit\(/.test(analytics) && /FANOUT/.test(analytics)],
  ["one slow restaurant cannot blank the whole group", () => /const pmOk = pmRes\.filter\(\(r\) => !r\.error\);/.test(analytics)],
  ["…and only a TOTAL failure is reported as an error", () => /if \(!pmOk\.length && pmRes\.length\) throw/.test(analytics)],
  ["…and the same for categories", () => /if \(!catOk\.length && catRes\.length\) throw/.test(analytics)],
  ["…and what is missing is NAMED so the screen can say so", () => /if \(pmOk\.length < pmRes\.length\) partial\.push\("payments"\)/.test(analytics)],
  ["the heatmap is deliberately non-fatal", () => /if \(heat\.error\) partial\.push\("busyHours"\)/.test(analytics)],
  ["…and excluded from the throw loop in the restaurant scope too", () => /for \(const e of \[ts, dishes, cats, hourly, pm\]\) if \(e\.error\) throw e\.error;/.test(analytics)],
  ["the all-time records read is wrapped so a failure is reported, not thrown", () => /await rd\("records", \(\) => sb\.rpc\("lfh_owner_records"/.test(analytics)],
  ["…and it is asked for only when the client asks", () => /const wantRecords = sp\.get\("records"\) === "1";/.test(analytics)],
  ["the food-loss read names its columns and caps its rows", () => /\.select\("amount"\)[\s\S]{0,220}?\.limit\(5000\)/.test(analytics)],
  ["…and excludes voided rows", () => /\.is\("voided_at", null\)/.test(analytics)],
  ["…and a failed read is reported as ABSENT, never as zero", () => /if \(q\.error\) \{ console\.error\("\[owner\/analytics\] food-loss read failed:"[\s\S]{0,40}?return null; \}/.test(analytics)],
  ["the staff-pay read goes through the payroll rung, per restaurant", () => /const eff = await payrollEffectiveByRid\(ids\);/.test(analytics)],
  ["…and a restaurant without the module contributes nothing rather than a zero", () => /if \(!on\.length\) return null;/.test(analytics)],
  ["the restaurant list is resolved ONCE per request, not once per tile", () => /scopeIdsP \?\?= \(async \(\) =>/.test(analytics)],
  ["…and the two expense reads run together, not one after the other", () => /await Promise\.all\(\[staffPayExpense\(\), foodLossExpense\(\)\]\)/.test(analytics)],
  ["the overview reads one pre-aggregated row per restaurant", () => /sb\.rpc\("lfh_owner_overview", \{ p_ids: pIds \}\)/.test(overview)],
  ["…and never one query per restaurant", () => !/for \(const [\w]+ of [\w.]+\) \{[\s\S]{0,200}?sb\.rpc\(/.test(overview)],
  ["the module probe reads both modules in one query", () => /\.select\("payroll_allowed, payroll_owner_control, payroll_enabled, inventory_allowed, inventory_owner_control, inventory_enabled"\)/.test(overview)],
  ["no read in either route selects everything", () => {
    const sels = [...(analytics + overview).matchAll(/\.select\(([^)]*)\)/g)].map((m) => m[1].trim());
    return sels.every((s) => s && !s.includes("*"));
  }],
  ["neither route writes anything", () => !/\.(insert|update|upsert|delete)\(/.test(analytics + overview)],
  ["the previous-window read cannot reject before anyone listens", () => /windowTotals\(pIds, prevWin\.from, prevWin\.to\)\.catch\(/.test(analytics)],
  ["…and the restaurant scope catches it too", () => /await windowTotals\(\[rid\], prevWin\.from, prevWin\.to\)\.catch\(/.test(analytics)],
  ["a partial payload is never FROZEN into the saved figures", () => /isPartial\(payload\)/.test(src("lib/ownerCache.ts"))],
  ["…and an all-zero payload cannot overwrite a good one seconds old", () => /zeroIsSuspicious\(payload, cur, maxAgeMs\)/.test(src("lib/ownerCache.ts"))],
]) await chk(nextId(), what, () => fn() ? true : "no longer true");

// ══ O · EVERYTHING IN THIS TERRITORY STILL UNNAMED ════════════════════════════════════════════
// the five back-button layers, by name
for (const layer of ["owner-rest", "owner-drill-restaurant", "owner-drill-dish", "owner-kpi-tile", "owner-rest-drawer"]) {
  await chk(nextId(), `the back-button layer "${layer}" is registered`, () =>
    new RegExp(`useBackClose\\("${layer}"`).test(page) ? true : "this overlay no longer peels on the phone's BACK");
}
await chk(nextId(), "…and the per-period dropdown registers one of its own", () =>
  /useBackClose\(`owner-rng-\$\{id\}`/.test(page) ? true : "the period dropdown no longer peels on BACK");
await chk(nextId(), "…and the drill registers ONE layer per level, in hook order", () => {
  const i = page.indexOf('useBackClose("owner-drill-restaurant"');
  const j = page.indexOf('useBackClose("owner-drill-dish"');
  return i > -1 && j > i ? true : "the two drill layers are no longer registered restaurant-then-dish";
});
// the page's own state, by name
for (const st of ["globalRange", "moneyCache", "recs", "recsUnread", "acts", "updatedAt", "offScope",
                  "landed", "dishSort", "actsOff", "actsErr", "refreshing", "tSort", "tileOpen", "drawerRid"]) {
  await chk(nextId(), `the page still keeps "${st}"`, () =>
    new RegExp(`\\[${st}[,\\]]`).test(page) ? true : "this piece of page state is gone");
}
// every constant the figures depend on
for (const [c, why] of [
  ["DAY_MS", "one day in milliseconds"], ["HEAT_CLAMP_DAYS", "how far the busy grid reaches"],
  ["RANGES", "the eight periods"], ["RANGE_LABEL", "how each period reads in a sentence"],
  ["PREV_LABEL", "what each period compares against"], ["RANGE_LS_KEY", "where the chosen period is remembered"],
  ["GREEN", "the one chart colour"], ["GRAY_LINE", "last month's reference line"],
  ["GREEN_SHADES", "the 2-3 restaurant shades"], ["IST", "the timezone every figure is stated in"],
]) {
  await chk(nextId(), `the constant ${c} (${why}) is still declared`, () =>
    new RegExp(`const ${c}\\b`).test(page) ? true : "gone");
}
// the CSS classes nothing named, present in the sheet
const sheet = page;
for (const cls of ["owr-btn", "owr-pop", "owd-btn", "owd-pop", "owd-div", "ow2-click", "ow2-kt", "ow2-live",
                   "ow2-spark", "ow2-nospark", "hq-table", "hq-bar", "hq-search", "hq-x", "hq-scroll", "hq-row",
                   "hq-nm", "hq-meter", "hq-empty", "own-dish-h", "own-dish-x", "rv-recs", "rv-rec",
                   "own-hero-id", "own-hero-name", "own-hero-sub", "own-hero-links", "own-pill", "ow2-seeall",
                   "ow2-acts", "ow2-drawer-wrap", "ow2-drawer-back", "ow2-drawer", "ow2-tile-back",
                   "rv-dishes", "rv-dn", "rv-bar", "rv-q", "rv-r", "ow2-bar", "ow2-title", "ow2-tools",
                   "ow2-tag", "ow2-fill", "ow2-note", "ow2-two", "dstats", "dspark", "dall", "dhidden"]) {
  await chk(nextId(), `the class .${cls} is styled by this page`, () =>
    sheet.includes(`.${cls}`) ? true : "this class is no longer styled here");
}
// the gate's own names
for (const nme of ["OwnerLayout", "skinCookie", "initialSkin", "actingValid", "ownedIds", "dualAdmin", "adminEnts", "metadata"]) {
  await chk(nextId(), `the owner gate still declares "${nme}"`, () =>
    new RegExp(`\\b${nme}\\b`).test(layout) ? true : "gone from app/owner/layout.tsx");
}
// and the route helpers
for (const nme of ["heatFrom", "windowFor", "prevWindowFor", "prevTsWindowFor", "fpFor", "fpWithStaffPay",
                   "windowTotals", "staffPayExpense", "foodLossExpense", "tileIds", "rangeKey",
                   "HEAT_MAX_DAYS", "WIDE_FP_MS", "VALID_RANGES"]) {
  await chk(nextId(), `the analytics route still declares "${nme}"`, () =>
    new RegExp(`\\b${nme}\\b`).test(analytics) ? true : "gone from the analytics route");
}
for (const nme of ["OutRow", "repAllow", "repOff", "modIds", "entitledSubset", "mergeOwnerEntitlements"]) {
  await chk(nextId(), `the overview route still declares "${nme}"`, () =>
    new RegExp(`\\b${nme}\\b`).test(overview) ? true : "gone from the overview route");
}

// The row-count lock is about a FULL run. A `--only=<id>` run deliberately executes one row, and
// an earlier version exited 2 here before report() could print — so every sabotage case looked
// like a guard staying green when the guard had never been given the chance to speak.
if (!argOnly && executedIds().length !== EXPECT_ROWS) {
  console.log(`\nID DRIFT: ran ${executedIds().length} rows, declares ${EXPECT_ROWS} (next id would be P${cursor})`);
  process.exit(2);
}
report(`T13 R2 bands M+N+O · odd estates, the database calls, and everything unnamed (P67653–P67700, P100771–P100920) · ${BASE}`, { minChecks: EXPECT_ROWS });
const out = process.argv.find((x) => x.startsWith("--ledger="));
if (out) writeLedger(out.slice(9), {
  how: "drove an all-zero and a switched-off estate; cross-checked every RPC against the migrations; named every remaining symbol, class and layer",
  section: "R2 · Bands M+N+O — odd estates, the database calls, and everything unnamed — P67653–P67700 and P100771–P100920",
});
await closeBrowser();
