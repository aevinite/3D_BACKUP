// verify-db-parity.mjs — the two databases must agree, and the migrations folder must be the truth.
//
// WHY THIS EXISTS (owner, 2026-07-31: "go to the root, it should not happen again"). Chasing the
// "a table shows the wrong party's food" family led to something worse than any single bug: the
// two live databases had quietly drifted apart, and nothing anywhere was checking.
//
//   • AV LIVE (the paying client) was running an OLDER lfh_table_view_summary — TIER 1 of the
//     manager's live Table view — without the guard that stops one malformed order row from
//     making the whole floor stop refreshing.
//   • AV LIVE was running an OLDER lfh_staff_open_table, so two people tapping Open on the same
//     table at the same instant showed the second one a raw database error instead of the table.
//   • AV LIVE was missing both partial indexes the floor query relies on, so every tile lookup
//     walked that table's entire order history (41,993 rows there) instead of the live rows.
//   • And the qty guard that DEV was running existed in NO migration file at all — it had been
//     applied to the dev database by hand, so AV live could never receive it and a rebuild from
//     migrations would have silently removed it.
//
// So this check has two halves, and both must stay green:
//   A. PARITY   — every function / index / trigger present on dev is present, and identical, on
//                 AV live (ignoring whitespace), except the modules AV live deliberately lacks.
//   B. SOURCED  — every function on dev appears in supabase/migrations/, so the folder really is
//                 the single source of truth for both databases.
//
// READ-ONLY on both databases: it only reads pg_proc / pg_indexes / pg_trigger. Never writes.
//
//   node scripts/verify-db-parity.mjs           # both halves
//   node scripts/verify-db-parity.mjs --quiet   # only failures
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const parseEnv = (t) => Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
  const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
}));
const dev = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
const AV_ENV = "/Users/aevinite/Documents/Projects/backup_Menu/.env.AV.live";
let av = null;
try { av = parseEnv(readFileSync(AV_ENV, "utf8")); } catch { /* no live keys here → parity half is skipped */ }
const QUIET = process.argv.includes("--quiet");

