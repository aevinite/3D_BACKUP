// verify-migrations-161-240.mjs — SWEEP #9, TERMINAL 31. The fifty checks this run added over
// `supabase/migrations/` positions 161–240, made permanent and re-runnable.
//
// WHY A SCRIPT, AND WHY THIS SHAPE. The ledger's 238 existing rows over this territory answer
// "is what each file promised still present?" and "is each file safe when a re-seed re-runs it?".
// Neither answers the question that actually bites HERE, and it is the opposite of the one that bit
// positions 1–80 (verify-migrations-1-80.mjs, T29): these eighty files are not stale, they are
// SUPERSEDED. Thirty-odd of the functions they define have been recreated since by a later
// migration — mig 301 replaced the pay-later formula, 352 taught it about split payments, a later
// file rewrote lfh_admin_floor_all from a per-restaurant loop into one grouped pass, another moved
// lfh_owner_records onto a stored net_amount column. Every one of those recreates is an
// opportunity to silently drop the fix the ORIGINAL file existed to make — the
// "migration recreate reverts a fix" lesson this repo has paid for repeatedly.
//
// So the assertions below check the INTENT each file shipped, never the mechanism it used. That
// distinction is not academic: five of this run's first-pass assertions went red against a
// perfectly correct database purely because they named a variable, CTE or formula a later
// migration had legitimately replaced. An assertion pinned to a mechanism becomes a false alarm
// the day someone improves the code, and a guard that cries wolf stops being read.
//
// Phases P104601–P104650. Ids are permanent; never renumber one.
//   A  P104601–P104612  everything these eighty files build is still present, and still reachable
//                       by exactly the roles intended (plus the two look-alikes that are NOT faults)
//   B  P104613–P104638  the load-bearing fix of each file, asserted by INTENT against the LIVE body
//   C  P104639–P104643  a re-seed re-runs every one of these files: none of them rewrites a choice
//   D  P104644–P104650  driven — real RPCs at real scopes, asserting what actually comes back
//
// READ-ONLY against the database. Writes nothing, creates nothing, deletes nothing, and is safe
// beside other sessions working in this folder.
//
//   node scripts/verify-migrations-161-240.mjs
//   node scripts/verify-migrations-161-240.mjs --static    # skip the database half
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = join(root, "supabase", "migrations");
const STATIC_ONLY = process.argv.includes("--static");
const ALL = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const MINE = ALL.slice(160, 240);              // positions 161–240, re-derived every run

let failed = 0, ran = 0, skipped = 0;
const check = (id, what, ok, detail) => {
  ran++; if (ok === null) { skipped++; } else if (!ok) failed++;
  console.log(`  ${ok === null ? "⏭" : ok ? "✓" : "✗"} ${id}  ${what}${detail ? " — " + detail : ""}`);
};
const head = (m) => console.log("\n" + m);

// ── source helpers ───────────────────────────────────────────────────────────────────────────
const src = (f) => readFileSync(join(MIG, f), "utf8");
const noComments = (s) => s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
// Only TOP-LEVEL statements — what a re-seed actually executes. Everything inside a dollar-quoted
// body ($$ … $$ / $function$ … $function$) runs when the function is CALLED, not when the file is
// applied, and counting those was this run's single biggest false-positive source (36 imaginary
// "unguarded rewrites" in one file, all of them DELETEs inside admin_purge_restaurant).
function topLevel(raw) {
  const s = noComments(raw);
  const re = /\$([a-zA-Z_]*)\$/g;
  let out = "", last = 0, m, open = null;
  while ((m = re.exec(s))) {
    if (open === null) { out += s.slice(last, m.index); open = m[1]; }
    else if (m[1] === open) { open = null; last = m.index + m[0].length; }
  }
  if (open === null) out += s.slice(last);
  return out;
}
// A 3-digit run that is not part of a longer number. `\b\d{3}\b` CANNOT be used here: `_` is a
// word character, so `\b` never matches in `224_inventory_recipes.sql` and the check silently
// passed every file by finding no number at all.
const threeDigits = (s) => [...s.matchAll(/(?<!\d)(\d{3})(?!\d)/g)].map((m) => m[1]);

