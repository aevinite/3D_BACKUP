// verify-binned-restaurant-leaves — a restaurant in the recycle bin must not appear in, or add its
// money to, the owner's estate view.
//
// WHY THIS EXISTS. Measured through the real gate on 2026-09-15 (sweep #9 / T30, item 3):
// GET /api/owner/overview?scope=all — the whole-platform owner view the ADMIN opens — answered with
// 177 restaurant rows where FIFTY restaurants exist. The other 127 had been put in the recycle bin
// and came back with their takings: `totals.restaurantCount` read 177, and ₹7,30,621.50 of all-time
// revenue from removed restaurants was folded into the estate headline, ₹7,30,411.50 of it from one
// removed restaurant. Migration 128 created `restaurants.deleted_at` precisely so a removed
// restaurant leaves the live views; `lfh_owner_overview` was written in migration 088, before the
// bin existed, and rewritten six times since without ever gaining the filter.
//
// THE FIX HAD TWO HALVES AND THIS CHECKS BOTH, because either one alone rots:
//   • `lib/ownerScope.ts` → scopedRestaurantIds() stops handing out binned ids ({ all: true }).
//   • migration 383 puts the same filter INSIDE lfh_owner_overview, because CLAUDE.md's SaaS rule
//     is that the business rule lives in the RPC and never in app-code filtering alone.
//
// ⚠️ THIS IS NOT THE DELETED-BILL RULE. docs/COMPLIANCE-GUARDRAILS.md §4 REQUIRES a soft-deleted
// BILL to stay in the owner's revenue, and migration 309 states the asymmetry. That is
// `orders.deleted_at`. This is `restaurants.deleted_at`. Nothing here changes a live restaurant's
// figures by a paisa, and this guard never asserts anything about a bill.
//
//   node scripts/verify-binned-restaurant-leaves.mjs                        # source + live DB
//   node scripts/verify-binned-restaurant-leaves.mjs --base http://localhost:4430   # + the real API
//
// Exit 1 = a binned restaurant is back in the estate. Exit 2 = could not run.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let bad = 0;
const ok = (s, m) => { console.log(`${s ? "✓" : "✗"} ${m}`); if (!s) bad++; };
const head = (t) => console.log(`\n── ${t}`);
const R = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };
const strip = (t) => t.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