// Modules AV live deliberately does not have. Anything matching these is EXPECTED to be missing
// there; anything else that is missing is drift and fails the check. Keep this list honest —
// add to it only when a module is deliberately withheld from the live stack.
const UNRELEASED_ON_AV = [
  /^lfh_inv_/, /^lfh_staff_pay/, /^lfh_staff_performance\(/,        // inventory + payroll modules
  /^(inv_|inventory|stock|vendor|recipe|expenses|staff_pay|payroll)/,  // their tables/indexes
  /^(uq_inv|inv_)/,
  /idx_(inv|stock|vendor|recipe|expenses|staff_pay|payroll)/,
  /trg_inv_/, /idx_orders_placed_by/, /idx_staff_actions_actor/, /idx_staff_users_payroll/,
];
const expectedMissing = (k) => UNRELEASED_ON_AV.some((re) => re.test(k));

// ── WHAT HAS DELIBERATELY NOT BEEN RELEASED TO AV LIVE ───────────────────────────────────────
// AV live does not receive releases in a line — it receives them surgically, one asked-for change
// at a time (the two-stack rule), so "AV live is on release N" is not a real number and cannot be
// derived from the database: there is no migrations ledger on either stack. What CAN be written
// down honestly is the decision itself. One line per migration the owner has chosen not to send.
//
// THIS LIST CANNOT ROT UNNOTICED: the check below fails if a migration listed here turns out to be
// present on AV live after all. A record that verifies itself is worth keeping; the hand-typed
// lists that rotted today were duplicates of things the code already knew.
const WITHHELD_FROM_AV = {
  241: "owner heatmap tax fix — not released",
  245: "recycle bin frees the login name — backup only, by decision",
  249: "tables can be merged, recorded and unmerged — not released",
  250: "ordering at a merged table — not released (needs 249)",
  251: "the deletion audit — not released",
  260: "a joined table cannot be given a second party — not released (needs 249)",
};

// ── WHICH RELEASE IS AV LIVE ON? ─────────────────────────────────────────────────────────────
// "AV live is missing 4 functions" is not, by itself, a fault. AV live receives releases
// deliberately and rarely (see the two-stack rule): every time backup gains a feature, the two
// databases differ until the next release, and shouting DRIFT at that teaches everyone to ignore
// this check — which is exactly what happened by 2026-08-02, when it had been red for days over
// table-merging, the deletion audit and the recycle-bin index, all of them simply unreleased.
//
// The distinction that actually matters:
//   BEHIND  — AV live lacks things that only NEWER migrations create. Expected. Reported, not failed.
//   DRIFT   — AV live lacks (or has changed) something an OLDER migration created, while newer ones
//             ARE present. That means somebody edited the live database by hand, or a release landed
//             out of order, and it is the thing this check exists to catch.
//
// Derived from the migrations folder, never a hand-typed list: two of those rotted today already.
const migSource = () => {
  const out = [];
  for (const f of readdirSync(join(root, "supabase/migrations")).filter((f) => /^\d+_.*\.sql$/.test(f)).sort())
    out.push([parseInt(f, 10), readFileSync(join(root, "supabase/migrations", f), "utf8")]);
  return out.sort((a, b) => a[0] - b[0]);
};
// object name (bare, no args / no table prefix) → the FIRST migration number that writes it.
// FIRST, not last, and that distinction is the whole check: half these functions are re-created
// by a dozen later migrations, so dating them by the newest one says "this is from mig 255" about
// something that has existed since 036 — and then every older difference reads as drift.
// TWO dates per object, because the two questions are different:
//   firstIn — when it first appeared. Dates its EXISTENCE (is it missing? is it extra?).
//   lastIn  — when its definition last changed. Dates its BODY (does it differ?).
// Using one for both is how this check said "lfh_place_order drifted (mig 15)" about a function
// that merely has a newer body here from mig 250 (2026-08-02).
const firstIn = new Map(), lastIn = new Map();
for (const [n, sql] of migSource()) {
  const add = (name) => {
    if (!name) return; const k = name.toLowerCase();
    if (!firstIn.has(k)) firstIn.set(k, n);
    lastIn.set(k, Math.max(n, lastIn.get(k) || 0));
  };
  for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi)) add(m[1]);
  for (const m of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([a-z0-9_]+)/gi)) add(m[1]);
  for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+([a-z0-9_]+)/gi)) add(m[1]);
  // A DROP dates an object too: the index mig 245 replaced still exists on AV live simply because
  // 245 has not been released there — that is BEHIND, not an index somebody invented.
  for (const m of sql.matchAll(/DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?(?:public\.)?([a-z0-9_]+)/gi)) add(m[1]);
  for (const m of sql.matchAll(/DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?([a-z0-9_]+)/gi)) add(m[1]);
  // A table's PRIMARY KEY index is created implicitly by CREATE TABLE, so no CREATE INDEX names
  // it. Date <table>_pkey by the migration that creates the table, or it reads as "in no
  // migration at all" — which the check calls drift, wrongly (both new tables did on 2026-08-02).
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z0-9_]+)/gi)) { add(m[1]); add(m[1] + "_pkey"); }
}
// "orders :: idx_x" → "idx_x";  "lfh_f(a uuid, b text)" → "lfh_f"
const bare = (k) => String(k).split(" :: ").pop().split("(")[0].trim().toLowerCase();
const firstWritten = (k) => firstIn.get(bare(k)) ?? null;
const lastWritten  = (k) => lastIn.get(bare(k)) ?? null;

let failed = 0;
const pass = (m) => { if (!QUIET) console.log("  ✓ " + m); };
const fail = (m) => { console.log("  ✗ " + m); failed++; };
const head = (m) => console.log("\n" + m);

const q = async (env, sql) => {
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`${ref.slice(0, 6)}…: ${(await r.text()).slice(0, 200)}`);
  return r.json();
};
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();   // whitespace-only diffs aren't drift

// Key by name AND argument list: several functions are OVERLOADED (an old signature kept beside
// a new one), and keying by name alone compares dev's signature A against AV live's signature B
// and cries drift where there is none — the first version of this guard did exactly that.
const FN_SQL = `SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS name,
  pg_get_functiondef(p.oid) AS def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'lfh%' ORDER BY 1`;
const IX_SQL = `SELECT tablename||' :: '||indexname AS name, indexdef AS def FROM pg_indexes WHERE schemaname='public' ORDER BY 1`;
const TG_SQL = `SELECT c.relname||' :: '||t.tgname AS name, pg_get_triggerdef(t.oid) AS def FROM pg_trigger t
  JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY 1`;

