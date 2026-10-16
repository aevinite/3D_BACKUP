// scripts/sweep/t1s10/rerun-n12.mjs — RE-RUN of T1.md N1–N2 (P15101–P15160): the moved-address door and the
// canonical-casing door, DRIVEN, then the same doors READ.
//
// WRITES — and only these: two rows in restaurant_slug_history, both belonging to French House (the restaurant
// this sweep writes to), keyed by their own slug, inserted at the start of the block and deleted by that key in
// a `finally` and on SIGINT/SIGTERM. Nothing on Aangan is written — the "a live restaurant's address" row
// names Aangan's ADDRESS as the retired slug, which is exactly the case the resolver must refuse.
import { R, src, code, ok, sql, BASE, FH } from "./lib.mjs";
import { newPage, done, open, withPage, cards } from "./browser.mjs";

const RP = "app/r/[restaurant]/menu/page.tsx", QP = "app/q/[code]/page.tsx", MENU = "app/menu/page.tsx", TEN = "lib/tenant.ts";
const OLD = "zz-t1-s10-old-address", LIVE_ADDR = "aangan-garden-restaurant";
const how = "asked lfh_slug_moved directly, then drove the door headless on :4401 (seeded history rows removed by key in the same run)";
const D = (id, file, title, fn) => R(id, file, title, fn, how);

let seeded = false;
async function seed() {
  if (seeded) return; seeded = true;
  await sql(`insert into restaurant_slug_history (slug, restaurant_id, replaced_by) values ('${OLD}', '${FH}', 'french-house'), ('${LIVE_ADDR}', '${FH}', 'french-house') on conflict (slug) do nothing`);
}
export async function unseed() { await sql(`delete from restaurant_slug_history where slug in ('${OLD}', '${LIVE_ADDR}') and restaurant_id = '${FH}'`); }
for (const s of ["SIGINT", "SIGTERM"]) process.once(s, () => { unseed().finally(() => process.exit(130)); });
const moved = async (slug) => (await sql(`select public.lfh_slug_moved('${slug.replace(/'/g, "''")}') as m`))[0].m;
const hops = (p) => { const out = []; p.on("response", (r) => { if (r.status() >= 300 && r.status() < 400) out.push(`${r.status()} ${new URL(r.url()).pathname}`); }); return out; };
const tables = (p) => p.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => /^lfh_table/.test(k)).map((k) => [k, localStorage.getItem(k)])));