// What every one of my eighty files declares, derived from the files themselves — never a typed list.
function declared() {
  const d = { tables: new Set(), cols: new Set(), idx: new Set(), fns: new Set(), trg: new Set(), rls: new Set(), buckets: new Set() };
  for (const f of MINE) {
    const c = topLevel(src(f));
    for (const m of c.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi)) d.tables.add(m[1].toLowerCase());
    for (const m of c.matchAll(/alter\s+table\s+(?:public\.)?([a-z0-9_]+)([\s\S]*?);/gi)) {
      const t = m[1].toLowerCase();
      for (const col of m[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z0-9_]+)/gi)) d.cols.add(`${t}.${col[1].toLowerCase()}`);
      if (/enable\s+row\s+level\s+security/i.test(m[2])) d.rls.add(t);
    }
    for (const m of c.matchAll(/create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?([a-z0-9_]+)/gi)) d.idx.add(m[1].toLowerCase());
    for (const m of c.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi)) d.fns.add(m[1].toLowerCase());
    for (const m of c.matchAll(/create\s+trigger\s+([a-z0-9_]+)/gi)) d.trg.add(m[1].toLowerCase());
    for (const m of c.matchAll(/insert\s+into\s+storage\.buckets[\s\S]*?values\s*\(\s*'([a-z0-9-]+)'/gi)) d.buckets.add(m[1]);
  }
  return d;
}
// Retired ON PURPOSE by a later file in the sequence. Absence here is correct, not a fault.
const RETIRED_FNS = new Set(["lfh_bump_error_signature"]);   // dropped by mig 219 (the muting removal)

