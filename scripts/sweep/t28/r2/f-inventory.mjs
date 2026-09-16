// BLOCK F · app/api/owner/inventory/route.ts — 35 phases, P160801–P160835.
// 396 lines, 21 ledger rows, 3 driven. It has TWO shapes nobody has driven together: one
// restaurant's stock page, and the estate roll-up that draws a box per restaurant.
import { FH, PP, GHOST, GET, sb, undo, block, of_, code, read } from "./harness.mjs";
const S = of_("app/api/owner/inventory/route.ts");
export const F = block(160801, "F · the owner's stock page and its estate roll-up");
const { row } = F;
const ist = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7);

// ── THE MODULE IS SWITCHED ON FOR THIS RUN, AND SWITCHED BACK ───────────────────────────────────
// Inventory is an admin entitlement and it is OFF for French House (`inventory_allowed: false`), so
// twelve of these thirty-five could only ever answer "the module is off" — which is an honest ⏭ and
// a useless block. T8 of sweep #8 hit the same wall on three modules and did the obvious thing on
// the owner's word: switch them on inside the run, drive the rows properly, then put every switch
// back AND VERIFY it back. That is what happens here.
//
// Exactly one column changes, on exactly one restaurant, and the restore is registered BEFORE the
// change so it also runs on a crash or a SIGINT. French House is the restaurant this stack is
// written to; Aangan is the read-only control and is not touched.
let moduleWasOn = null;
async function ensureModule() {
  if (moduleWasOn !== null) return moduleWasOn;
  const before = (await sb.from("settings")
    .select("inventory_allowed, inventory_owner_control, inventory_enabled").eq("restaurant_id", FH).maybeSingle()).data;
  if (!before) { moduleWasOn = false; return false; }
  if (before.inventory_allowed === true) { moduleWasOn = true; return true; }
  undo(async () => {
    await sb.from("settings").update({ inventory_allowed: before.inventory_allowed }).eq("restaurant_id", FH);
    const back = (await sb.from("settings").select("inventory_allowed").eq("restaurant_id", FH).maybeSingle()).data;
    if (back?.inventory_allowed !== before.inventory_allowed) {
      throw new Error(`inventory_allowed is ${back?.inventory_allowed}, not the ${before.inventory_allowed} it started as`);
    }
  }, "French House's inventory_allowed switch");
  const up = await sb.from("settings").update({ inventory_allowed: true }).eq("restaurant_id", FH);
  if (up.error) { moduleWasOn = false; return false; }
  await new Promise((r) => setTimeout(r, 1200));       // the module ladder is cached briefly
  moduleWasOn = true;
  return true;
}

const on = async (c) => {
  if (!(await ensureModule())) return false; const r = await GET(c.O, `/api/owner/inventory?rid=${FH}`); return r.status !== 403; };