// ── A. PARITY between the two live databases ─────────────────────────────────
if (!av) {
  console.log("A. Parity check SKIPPED — no live-stack keys in this checkout");
} else {
  head("A. Do the two databases agree? (dev ⇄ AV live)");
  for (const [what, sql] of [["function", FN_SQL], ["index", IX_SQL], ["trigger", TG_SQL]]) {
    const [d, a] = await Promise.all([q(dev, sql), q(av, sql)]);
    const A = new Map(a.map((r) => [r.name, r.def]));
    const missing = [], differing = [];
    for (const row of d) {
      if (expectedMissing(row.name)) continue;
      if (!A.has(row.name)) { missing.push(row.name); continue; }
      if (norm(A.get(row.name)) !== norm(row.def)) differing.push(row.name);
    }
    const extra = a.map((r) => r.name).filter((n) => !d.some((r) => r.name === n) && !expectedMissing(n));
    // Date each disagreement by the question it answers (see firstIn / lastIn above).
    const gaps = [
      ...missing.map((n) => ({ n, mig: firstWritten(n), why: "missing from AV live" })),
      ...differing.map((n) => ({ n, mig: lastWritten(n), why: "an older definition on AV live" })),
      ...extra.map((n) => ({ n, mig: lastWritten(n), why: "dropped here, still on AV live" })),
    ];
    // How far has the release train demonstrably reached on AV live? The highest migration that
    // INTRODUCED something AV live actually has. An object it has from mig 251 proves 251 landed
    // there, so anything older that it lacks was not "not released yet" — it was lost or edited.
    const avLevel = Math.max(0, ...a.map((r) => firstWritten(r.name)).filter((m) => m != null));
    const withheld = (m) => m != null && Object.prototype.hasOwnProperty.call(WITHHELD_FROM_AV, m);
    const behind = gaps.filter((g) => g.mig != null && (g.mig > avLevel || withheld(g.mig)));
    const drift  = gaps.filter((g) => g.mig == null || (g.mig <= avLevel && !withheld(g.mig)));
    // Keep the record above honest: if something it says is withheld is actually THERE, say so.
    const wrongly = a.map((r) => firstWritten(r.name)).filter((m) => withheld(m));
    if (wrongly.length) fail(`the withheld-from-AV list names migration(s) ${[...new Set(wrongly)].join(", ")} as not released, but AV live has their ${what}s — update WITHHELD_FROM_AV in this script`);
    if (drift.length) {
      fail(`${drift.length} ${what}(s) DRIFTED — AV live is on release ~${avLevel}, so these are not "not released yet": ${drift.slice(0, 8).map((g) => `${g.n} — ${g.why}${g.mig ? ` (mig ${g.mig})` : ", and in no migration at all"}`).join(" · ")}`);
    } else if (behind.length) {
      const migs = [...new Set(behind.map((g) => g.mig))].sort((x, y) => x - y);
      pass(`${what}s: ${behind.length} object(s) wait on ${migs.length} migration(s) not sent to AV live (${migs.map((m) => `${m}${WITHHELD_FROM_AV[m] ? ` — ${WITHHELD_FROM_AV[m]}` : ""}`).join("; ")})`);
    } else {
      pass(`every ${what} matches between the two databases`);
    }
  }
}

