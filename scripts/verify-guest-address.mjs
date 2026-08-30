// verify:guest-address — a restaurant created on a REUSED web address serves its OWN guest menu.
//
// WHERE THIS BITES: the guest menu — a diner's own screen — for any restaurant created on an
// address a binned or permanently-removed restaurant used to hold. Admin console → Restaurants →
// New restaurant is where that situation is made.
//
// WHY IT EXISTS. Sweep #7 T16 found that such a restaurant could answer "this menu isn't available
// right now" on its own address, while Admin → Restaurants listed it as Active and healthy. Three
// decisions that are each right on their own combined into it:
//
//   · mig 309 — a purge KEEPS the restaurants row (the retained bills hang off it), and that row
//     keeps its slug;
//   · mig 319 — the slug's unique index is PARTIAL (`WHERE deleted_at IS NULL`), so a binned name
//     is free for a new restaurant to take;
//   · mig 282 — `lfh_guest_restaurant(p_slug)` was `WHERE r.slug = p_slug LIMIT 1`, with no
//     `deleted_at` filter and no ORDER BY.
//
// Two rows legitimately hold one slug, and an unordered LIMIT 1 picked either. Migration 370 makes
// the choice deterministic and puts the LIVE restaurant first. It was INTERMITTENT before, so the
// live half below runs the whole loop rather than reading the answer once.
//
// STATIC by default — it reads two files and needs no database:
//     node scripts/verify-guest-address.mjs
// With a base URL it ALSO drives the real thing once (creates and removes its own rows, by id):
//     npm run verify:guest-address -- --base http://localhost:4000
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const baseArg = args.indexOf("--base");
const BASE = baseArg >= 0 ? args[baseArg + 1] : null;
const ROOT = args.find((a) => !a.startsWith("--") && a !== BASE) || join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return ""; } };
let failed = 0;
const ok = (m) => console.log("  ✓ " + m);
const bad = (m) => { console.log("  ✗ " + m); failed++; };
const want = (c, m) => (c ? ok(m) : bad(m));

console.log("\nA restaurant on a reused web address serves its own menu");

// ── 1 · the LATEST definition of the resolver is the ordered one ───────────────────────────────
// Read the migration folder rather than one file: a later migration may CREATE OR REPLACE this
// function again, and the last definition is the one the database ends up with.
const migDir = join(ROOT, "supabase/migrations");
let defs = [];
try {
  defs = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort()
    .map((f) => ({ f, sql: readFileSync(join(migDir, f), "utf8") }))
    .filter((x) => /CREATE OR REPLACE FUNCTION\s+(public\.)?lfh_guest_restaurant/i.test(x.sql));
} catch { /* reported below */ }
want(defs.length > 0, `the guest resolver is defined in a migration (found ${defs.length})`);
const last = defs[defs.length - 1];
if (last) {
  console.log(`  · its last definition is ${last.f}`);
  // the body of THAT definition only
  const body = (last.sql.match(/CREATE OR REPLACE FUNCTION\s+(?:public\.)?lfh_guest_restaurant[\s\S]*?\$\$;/i) || [""])[0];
  want(/FROM\s+restaurants\s+r/i.test(body) && /WHERE\s+r\.slug\s*=\s*p_slug/i.test(body),
    "…it still resolves a slug off `restaurants`");
  want(/ORDER BY\s*\(\s*r\.deleted_at IS NULL\s*\)\s*DESC/i.test(body),
    "…and the LIVE row on that address is ordered FIRST (this is the fix — without it, an unordered LIMIT 1 can answer with a removed restaurant)");
  want(/LIMIT\s+1/i.test(body), "…and it still answers with exactly one row");
  want(/created_at\s+DESC/i.test(body),
    "…with a deterministic tie-break for the case where every row on the address is gone");
  // The guest slice must not have grown while somebody was in here.
  for (const k of ["access_config", "manager_permissions", "owner_entitlements", "owner_user_id"]) {
    want(body.includes(`'${k}'`), `…and '${k}' is still stripped from what a guest is handed`);
  }
  want(/GRANT EXECUTE ON FUNCTION lfh_guest_restaurant\(text\) TO anon/i.test(last.sql)
    || defs.some((d) => /GRANT EXECUTE ON FUNCTION lfh_guest_restaurant\(text\) TO anon/i.test(d.sql)),
    "…and it is granted to anon on purpose (a guest is not signed in)");
}