row(S("one restaurant's stock page answers, or says the feature is not switched on — never a page of zeroes"), "GET ?rid=<FH>", async (c) => {
  await ensureModule();
  const r = await GET(c.O, `/api/owner/inventory?rid=${FH}`);
  if (r.status === 403) return /isn't enabled/i.test(r.j?.error || "") || `403 but: ${r.j?.error}`;
  return !!(r.status === 200 && r.j.summary) || `${r.status} ${r.j?.error}`;
});
row(S("the admin must pick a restaurant — stock cannot be summed across kitchens"), "GET with no rid as the admin", async (c) => {
  const r = await GET(c.A, "/api/owner/inventory?scope=all");
  return !!(r.status === 400 && /pick a restaurant/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("an owner cannot open a restaurant they do not own"), "GET ?rid=<Pizza Palace> as diago1", async (c) => {
  const r = await GET(c.O, `/api/owner/inventory?rid=${PP}`);
  return !!(r.status === 403 && /not your restaurant/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("…nor one that does not exist"), "GET ?rid=<a well-formed id nothing owns>", async (c) => {
  const r = await GET(c.O, `/api/owner/inventory?rid=${GHOST}`);
  return !!(r.status >= 400 && !/"stockValue"/.test(r.txt)) || `${r.status} ${r.txt.slice(0, 100)}`;
});
row(S("a kitchen login sees no stock"), "GET as diagkitchen", async (c) => {
  const r = await GET(c.K, `/api/owner/inventory?rid=${FH}`);
  return !!(r.status >= 400) || `${r.status}`;
});
row(S("a month that is not a month is refused before it becomes January of the next year"), "GET ?month=2026-13 and 2026-00", async (c) => {
  const cur = ist();
  for (const m of ["2026-13", "2026-00", "2026-1", "20261", "zzz"]) {
    const r = await GET(c.O, `/api/owner/inventory?rid=${FH}&month=${m}`);
    if (r.status === 403) return "SKIP: the module is off for this restaurant";
    if (r.status !== 200) return `month=${m} answered ${r.status}`;
    if (r.j.month !== cur) return `month=${m} was answered as ${r.j.month}, not the current month`;
  }
  return true;
});
row(S("…and a real month is honoured, and labelled as itself"), "GET ?month=<last month>", async (c) => {
  const d = new Date(Date.now() + 5.5 * 3600e3); d.setUTCMonth(d.getUTCMonth() - 1);
  const m = d.toISOString().slice(0, 7);
  const r = await GET(c.O, `/api/owner/inventory?rid=${FH}&month=${m}`);
  if (r.status === 403) return "SKIP: the module is off";
  return r.j.month === m || `it answered ${r.j.month} for ${m}`;
});
row(S("every headline figure is a number, never a null or a NaN"), "read summary at two months", async (c) => {
  if (!(await on(c))) return "SKIP: the module is off";
  for (const m of [ist(), "2026-08"]) {
    const r = await GET(c.O, `/api/owner/inventory?rid=${FH}&month=${m}`);
    for (const [k, v] of Object.entries(r.j.summary || {})) if (!Number.isFinite(v)) return `month=${m} summary.${k}=${JSON.stringify(v)}`;
  }
  return true;
});
row(S("the true COUNT of purchases rides along, so a capped list cannot read as all of them"), "read summary.purchasesCount against purchases[]", async (c) => {
  if (!(await on(c))) return "SKIP: the module is off";
  const r = await GET(c.O, `/api/owner/inventory?rid=${FH}`);
  return r.j.summary.purchasesCount >= (r.j.purchases || []).length
    || `count ${r.j.summary.purchasesCount} < the ${(r.j.purchases || []).length} shown`;
});
row(S("…and the caps the answer was built with are named, so the screen never has to guess them"), "read caps", async (c) => {
  if (!(await on(c))) return "SKIP: the module is off";
  const r = await GET(c.O, `/api/owner/inventory?rid=${FH}`);
  return !!(r.j.caps && ["expenses", "purchases", "low", "negative"].every((k) => typeof r.j.caps[k] === "number")) || JSON.stringify(r.j.caps);
});
row(S("a low-stock line only appears for an ingredient genuinely below its par level"), "read low[] against have/par", async (c) => {
  if (!(await on(c))) return "SKIP: the module is off";
  const r = await GET(c.O, `/api/owner/inventory?rid=${FH}`);
  const wrong = (r.j.low || []).filter((x) => !(x.have < x.par));
  return wrong.length === 0 || `${wrong.length} line(s) listed as low that are not`;
});
row(S("…and a negative line only for stock that really went below zero"), "read negative[]", async (c) => {
  if (!(await on(c))) return "SKIP: the module is off";
  const r = await GET(c.O, `/api/owner/inventory?rid=${FH}`);
  const wrong = (r.j.negative || []).filter((x) => !(x.have < 0));
  return wrong.length === 0 || `${wrong.length} line(s) listed as negative that are not`;
});
row(S("a voided expense is visible in the list but kept OUT of the totals"), "compare expTotals with the expense rows", async (c) => {
  if (!(await on(c))) return "SKIP: the module is off";
  const r = await GET(c.O, `/api/owner/inventory?rid=${FH}`);
  const live = (r.j.expenses || []).filter((e) => !e.voided_at);
  const byCat = {};
  for (const e of live) byCat[e.category] = Math.round(((byCat[e.category] || 0) + Number(e.amount)) * 100) / 100;
  for (const [k, v] of Object.entries(byCat)) {
    const got = Math.round((r.j.expTotals?.[k] || 0) * 100) / 100;
    if (Math.abs(got - v) > 0.05 && (r.j.expenses || []).length < r.j.caps.expenses) return `${k}: total ${got} vs live rows ${v}`;
  }
  return true;
});
row(S("an expense slip's photo is a short-lived link, never a permanent public address"), "read expenses[].photo_url", async (c) => {
  if (!(await on(c))) return "SKIP: the module is off";
  const r = await GET(c.O, `/api/owner/inventory?rid=${FH}`);
  const perm = (r.j.expenses || []).filter((e) => e.photo_url && !/token=|X-Amz|\?/.test(String(e.photo_url)));
  return perm.length === 0 || `${perm.length} slip(s) carry a permanent link`;
});
row(S("the usage card names its ingredients rather than their ids"), "read usage.top[].name", async (c) => {
  if (!(await on(c))) return "SKIP: the module is off";
  const r = await GET(c.O, `/api/owner/inventory?rid=${FH}`);
  const ids = (r.j.usage?.top || []).filter((x) => /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(String(x.name)));
  return ids.length === 0 || `${ids.length} ingredient(s) named by their id`;
});
row(S("…and never as \"?\", which is what an unresolved name would look like"), "read usage.top[].name", async (c) => {
  if (!(await on(c))) return "SKIP: the module is off";
  const r = await GET(c.O, `/api/owner/inventory?rid=${FH}`);
  const q = (r.j.usage?.top || []).filter((x) => x.name === "?");
  return q.length === 0 || `${q.length} ingredient(s) came back as "?"`;
});
row(S("the stock page and the stock REPORT answer the same month the same way"), "compare this route with reports?type=invstock", async (c) => {
  if (!(await on(c))) return "SKIP: the module is off";
  const a = await GET(c.O, `/api/owner/inventory?rid=${FH}`);
  const b = await GET(c.O, `/api/owner/reports?type=invstock&range=month&rid=${FH}`);
  if (b.status !== 200) return `SKIP: the report answered ${b.status}`;
  const x = Math.round(a.j.summary.stockValue * 100) / 100, y = Math.round(b.j.summary.stockValue * 100) / 100;
  return x === y || `the page says ${x} and the report says ${y} for the same restaurant`;
});
row(S("a healthy page names nothing as unread"), "GET and check `partial`", async (c) => {
  if (!(await on(c))) return "SKIP: the module is off";
  const r = await GET(c.O, `/api/owner/inventory?rid=${FH}`);
  return !r.j.partial || `partial=${JSON.stringify(r.j.partial)}`;
});
row(S("…and a failed read names itself rather than printing ₹0 for a full storeroom"), "read: the summary is fatal and each list names itself", async () => {
  const src = code(read("app/api/owner/inventory/route.ts"));
  return !!(/reads\.partial\(\{/.test(src) && /reads\.one<Record<string, unknown>>\("summary"\)/.test(src) && /ReadFailed/.test(src))
    || "the read guard has gone, so a blip could print zeroes again";
});
row(S("the change-detector answers \"unread\" when it cannot look, so the figures recompute"), "read: both detectors", async () => {
  const src = code(read("app/api/owner/inventory/route.ts"));
  return ((src.match(/if \(mv\.error \|\| ex\.error\)[\s\S]{0,260}?return `unread\|/g) || []).length >= 2)
    || "one of the two stock detectors can go blind again";
});
row(S("a second identical open is served from the saved copy"), "GET twice and compare the stamp", async (c) => {
  if (!(await on(c))) return "SKIP: the module is off";
  const a = await GET(c.O, `/api/owner/inventory?rid=${FH}`);
  const b = await GET(c.O, `/api/owner/inventory?rid=${FH}`);
  return Date.parse(a.j.cachedAt || 0) === Date.parse(b.j.cachedAt || 1) || `${a.j.cachedAt} vs ${b.j.cachedAt}`;
});
row(S("…and Refresh recomputes it"), "GET ?refresh=1", async (c) => {
  if (!(await on(c))) return "SKIP: the module is off";
  const a = await GET(c.O, `/api/owner/inventory?rid=${FH}`);
  const b = await GET(c.O, `/api/owner/inventory?rid=${FH}&refresh=1`);
  return Date.parse(a.j.cachedAt || 0) !== Date.parse(b.j.cachedAt || 0) || "refresh returned the same stamp";
});
row(S("…and two MONTHS never share one saved copy"), "compare this month with last", async (c) => {
  if (!(await on(c))) return "SKIP: the module is off";
  const d = new Date(Date.now() + 5.5 * 3600e3); d.setUTCMonth(d.getUTCMonth() - 1);
  const a = await GET(c.O, `/api/owner/inventory?rid=${FH}`);
  const b = await GET(c.O, `/api/owner/inventory?rid=${FH}&month=${d.toISOString().slice(0, 7)}`);
  return a.j.month !== b.j.month || `both answered ${a.j.month}`;
});

// ══ the estate roll-up ═════════════════════════════════════════════════════════════════════════
row(S("the estate roll-up answers a box per restaurant plus one set of totals"), "GET ?estate=1 as diagmulti", async (c) => {
  const r = await GET(c.M, "/api/owner/inventory?estate=1");
  if (r.status === 503) return /try again/i.test(r.j?.error || "") || `503 but: ${r.j?.error}`;
  return !!(r.status === 200 && Array.isArray(r.j.estate) && r.j.totals) || `${r.status} ${r.j?.error}`;
});
row(S("…and it says how many restaurants are switched OFF, so a missing box is explained"), "read offCount", async (c) => {
  const r = await GET(c.M, "/api/owner/inventory?estate=1");
  if (r.status !== 200) return `SKIP: ${r.status}`;
  return typeof r.j.offCount === "number" || `offCount=${JSON.stringify(r.j.offCount)}`;
});
row(S("…and how many of the boxes it could actually count, so the totals never imply an estate they do not cover"), "read countedOf", async (c) => {
  const r = await GET(c.M, "/api/owner/inventory?estate=1");
  if (r.status !== 200) return `SKIP: ${r.status}`;
  return !!(r.j.countedOf && typeof r.j.countedOf.counted === "number" && typeof r.j.countedOf.of === "number")
    || JSON.stringify(r.j.countedOf);
});
row(S("the totals are summed from the boxes shown, so the header and the boxes cannot drift apart"), "sum estate[] against totals", async (c) => {
  const r = await GET(c.M, "/api/owner/inventory?estate=1");
  if (r.status !== 200 || !(r.j.estate || []).length) return "SKIP: no boxes to sum";
  for (const k of ["stockValue", "purchases", "waste", "expenses"]) {
    const sum = Math.round((r.j.estate || []).filter((x) => !x.unread).reduce((a, x) => a + (x[k] || 0), 0) * 100) / 100;
    if (Math.abs(sum - Math.round((r.j.totals[k] || 0) * 100) / 100) > 0.05) return `${k}: boxes ${sum} vs header ${r.j.totals[k]}`;
  }
  return true;
});
row(S("a restaurant whose figures did not read keeps its box, with dashes — never ₹0 for a full storeroom"), "read: an unread box carries the flag, not zeroes", async () => {
  const src = code(read("app/api/owner/inventory/route.ts"));
  return !!(/unread: true/.test(src) && /if \(r\.unread\) return t;/.test(src))
    || "an unread restaurant is either summed as zero or dropped from the estate";
});
row(S("every box names its restaurant"), "read estate[].name", async (c) => {
  const r = await GET(c.M, "/api/owner/inventory?estate=1");
  if (r.status !== 200) return `SKIP: ${r.status}`;
  const bad = (r.j.estate || []).filter((x) => !x.name || x.name === "—");
  return bad.length === 0 || `${bad.length} box(es) with no restaurant name`;
});
row(S("…and no box belongs to a restaurant the caller does not own"), "read estate[].rid", async (c) => {
  const r = await GET(c.M, "/api/owner/inventory?estate=1");
  if (r.status !== 200) return `SKIP: ${r.status}`;
  const stray = (r.j.estate || []).filter((x) => x.rid !== FH && x.rid !== PP);
  return stray.length === 0 || `${stray.length} box(es) from another owner's restaurant`;
});
row(S("the busiest restaurant is first, because that is the box an owner is looking for"), "read the order of estate[]", async (c) => {
  const r = await GET(c.M, "/api/owner/inventory?estate=1");
  if (r.status !== 200 || (r.j.estate || []).length < 2) return "SKIP: fewer than two boxes";
  const busy = (x) => (x.purchases || 0) + (x.expenses || 0) + (x.waste || 0);
  const v = r.j.estate.map(busy);
  return v.every((x, i) => i === 0 || v[i - 1] >= x) || `out of order: ${JSON.stringify(v)}`;
});
row(S("the estate roll-up costs one saved copy, not one per restaurant"), "GET twice and compare the stamp", async (c) => {
  const a = await GET(c.M, "/api/owner/inventory?estate=1");
  const b = await GET(c.M, "/api/owner/inventory?estate=1");
  if (a.status !== 200) return `SKIP: ${a.status}`;
  return Date.parse(a.j.cachedAt || 0) === Date.parse(b.j.cachedAt || 1) || `${a.j.cachedAt} vs ${b.j.cachedAt}`;
});
row(S("…and nothing is read before the cache is consulted, so a saved open is one row read"), "read: the settings and names reads are inside compute", async () => {
  const src = code(read("app/api/owner/inventory/route.ts"));
  const est = src.slice(src.indexOf("async function estate("));
  const iFp = est.indexOf("const fingerprint");
  const iEff = est.indexOf("inventoryEffectiveByRid");
  const iNames = est.indexOf("restaurantNames(");
  return !!(iEff > iFp && iNames > iFp) || `the module and name reads happen before the cache (fp at ${iFp}, eff at ${iEff}, names at ${iNames})`;
});
row(S("a database sentence never reaches the owner from either shape"), "scan both bodies", async (c) => {
  for (const u of [`/api/owner/inventory?rid=${FH}`, "/api/owner/inventory?estate=1", `/api/owner/inventory?rid=${FH}&month=2026-13`]) {
    const r = await GET(c.M, u);
    if (/PGRST|invalid input syntax|relation "|\[object Object\]/i.test(r.txt)) return `${u}: ${r.txt.slice(0, 110)}`;
  }
  return true;
});
row(S("is this how a real restaurant needs it? the food-cost percentage is only ever divided by the sales it can actually explain"), "read: coveredRevenue is the denominator", async () => {
  const src = code(read("app/api/owner/reports/route.ts"));
  return /foodCostPct: coveredRevenue > 0 \? \(theoreticalCost \/ coveredRevenue\) \* 100 : null/.test(src)
    || "the food-cost percentage is no longer divided by covered revenue only — a partly-mapped menu would get a flattering number";
});
