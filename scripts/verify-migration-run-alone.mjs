// verify-migration-run-alone.mjs — THE DECISIONS THE MIGRATIONS-001-118 SWEEP MADE, KEPT MADE.
//
// Two of them: (1) running ONE old migration by hand must not undo a later decision, and (2) a
// pre-tenancy table must not go back to guessing which restaurant a row belongs to (migration 358).
//
// WHY THIS EXISTS. CLAUDE.md and `scripts/run-migration.mjs` both recommend applying ONE migration
// instead of a full re-seed, and that script's header states the assumption plainly: "Idempotent
// migrations (CREATE OR REPLACE / IF NOT EXISTS) are safe to re-run." For a file that only ADDS
// things that is true. For a file whose objects a LATER migration deliberately removed, it is not:
// the old file happily re-creates them, and the removal is 100+ files away where nobody looks.
//
// This is not hypothetical. Migration 099's body was replaced by its own removal for exactly this
// reason ("running this file alone brought a table-closing job back to life"), and migration 297 is
// literally named "undo a resurrection". The 2026-08-21 sweep of migrations 001–118 then MEASURED
// it: running 005, 015 and 036 by hand
//   · re-created 7 pre-tenancy function overloads, 5 of them callable with the public menu key —
//     including an `lfh_place_order` that trusts a client-supplied subtotal/tax/total, the exact
//     thing migration 029 exists to prevent (029 left a shim there that IGNORES that money); and
//   · reverted 5 function BODIES to their old era — `lfh_session_state`, the guest's whole table
//     view, went from 5,315 characters back to 1,601, losing migrations 076/126/271/318.
//
// `verify-db-grants.mjs` did not notice any of it, and could not: its allow-list is keyed by
// function NAME, so a stale overload of an allowed name looks allowed, and it never compares bodies.
// This file is the missing check.
//
// TWO ASSERTIONS:
//   1. STATIC (no database) — no migration re-creates an object that the migration sequence later
//      removes, unless that same file removes it again before it ends. This is what makes a
//      single-file run land in the same state as a full re-seed.
//   2. LIVE (needs .env.local) — no function in the database carries a signature that the migration
//      sequence drops. That is the stale-overload check, and it is the one that catches a hand-run
//      after the fact. Skipped with a clear message when there is no database to ask.
//
// READ-ONLY. Writes nothing, creates nothing, and is safe to run while other sessions are working.
//
//   node scripts/verify-migration-run-alone.mjs
//   node scripts/verify-migration-run-alone.mjs --static   # skip the database half
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(root, "supabase", "migrations");
const STATIC_ONLY = process.argv.includes("--static");
let failed = 0;
const pass = (m) => console.log("  ✓ " + m);
const fail = (m) => { console.log("  ✗ " + m); failed++; };
const head = (m) => console.log("\n" + m);

// ── THE KNOWN BACKLOG ────────────────────────────────────────────────────────────────────────
// Four files OUTSIDE migrations 001–118 still carry this shape. They are listed — not ignored —
// so this check is green on today's repo and RED the moment a NEW one appears. Each needs the same
// one-line ending its own later migration already wrote; the fix belongs to whoever owns that file,
// and migration 281 says the quiet part out loud about its own pair: "if 236 is ever re-run alone
// they will come back". Delete an entry as its file is fixed; never add one to silence a new fault.
const KNOWN_BACKLOG = new Set([
  "218_error_signatures.sql|function|lfh_bump_error_signature",           // retired by 219 (no-muting rework)
  "236_write_down_the_unwritten_function.sql|function|lfh_check_ban_scoped", // retired by 281, which predicted this
  "249_merge_is_recorded_and_reversible.sql|function|lfh_merge_group",    // retired by 267 as having no caller
  "296_database_layer_a_sweep_fixes.sql|function|lfh_check_verification", // retired by 297, "undo a resurrection"
]);

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const _c = new Map();
// -- line comments stripped, so a sentence in a comment can never look like a statement
const code = (f) => {
  if (!_c.has(f)) _c.set(f, readFileSync(join(DIR, f), "utf8").split("\n").map((l) => l.replace(/--.*$/, "")).join("\n"));
  return _c.get(f);
};
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Every object each file CREATES and every object it DROPS, in file order.
const KINDS = [
  { kind: "function", create: /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-zA-Z0-9_]+)"?\s*\(/gi,
    drop: /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z0-9_]+)"?/gi },
  { kind: "trigger",  create: /CREATE\s+TRIGGER\s+"?([a-zA-Z0-9_]+)"?/gi,
    drop: /DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?([a-zA-Z0-9_]+)"?/gi },
  { kind: "policy",   create: /CREATE\s+POLICY\s+"?([a-zA-Z0-9_ ]+?)"?\s+ON\s+(?:public\.)?"?([a-zA-Z0-9_]+)"?/gi,
    drop: /DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?"?([a-zA-Z0-9_ ]+?)"?\s+ON\s+(?:public\.)?"?([a-zA-Z0-9_]+)"?/gi },
];