// ── A · the app-code half: the id list itself ────────────────────────────────────────────────
head("A · scopedRestaurantIds() does not hand out a binned restaurant");
{
  const src = R("lib/ownerScope.ts");
  ok(!!src, "lib/ownerScope.ts is readable");
  if (src) {
    // The { all: true } branch pages `restaurants`. Find that read and require the filter ON IT,
    // not merely somewhere in the file — a deleted_at fifty lines away proves nothing.
    const m = strip(src).match(/from\(\s*["']restaurants["']\s*\)[^;\n]*\.range\(/);
    ok(!!m, "found the paged restaurants read in the { all: true } branch");
    if (m) ok(/\.is\(\s*["']deleted_at["']\s*,\s*null\s*\)/.test(m[0]),
      `that read filters out binned restaurants` + (/\.is\(/.test(m[0]) ? "" : ` — it does not.`
        + ` Add .is("deleted_at", null) so "every restaurant" means every LIVE restaurant.`));
  }
}

// ── B · the migrations folder, the source of truth for both databases ────────────────────────
head("B · the newest lfh_owner_overview in supabase/migrations/ carries the filter");
{
  const dir = join(root, "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let newest = null;
  for (const f of files) {
    const sql = readFileSync(join(dir, f), "utf8");
    if (/create\s+(or\s+replace\s+)?function\s+(public\.)?lfh_owner_overview\s*\(/i.test(sql)) newest = { f, sql };
  }
  ok(!!newest, newest ? `newest definition: ${newest.f}` : "no migration defines lfh_owner_overview");
  if (newest) {
    const body = strip(newest.sql);
    ok(/r\.deleted_at\s+IS\s+NULL/i.test(body),
      `${newest.f} filters r.deleted_at IS NULL`
      + (/r\.deleted_at\s+IS\s+NULL/i.test(body) ? "" : ` — it does not. A restaurant in the recycle`
        + ` bin would be an estate row again, with its money in the headline.`));
  }
}

// ── C · the body actually installed in the database ──────────────────────────────────────────
head("C · the same question, asked of the live dev database");
{
  const parseEnv = (t) => Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  }));
  let env = {}; try { env = parseEnv(R(".env.local")); } catch { /* none */ }
  if (!env.SUPABASE_ACCESS_TOKEN || !env.NEXT_PUBLIC_SUPABASE_URL) {
    console.log("⏭  skipped: no SUPABASE_ACCESS_TOKEN in .env.local. Halves A and B already cover");
    console.log("   the code and the folder, which is the source of truth for both databases.");
  } else {
    const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
    const q = async (sql) => {
      const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: sql, read_only: true }),
      });
      if (!r.ok) throw new Error((await r.text()).slice(0, 160));
      return r.json();
    };
    try {
      const rows = await q(`select pg_get_functiondef(p.oid) def from pg_proc p
                              join pg_namespace n on n.oid = p.pronamespace
                             where n.nspname = 'public' and p.proname = 'lfh_owner_overview'`);
      const def = strip(rows.map((r) => r.def).join("\n"));
      ok(/r\.deleted_at\s+IS\s+NULL/i.test(def),
        "the installed lfh_owner_overview filters r.deleted_at IS NULL"
        + (/r\.deleted_at\s+IS\s+NULL/i.test(def) ? "" : " — the database is running an older copy than the folder."));
    } catch (e) { console.log(`⏭  skipped: the database would not answer (${String(e.message).slice(0, 110)}).`); }
  }
}

// ── D · and the real API, when a server is running ───────────────────────────────────────────
head("D · GET /api/owner/overview?scope=all returns no binned restaurant");
{
  const i = process.argv.indexOf("--base");
  const base = i > -1 ? process.argv[i + 1] : null;
  if (!base) {
    console.log("⏭  skipped: pass --base http://localhost:<port> to drive the real API. Not a failure.");
  } else {
    try {
      const { adminHeaders } = await import("./sweep/login.mjs");
      const r = await fetch(`${base}/api/owner/overview?scope=all`, { headers: await adminHeaders(base) });
      if (!r.ok) { console.log(`⏭  skipped: the API answered ${r.status}.`); }
      else {
        const j = await r.json();
        const rows = j.restaurants || [];
        const env = Object.fromEntries(R(".env.local").split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => { const k = l.indexOf("="); return [l.slice(0, k).trim(), l.slice(k + 1).trim()]; }));
        const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
        const dbr = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
          method: "POST",
          headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query: `select id from restaurants where deleted_at is not null`, read_only: true }),
        });
        const binned = new Set((await dbr.json()).map((x) => x.id));
        const leaked = rows.filter((x) => binned.has(x.id));
        ok(leaked.length === 0, `${rows.length} estate rows, ${binned.size} binned restaurants exist,`
          + ` ${leaked.length} of them in the reply`
          + (leaked.length ? ` — e.g. ${leaked.slice(0, 2).map((x) => x.name).join(", ")}` : ""));
        ok(j.totals?.restaurantCount === rows.length,
          `the headline count (${j.totals?.restaurantCount}) equals the rows it was reduced from (${rows.length})`);
      }
    } catch (e) { console.log(`⏭  skipped: ${String(e.message).slice(0, 140)}`); }
  }
}

console.log(bad === 0
  ? "\n✅ a removed restaurant stays in the recycle bin — it is not an estate row and its money is not in the headline."
  : `\n❌ ${bad} problem(s) — a binned restaurant is back in the owner's estate view.`);
process.exit(bad === 0 ? 0 : 1);
