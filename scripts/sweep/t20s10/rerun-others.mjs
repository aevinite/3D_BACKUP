// Re-runs the rows OTHER terminals' ledgers hold about this territory's files (T17-S10, T20, T25,
// T30, T29, T28-S9-R2, T11, T30-S10, T22, T14, T27, T18-S10, T13-S10). Found by grepping every ledger
// for the eleven file names. Rows that only MENTION one of the names but are about another file
// (the manager panel's dashRangeToggleHtml in app.js, /owner/menu, the Charts.tsx heatmap, the Reports
// page) are left alone — they are another terminal's.
//
// Each row is re-proved here on today's code: by reading, by driving, or by pointing at the band row
// of THIS run that drove the same thing (the band JSON is read, never a typed claim).
//
//   npx tsx --env-file=.env.local scripts/sweep/t20s10/rerun-others.mjs --base http://localhost:4420 --bands=<dir> --json=<file>
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { src, rel, ROOT, BASE, arg } from "./lib.mjs";
import { loginAs, adminHeaders } from "../login.mjs";

const bandsDir = arg("bands", "");
const band = new Map();
for (const f of ["a", "b", "c", "d", "e", "f", "g"]) {
  const p = join(bandsDir, `band-${f}.json`);
  if (existsSync(p)) for (const r of JSON.parse(readFileSync(p, "utf8"))) band.set(r.id, r);
}
const out = [];
const re = async (id, fn) => { let r; try { r = await fn(); } catch (e) { r = { ok: false, note: `threw: ${e.message}` }; } out.push({ id, ...r }); };
const ok = (n) => ({ ok: true, note: n }), no = (n) => ({ ok: false, note: n });
/** the result of a row THIS run's bands wrote — a band row that did not pass makes this row fail too */
const via = (ids, what) => {
  const rs = ids.map((i) => band.get(i));
  if (rs.some((r) => !r)) return no(`band rows missing: ${ids.filter((i, k) => !rs[k]).join(", ")} — run the bands with --json first`);
  const bad = rs.filter((r) => r.pass !== true);
  return bad.length ? no(`${what} — ${bad.map((b) => `${b.id} ${b.why}`).join("; ")}`) : ok(`${what} — driven again in this run as ${ids.join(", ")}`);
};
const OV = src("app/api/owner/overview/route.ts"), L = src("app/owner/layout.tsx"), P = src("app/owner/page.tsx");
const SCOPE = src("lib/ownerScope.ts");