// ── A2. Are the migration files unambiguously ordered? ───────────────────────
head("A2. Migration numbers");
{
  const files = readdirSync(join(root, "supabase/migrations")).filter((f) => /^\d+_.*\.sql$/.test(f));
  const byNum = new Map();
  for (const f of files) {
    const n = f.match(/^(\d+)_/)[1];
    if (!byNum.has(n)) byNum.set(n, []);
    byNum.get(n).push(f);
  }
  const clashes = [...byNum].filter(([, list]) => list.length > 1);

  // Parallel sessions have numbered migrations at the same time for months: 18 numbers were
  // already doubled when this check was written (057 through 229). They are harmless — VERIFIED,
  // not assumed: no colliding pair creates or alters the same function/index/trigger/table, so
  // whichever ran first, the result is identical. Renaming 18 applied migrations would be churn
  // with its own risk, so they are grandfathered BY NUMBER and the check guards two real things:
  //   • a NEW duplicated number (the next collision, caught before it merges);
  //   • ANY duplicated pair that touches the same object — grandfathered or not, that one's
  //     outcome depends on filename sort order, which is not a decision anybody made.
  const GRANDFATHERED = new Set(["057", "068", "116", "121", "122", "130", "145", "155", "181",
    "190", "196", "202", "203", "208", "221", "227", "228", "229"]);
  const objectsIn = (f) => {
    const t = readFileSync(join(root, "supabase/migrations", f), "utf8");
    const out = new Set();
    for (const [re, tag] of [
      [/(?:CREATE OR REPLACE FUNCTION|CREATE FUNCTION)\s+(?:public\.)?(\w+)/gi, "function"],
      [/CREATE (?:UNIQUE )?INDEX(?: IF NOT EXISTS)?\s+(\w+)/gi, "index"],
      [/CREATE TRIGGER\s+(\w+)/gi, "trigger"],
      [/ALTER TABLE\s+(?:public\.)?(\w+)/gi, "table"],
    ]) for (const m of t.matchAll(re)) out.add(`${tag} ${m[1].toLowerCase()}`);
    return out;
  };
  const fresh = clashes.filter(([n]) => !GRANDFATHERED.has(n));
  const fighting = clashes.filter(([, list]) => {
    const sets = list.map(objectsIn);
    return [...sets[0]].some((o) => sets.slice(1).every((s) => s.has(o)));
  });
  fresh.length === 0
    ? pass(`${files.length} migrations; no NEW duplicated number (${clashes.length} historical ones grandfathered)`)
    : fail(`new duplicated migration number(s): ${fresh.map(([n, l]) => n + " → " + l.join(" + ")).join("; ")} — renumber the newer file`);
  fighting.length === 0
    ? pass("no two same-numbered migrations create or alter the same object, so their order can't matter")
    : fail(`${fighting.length} same-numbered pair(s) touch the SAME object — their order decides the result: ${fighting.map(([n, l]) => n + " → " + l.join(" + ")).join("; ")}`);
}

// ── B. Is the migrations folder really the source of truth? ──────────────────
head("B. Is every live function written down in supabase/migrations?");
{
  const files = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql"));
  const allSql = files.map((f) => readFileSync(join(root, "supabase/migrations", f), "utf8")).join("\n");
  const fns = await q(dev, FN_SQL);
  const bare = (n) => n.replace(/\(.*$/, "");
  const undeclared = [...new Set(fns.map((r) => bare(r.name)))].filter((n) => !new RegExp(`FUNCTION\\s+(public\\.)?${n}\\s*\\(`, "i").test(allSql));
  undeclared.length === 0
    ? pass(`${fns.length} live functions, every one of them created by a migration in this folder`)
    : fail(`${undeclared.length} function(s) exist on the database but in NO migration: ${undeclared.join(", ")} — a rebuild would lose them and the other stack can never get them`);

  // The body has to match too: a function edited by hand on the database, with the migration left
  // behind, is the exact drift that hid the qty guard from AV live for good.
  //
  // Compare on WHITESPACE-NORMALISED text on both sides. The first version of this check compared
  // raw lines and cried "hand-edited" over lfh_touch_session, whose only difference was that
  // Postgres prints `SET search_path TO 'public'` where the migration wrote `= public` — the same
  // thing. A guard that fires on formatting trains people to ignore it.
  const flatSql = norm(allSql);
  const handEdited = [];
  for (const row of fns) {
    if (expectedMissing(row.name)) continue;
    const flat = norm(row.def);
    // Only judge SUBSTANTIAL bodies. Short trigger functions (lfh_set_topic_rid, lfh_rt_prune)
    // are a few lines whose normalised phrases legitimately don't survive reformatting, and
    // flagging them is noise — the drift worth catching is a rewritten function body.
    if (flat.split(" ").length < 70) continue;
    // a few distinctive normalised phrases from the live body must appear in the folder
    const words = flat.split(" ");
    const marks = [];
    for (let i = 10; i < words.length - 8 && marks.length < 5; i += Math.max(8, Math.floor(words.length / 6))) {
      marks.push(words.slice(i, i + 8).join(" "));
    }
    const found = marks.some((m) => flatSql.includes(m));
    if (!found) handEdited.push(bare(row.name));
  }
  handEdited.length === 0
    ? pass("no live function body looks hand-edited away from its migration")
    : fail(`${handEdited.length} function(s) look changed on the database without a migration: ${handEdited.slice(0, 8).join(", ")}`);
}

console.log(failed
  ? `\n✗ ${failed} parity problem(s) — a fix that is only on one stack is not a fix`
  : "\n✓ both databases agree, and every function is written down in migrations");
process.exit(failed ? 1 : 0);
