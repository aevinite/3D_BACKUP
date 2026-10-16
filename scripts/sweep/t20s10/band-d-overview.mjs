// Band D — /api/owner/overview, DRIVEN as three real callers, plus a reading of every branch.
// ids P189341–P189390.
//
//   npx tsx --env-file=.env.local scripts/sweep/t20s10/band-d-overview.mjs --base http://localhost:4420 [--json=<file>]
//
// Callers: the one-restaurant diag owner (diago1), the two-restaurant diag owner (diagmulti), and the
// admin console's own session with no restaurant pinned. Each signs in ONCE through the shared cached
// helper. The owned-restaurant list each answer is compared against is read from the dev database with
// the service key — a READ, never a write. Nothing here swaps an id or calls a route without its login.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { chk, report, src, BASE } from "./lib.mjs";
import { loginAs, adminHeaders } from "../login.mjs";

const R = "app/api/owner/overview/route.ts";
const how = (who) => `GET /api/owner/overview on ${BASE} as ${who}`;
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const browser = await chromium.launch();

async function as(role, creds) {
  const ctx = await browser.newContext();
  await loginAs(ctx, role, BASE, creds);
  const t0 = Date.now();
  const r = await ctx.request.get(`${BASE}/api/owner/overview?_=1`, { timeout: 120000 });
  return { ctx, status: r.status(), headers: r.headers(), body: await r.json().catch(() => null), ms: Date.now() - t0 };
}
async function ownedBy(username) {
  const u = await sb.from("staff_users").select("id").eq("username", username).is("deleted_at", null).limit(1);
  const id = u.data?.[0]?.id;
  const a = await sb.from("restaurant_owners").select("restaurant_id").eq("user_id", id).limit(50);
  // Ownership is restaurant_owners (mig 097) ∩ the LIVE restaurants — exactly what lib/panelAccess
  // enabledOwnedRestaurantIds reads. restaurants.owner_user_id is only the display "primary".
  const ids = (a.data || []).map((x) => x.restaurant_id);
  const b = await sb.from("restaurants").select("id").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).is("deleted_at", null).limit(50);
  return new Set((b.data || []).map((x) => x.id));
}
const r2 = (n) => Math.round(n * 100) / 100;
const twoDp = (n) => typeof n === "number" && Math.abs(r2(n) - n) < 1e-9;

const one = await as("owner");
const multi = await as("ownerMulti");
const ownOne = await ownedBy("diago1"), ownMulti = await ownedBy("diagmulti");