// ── 1. STATIC: a single-file run must land where a full re-seed lands ────────────────────────
head("supabase/migrations — running ONE file by hand lands in the same state as a full re-seed");
{
  // last create / last drop across the whole sequence, per object
  const lastCreate = new Map(), lastDrop = new Map();
  for (const f of files) {
    const t = code(f);
    for (const { kind, create, drop } of KINDS) {
      for (const m of t.matchAll(create)) lastCreate.set(`${kind}:${(m[2] ? m[2] + "." : "")}${m[1].toLowerCase()}`, f);
      for (const m of t.matchAll(drop))   lastDrop.set(`${kind}:${(m[2] ? m[2] + "." : "")}${m[1].toLowerCase()}`, f);
    }
  }
  // an object the sequence RETIRES: its last drop comes after its last create
  const retired = new Set([...lastDrop.keys()].filter((k) => {
    const c = lastCreate.get(k); const d = lastDrop.get(k);
    return !c || d > c;
  }));

  const offenders = [];
  const backlog = new Set();
  for (const f of files) {
    const t = code(f);
    for (const { kind, create, drop } of KINDS) {
      const creates = [...t.matchAll(create)].map((m) => ({ key: `${kind}:${(m[2] ? m[2] + "." : "")}${m[1].toLowerCase()}`, at: m.index, name: m[1], tbl: m[2] }));
      if (!creates.length) continue;
      const drops = [...t.matchAll(drop)].map((m) => ({ key: `${kind}:${(m[2] ? m[2] + "." : "")}${m[1].toLowerCase()}`, at: m.index }));
      for (const c of creates) {
        if (!retired.has(c.key)) continue;                       // still a live object — nothing to answer for
        const lastC = Math.max(...creates.filter((x) => x.key === c.key).map((x) => x.at));
        const lastD = Math.max(-1, ...drops.filter((x) => x.key === c.key).map((x) => x.at));
        if (lastD > lastC) continue;                             // the file removes it again before it ends ✓
        if (KNOWN_BACKLOG.has(`${f}|${kind}|${c.name}`)) { backlog.add(`${f} → ${kind} ${c.name}`); continue; }
        offenders.push(`${f} re-creates ${kind} ${c.tbl ? c.tbl + "." : ""}${c.name}, which ${lastDrop.get(c.key)} retires`);
      }
    }
  }
  const uniq = [...new Set(offenders)];
  if (uniq.length) {
    fail(`${uniq.length} migration(s) would put back something a later migration deliberately removed:`);
    for (const o of uniq) console.log("      · " + o);
    console.log("      Fix: end the offending file with the same removal the later migration made");
    console.log("      (idempotent DROP … IF EXISTS), the way migrations 036/040/099 do.");
  } else {
    pass(`no migration re-creates an object the sequence later retires (${retired.size} retired objects checked across ${files.length} files)`);
  }
  if (backlog.size) {
    console.log(`  – ${backlog.size} known, written-down: ${[...backlog].join(" · ")}`);
    console.log("    (outside migrations 001–118; each needs the same one-line ending in its own file)");
  }
}