D("P15101", TEN, `lfh_slug_moved("${OLD}") → french-house`, async () => { await seed(); const m = await moved(OLD); return ok(m === "french-house", String(m)); });
D("P15102", TEN, "…and it folds case", async () => { await seed(); const m = await moved(OLD.toUpperCase()); return ok(m === "french-house", String(m)); });
D("P15103", TEN, "…and it trims", async () => { await seed(); const m = await moved(`  ${OLD}  `); return ok(m === "french-house", String(m)); });
D("P15104", TEN, "an address a LIVE restaurant holds is never redirected", async () => { await seed(); const m = await moved(LIVE_ADDR); return ok(m === null, String(m)); });
D("P15105", TEN, "an address nobody had answers null", async () => ok((await moved("zz-never-was-t1s10")) === null));
let landed = null;
const land = async (q = "") => { await seed(); const p = await newPage(); const h = hops(p); const res = await open(p, `/r/${OLD}/menu${q}`); return { p, h, res }; };
D("P15106", RP, "an old printed address lands on the right menu", async () => { const { p, res, h } = await land(); try { landed = { url: p.url(), status: res.status(), n: await cards(p), h }; return ok(new URL(p.url()).pathname === "/r/french-house/menu", p.url()); } finally { await done(p); } });
D("P15107", RP, "…with a 200", async () => ok(landed?.status === 200, String(landed?.status)));
D("P15108", RP, "…and real dishes on it", async () => ok(landed?.n > 0, `${landed?.n}`));
D("P15109", RP, "the hop is temporary (307), never cached for ever", async () => ok(landed?.h.length === 1 && /^307 /.test(landed.h[0]), JSON.stringify(landed?.h)));
D("P15110", RP, "?table= survives the hop (then leaves the bar, 2026-08-30)", async () => { const { p } = await land("?table=12"); try { const t = await tables(p); return ok(t["lfh_table:french-house"] === "12", `${p.url()} · ${JSON.stringify(t)}`); } finally { await done(p); } });
D("P15111", RP, "…and the table is stored", async () => { const { p } = await land("?table=12"); try { const t = await tables(p); return ok(Object.values(t).includes("12"), JSON.stringify(t)); } finally { await done(p); } });
D("P15112", RP, "…under the NEW address's scope", async () => { const { p } = await land("?table=12"); try { const t = await tables(p); return ok(!Object.keys(t).some((k) => k.includes(OLD)), JSON.stringify(t)); } finally { await done(p); } });
D("P15113", RP, "every parameter survives, not just table", async () => { await seed(); const p = await newPage(); const reqs = []; p.on("request", (r) => { if (r.isNavigationRequest()) reqs.push(r.url()); }); try { await open(p, `/r/${OLD}/menu?t=3&utm=qr`); const hop = reqs.find((u) => /\/r\/french-house\/menu/.test(u)) || ""; return ok(/t=3/.test(hop) && /utm=qr/.test(hop), hop); } finally { await done(p); } });
D("P15114", RP, "a retired address in capitals still lands right", async () => { await seed(); const p = await newPage(); try { await open(p, `/r/${OLD.toUpperCase()}/menu?table=5`); return ok(new URL(p.url()).pathname === "/r/french-house/menu", p.url()); } finally { await done(p); } });
D("P15115", RP, "…in ONE scope", async () => { await seed(); const p = await newPage(); try { await open(p, `/r/${OLD.toUpperCase()}/menu?table=5`); const t = await tables(p); return ok(Object.keys(t).length === 1 && t["lfh_table:french-house"] === "5", JSON.stringify(t)); } finally { await done(p); } });
D("P15116", RP, "at most one hop, no loop", async () => ok(landed?.h.length === 1, JSON.stringify(landed?.h)));
D("P15117", TEN, "seeded a history row claiming a LIVE restaurant's address", async () => { await seed(); const r = await sql(`select restaurant_id from restaurant_slug_history where slug='${LIVE_ADDR}'`); return ok(r[0]?.restaurant_id === FH, "French House's row names Aangan's address"); });
D("P15118", RP, "the live holder keeps its own address and menu", () => withPage(`/r/${LIVE_ADDR}/menu`, async (p) => { const t = await p.title(); return ok(new URL(p.url()).pathname === `/r/${LIVE_ADDR}/menu` && /AANGAN/i.test(t), t); }));
D("P15119", RP, "a retired address whose restaurant is BINNED (and off) stays closed — re-aimed: no live-but-off restaurant exists", async () => { const r = await sql(`select public.lfh_slug_moved('demo-bistro') m`); return withPage("/r/demo-bistro/menu", async (p, res) => ok(r[0].m === null && res.status() === 404, `resolver ${r[0].m}, page ${res.status()}`)); });
D("P15120", RP, "…and the diner sees a guest page", () => withPage("/r/demo-bistro/menu", async (p) => { const t = await p.evaluate(() => document.body.innerText); return ok(!/aevidine/i.test(t) && /available|exist/.test(t), t.replace(/\s+/g, " ").slice(0, 80)); }));
for (const [ids, label, slug] of [[["P15121", "P15122", "P15123"], "Title-Case", "French-House"], [["P15124", "P15125", "P15126"], "ALL CAPS", "FRENCH-HOUSE"], [["P15127", "P15128", "P15129"], "mIxEd", "fReNcH-HoUsE"]]) {
  let r = null;
  const go = async () => { if (r) return r; const p = await newPage(); try { const res = await open(p, `/r/${slug}/menu?table=8`); await p.click('button[aria-label="List view"]').catch(() => {}); await p.waitForTimeout(200); r = { url: p.url(), status: res.status(), keys: await p.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter((k) => /^lfh_/.test(k) && k.includes(":"))) }; return r; } finally { await done(p); } };
  D(ids[0], RP, `${label} → one canonical address`, async () => { const x = await go(); return ok(new URL(x.url).pathname === "/r/french-house/menu", x.url); });
  D(ids[1], RP, `${label}: every scoped key is lower case`, async () => { const x = await go(); return ok(x.keys.length > 0 && x.keys.every((k) => k === k.toLowerCase() || !/[A-Z]/.test(k.split(":").pop())), x.keys.join(",")); });
  D(ids[2], RP, `${label}: 200`, async () => { const x = await go(); return ok(x.status === 200, String(x.status)); });
}
D("P15130", RP, "the ordinary case does no redirect at all", async () => { const p = await newPage(); const h = hops(p); try { await open(p, "/r/french-house/menu?table=3"); return ok(h.length === 0, JSON.stringify(h)); } finally { await done(p); } });
const hopQuery = async (path) => { const p = await newPage(); const nav = []; p.on("request", (r) => { if (r.isNavigationRequest()) nav.push(r.url()); }); try { await open(p, path); const u = nav.find((x) => /\/r\/french-house\/menu/.test(x)); return u ? new URL(u).search : null; } finally { await done(p); } };
let qs = null;
const Q = "?table=4&a=1&a=2&b=%20sp%20";
const queries = async () => { if (qs) return qs; await seed(); qs = { moved: await hopQuery(`/r/${OLD}/menu${Q}`), casing: await hopQuery(`/r/French-House/menu${Q}`), legacy: await hopQuery(`/menu${Q}`) }; return qs; };
D("P15131", RP, "moved-address and casing doors carry an identical query", async () => { const q = await queries(); return ok(q.moved === q.casing && !!q.moved, `${q.moved} vs ${q.casing}`); });
D("P15132", RP, "…including a repeated parameter", async () => { const q = await queries(); return ok(/a=1&a=2/.test(q.moved || ""), q.moved); });
D("P15133", RP, "…and an encoded space", async () => { const q = await queries(); return ok(/b=\+sp\+|b=%20sp%20/.test(q.moved || ""), q.moved); });
D("P15134", MENU, "the legacy /menu door agrees", async () => { const q = await queries(); return ok(q.legacy === q.casing, `${q.legacy} vs ${q.casing}`); });
// ═════ N2 · door ordering and tenant resolution, READ ═════
const S = (id, file, title, fn) => R(id, file, title, fn, "read the door pages and lib/tenant.ts with comments stripped (TypeScript parser)");
const page = () => code(RP), body = () => { const c = page(); return c.slice(c.indexOf("export default async function RestaurantMenuPage")); };
S("P15135", RP, "the moved question is asked ONLY when the address resolves to nothing", () => /if \(!r\) \{\s*const moved = await slugMovedTo\(restaurant\);/.test(body()));
S("P15136", RP, "…so a real menu load never pays for it", () => body().indexOf("slugMovedTo(") > body().indexOf("if (!r) {"));
S("P15137", RP, "an existing but switched-off restaurant is refused, never redirected", () => { const b = body(); return b.indexOf("if (!r || !r.active) notFound();") > b.indexOf("slugMovedTo(") && /if \(!r\) \{[\s\S]*?\}\s*if \(!r \|\| !r\.active\) notFound\(\);/.test(b); });
S("P15138", RP, "the Menu master switch is checked before anything renders", () => body().indexOf("if (!settings.menuEnabled) notFound();") < body().indexOf("return ("));
S("P15139", RP, "the canonical hop happens before the page renders", () => body().indexOf("if (restaurant !== r.slug)") < body().indexOf("return ("));
S("P15140", RP, "…and after the refusals", () => body().indexOf("if (restaurant !== r.slug)") > body().indexOf("if (!settings.menuEnabled) notFound();"));
S("P15141", RP, "both hops use the same query builder", () => (body().match(/queryStringOf\(await searchParams\)/g) || []).length === 2);
S("P15142", RP, "the moved hop names the CURRENT address", () => /redirect\(`\/r\/\$\{moved\}\/menu/.test(body()) && /SELECT r\.slug/.test(src("supabase/migrations/350_an_old_web_address_still_finds_the_restaurant.sql") || ""));
S("P15143", RP, "the canonical hop names the RESOLVED slug", () => /redirect\(`\/r\/\$\{r\.slug\}\/menu/.test(body()));
S("P15144", RP, "neither hop is permanent", () => !/permanentRedirect/.test(page()) && !/RedirectType\.(replace|push)/.test(page()));
S("P15145", RP, "generateMetadata never redirects", () => { const c = page(); const m = c.slice(c.indexOf("export async function generateMetadata"), c.indexOf("export default async function")); return !/redirect\(|notFound\(/.test(m); });
S("P15146", TEN, "getRestaurantBySlug folds case in ONE place", () => /const slug = String\(slugRaw \|\| ""\)\.trim\(\)\.toLowerCase\(\);/.test(code(TEN)) && !/toLowerCase\(\)/.test(page()));
S("P15147", TEN, "the cache is keyed on the folded value", () => /const hit = bySlug\.get\(slug\);/.test(code(TEN)) && /bySlug\.set\(slug,/.test(code(TEN)));
S("P15148", TEN, "a failed lookup is never cached as 'no such restaurant'", () => { const f = code(TEN); const e = f.indexOf("if (error) {"), s = f.indexOf("bySlug.set(slug,"); return e > 0 && s > e && /throw new Error\(`Couldn't look up restaurant/.test(f); });
S("P15149", TEN, "…and it stands on the last real answer first", () => /if \(hit && Date\.now\(\) - hit\.at < STALE_ON_ERROR_MS\) return hit\.value;/.test(code(TEN)));
S("P15150", TEN, "slugMovedTo never throws", () => { const f = code(TEN); const b = f.slice(f.indexOf("export async function slugMovedTo")); return /try \{/.test(b) && /\} catch \{\s*return hit \? hit\.value : null;/.test(b) && !/throw /.test(b.slice(0, b.indexOf("export function queryStringOf"))); });
S("P15151", TEN, "…and it caches both a hit and a miss", () => /movedSlug\.set\(slug, \{ value: to, at: Date\.now\(\) \}\);/.test(code(TEN)));
S("P15152", TEN, "a binned restaurant resolves to null", () => /data && !data\.deleted_at\s*\?/.test(code(TEN)));
S("P15153", TEN, "the guest row comes through ONE security-definer function", () => /\.rpc\("lfh_guest_restaurant", \{ p_slug: slug \}\)/.test(code(TEN)) && !/\.from\("restaurants"\)/.test(code(TEN)));
// Runs OUR OWN lib/tenant.ts helper body (no outside input) so the row tests the real function, not a copy.
const qsOf = async () => { const m = await import("node:module"); void m; const f = code(TEN); const fn = f.slice(f.indexOf("export function queryStringOf"), f.indexOf("return s ? `?${s}` : \"\";") + 30).replace(/^export /, "").replace(/: Record<string, string \| string\[\] \| undefined>/, "").replace(/: string/, ""); return new Function(`${fn}; return queryStringOf;`)(); };
S("P15154", TEN, "queryStringOf returns '' for an empty query", async () => (await qsOf())({}) === "");
S("P15155", TEN, "queryStringOf skips null/undefined", async () => (await qsOf())({ a: undefined, b: null, c: "1" }) === "?c=1");
S("P15156", TEN, "queryStringOf appends every value of a repeated parameter", async () => (await qsOf())({ a: ["1", "2"] }) === "?a=1&a=2");
S("P15157", MENU, "the legacy /menu door builds the SAME query shape (its own copy)", () => /for \(const \[k, v\] of Object\.entries\(sp\)\) \{\s*if \(v == null\) continue;\s*if \(Array\.isArray\(v\)\) v\.forEach\(\(x\) => qs\.append\(k, x\)\);\s*else qs\.append\(k, v\);/.test(code(MENU)));
S("P15158", QP, "/q resolves code → restaurant → settings inside ONE cached call", () => /const resolveCode = cache\(async function resolveCode[\s\S]*?getSettings\(r\.id\)/.test(code(QP)));
S("P15159", QP, "…so generateMetadata and the page share the same reads", () => (code(QP).match(/await resolveCode\(code\)/g) || []).length === 2);
S("P15160", QP, "/q never redirects", () => !/redirect\(/.test(code(QP)));
R("P15160z", TEN, "(cleanup) the two seeded history rows are gone", async () => { await unseed(); const r = await sql(`select count(*)::int n from restaurant_slug_history where slug in ('${OLD}', '${LIVE_ADDR}')`); return ok(r[0].n === 0, `${r[0].n} left`); }, "deleted by key, read back");