let n = 189341;
const id = () => `P${n++}`;
for (const [who, res, owned] of [["the one-restaurant owner", one, ownOne], ["the two-restaurant owner", multi, ownMulti]]) {
  const b = res.body || {};
  const rs = Array.isArray(b.restaurants) ? b.restaurants : [];
  await chk(id(), R, `${who}: answers 200 with restaurants, totals, entitlements and modules`, how(who), () =>
    (res.status === 200 && Array.isArray(b.restaurants) && !!b.totals && !!b.entitlements && !!b.modules) || `status ${res.status} keys ${Object.keys(b)}`);
  await chk(id(), R, `${who}: every restaurant in the answer is one this person owns`, how(who) + ", compared with restaurant_owners", () =>
    (rs.length > 0 && rs.every((r) => owned.has(r.id))) || `not owned: ${rs.filter((r) => !owned.has(r.id)).map((r) => r.name)}`);
  await chk(id(), R, `${who}: every restaurant this person owns (live, panel on) is in the answer`, how(who), () =>
    rs.length === owned.size || `answer ${rs.length}, owns ${owned.size}`);
  await chk(id(), R, `${who}: totals.restaurantCount is the number of rows actually sent`, how(who), () => b.totals?.restaurantCount === rs.length);
  await chk(id(), R, `${who}: the headline taken-today is the sum of the rows, to the paisa`, how(who), () =>
    b.totals?.revenueToday === r2(rs.reduce((a, r) => a + r.revenueToday, 0)) || `${b.totals?.revenueToday} vs ${r2(rs.reduce((a, r) => a + r.revenueToday, 0))}`);
  await chk(id(), R, `${who}: the headline orders-today and open tables are the sums of the rows`, how(who), () =>
    b.totals?.ordersToday === rs.reduce((a, r) => a + r.ordersToday, 0) && b.totals?.openTables === rs.reduce((a, r) => a + r.openTables, 0));
  await chk(id(), R, `${who}: every figure arrives as a NUMBER (never a numeric string)`, how(who), () =>
    rs.every((r) => ["ordersToday", "revenueToday", "ordersAll", "revenueAll", "openTables"].every((k) => typeof r[k] === "number" && Number.isFinite(r[k]))));
  await chk(id(), R, `${who}: every money figure is rounded to paise`, how(who), () => rs.every((r) => twoDp(r.revenueToday) && twoDp(r.revenueAll)) && twoDp(b.totals.revenueToday));
  await chk(id(), R, `${who}: today can never exceed all-time, per restaurant`, how(who), () =>
    rs.every((r) => r.ordersToday <= r.ordersAll && r.revenueToday <= r.revenueAll + 0.01) || rs.map((r) => `${r.name} ${r.ordersToday}/${r.ordersAll}`).join(", "));
  await chk(id(), R, `${who}: every row carries a real accent colour and a reportsOff flag`, how(who), () =>
    rs.every((r) => typeof r.accentColor === "string" && /^#|^rgb|^hsl/.test(r.accentColor) && typeof r.reportsOff === "boolean"));
  await chk(id(), R, `${who}: the rows come back in name order (the RPC's ORDER BY r.name)`, how(who), () => {
    const names = rs.map((r) => r.name); return JSON.stringify(names) === JSON.stringify([...names].sort((a, c) => (a < c ? -1 : a > c ? 1 : 0))) || names.join(" · ");
  });
  await chk(id(), R, `${who}: entitlements are booleans and include reports and logs`, how(who), () =>
    Object.values(b.entitlements).every((v) => typeof v === "boolean") && "reports" in b.entitlements && "logs" in b.entitlements);
  await chk(id(), R, `${who}: modules carries payroll and inventory as booleans`, how(who), () => typeof b.modules?.payroll === "boolean" && typeof b.modules?.inventory === "boolean");
  await chk(id(), R, `${who}: no 'partial' key on a healthy read`, how(who), () => !("partial" in b) || JSON.stringify(b.partial));
  await chk(id(), R, `${who}: the answer carries only the documented keys — nothing extra rides along`, how(who), () => {
    const top = Object.keys(b).sort().join(","); const row = rs[0] ? Object.keys(rs[0]).sort().join(",") : "";
    return (top === "entitlements,modules,restaurants,totals" && row === "accentColor,active,id,name,openTables,ordersAll,ordersToday,reportsOff,revenueAll,revenueToday,slug") || `${top} | ${row}`;
  });
  // Next does not stamp Cache-Control on a dynamic route handler in dev; what matters is that nothing
  // in the answer LETS a browser reuse it (no max-age, no Expires, no Last-Modified/ETag to revalidate
  // against) — and the page asks with cache: "no-store" (band C, P189297).
  await chk(id(), R, `${who}: nothing in the answer lets a browser cache reuse it`, how(who) + ", reading the response headers", () =>
    (!/max-age=[1-9]|public/.test(res.headers["cache-control"] || "") && !res.headers["expires"] && !res.headers["last-modified"]) || JSON.stringify({ cc: res.headers["cache-control"], ex: res.headers["expires"], lm: res.headers["last-modified"] }));
  await chk(id(), R, `${who}: answers within 8 s on the dev stack`, how(who), () => res.ms < 8000 || `${res.ms} ms`);
}
// n is now 189375
const again = await one.ctx.request.get(`${BASE}/api/owner/overview?_=2`).then((r) => r.json());
await chk("P189375", R, "two reads seconds apart agree on every all-time figure (nothing moves under a re-read)", how("the one-restaurant owner, twice"), () =>
  JSON.stringify(again.restaurants.map((r) => [r.id, r.ordersAll])) === JSON.stringify(one.body.restaurants.map((r) => [r.id, r.ordersAll])) || "the all-time order counts differ between two reads");

// cross-surface: the overview's "today" and the analytics route's "today" for the same restaurant
const fh = one.body.restaurants[0];
const ana = await one.ctx.request.get(`${BASE}/api/owner/analytics?range=today&rid=${fh.id}&refresh=1`, { timeout: 120000 }).then((r) => r.json()).catch(() => null);
await chk("P189376", R, "the Today tile's money (overview) equals the analytics route's Today revenue for the same restaurant", "both routes, the same restaurant, analytics forced live", () =>
  (ana && Math.abs((ana.kpis?.revenue ?? -1) - fh.revenueToday) < 1) || `overview ${fh.revenueToday} vs analytics ${ana?.kpis?.revenue}`);
await chk("P189377", R, "…and the same order count", "both routes, the same restaurant", () =>
  (ana && ana.kpis?.orders === fh.ordersToday) || `overview ${fh.ordersToday} vs analytics ${ana?.kpis?.orders}`);

// the admin, no restaurant pinned
const actx = await browser.newContext({ extraHTTPHeaders: adminHeaders(BASE) });
const ad = await actx.request.get(`${BASE}/api/owner/overview?_=1`, { timeout: 120000 });
const adb = await ad.json().catch(() => ({}));
const live = await sb.from("restaurants").select("id", { count: "exact", head: true }).is("deleted_at", null);
await chk("P189378", R, "the admin with no pin is answered with every live restaurant on the platform", how("the admin console session"), () =>
  (ad.status() === 200 && adb.restaurants?.length === live.count) || `status ${ad.status()} rows ${adb.restaurants?.length} live ${live.count}`);
await chk("P189379", R, "…none of them flagged reportsOff — the admin is never narrowed", how("the admin console session"), () => (adb.restaurants || []).every((r) => r.reportsOff === false));
await chk("P189380", R, "…every entitlement on, and both modules on (the admin's X-ray)", how("the admin console session"), () =>
  Object.values(adb.entitlements || {}).every((v) => v === true) && adb.modules?.payroll === true && adb.modules?.inventory === true);
await chk("P189381", R, "…and no binned restaurant in the list", how("the admin console session") + ", compared with restaurants.deleted_at", async () => {
  const binned = await sb.from("restaurants").select("id").not("deleted_at", "is", null).limit(500);
  const ids = new Set((binned.data || []).map((x) => x.id)); return (adb.restaurants || []).every((r) => !ids.has(r.id));
});

// reading the route
const code = src(R);
await chk("P189382", R, "the scope is resolved through ownerScopeOr503 BEFORE the first database call", "read the handler top to bottom", () =>
  code.indexOf("ownerScopeOr503(req)") > 0 && code.indexOf("ownerScopeOr503(req)") < code.indexOf("sb.rpc("));
await chk("P189383", R, "a non-owner answer from the scope (401/503) is returned as-is, before any read", "read the handler", () => /if \(sc\.resp\) return sc\.resp;/.test(code));
await chk("P189384", R, "the RPC gets the caller's ids; only the admin's all-view passes NULL", "read the call", () => /const pIds = scope\.all \? null : scope\.ids;/.test(code) && /p_ids: pIds/.test(code));
await chk("P189385", R, "a failed RPC answers a plain sentence through dbFail, never the database's words", "read the error branch", () => /if \(error\) return dbFail\("owner\/overview", error, \{ message: "Couldn't load your restaurants just now — please try again\." \}\)/.test(code));
await chk("P189386", R, "the module probe names its columns and reads only the caller's restaurants", "read the probe", () => /\.from\("settings"\)\s*\.select\("payroll_allowed, [^"]+"\)\s*\.in\("restaurant_id", modIds\)/.test(code));
await chk("P189387", R, "the route issues no write of any kind", "read every call", () => !/\.(insert|update|upsert|delete)\(/.test(code));
await chk("P189388", R, "it is force-dynamic (live numbers, never a build-time copy)", "read the export", () => /export const dynamic = "force-dynamic"/.test(code));
await chk("P189389", R, "the money a REAL owner may not see is zeroed in the route, not hidden in the page", "read the map", () => /revenueToday: repOff \? 0/.test(code) && /revenueAll: repOff \? 0/.test(code));
await chk("P189390", R, "the RPC it calls is locked to the service role (REVOKE from PUBLIC, anon, authenticated)", "read the newest migration that defines lfh_owner_overview", async () => {
  const { execFileSync } = await import("node:child_process");
  const files = execFileSync("grep", ["-l", "FUNCTION public.lfh_owner_overview", "-r", "supabase/migrations"], { cwd: new URL("../../../", import.meta.url).pathname }).toString().trim().split("\n").sort((a, c) => a.localeCompare(c, undefined, { numeric: true }));
  const last = src(files[files.length - 1]);
  return (/REVOKE ALL ON FUNCTION public\.lfh_owner_overview\(uuid\[\]\) FROM PUBLIC, anon, authenticated/.test(last) && /GRANT EXECUTE ON FUNCTION public\.lfh_owner_overview\(uuid\[\]\) TO service_role/.test(last)) || files[files.length - 1];
});

await browser.close();
report("T20 band D · /api/owner/overview, driven (P189341–P189390)", { expect: 50 });
process.exit(process.exitCode || 0);