// ── T17-S10 ──────────────────────────────────────────────────────────────────────────────────────
for (const id of ["P186730", "P186738"]) await re(id, () => via(["P189342", "P189359"], "every restaurant_id in the overview is one the caller owns (one- and two-restaurant owners)"));
await re("P186760", () => via(["P189342", "P189343"], "the one-restaurant owner: exactly the restaurants they own"));
await re("P186770", () => via(["P189359", "P189360"], "the two-restaurant owner: exactly the restaurants they own"));
await re("P186848", () => via(["P189382", "P189383"], "gated by ownerScopeOr503 before the first database call"));
// T17's thirteen mutation rows and its two break-it rows — re-run by rerun-layout-mutations.mjs
const mut = existsSync(join(bandsDir, "mutations.json")) ? JSON.parse(readFileSync(join(bandsDir, "mutations.json"), "utf8")) : [];
for (const m of mut) out.push({ id: m.id, ok: m.pass, note: m.why });
// item 37's signed-out pages, driven exactly as T17 did
{
  const b = await chromium.launch();
  for (const [id, path] of [["P163952", "/owner/reports?range=week"], ["P163953", "/owner/menu"], ["P163954", "/owner/inventory"], ["P163955", "/owner/manager"],
    ["P163956", "/owner/staff?tab=pay#top"], ["P163957", "/owner"], ["P163982", "/owner/reports?range=week"], ["P163983", "/owner/menu"],
    ["P163992", "/owner/reports?range=week"], ["P163993", "/owner/menu"], ["P163994", "/owner/staff"]]) {
    const c = await b.newContext({ serviceWorkers: "block" }); const pg = await c.newPage();
    await pg.goto(BASE + path, { waitUntil: "load", timeout: 120000 }); await pg.waitForURL(/\/login/, { timeout: 30000 }).catch(() => {});
    const u = new URL(pg.url());
    await re(id, () => (u.pathname === "/login" && u.searchParams.get("next") === path)
      ? ok(`signed out, ${path} reaches the sign-in card carrying itself as ?next (fresh browser, port 4420)`) : no(`landed on ${pg.url()}`));
    await c.close();
  }
  const c = await b.newContext({ serviceWorkers: "block" }); await loginAs(c, "owner", BASE);
  const pg = await c.newPage(); await pg.goto(BASE + "/owner/reports", { waitUntil: "load", timeout: 120000 }); await pg.waitForTimeout(2500);
  const stay = new URL(pg.url()).pathname === "/owner/reports";
  for (const id of ["P163960", "P163996"]) await re(id, () => stay ? ok("a signed-in owner opening /owner/reports stays there") : no(`moved to ${pg.url()}`));
  await c.close();
  // T20.md P09827 / P09828 — the admin's two overview questions, as the console asks them
  const a = await b.newContext({ extraHTTPHeaders: adminHeaders(BASE) });
  const all = await (await a.request.get(`${BASE}/api/owner/overview?_=1`)).json();
  const fhId = "00000000-0000-0000-0000-000000000001";
  const one = await (await a.request.get(`${BASE}/api/owner/overview?_=1&scope=${fhId}`)).json();
  await re("P09827", () => (Array.isArray(all.restaurants) && all.restaurants.length > 2 && all.totals && all.entitlements && all.modules)
    ? ok(`the admin with no pin: ${all.restaurants.length} restaurants + totals + entitlements + modules`) : no(JSON.stringify(Object.keys(all))));
  // The pin opens what French House's OWNER sees — every restaurant that owner owns (lib/ownerScope:
  // primary owner_user_id when a member, widened through restaurant_owners). Compared with that list,
  // read from the dev database (reads only).
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const prim = (await db.from("restaurants").select("owner_user_id").eq("id", fhId).maybeSingle()).data?.owner_user_id;
  const links = (await db.from("restaurant_owners").select("restaurant_id").eq("user_id", prim).limit(500)).data || [];
  const liveIds = new Set(((await db.from("restaurants").select("id").in("id", links.map((l) => l.restaurant_id)).is("deleted_at", null).limit(500)).data || []).map((r) => r.id));
  const got = new Set((one.restaurants || []).map((r) => r.id));
  await re("P09828", () => (got.size === liveIds.size && [...got].every((x) => liveIds.has(x)) && got.has(fhId))
    ? ok(`the admin pinned to French House sees exactly what French House's owner owns — ${got.size} live restaurants, compared with restaurant_owners`)
    : no(`answer ${[...got].length} vs owner owns ${liveIds.size}`));
  await a.close(); await b.close();
}
// item 37 / OwnedLookupFailed break-its — the same gate T17 used, on today's file
{
  const FILE = rel("app/owner/layout.tsx"); const ORIG = readFileSync(FILE, "utf8");
  const breakIt = (from, to) => {
    if (!ORIG.includes(from)) return "anchor gone";
    writeFileSync(FILE, ORIG.replace(from, to));
    try { const r = spawnSync("node", ["scripts/verify-t25-login-and-panel-apis.mjs"], { cwd: ROOT, encoding: "utf8" }); return r.status === 0 ? "SURVIVED" : null; }
    finally { writeFileSync(FILE, ORIG); }
  };
  const a = breakIt("return <SignInBounce />;", 'redirect("/login?next=/owner");');
  await re("P163945", () => a === null ? ok("undoing item 37 (a fixed /owner bounce) turns verify:t25-doors red — re-run on today's file, restored byte for byte") : no(a));
  const c = breakIt("e instanceof AuthDbError || e instanceof OwnedLookupFailed", "e instanceof AuthDbError");
  await re("P163950", () => c === null ? ok("dropping OwnedLookupFailed from the reconnect catch turns verify:t25-doors red — restored byte for byte") : no(c));
  if (readFileSync(FILE, "utf8") !== ORIG) throw new Error("layout.tsx not restored");
}

