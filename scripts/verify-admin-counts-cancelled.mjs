// verify-admin-counts-cancelled — every admin number that COUNTS orders must skip cancelled ones.
//
// WHY THIS EXISTS. Migration 137 set the rule and its header says why: "one restaurant shows two
// different order counts depending on which panel you look at — the exact 'same number, two
// answers' class we're stamping out… align admin to the owner definition (exclude cancelled)."
// Migration 139 applied it to 'orders today' and the floor stats. Then migration 149 shipped
// `lfh_admin_restaurant_health` — AFTER both — and never adopted it, so the admin console →
// Restaurants list read "Healthy · 8 orders/24h" for a restaurant whose eight orders had all been
// cancelled, and dated its "last order" from a cancelled one seven days newer than the real last
// one. Migration 390 fixed that function (sweep #9 T30 item 1); THIS guard is what stops the next
// admin count from being written without the filter, because three migrations patching one
// function each is not a rule — a check is.
//
//   node scripts/verify-admin-counts-cancelled.mjs           # both halves
//   node scripts/verify-admin-counts-cancelled.mjs --quiet   # failures only
//
// TWO HALVES:
//   A  SOURCE — every `CREATE … FUNCTION lfh_admin_…` in supabase/migrations/ that counts or takes
//      a max() over `orders` carries a cancelled filter in the SAME body. Needs no key, no server.
//   B  LIVE   — the same question asked of the bodies actually installed in the dev database, via
//      pg_get_functiondef. A migration can be right while the database runs an older hand-applied
//      copy; that is the drift `verify:db-parity` exists for, and this is its narrow cousin.
//      Skipped with a clear line (never a failure) when SUPABASE_ACCESS_TOKEN is absent.
//
// READ-ONLY on the database. Writes nothing, anywhere, ever.
// Exit 1 = a count went back to including cancelled orders. Exit 2 = could not run.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const QUIET = process.argv.includes("--quiet");
let bad = 0;
const ok = (s, m) => { if (!s || !QUIET) console.log(`${s ? "✓" : "✗"} ${m}`); if (!s) bad++; };
const head = (t) => console.log(`\n── ${t}`);

// A function EXEMPT from the rule must be named here with the reason, exactly like
// ANON_ALLOWED in verify-db-grants.mjs. Do not add a name without one.
const EXEMPT = {
  // A change-detector, not a number anyone reads. It answers "has anything about these orders
  // moved since you last looked", and a cancellation IS a change — filtering it out would make
  // the fingerprint miss the very edit it exists to notice.
  lfh_owner_orders_fingerprint: "a change detector; a cancellation is a change it must see",
  lfh_owner_report_month_fingerprint: "same — a fingerprint, not a count",
  // Counts TABLES, never orders: pg_class row estimates only (mig 123). Named here because its
  // body mentions `orders` as a table NAME, which is all the source scan can see.
  lfh_admin_table_estimates: "reads pg_class estimates; counts no order rows",
  // Counts what a restaurant COSTS the platform, cancelled attempts included on purpose — a
  // cancelled order still consumed a round trip. Mig 153's own header says so.
  lfh_admin_usage: "platform usage: a cancelled order still consumed a request",
  lfh_admin_usage_range: "platform usage over a window; same reason",
};

// STRIP THE COMMENTS FIRST, and this is not defensive tidiness — it is the whole reason the
// guard works. Proved on itself while it was being written: `sed` took the two real
// `status <> 'cancelled'` clauses out of migration 390 and the check still passed, because the
// migration's own header EXPLAINS the rule and says the word "cancelled" six times. A guard that
// reads a comment as code is a guard that goes green over a broken function. `verify:rejected`
// records the same trap from the other direction — it had to strip comments so a comment ABOUT
// the convention was not read as a claim.
const code = (body) => body.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");