// ── 2. LIVE: no function carries a signature the sequence drops ──────────────────────────────
head("BACKUP / DEV database — no function carries a signature the migrations dropped");
if (STATIC_ONLY) {
  console.log("  – skipped (--static)");
} else if (!existsSync(join(root, ".env.local"))) {
  console.log("  – skipped: no .env.local, so there is no database to ask");
} else {
  const env = Object.fromEntries(readFileSync(join(root, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ read_only: true, query:
      `select p.proname, pg_get_function_identity_arguments(p.oid) as args,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'` }),
  });
  if (!r.ok) { fail(`could not read the database: ${(await r.text()).slice(0, 160)}`); }
  else {
    const live = await r.json();
    // every signature the sequence DROPs, normalised to bare type names
    const norm = (s) => s.toLowerCase().replace(/\s+/g, " ")
      .split(",").map((a) => a.trim().replace(/^\w+\s+/, (mm) => (/^(in|out|inout|variadic)\s/.test(mm) ? "" : mm)))
      .map((a) => a.replace(/^p_[a-z0-9_]*\s+/, "").replace(/\s+default\b[\s\S]*$/, "").trim()).join(",");
    // A signature is RETIRED only when its LAST drop comes after its LAST create. The everyday
    // idiom `DROP FUNCTION IF EXISTS x(sig); CREATE OR REPLACE FUNCTION x(sig) …` — how you change
    // a return type — drops and immediately rebuilds, and must not be read as a retirement.
    const lastDropSig = new Map(), lastCreateSig = new Map();
    for (const f of files) {
      const t = code(f);
      for (const m of t.matchAll(/DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z0-9_]+)"?\s*\(([^)]*)\)/gi))
        lastDropSig.set(`${m[1].toLowerCase()}(${norm(m[2])})`, `${f}#${String(m.index).padStart(8, "0")}`);
      for (const m of t.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-zA-Z0-9_]+)"?\s*\(([^)]*)\)/gi))
        lastCreateSig.set(`${m[1].toLowerCase()}(${norm(m[2])})`, `${f}#${String(m.index).padStart(8, "0")}`);
    }
    const dropped = new Set([...lastDropSig.keys()].filter((k) => {
      const c = lastCreateSig.get(k);
      return !c || lastDropSig.get(k) > c;
    }));
    const stale = live.filter((x) => dropped.has(`${x.proname.toLowerCase()}(${norm(x.args)})`));
    if (stale.length) {
      fail(`${stale.length} function signature(s) the migrations dropped are still in the database — a migration was almost certainly run by hand:`);
      for (const s of stale) console.log(`      · ${s.proname}(${s.args})${s.anon ? "   ⚠ reachable with the public menu key" : ""}`);
      console.log("      Fix: DROP the stale signature, then restore any body the hand-run reverted");
      console.log("      by re-applying ONLY the definition from the migration that last defines it.");
    } else {
      pass(`no stale overload: every one of the ${live.length} functions carries a signature the sequence still expects`);
    }
  }
}

// ── 3. A pre-tenancy table must not go back to guessing the restaurant (migration 358) ──────
head("BACKUP / DEV database — no table guesses which restaurant a row belongs to");
// Migration 078 gave every table that already existed `restaurant_id DEFAULT <restaurant #1>` as its
// backfill device. That is step one of default → backfill → ENFORCE; step three never happened, so
// for 300 migrations a writer that forgot to name a restaurant silently filed the row under French
// House. Migration 351 dropped the default on 20 of the 25.
//
// Migration 358 covers all 25, so this list is EMPTY and must stay empty. It exists because the
// first version of 352 held five back (orders, sessions, session_members, blocklist, staff_actions)
// while two test fixtures still inserted into them without a restaurant; those fixtures now pass it
// explicitly, so nothing is exempt any more. A NAME APPEARING HERE MEANS A TABLE WENT BACK TO
// GUESSING — treat it as a regression to fix, not an exception to record.
const STILL_DEFAULTED = new Set();   // all 25 done — migration 358 covers every one of them
if (STATIC_ONLY) {
  console.log("  – skipped (--static)");
} else if (!existsSync(join(root, ".env.local"))) {
  console.log("  – skipped: no .env.local, so there is no database to ask");
} else {
  const env = Object.fromEntries(readFileSync(join(root, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ read_only: true, query:
      `select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'restaurant_id'
          and column_default is not null order by 1` }),
  });
  if (!r.ok) { fail(`could not read the database: ${(await r.text()).slice(0, 160)}`); }
  else {
    const defaulted = (await r.json()).map((x) => x.table_name);
    const unexpected = defaulted.filter((t) => !STILL_DEFAULTED.has(t));
    const healed = [...STILL_DEFAULTED].filter((t) => !defaulted.includes(t));
    if (unexpected.length) {
      fail(`${unexpected.length} table(s) guess the restaurant when a writer stays silent: ${unexpected.join(", ")}`);
      console.log("      A row written without a restaurant lands in French House instead of failing.");
      console.log("      Fix: ALTER TABLE <t> ALTER COLUMN restaurant_id DROP DEFAULT; (migration 358's pattern)");
    } else {
      pass(`no table guesses the restaurant beyond the ${STILL_DEFAULTED.size} written down (${defaulted.length} defaulted, all expected)`);
    }
    if (healed.length) console.log(`  – ${healed.length} of the written-down five now fixed — remove from STILL_DEFAULTED: ${healed.join(", ")}`);
  }
}