// ── T20.md — the overview route, read and driven ──────────────────────────────────────────────────
const handler = OV.slice(OV.indexOf("export async function GET"));
await re("P09656", () => /return NextResponse\.json\(\{/.test(handler) && /if \(sc\.resp\) return sc\.resp;/.test(handler) && /if \(error\) return dbFail\(/.test(handler) ? ok("every branch returns: the scope's own answer, dbFail, or the JSON") : no("a branch falls through"));
await re("P09657", () => /if \(error\) return dbFail/.test(OV) && /if \(probe\.error\)/.test(OV) ? ok("both reads inspect .error; the module probe degrades to 'modules' in partial and keeps the cards") : no("an error unchecked"));
await re("P09658", () => /payroll = true; inventory = true;/.test(OV) && /partial\.push\("modules"\)/.test(OV) ? ok("a failed probe is never shown as 'no module' — it keeps the cards and names itself") : no("failure becomes a claim"));
await re("P09659", () => via(["P189384"], "the scope goes INTO the RPC (p_ids), not filtered afterwards"));
await re("P09660", () => /ownerScopeOr503\(req\)/.test(OV) && !/searchParams\.get\("(rid|restaurant_id)"\)/.test(OV) ? ok("the route reads no ?rid of its own; ownerScope decides, and a pin can only narrow (lib/ownerScope)") : no("reads a raw id"));
await re("P09733", () => via(["P189382"], "the scope resolves before the first database call"));
await re("P09771", () => via(["P189386"], "the one table read names its columns; the RPC returns one row per owned restaurant"));
await re("P24793", () => !/\.error[^;]*(not found|not enabled|not yours)/i.test(OV) ? ok("no refusal is decided from an unchecked error") : no("found one"));
await re("P24794", () => via(["P189354", "P189371"], "no failure becomes a claim (no partial on a healthy read; the probe failure keeps cards)"));
await re("P24795", () => /message: "Couldn't load your restaurants just now — please try again\."/.test(OV) ? ok("the one failure answer is a plain sentence through dbFail") : no("raw prose"));
await re("P24796", () => /\.in\("restaurant_id", modIds\)/.test(OV) ? ok("the settings probe is bounded by the caller's own ids (one row per restaurant); the RPC returns one row per restaurant") : no("unbounded"));
await re("P24797", () => via(["P189382"], "the gate runs before the first database call"));
await re("P24798", () => !/password|pin_hash|secret|token/i.test(OV.replace(/\/\/.*$/gm, "")) ? ok("no column it reads is a secret") : no("moves a secret"));
await re("P24859", () => /payroll = true; inventory = true;\s+\/\/ keep the cards/.test(OV) ? ok("item 17 holds: a failed module read keeps the pay card visible") : no("the card can vanish"));
await re("P24990", () => via(["P189341", "P189358"], "a real owner gets restaurants, totals, entitlements and modules"));
await re("P46956", () => existsSync(rel("app/api/owner/overview/route.ts")) ? ok("still exists; in sweep #10 it belongs to T20 (the owner's home dashboard), re-derived from today's file list") : no("gone"));
await re("P46957", () => via(["P189382", "P189385", "P189387"], "nothing changed since has broken its rules"));
await re("P46958", () => out.find((x) => x.id === "P24793")?.ok ? ok("no refusal from an unchecked error (as P24793)") : no("see P24793"));
await re("P46959", () => out.find((x) => x.id === "P24796")?.ok ? ok("every read still bounded (as P24796)") : no("see P24796"));
await re("P46960", () => via(["P189382"], "the gate still runs first"));
await re("P47017", () => /todayRev === 0 \? `\$\{todayOrd\} order/.test(P) && !/fetch\([^)]*today/.test(P) ? ok("item 26's wording is derived from the overview the page already holds — no extra query") : no("a query was added"));
// ── T25 ──────────────────────────────────────────────────────────────────────────────────────────
await re("P12042", () => via(["P189299", "P189300"], "an { error } body and a rejected request are both evicted at once"));
await re("P12043", () => via(["P189295"], "keyed by the scope suffix — two scopes never share an answer"));
await re("P12225", () => via(["P189257", "P189260", "P189265", "P189270"], "anything outside the reach resolves to today, never an error"));
await re("P12250", () => via(["P189325", "P189326", "P189327", "P189328"], "#1 → a picked restaurant → the oldest live one, executed against the dev database"));
await re("P12251", () => /eq\("username", key\)\.is\("deleted_at", null\)/.test(src("lib/ownerHome.ts")) ? ok("a binned account's name is free (deleted_at IS NULL)") : no("binned names block"));
await re("P12255", () => via(["P189281", "P189282", "P189285", "P189288", "P189292"], "sessionStorage only, versioned, size-capped, cleared on login"));
await re("P12359", () => via(["P189342", "P189359"], "an owner sees only their own restaurants"));
// ── T30 ──────────────────────────────────────────────────────────────────────────────────────────
await re("P14513", () => /sb\.rpc\("lfh_owner_overview"/.test(OV) && !/net_amount|discount|\* 1\.0?5/.test(OV) ? ok("the dashboard's money comes from the one RPC's stored net, no arithmetic of its own") : no("own arithmetic"));
for (const id of ["P14616", "P14647", "P29894"]) await re(id, () => via(["P189301", "P189299"], "the module cache has a TTL (8 s) and evicts failures — bounded"));
await re("P43883", () => via(["P189376", "P189377"], "the overview's today figure equals the analytics route's, to the rupee"));
// ── T29 ──────────────────────────────────────────────────────────────────────────────────────────
await re("P14173", () => via(["P189428"], "AutoFitNumbers mounted once per render path of the owner layout"));
await re("P14188", () => /from "@\/components\/owner\/AnimatedNumber"/.test(P) && spawnSync("npx", ["tsc", "-p", "tsconfig.typecheck.json"], { cwd: ROOT }).status === 0
  ? ok("AnimatedNumber.tsx (this territory's file of the eight) parses (typecheck green) and is imported by the dashboard") : no("unused or does not parse"));
await re("P14437", () => via(["P189411", "P189412"], "the owner panel names its tab 'Owner — Aevidine' (the admin console's half is T25's)"));
await re("P41859", () => via(["P189413", "P189414", "P189415", "P189416"], "the owner console paints its skin server-side from the cookie"));
// ── T28-S9-R2 ────────────────────────────────────────────────────────────────────────────────────
await re("P160641", () => /if \(!s\) return \{ resp: Response\.json\(\{ error: "unauthorized" \}, \{ status: 401 \}\) \};/.test(SCOPE)
  ? ok("re-proved by READING lib/ownerScope.ts → ownerScopeOr503: no owner and no admin → 401 before any read. Not demonstrated by calling the route without a login (S10-RULES §7)") : no("no 401 path"));
await re("P160669", () => via(["P189378"], "the admin with no pin sees every live restaurant"));
await re("P160936", () => via(["P189345", "P189346"], "the header totals are the sums of the rows"));
await re("P160937", () => via(["P189389"], "a withheld restaurant stays listed with its money zeroed (in the route)"));
// ── T11, T30-S10, T22, T14, T27, T18-S10, T13-S10 ────────────────────────────────────────────────
await re("P05483", () => via(["P189491"], "the page reads the shared de-duper, so the shell and the page cost one request"));
await re("P199438", () => /import \{ compactINR \} from "@\/lib\/money"/.test(P) && !/function compactINR/.test(P) ? ok("page.tsx imports compactINR; no private copy") : no("re-implemented"));
await re("P199563", () => via(["P189293", "P189301"], "the overview is shared for 8 s, then refreshed"));
await re("P104504", () => /net_today/.test(src("supabase/migrations/383_a_restaurant_in_the_bin_leaves_the_estate.sql")) ? ok("the overview RPC returns the stored net (net_amount), the same column the floor reads — migration 383's body, re-read") : no("two formulas"));
await re("P104524", () => via(["P189381"], "no binned restaurant in the admin's list"));
await re("P48673", () => via(["P189401", "P189402", "P189403"], "/owner/marketing renders its Coming-soon card"));
await re("P48674", () => via(["P189407", "P189408", "P189409"], "/owner/online renders its Coming-soon card"));
await re("P13360", () => !/useTranslation|lib\/i18n/.test(P) ? ok("still a staff surface: English-only by decision, no guest i18n layer; no code text on screen (band F P189432…)") : no("pulls guest i18n"));
await re("P187082", () => via(["P189256"], "every rung the access tree offers is one dashRange honours"));
await re("P169126", () => /const navOn = /.test(L) && (L.match(/navOn\(/g) || []).length >= 6 ? ok("every module read in the owner nav goes through navOn()") : no("a raw module read"));

const j = arg("json", "") || process.argv.find((a) => a.startsWith("--json="))?.slice(7);
if (j) { mkdirSync(dirname(j), { recursive: true }); writeFileSync(j, JSON.stringify(out, null, 1)); }
for (const r of out) if (r.ok !== true) console.log(`${r.ok === false ? "❌" : "⏭"} ${r.id} ${r.note.slice(0, 170)}`);
console.log(`\n${out.filter((r) => r.ok === true).length} ✅ · ${out.filter((r) => r.ok === false).length} ❌ · ${out.filter((r) => r.ok === null).length} ⏭ of ${out.length}`);