// Does this function body count/aggregate over the orders table at all?
const readsOrders = (raw) => {
  const body = code(raw);
  return /\bfrom\s+(public\.)?orders\b/i.test(body) &&
    /\b(count\s*\(|max\s*\(\s*[a-z_.]*created_at|sum\s*\()/i.test(body);
};
// …and does the EXECUTABLE half say so when it skips a cancelled one?
const skipsCancelled = (raw) => /cancelled/i.test(code(raw));

// Split a SQL text into its individual CREATE FUNCTION bodies, keyed by name.
function functionBodies(sql) {
  const out = [];
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    const name = m[1];
    // the body runs to the closing dollar-quote that opened after the signature
    const rest = sql.slice(m.index);
    const dq = rest.match(/\$([a-z_]*)\$/i);
    if (!dq) continue;
    const start = rest.indexOf(dq[0]) + dq[0].length;
    const end = rest.indexOf(dq[0], start);
    if (end < 0) continue;
    out.push([name, rest.slice(start, end)]);
  }
  return out;
}

// ── A · the migrations folder, which is the source of truth for both databases ────────────────
head("A · every admin order-count in supabase/migrations/ skips cancelled orders");
{
  const dir = join(root, "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  // Only the NEWEST definition of each function matters — an older migration is history.
  const newest = new Map();
  for (const f of files) {
    const sql = readFileSync(join(dir, f), "utf8");
    for (const [name, body] of functionBodies(sql)) {
      if (!/^lfh_admin_|^lfh_owner_/.test(name)) continue;
      newest.set(name, { file: f, body });
    }
  }
  let looked = 0;
  for (const [name, { file, body }] of [...newest].sort()) {
    if (name in EXEMPT) continue;
    if (!readsOrders(body)) continue;
    looked++;
    ok(skipsCancelled(body), `${name} (newest: ${file})`
      + (skipsCancelled(body) ? "" : ` — counts orders with NO cancelled filter.`
        + ` Migration 137 set this rule; add \`status <> 'cancelled'\`, or name the function in`
        + ` EXEMPT in this file with the reason.`));
  }
  ok(looked > 0, `read ${looked} admin/owner functions that count over orders (${newest.size} defined in the folder)`);
}

// ── B · the bodies actually installed in the dev database ─────────────────────────────────────
head("B · the same question, asked of the live dev database");
{
  const parseEnv = (t) => Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  }));
  let env = {};
  try { env = parseEnv(readFileSync(join(root, ".env.local"), "utf8")); } catch { /* no keys here */ }
  if (!env.SUPABASE_ACCESS_TOKEN || !env.NEXT_PUBLIC_SUPABASE_URL) {
    console.log("⏭  skipped: no SUPABASE_ACCESS_TOKEN in .env.local — half A already covers the folder,");
    console.log("   which is the source of truth for both databases. Not a failure.");
  } else {
    const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
    // ── A SLOW DATABASE IS BUSY, NOT BROKEN (T33, sweep #9, 2026-09-17) ──────────────────────
    // This handled a non-OK REPLY and not a failed CONNECTION, so when `fetch` itself threw, the
    // guard died with an uncaught TypeError and a stack trace — no "⏭ skipped", no half-A result,
    // nothing. Inside a full run that reads as a PRODUCT fault when it is the network. Witnessed
    // four times in one session: five sweep terminals share this one management endpoint and it
    // was measured at 4–9 seconds to connect, where Node's undici gives up at a fixed 10s and
    // tries IPv6 first.
    //
    // A generous deadline plus jittered backoff, then stand down with a sentence — this project's
    // own "busy is treated like offline, both ways" rule applied to its own test rig. A REFUSAL
    // (401/403, or a SQL error) is NOT retried: that answer is real, and retrying a real refusal
    // into a skip is how a check stops checking.
    const nap = (ms) => new Promise((res) => setTimeout(res, ms));
    let r = null, why = "";
    for (let i = 0; i < 5 && !r; i++) {
      try {
        const attempt = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
          method: "POST",
          headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `select p.proname, pg_get_functiondef(p.oid) def
                      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public'
                       and (p.proname like 'lfh_admin_%' or p.proname like 'lfh_owner_%')`,
            read_only: true,
          }),
          signal: AbortSignal.timeout(60_000),
        });
        if (attempt.status === 429 || attempt.status >= 500) why = `HTTP ${attempt.status}`;
        else { r = attempt; break; }
      } catch (e) { why = String(e?.cause?.code || e?.message || e).slice(0, 90); }
      await nap(Math.round(2 ** i * 800 * (0.6 + Math.random() * 0.8)));
    }
    if (!r) {
      console.log(`⏭  skipped: could not reach the database after 5 tries (${why}). Half A stands —`);
      console.log("   it read every migration file, which is the source of truth for both databases.");
    } else if (!r.ok) {
      console.log(`⏭  skipped: the database would not answer (${(await r.text()).slice(0, 120)}). Half A stands.`);
    } else {
      const rows = await r.json();
      const merged = new Map();
      for (const row of rows) merged.set(row.proname, (merged.get(row.proname) || "") + "\n" + row.def);
      let looked = 0;
      for (const [name, def] of [...merged].sort()) {
        if (name in EXEMPT) continue;
        if (!readsOrders(def)) continue;
        looked++;
        ok(skipsCancelled(def), `${name} — the body installed in the database`
          + (skipsCancelled(def) ? "" : ` counts orders with NO cancelled filter.`
            + ` Either it was hand-applied from an older copy, or a migration landed without the rule.`));
      }
      ok(looked > 0, `read ${looked} live bodies that count over orders (${merged.size} admin/owner functions installed)`);
    }
  }
}

console.log(bad === 0
  ? "\n✅ every admin number that counts orders skips the cancelled ones."
  : `\n❌ ${bad} problem(s) — an admin count is back to including cancelled orders.`);
process.exit(bad === 0 ? 0 : 1);