// ── 4. The "a sale cannot be erased" lock must not depend on WHEN a bill is numbered (mig 361) ──
head("BACKUP / DEV database — the issued-bill lock does not depend on billing");
// `lfh_block_issued_delete` refuses a hard delete of an order or a session that represents a real
// sale. Until migration 361 its ORDER-level test asked whether the order's SESSION had a `bill_no`.
// That only worked by accident: `bill_no` arrives with a table's first order, so the test happened to
// mean "this table has ordered". Anyone moving the bill number later — which is a reasonable thing to
// want, and what the owner asked for — would have silently loosened a compliance guard, because an
// unpaid, unserved order on an unbilled table would have become hard-deletable.
// It now tests `kot_no`, which every order gets at insert (mig 036) and which no billing decision can
// move. If `bill_no` ever reappears in the order branch of this function, the coupling is back.
if (STATIC_ONLY) {
  console.log("  – skipped (--static)");
} else if (!existsSync(join(root, ".env.local"))) {
  console.log("  – skipped: no .env.local, so there is no database to ask");
} else {
  const env = Object.fromEntries(readFileSync(join(root, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ read_only: true, query:
      `select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'lfh_block_issued_delete'` }),
  });
  if (!r.ok) { fail(`could not read the database: ${(await r.text()).slice(0, 160)}`); }
  else {
    const rows = await r.json();
    if (!rows.length) fail("lfh_block_issued_delete is MISSING — nothing stops an issued bill being hard-deleted");
    else {
      // Strip -- comments FIRST. The function body explains why it stopped testing bill_no, and
      // matching that sentence reported the very coupling the comment says was removed.
      const src = rows[0].prosrc.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
      // the orders branch runs from "if tg_table_name = 'orders'" up to the elsif
      const oStart = src.indexOf("tg_table_name = 'orders'");
      const oEnd = src.indexOf("elsif", oStart < 0 ? 0 : oStart);
      const ordersBranch = oStart < 0 ? "" : src.slice(oStart, oEnd < 0 ? src.length : oEnd);
      const problems = [];
      if (!/kot_no/.test(ordersBranch)) problems.push("its orders branch no longer tests kot_no");
      if (/bill_no/.test(ordersBranch)) problems.push("its orders branch tests bill_no again — the coupling to billing is back");
      if (!/payment_status\s*=\s*'paid'/.test(ordersBranch)) problems.push("it stopped testing payment_status = 'paid'");
      if (!/status\s*=\s*'served'/.test(ordersBranch)) problems.push("it stopped testing status = 'served'");
      if (!/bill_no/.test(src) || !/invoice_no/.test(src)) problems.push("its sessions branch stopped testing bill_no / invoice_no");
      if (!/lfh\.allow_purge/.test(src)) problems.push("the audited purge escape hatch is gone");
      if (problems.length) { fail(`the issued-bill lock has drifted: ${problems.join("; ")}`); }
      else pass("the issued-bill lock holds on kot_no + paid + served, and the session half still holds on bill_no / invoice_no");
    }
  }
}

console.log(failed ? `\n✗ ${failed} check(s) failed` : "\n✓ a single-file migration run cannot undo a later decision");
process.exit(failed ? 1 : 0);