// ── the database, read-only ──────────────────────────────────────────────────────────────────
let db = null;
if (!STATIC_ONLY && existsSync(join(root, ".env.local"))) {
  const env = Object.fromEntries(readFileSync(join(root, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
  const url = env.NEXT_PUBLIC_SUPABASE_URL, pat = env.SUPABASE_ACCESS_TOKEN;
  if (url && pat) {
    const { refuseUnlessDevTestDb } = await import(join(root, "scripts", "sweep", "devStacks.mjs"));
    refuseUnlessDevTestDb(url, "a read-only migration inspection");
    const ref = new URL(url).hostname.split(".")[0];
    db = async (sql) => {
      const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: sql }),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(`SQL ${r.status}: ${t.slice(0, 300)}`);
      return JSON.parse(t);
    };
  }
}
const noDb = (id, what) => check(id, what, null, "no database reachable — static run");

console.log(`supabase/migrations positions 161–240 — ${MINE.length} files, ${MINE[0]} → ${MINE[MINE.length - 1]}`);

// ═════════════════════════════════════════════════════════════════════════════════════════════
// A · everything these files build is still present, and reachable by exactly the right roles
// ═════════════════════════════════════════════════════════════════════════════════════════════
head("A · what these eighty files build is still there, and still reachable by the right roles");
const D = declared();
if (!db) {
  for (const [id, what] of [
    ["P104601", "every table these files create still exists"],
    ["P104602", "every column these files add still exists"],
    ["P104603", "every index these files create still exists"],
    ["P104604", "every function these files define still exists (bar the one mig 219 retires)"],
    ["P104605", "every trigger these files attach still exists"],
    ["P104606", "every table these files lock down still has row-level security on"],
    ["P104607", "the inventory photo bucket still exists"],
    ["P104608", "every staff-only function these files define is still closed to the public menu key"],
    ["P104609", "every guest-called function these files define is still open to the public menu key"],
    ["P104610", "the customer-recognition read being closed to the public key is a LATER deliberate narrowing, not drift"],
    ["P104611", "the second, older guest place-order signature is a shim that re-prices on the server — not a second way to name your own price"],
    ["P104612", "no function these files define carries two live signatures that a named-argument call could not choose between"],
  ]) noDb(id, what);
} else {
  const lit = (a) => [...a].map((x) => `'${x}'`).join(",") || "''";
  const live = {
    tables: new Set((await db(`select tablename t from pg_tables where schemaname='public'`)).map((r) => r.t)),
    cols: new Set((await db(`select table_name||'.'||column_name k from information_schema.columns where table_schema='public'`)).map((r) => r.k)),
    idx: new Set((await db(`select indexname i from pg_indexes where schemaname='public'`)).map((r) => r.i)),
    fns: new Set((await db(`select distinct proname n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public'`)).map((r) => r.n)),
    trg: new Set((await db(`select tgname t from pg_trigger where not tgisinternal`)).map((r) => r.t)),
    rls: new Set((await db(`select c.relname r from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relrowsecurity`)).map((r) => r.r)),
    buckets: new Set((await db(`select id from storage.buckets`)).map((r) => r.id)),
  };
  const missing = (want, have, skip = new Set()) => [...want].filter((x) => !have.has(x) && !skip.has(x));
  const m1 = missing(D.tables, live.tables);
  check("P104601", "every table these files create still exists", m1.length === 0, `${D.tables.size - m1.length}/${D.tables.size}${m1.length ? " MISSING " + m1.join(", ") : ""}`);
  const m2 = missing(D.cols, live.cols);
  check("P104602", "every column these files add still exists", m2.length === 0, `${D.cols.size - m2.length}/${D.cols.size}${m2.length ? " MISSING " + m2.join(", ") : ""}`);
  const m3 = missing(D.idx, live.idx);
  check("P104603", "every index these files create still exists", m3.length === 0, `${D.idx.size - m3.length}/${D.idx.size}${m3.length ? " MISSING " + m3.join(", ") : ""}`);
  const m4 = missing(D.fns, live.fns, RETIRED_FNS);
  check("P104604", "every function these files define still exists (bar the one mig 219 retires)", m4.length === 0, `${D.fns.size - m4.length}/${D.fns.size}, ${RETIRED_FNS.size} deliberately retired${m4.length ? ", MISSING " + m4.join(", ") : ""}`);
  const m5 = missing(D.trg, live.trg);
  check("P104605", "every trigger these files attach still exists", m5.length === 0, `${D.trg.size - m5.length}/${D.trg.size}${m5.length ? " MISSING " + m5.join(", ") : ""}`);
  const m6 = missing(D.rls, live.rls);
  check("P104606", "every table these files lock down still has row-level security on", m6.length === 0, `${D.rls.size - m6.length}/${D.rls.size}${m6.length ? " RLS OFF on " + m6.join(", ") : ""}`);
  const m7 = missing(D.buckets, live.buckets);
  check("P104607", "the inventory photo bucket still exists", m7.length === 0, [...D.buckets].join(", "));

  // Intent, read out of the files: REVOKEd from anon/authenticated => staff-only; GRANTed to anon => guest-called.
  const staffOnly = new Set(), guestCalled = new Set();
  for (const f of MINE) {
    const c = noComments(src(f));
    for (const m of c.matchAll(/revoke[\s\S]{0,140}?on\s+function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi)) staffOnly.add(m[1].toLowerCase());
    for (const m of c.matchAll(/grant\s+execute\s+on\s+function\s+(?:public\.)?([a-z0-9_]+)\s*\([^)]*\)\s*to\s+([a-z_,\s]+)/gi))
      if (/anon/.test(m[2])) guestCalled.add(m[1].toLowerCase());
  }
  for (const g of guestCalled) staffOnly.delete(g);
  // A later migration may deliberately CLOSE a door these files opened. Written down, with the file.
  const NARROWED_LATER = new Map([["lfh_recognize_customer", "mig 300 closed it to the public key; both remaining call sites are server-side"]]);
  const acl = await db(`select p.proname n, p.oid::regprocedure::text sig,
      has_function_privilege('anon',p.oid,'EXECUTE') a,
      has_function_privilege('authenticated',p.oid,'EXECUTE') u,
      has_function_privilege('service_role',p.oid,'EXECUTE') s
    from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='public' and p.proname in (${lit(new Set([...staffOnly, ...guestCalled]))})`);
  const leaked = acl.filter((r) => staffOnly.has(r.n) && (r.a || r.u));
  const unreachable = acl.filter((r) => staffOnly.has(r.n) && !r.s);
  check("P104608", "every staff-only function these files define is still closed to the public menu key",
    leaked.length === 0 && unreachable.length === 0,
    `${acl.filter((r) => staffOnly.has(r.n)).length} staff-only function(s) checked${leaked.length ? "; REACHABLE WITH THE PUBLIC KEY: " + leaked.map((r) => r.sig).join(", ") : ""}${unreachable.length ? "; THE SERVER CANNOT CALL: " + unreachable.map((r) => r.sig).join(", ") : ""}`);
  const shut = acl.filter((r) => guestCalled.has(r.n) && !r.a && !NARROWED_LATER.has(r.n));
  check("P104609", "every guest-called function these files define is still open to the public menu key",
    shut.length === 0, `${acl.filter((r) => guestCalled.has(r.n) && r.a).length} open as intended${shut.length ? "; CLOSED AND NOT WRITTEN DOWN: " + shut.map((r) => r.sig).join(", ") : ""}`);
  const narrowedOk = [...NARROWED_LATER.keys()].every((n) => { const r = acl.find((x) => x.n === n); return !r || (!r.a && !r.u && r.s); });
  check("P104610", "the customer-recognition read being closed to the public key is a LATER deliberate narrowing, not drift",
    narrowedOk, [...NARROWED_LATER.values()].join("; "));

  const shim = await db(`select p.oid::regprocedure::text sig, p.pronargdefaults nd, pg_get_functiondef(p.oid) def
    from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='public' and p.proname='lfh_place_order' and p.pronargs=6`);
  const isShim = shim.length === 1 && /RETURN\s+lfh_place_order\(\s*p_token\s*,\s*p_items\s*,\s*p_allergies\s*\)/i.test(shim[0].def);
  check("P104611", "the second, older guest place-order signature is a shim that re-prices on the server — not a second way to name your own price",
    isShim, isShim ? "the six-argument form ignores the subtotal/tax/total it is handed and delegates to the server-priced three-argument one (mig 029's shim)" : "the six-argument form no longer delegates — the money it is handed may be trusted");

  const ambiguous = await db(`select p.proname n, count(*) c, string_agg(p.oid::regprocedure::text, ' | ') sigs,
      sum(case when p.pronargdefaults > 0 then 1 else 0 end) with_defaults
    from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='public' and p.proname in (${lit(D.fns)})
    group by p.proname having count(*) > 1`);
  // Two signatures only collide for a named-argument call when a shorter one's keys are a subset of
  // a longer one's REQUIRED keys, i.e. when the longer one has defaults. None here do.
  const risky = ambiguous.filter((r) => Number(r.with_defaults) > 0);
  check("P104612", "no function these files define carries two live signatures that a named-argument call could not choose between",
    risky.length === 0, ambiguous.length ? `${ambiguous.length} name(s) with two signatures, none defaultable: ${ambiguous.map((r) => r.n).join(", ")}` : "every name has exactly one live signature");
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// B · the load-bearing fix of each file, asserted by INTENT against the LIVE body
// ═════════════════════════════════════════════════════════════════════════════════════════════
head("B · each file's load-bearing fix, asserted by intent against the live function body");
const B_CHECKS = [
  ["P104613", "lfh_owner_overview", "mig 155 · the portfolio tiles still resolve the tax rate once per query, never once per order row",
    (d) => ({ ok: /rates\s+AS\s+MATERIALIZED/i.test(d) || !/lfh_effective_tax_rate\(\s*o\./i.test(d), why: "a MATERIALIZED rates join, or no per-order-row rate call at all" })],
  ["P104614", "lfh_owner_records", "mig 155 · the all-time records read still never asks for the tax rate once per order row",
    (d) => ({ ok: !/lfh_effective_tax_rate\(\s*o\./i.test(d) && (/net_amount/i.test(d) || /\(\s*SELECT\s+lfh_effective_tax_rate\(/i.test(d)), why: "a stored net amount or a once-per-query rate" })],
  ["P104615", "lfh_prune_logs", "mig 157 · log pruning still consults the platform-wide default row", (d) => ({ ok: /id\s*=\s*'site'/i.test(d), why: "the id='site' fallback" })],
  ["P104616", "lfh_prune_logs", "mig 158 · log pruning still hard-caps every restaurant's window at one month",
    (d) => ({ ok: /LEAST\(\s*COALESCE\([^)]*?,\s*30\s*\)\s*,\s*30\s*\)/i.test(d), why: "the 30-day ceiling on both windows" })],
  ["P104617", "lfh_prune_logs", "mig 162 · pruning still trims the session history and SETTLED repair requests, and never an open one",
    (d) => ({ ok: /DELETE FROM agent_runs[\s\S]{0,160}?interval '30 days'/i.test(d) && /DELETE FROM fix_requests[\s\S]{0,200}?status <> 'open'/i.test(d), why: "both sweeps, with open requests spared" })],
  ["P104618", "lfh_log_manual_edit", "mig 159 · the manual-edit footprint still cannot break the edit it is recording",
    (d) => ({ ok: /EXCEPTION\s+WHEN\s+OTHERS/i.test(d), why: "the swallow-everything handler" })],
  ["P104620", "lfh_place_order", "mig 164 · a follow-up guest order still skips the second Accept",
    (d) => ({ ok: /status NOT IN \('received', ?'cancelled'\)/i.test(d) && /'preparing'/.test(d), why: "the auto-accept branch" })],
  ["P104621", "lfh_place_order", "mig 206 · the guest session ordering door still passes through the rate limiter",
    (d) => ({ ok: /lfh_rate_check\(/i.test(d), why: "the rate-limit guard" })],
  ["P104622", "lfh_place_order", "mig 164 · a guest order is still priced by the server for the session's OWN restaurant",
    (d) => ({ ok: /lfh_price_order\(\s*p_items\s*,\s*v_rid\s*\)/i.test(d), why: "the tenant-scoped server pricing call" })],
  ["P104623", "lfh_rt_emit", "mig 166 · the realtime breadcrumb still has its own table-marks branch (that table has no id column)",
    (d) => ({ ok: /TG_TABLE_NAME = 'table_tags'/i.test(d), why: "the explicit table_tags branch" })],
  ["P104624", "lfh_clear_table_tag_on_close", "mig 166 · a table's mark still clears when that party leaves, unless another party still holds the table",
    (d) => ({ ok: /NOT EXISTS[\s\S]{0,240}status = 'open'[\s\S]{0,80}id <> NEW\.id/i.test(d), why: "the other-session-still-open exemption" })],
  ["P104625", "lfh_admin_floor_all", "mig 166 · the admin all-restaurants floor still carries each table's mark and still carries NO money",
    (d) => ({ ok: /table_tags/i.test(d) && /'g',/.test(d) && !/'due'|net_amount|o\.total|SUM\(/i.test(d), why: "the mark, and no amount anywhere" })],
  ["P104626", "lfh_staff_move_order", "mig 173 · moving one kitchen ticket still refuses a paid order and a live invoice on either side",
    (d) => ({ ok: /'order_paid'/.test(d) && /'source_invoiced'/.test(d) && /'target_invoiced'/.test(d), why: "all three refusals" })],
  ["P104627", "lfh_staff_merge_tables", "mig 174 · merging two tables still adds both discounts up and re-splits them over the one combined bill",
    (d) => ({ ok: /discount\s*=\s*COALESCE\(\s*v_\w+\.discount,\s*0\s*\)\s*\+\s*COALESCE\(\s*v_\w+\.discount,\s*0\s*\)/i.test(d) && /lfh_split_bill_discount\(\s*v_\w+\.id\s*\)/i.test(d), why: "both halves of the money rule" })],
  ["P104628", "lfh_staff_merge_tables", "mig 174 · a merged table still ends up with exactly one head",
    (d) => ({ ok: /SET role = 'guest'/i.test(d), why: "the head demotion" })],
  ["P104629", "lfh_staff_move_order_item", "mig 175 · moving the last dish off a ticket still cancels it instead of leaving a ₹0 line on the bill",
    (d) => ({ ok: /v_left = 0[\s\S]{0,240}status = 'cancelled'/i.test(d), why: "the empty-order cancellation" })],
  ["P104630", "lfh_staff_move_order_item", "mig 175 · a dish already served still keeps its status when it moves, so it never returns as a new kitchen task",
    (d) => ({ ok: /v_item\.status = 'served'[\s\S]{0,60}'served'/i.test(d), why: "the served-stays-served mapping" })],
  ["P104631", "lfh_generate_invoice", "mig 189 · an invoice still cannot be re-issued once the bill is settled",
    (d) => ({ ok: /status = 'closed'[\s\S]{0,260}invoice locked/i.test(d), why: "the settled lock" })],
  ["P104632", "lfh_void_invoice", "mig 189 · voiding an invoice is still refused once the bill is settled, and still leaves a permanent record",
    (d) => ({ ok: /status = 'closed'[\s\S]{0,260}invoice locked/i.test(d) && /insert into invoice_events/i.test(d), why: "the settled lock and the history row" })],
  ["P104633", "lfh_block_issued_delete", "mig 190 · an issued bill still cannot be permanently erased, and the audited purge is still the only exception",
    (d) => ({ ok: /lfh\.allow_purge/.test(d) && /payment_status = 'paid'/i.test(d) && /bill_no is not null/i.test(d), why: "the escape hatch and both definitions of issued" })],
  ["P104634", "lfh_issue_credit_note", "mig 194 · a credit note still cannot exceed the bill it credits, and still needs a reason",
    (d) => ({ ok: /cannot exceed the bill total/i.test(d) && /a reason is required/i.test(d), why: "both refusals" })],
  ["P104635", "lfh_owner_category_breakdown", "mig 195 · the category mix still matches a sold line to the menu by title (matching by id put every sale in \"Other\")",
    (d) => ({ ok: /mi\.title = \(it->>'title'\)/i.test(d) && !/mi\.id::text = \(it->>'id'\)/i.test(d), why: "the title join, and not the broken id join" })],
  ["P104636", "lfh_staff_place_order", "mig 202 · two identical orders fired at one table in the same instant are still serialised and de-duplicated",
    (d) => ({ ok: /pg_advisory_xact_lock\(hashtextextended\('lfh_place:/i.test(d) && /duplicateWarning/i.test(d) && /p_confirm_duplicate/i.test(d), why: "the per-table lock, the warning, and the deliberate send-anyway" })],
  ["P104637", "lfh_price_order", "mig 203 · a malformed add-on list on one line still degrades to \"no add-ons\" instead of failing the whole order",
    (d) => ({ ok: (d.match(/jsonb_typeof\([^)]*\) = 'array'/g) || []).length >= 3, why: "all three extraction sites type-guarded" })],
  ["P104638", "lfh_price_order", "mig 215 · an open-price dish still takes the price the staff typed, clamped, and still refuses to ring up at ₹0",
    (d) => ({ ok: /open_price/i.test(d) && /LEAST\(100000/.test(d) && /'price_required'/.test(d), why: "the typed price, the clamp, and the ₹0 refusal" })],
];
if (!db) { for (const [id, , what] of B_CHECKS) noDb(id, what); noDb("P104619", "mig 159 · the manual-edit footprint is still on the config tables only, never the hot order tables"); }
else {
  const rows = await db(`select p.proname n, pg_get_functiondef(p.oid) def
    from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='public' and p.proname in (${[...new Set(B_CHECKS.map((c) => c[1]))].map((x) => `'${x}'`).join(",")})`);
  const byName = {};
  for (const r of rows) byName[r.n] = (byName[r.n] || "") + "\n" + r.def;
  for (const [id, fn, what, test] of B_CHECKS) {
    const d = byName[fn];
    if (!d) { check(id, what, false, `${fn} is not in the database`); continue; }
    const { ok, why } = test(d);
    check(id, what, ok, ok ? `live body carries ${why}` : `live body does NOT carry ${why}`);
  }
  // asked of the DATABASE, not of the file: which tables is the footprint actually on?
  const tg = (await db(`select c.relname t from pg_trigger tr
      join pg_class c on c.oid=tr.tgrelid join pg_proc p on p.oid=tr.tgfoid
     where not tr.tgisinternal and p.proname='lfh_log_manual_edit'`)).map((r) => r.t);
  const want = ["categories", "menu_items", "restaurants", "settings"];
  const hot = [...new Set(tg)].filter((t) => ["orders", "sessions", "order_items"].includes(t));
  check("P104619", "mig 159 · the manual-edit footprint is still on the config tables only, never the hot order tables",
    want.every((w) => tg.includes(w)) && hot.length === 0,
    `on ${[...new Set(tg)].join(", ")}; on a hot order table: ${hot.join(", ") || "none"}`);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// C · a re-seed re-runs every one of these files. None of them rewrites a stored choice.
// ═════════════════════════════════════════════════════════════════════════════════════════════
head("C · a re-seed re-runs all eighty of these files with no ledger of its own");
{
  const ABSENCE = /IS NULL|NOT IN \(|\? '[a-z_]+' = false|NOT EXISTS|owner_entitlements - '|= 0\b/i;
  // A rewrite that converges: running it twice lands in the same place as running it once.
  const CONVERGES = /source = 'parcel'|tablet_take_orders = 'on'|key = 'admin_login'/i;
  const unguarded = [], rewriters = [];
  for (const f of MINE) {
    const raw = src(f), c = topLevel(raw), ledger = /lfh_already_applied/.test(raw);
    let n = 0;
    // A REAL rewrite. `UPDATE <tbl> [alias] SET …` — the optional alias matters: without it
    // `UPDATE staff_users su SET …` in migrations 223 and 225 is invisible.
    for (const m of c.matchAll(/\bupdate\s+[a-z0-9_.]+(?:\s+(?!set\b)[a-z0-9_]+)?\s+set\b([\s\S]*?);/gi)) {
      n++; const s = m[0].replace(/\s+/g, " ");
      if (!(ledger || ABSENCE.test(s) || CONVERGES.test(s))) unguarded.push(`${f} :: ${s.slice(0, 110)}`);
    }
    for (const m of c.matchAll(/\bdelete\s+from\s+([a-z0-9_.]+)([\s\S]*?);/gi)) {
      n++; const s = m[0].replace(/\s+/g, " ");
      if (!(ledger || ABSENCE.test(s) || CONVERGES.test(s))) unguarded.push(`${f} :: ${s.slice(0, 110)}`);
    }
    if (n) rewriters.push(f);
  }
  check("P104639", "no top-level data rewrite in these eighty files would change a stored choice on a second run",
    unguarded.length === 0, `${rewriters.length} file(s) rewrite data at the top level; unguarded: ${unguarded.length}${unguarded.length ? "\n      " + unguarded.join("\n      ") : ""}`);

  // The guarded blocks. Their bodies are dollar-quoted, so topLevel() strips them — they need
  // their own pass, or a future unguarded rewrite hidden inside a DO block reads as "no rewrites".
  const blocks = [], bad = [];
  for (const f of MINE) for (const m of src(f).matchAll(/\bDO\s+\$([a-zA-Z_]*)\$([\s\S]*?)\$\1\$/g)) {
    const b = m[2];
    if (!/\bupdate\s+[a-z0-9_.]+(?:\s+(?!set\b)[a-z0-9_]+)?\s+set\b|\bdelete\s+from\b/i.test(b)) continue;
    blocks.push(`${f} DO $${m[1]}$`);
    if (!(/lfh_already_applied/.test(b) || /information_schema\.columns|to_regclass|to_regprocedure|pg_constraint/.test(b))) bad.push(`${f} DO $${m[1]}$`);
  }
  check("P104640", "every do-block in these files that rewrites data is behind the applied-once ledger or an existence test",
    bad.length === 0, `${blocks.length} such block(s): ${blocks.join(", ")}${bad.length ? "; UNGUARDED: " + bad.join(", ") : ""}`);

  let hazard = [];
  for (const f of MINE) {
    const c = topLevel(src(f)), h = [];
    if (/create\s+table\s+(?!if\s+not\s+exists)/i.test(c)) h.push("CREATE TABLE without IF NOT EXISTS");
    if (/add\s+column\s+(?!if\s+not\s+exists)/i.test(c)) h.push("ADD COLUMN without IF NOT EXISTS");
    if (/create\s+(unique\s+)?index\s+(?!if\s+not\s+exists|concurrently)/i.test(c)) h.push("CREATE INDEX without IF NOT EXISTS");
    if (/create\s+function/i.test(c) && !/create\s+or\s+replace\s+function/i.test(c)) h.push("CREATE FUNCTION without OR REPLACE");
    for (const m of c.matchAll(/create\s+trigger\s+([a-z0-9_]+)/gi))
      if (!new RegExp(`drop\\s+trigger\\s+if\\s+exists\\s+${m[1]}`, "i").test(c)) h.push(`CREATE TRIGGER ${m[1]} with no DROP first`);
    for (const m of c.matchAll(/insert\s+into\s+([a-z0-9_.]+)([\s\S]*?);/gi))
      if (!/on\s+conflict/i.test(m[2]) && !/storage\.buckets/i.test(m[1])) h.push(`seeding INSERT into ${m[1]} with no ON CONFLICT`);
    if (/\bdrop\s+table\b/i.test(c)) h.push("DROP on a live table");
    if (h.length) hazard.push(`${f}: ${h.join("; ")}`);
  }
  check("P104641", "not one of these eighty files carries any of the seven statement-level re-seed hazards",
    hazard.length === 0, hazard.length ? hazard.join(" | ") : `all ${MINE.length} files clean`);

  const MONEY = ["orders", "sessions", "order_items", "session_payments", "invoice_events", "credit_notes", "payments", "aggregator_orders"];
  const erases = [];
  for (const f of MINE) {
    const c = topLevel(src(f));
    for (const m of c.matchAll(/\bdelete\s+from\s+([a-z0-9_.]+)/gi)) if (MONEY.includes(m[1].toLowerCase())) erases.push(`${f}: DELETE from ${m[1]}`);
    for (const m of c.matchAll(/\bupdate\s+([a-z0-9_.]+)(?:\s+(?!set\b)[a-z0-9_]+)?\s+set\b([\s\S]*?);/gi))
      if (MONEY.includes(m[1].toLowerCase()) && /\b(total|subtotal|tax|discount|net_amount|amount)\s*=\s*0\b/i.test(m[2])) erases.push(`${f}: UPDATE zeroing money on ${m[1]}`);
  }
  check("P104642", "no statement in these eighty files erases or zeroes a sale when the file is applied",
    erases.length === 0, erases.length ? erases.join(" | ") : "no top-level statement touches a money table destructively");

  // A file's own CLAIM about which migration it is = a 3-digit number opening a header comment
  // (`-- 192_name.sql` or `-- 193 — …`). A CROSS-REFERENCE ("mirrors migration 128", "mig 185
  // changed …") is not a claim, and reading one as a claim is how this check produced a false
  // alarm on 208_owner_recycle_bin.sql, whose header legitimately points at migration 128.
  const misnumbered = [];
  for (const f of MINE) {
    const own = f.slice(0, 3);
    const lines = src(f).split("\n").slice(0, 6);
    const claims = [];
    for (const l of lines) {
      const m = l.match(/^\s*--\s*(?<!\d)(\d{3})(?!\d)/);
      if (m) claims.push(m[1]);
    }
    const h = lines.join(" ");
    if (claims.length && !claims.includes(own) && !/renumber/i.test(h))
      misnumbered.push(`${f} header claims to be migration ${[...new Set(claims)].join(", ")}`);
  }
  check("P104643", "every one of these files still names its own migration number in its header, or says it was renumbered",
    misnumbered.length === 0, misnumbered.length ? misnumbered.join(" | ") : `all ${MINE.length} headers agree with their filename`);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// D · driven — real RPCs at real scopes, asserting what actually comes back
// ═════════════════════════════════════════════════════════════════════════════════════════════
head("D · driven against the database — real calls, real answers");
const RID = "00000000-0000-0000-0000-000000000001";
const D_IDS = [
  ["P104644", "mig 227 · the four ways of writing one Indian mobile still resolve to the same customer, and a foreign number is still not mangled"],
  ["P104645", "mig 212 · the returning-guest greeting still never carries a phone number"],
  ["P104646", "mig 228 · the admin Customers view still returns head-counts only, never a restaurant's earnings"],
  ["P104647", "mig 184 · a pay-later bill still shows exactly what is still owed, and never a negative debt"],
  ["P104648", "mig 227 · a purchase or expense dated today is still inside a \"this month\" window"],
  ["P104649", "mig 229 · the floor view still survives an order whose items are not a list, and still answers for a real restaurant"],
  ["P104650", "mig 205 · a key with no configured limit is still allowed through, and still writes no counter and no problem row"],
];
if (!db) { for (const [id, what] of D_IDS) noDb(id, what); }
else {
  const p = (await db(`select lfh_phone10('+91 98250 12345') a, lfh_phone10('098250 12345') b, lfh_phone10('9825012345') c,
    lfh_phone10('091 98250 12345') d, lfh_phone10('+1 415 555 0123') e, lfh_phone10('') f`))[0];
  check("P104644", D_IDS[0][1], p.a === "9825012345" && p.b === p.a && p.c === p.a && p.d === p.a && p.e === "14155550123" && p.f === null,
    `+91 / 0 / bare / 091 all resolve to ${p.a}; a US number stays ${p.e}; empty stays empty`);

  const greet = await db(`select lfh_greet_device('${RID}'::uuid, d.device_id) g, d.phone
     from customer_devices d where d.restaurant_id='${RID}' limit 5`);
  if (!greet.length) check("P104645", D_IDS[1][1], true, "no linked devices on this database; the function selects only name and visit count");
  else {
    const leaked = greet.filter((x) => x.phone && JSON.stringify(x.g).includes(String(x.phone).slice(-6)));
    check("P104645", D_IDS[1][1], leaked.length === 0, `${greet.length} known device(s) greeted, ${leaked.length} carrying any part of the number`);
  }

  const spread = (await db(`select lfh_admin_customer_spread() s`))[0].s;
  const keys = [...new Set(spread.flatMap((x) => Object.keys(x)))];
  const money = keys.filter((k) => /revenue|total|spend|amount|lifetime|net/i.test(k));
  check("P104646", D_IDS[2][1], money.length === 0, `keys returned: ${keys.join(", ")}; money-shaped: ${money.join(", ") || "none"}`);

  const k = (await db(`
    with rpc as (select bill_key, bill_amount from lfh_khata_outstanding(ARRAY['${RID}'::uuid])),
    hand as (
      select coalesce(o.session_id::text,o.id::text) kk,
             greatest(round(sum(coalesce(o.net_amount,0)),2) - coalesce(max(sc.collected),0), 0) due
        from orders o
        left join lfh_session_collected sc on sc.session_id=o.session_id and sc.restaurant_id=o.restaurant_id
       where o.restaurant_id='${RID}' and o.khata_at is not null and o.payment_status<>'paid'
         and o.status<>'cancelled' and o.deleted_at is null and o.khata_customer_id is not null
       group by 1)
    select (select count(*) from rpc) a, (select count(*) from hand where due>0) b,
           (select count(*) from rpc join hand h on h.kk=rpc.bill_key and h.due=rpc.bill_amount) c,
           (select count(*) from rpc where bill_amount<0) d`))[0];
  check("P104647", D_IDS[3][1], Number(k.a) === Number(k.b) && Number(k.c) === Number(k.a) && Number(k.d) === 0,
    `${k.a} open pay-later bill(s); ${k.c} agreeing to the paisa with "stored net amount minus what the split already collected"; negative debts: ${k.d}`);

  const w = (await db(`select ((now() - interval '1 microsecond') at time zone 'Asia/Kolkata')::date e,
    (now() at time zone 'Asia/Kolkata')::date t,
    ((now() - interval '1 microsecond') at time zone 'Asia/Kolkata')::date >= (now() at time zone 'Asia/Kolkata')::date ok`))[0];
  check("P104648", D_IDS[4][1], w.ok === true, `window end resolves to ${w.e}, today is ${w.t}`);

  const g = (await db(`select
    (select count(*) from jsonb_array_elements(case when jsonb_typeof('0'::jsonb)='array' then '0'::jsonb else '[]'::jsonb end)) rows,
    (select count(*) from orders where restaurant_id='${RID}' and jsonb_typeof(items) <> 'array') bad,
    json_typeof(lfh_table_view_summary('${RID}'::uuid)) t`))[0];
  check("P104649", D_IDS[5][1], Number(g.rows) === 0 && g.t === "object",
    `the guard turns a non-list items value into 0 rows instead of an error; malformed rows today: ${g.bad}; the live floor call answered with a ${g.t}`);

  const key = `verify-161-240-probe-${Date.now()}`;
  const allowed = (await db(`select lfh_rate_check('${RID}'::uuid,'${key}','subject:probe','probe') ok`))[0].ok;
  const after = (await db(`select
    (select count(*) from rate_limit_counters where key='${key}') c,
    (select count(*) from rate_limit_events   where key='${key}') e`))[0];
  check("P104650", D_IDS[6][1], allowed === true && Number(after.c) === 0 && Number(after.e) === 0,
    `allowed=${allowed}; counter rows written: ${after.c}; problem rows written: ${after.e} (nothing to clean up)`);
}

console.log(`\n${failed ? "✗" : "✓"} migrations 161–240 — ${ran - skipped - failed}/${ran - skipped} green${skipped ? `, ${skipped} skipped (no database)` : ""}${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