// ── 2 · the reasoning stands on the partial unique index ───────────────────────────────────────
// "at most ONE live row per slug" is what makes the first ORDER BY key decide the answer. If that
// index ever loses its WHERE clause the ordering is still right, but the argument for it changes —
// so this is checked, not assumed.
const allSql = (() => { try { return readdirSync(migDir).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(join(migDir, f), "utf8")).join("\n"); } catch { return ""; } })();
want(/unique\s+index[\s\S]{0,200}restaurants[\s\S]{0,200}\(\s*slug\s*\)[\s\S]{0,120}where[\s\S]{0,60}deleted_at\s+is\s+null/i.test(allSql)
  || /on\s+public\.restaurants\s*\(\s*lower\(slug\)\s*\)[\s\S]{0,120}where[\s\S]{0,60}deleted_at\s+is\s+null/i.test(allSql),
  "the slug's unique index is still PARTIAL on `deleted_at is null` — which is what makes 'at most one live row per address' true");

// ── 3 · the caller still nulls a closed restaurant itself ──────────────────────────────────────
// Migration 370 ORDERS rather than FILTERS, precisely because lib/tenant.ts turns a row carrying
// deleted_at into null on its own. If that ever moves, the ordering alone stops being enough.
const TEN = read("lib/tenant.ts");
want(/data && !data\.deleted_at/.test(TEN),
  "lib/tenant.ts still turns a row carrying `deleted_at` into null itself (mig 370 orders rather than filters BECAUSE of this)");
want(/slugMovedTo/.test(TEN),
  "…and a null still falls through to the retired-address redirect (mig 350), so an old printed code is unaffected");

// ── 4 · the live half, when a base URL is given ─────────────────────────────────────────────────
if (!BASE) {
  console.log("\n  · static only. Pass `-- --base http://localhost:4000` to also drive the real loop once.");
} else {
  const { adminCookie } = await import(join(ROOT, "scripts/sweep/login.mjs"));
  const c = adminCookie(BASE);
  const H = { "Content-Type": "application/json", cookie: `${c.name}=${c.value}` };
  const api = async (p, i) => { const r = await fetch(BASE + p, { ...i, headers: { ...H, ...(i?.headers || {}) } }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  const create = (name) => api("/api/admin/restaurants", { method: "POST", body: JSON.stringify({ action: "create_restaurant", name, panels: { manager: true, kitchen: true, tablet: true, owner: false }, seedMenu: false }) });
  const remove = async (id) => {
    await api("/api/admin/restaurants", { method: "POST", body: JSON.stringify({ action: "set_restaurant_active", restaurant_id: id, active: false }) });
    await api("/api/admin/restaurants", { method: "POST", body: JSON.stringify({ action: "soft_delete_restaurant", restaurant_id: id, reason: "verify:guest-address" }) });
    await api("/api/admin/restaurants", { method: "POST", body: JSON.stringify({ action: "purge_restaurant", restaurant_id: id }) });
  };
  const NAME = "zzguestaddr " + Date.now().toString(36);
  const made = [];
  const clean = async () => { for (const id of made.splice(0)) await remove(id).catch(() => {}); };
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await clean(); process.exit(1); });
  console.log("\n  Driving it: create → remove for good → create again on the freed address → open its menu");
  try {
    const a = await create(NAME);
    if (a.s !== 200 || !a.j.id) { bad(`couldn't create the first restaurant (${a.s})`); }
    else {
      const slug = a.j.slug;
      made.push(a.j.id);
      await new Promise((r) => setTimeout(r, 1500));
      want((await fetch(`${BASE}/r/${slug}/menu`, { redirect: "manual" })).status === 200,
        "a brand-new restaurant serves its own guest menu");
      await remove(made.pop());
      const b = await create(NAME);
      if (b.s !== 200 || !b.j.id) bad(`couldn't create the second restaurant on the freed address (${b.s})`);
      else {
        made.push(b.j.id);
        want(b.j.slug === slug, `…the second one really is minted on the same address (${b.j.slug})`);
        await new Promise((r) => setTimeout(r, 1600));
        const st = (await fetch(`${BASE}/r/${b.j.slug}/menu`, { redirect: "manual" })).status;
        want(st === 200, `…and IT serves its own menu too, not the removed restaurant's 404 (got ${st})`);
      }
    }
  } finally {
    await clean();
    const live = (await api("/api/admin/restaurants")).j.restaurants || [];
    const bin = (await api("/api/admin/restaurants?deleted=1")).j.trashed || [];
    const leftOver = [...live, ...bin].filter((r) => /zzguestaddr/i.test(r.name + r.slug)).length;
    want(leftOver === 0, `cleanup — every row this check created is gone (${leftOver} left)`);
  }
}

console.log(failed
  ? `\n✗ ${failed} check${failed === 1 ? "" : "s"} failed — a restaurant on a reused web address may not serve its own menu\n`
  : "\n✓ the live restaurant on a web address is the one a guest reaches\n");
process.exit(failed ? 1 : 0);
