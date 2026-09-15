// verify-migrations-1-80.mjs — SWEEP #9, TERMINAL 29. The fifty checks this run added over
// `supabase/migrations/` positions 1–80, made permanent and re-runnable.
//
// WHY A SCRIPT. The ledger's 431 existing rows over this territory answer "is what each file
// promised still present?" (verify:migration-truth), "who may run it?" (verify:grants) and "is each
// statement syntactically re-runnable?". None of them answered the question that actually bit:
// **a file can be perfectly idempotent and still be unrunnable today**, because a LATER migration
// deliberately retired what it creates. Three of these eighty files could not be applied at all —
// 030, 032 and 054 each raise a hard error on any database that has reached the migration which
// retired their object, which is every live one. A full re-seed hid it, because a re-seed runs the
// retiring file afterwards. `node scripts/run-migration.mjs <one file>` — the workflow CLAUDE.md
// actively recommends — did not.
//
// Phases P104401–P104450. Ids are permanent; never renumber one.
//   A  P104401–P104412  the seven run-alone faults this run fixed, one row per retired object
//   A2 P104413–P104415  the same question asked of all eighty files at once
//   B  P104416–P104431  the sixteen THINNEST files in the territory, by measured ledger coverage
//   D  P104432–P104438  does each restaurant still only see its own numbers, for the objects
//                       these eighty files created
//   E  P104439–P104442  reading the logic for a wrong result a real restaurant would get
//   C  P104443–P104450  driven in a real browser — recorded here, run by the sweep's live pass
//
// READ-ONLY against the database. Writes nothing, creates nothing, safe beside other sessions.
//
//   node scripts/verify-migrations-1-80.mjs
//   node scripts/verify-migrations-1-80.mjs --static     # skip the database half
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG = join(root, "supabase", "migrations");
const STATIC_ONLY = process.argv.includes("--static");
const FILES = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const MINE = FILES.slice(0, 80);

let failed = 0, ran = 0;
const results = [];
const check = (id, what, ok, detail) => {
  ran++;
  if (!ok) failed++;
  results.push({ id, what, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${id}  ${what}${detail ? " — " + detail : ""}`);
};
const head = (m) => console.log("\n" + m);

const src = (f) => readFileSync(join(MIG, f), "utf8");
const code = (f) => src(f).split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const has = (f, re) => re.test(code(f));

// ── the database, read-only ──────────────────────────────────────────────────────────────────
let db = null;
if (!STATIC_ONLY && existsSync(join(root, ".env.local"))) {
  const env = Object.fromEntries(readFileSync(join(root, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  db = async (sql) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ read_only: true, query: sql }),
    });
    if (!r.ok) throw new Error((await r.text()).slice(0, 200));
    return r.json();
  };
}
const one = async (sql) => (await db(sql))[0];
const body = async (fn) => {
  const rows = await db(`select p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                          where n.nspname='public' and p.proname='${fn}'`);
  return rows.map((r) => r.prosrc).join("\n");
};

// ═════════════ A — the seven run-alone faults, one row per retired object ═════════════════════
head("A — running ONE of these eighty files by hand lands where the sequence left it (P104401–P104412)");

check("P104401", "013 leaves `settings` OFF the supabase_realtime publication, as migration 304 decided",
  has("013_realtime_settings.sql", /ALTER\s+PUBLICATION\s+supabase_realtime\s+DROP\s+TABLE\s+public\.settings/i),
  "the file ends with 304's own guarded removal");

for (const [id, idx, by] of [
  ["P104402", "idx_blocklist_phone", "267"],
  ["P104403", "idx_blocklist_table", "267"],
  ["P104404", "idx_otp_phone", "296"],
]) check(id, `014 leaves ${idx} dropped, as migration ${by} decided`,
  has("014_sessions_v2_schema.sql", new RegExp(`DROP\\s+INDEX\\s+IF\\s+EXISTS\\s+${idx}`, "i")),
  "re-creating it is paid for on every insert, for reads nobody makes");

check("P104405", "030 names no column the database lacks, so the file can be APPLIED AT ALL",
  !/^\s*UPDATE\s+menu_items\s+SET\s+reviews/im.test(code("030_real_reviews.sql")),
  "the wipe is gated on the columns existing (migration 359 dropped reviews + rating)");
check("P104406", "030 still wipes the seeded fakes on a database that DOES have the two columns",
  has("030_real_reviews.sql", /information_schema\.columns[\s\S]*?'reviews'[\s\S]*?UPDATE menu_items SET reviews/i)
  && has("030_real_reviews.sql", /'rating'[\s\S]*?UPDATE menu_items SET rating = NULL/i),
  "a fresh seed is unchanged — the gate only skips where the columns are already gone");

check("P104407", "032 does not build the GLOBAL dish-number index where 082's per-restaurant one exists",
  has("032_dish_no.sql", /pg_indexes[\s\S]*?menu_items_restaurant_dish_no_key[\s\S]*?CREATE UNIQUE INDEX IF NOT EXISTS menu_items_dish_no_key/i),
  "ten restaurants share a dish #3, so an unguarded CREATE raises a duplicate-key error");
check("P104408", "032 ends with the global dish-number index retired, as migration 082 decided",
  has("032_dish_no.sql", /DROP\s+INDEX\s+IF\s+EXISTS\s+menu_items_dish_no_key/i), "");

check("P104409", "054 does not build the GLOBAL username index where 091/245's per-restaurant one exists",
  has("054_staff_users.sql", /idx_staff_users_username_live[\s\S]*?CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_users_username/i),
  "four restaurants each have a \"manager\", so an unguarded CREATE raises a duplicate-key error");
check("P104410", "054 ends with the global username index retired, as migrations 091/245 decided",
  has("054_staff_users.sql", /DROP\s+INDEX\s+IF\s+EXISTS\s+idx_staff_users_username\s*;/i), "");

check("P104411", "037 ends with settings.tax_inclusive dropped, as migration 304 decided",
  has("037_billing_feedback_backend_stubs.sql", /ALTER\s+TABLE\s+settings\s+DROP\s+COLUMN\s+IF\s+EXISTS\s+tax_inclusive/i),
  "price_tax_mode (270) is what every tax decision reads");
check("P104412", "057 ends with realtime_events_topic_idx dropped, as migration 267 decided",
  has("057_realtime_events.sql", /DROP\s+INDEX\s+IF\s+EXISTS\s+realtime_events_topic_idx/i),
  "realtime_events is the busiest INSERT table in the product");

// ═════════════ A2 — the same question asked of all eighty at once ════════════════════════════
head("A2 — and no OTHER file in the eighty carries the same shape (P104413–P104415)");
{
  // Rebuilt here rather than imported, so these three rows can be re-run on their own.
  const lastC = new Map(), lastD = new Map(), colA = new Map(), colD = new Map();
  const stamp = (f, at) => `${f}#${String(at).padStart(8, "0")}`;
  for (const f of FILES) {
    const t = code(f);
    for (const m of t.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z0-9_]+)"?\s+ON/gi)) lastC.set(m[1].toLowerCase(), stamp(f, m.index));
    for (const m of t.matchAll(/(?:DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?(?:public\.)?|DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?)"?([a-zA-Z0-9_]+)"?/gi)) lastD.set(m[1].toLowerCase(), stamp(f, m.index));
    for (const m of t.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z0-9_]+)"?([\s\S]*?);/gi)) {
      const tb = m[1].toLowerCase();
      for (const c of m[2].matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z0-9_]+)"?/gi)) colA.set(`${tb}.${c[1].toLowerCase()}`, stamp(f, m.index + c.index));
      for (const c of m[2].matchAll(/DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?([a-zA-Z0-9_]+)"?/gi)) colD.set(`${tb}.${c[1].toLowerCase()}`, stamp(f, m.index + c.index));
    }
  }
  const retiredIdx = new Set([...lastD.keys()].filter((k) => !lastC.get(k) || lastD.get(k) > lastC.get(k)));
  const deadCol = new Set([...colD.keys()].filter((k) => !colA.get(k) || colD.get(k) > colA.get(k)));

  const idxOffenders = [], colOffenders = [], writeOffenders = [];
  for (const f of MINE) {
    const t = code(f);
    const cre = [...t.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z0-9_]+)"?\s+ON/gi)];
    const dro = [...t.matchAll(/DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z0-9_]+)"?/gi)];
    for (const c of cre) {
      const n = c[1].toLowerCase();
      if (!retiredIdx.has(n)) continue;
      if (dro.some((d) => d[1].toLowerCase() === n && d.index > c.index)) continue;
      idxOffenders.push(`${f}:${n}`);
    }
    for (const m of t.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z0-9_]+)"?([\s\S]*?);/gi)) {
      const tb = m[1].toLowerCase();
      for (const c of m[2].matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z0-9_]+)"?/gi)) {
        const k = `${tb}.${c[1].toLowerCase()}`;
        if (!deadCol.has(k)) continue;
        if (new RegExp(`DROP\\s+COLUMN\\s+IF\\s+EXISTS\\s+${c[1]}`, "i").test(t.slice(m.index))) continue;
        colOffenders.push(`${f}:${k}`);
      }
    }
    const top = t.replace(/\$([a-zA-Z0-9_]*)\$[\s\S]*?\$\1\$/g, " ");
    for (const m of top.matchAll(/\bUPDATE\s+(?:public\.)?"?([a-zA-Z0-9_]+)"?\s+SET\s+([\s\S]*?)(?:\bWHERE\b|\bFROM\b|;)/gi))
      for (const c of m[2].matchAll(/([a-zA-Z0-9_]+)\s*=/g))
        if (deadCol.has(`${m[1].toLowerCase()}.${c[1].toLowerCase()}`)) writeOffenders.push(`${m[1]}.${c[1]} in ${f}`);
  }
  check("P104413", `no file in 001–080 re-creates an index the sequence retires (${retiredIdx.size} retired indexes known)`,
    idxOffenders.length === 0, idxOffenders.join(", "));
  check("P104414", `no file in 001–080 re-adds a column the sequence drops (${deadCol.size} dropped columns known)`,
    colOffenders.length === 0, colOffenders.join(", "));
  check("P104415", "no file in 001–080 NAMES a dropped column in a statement that runs at migration time",
    writeOffenders.length === 0, writeOffenders.join(", "));
}

// ═════════════ B — the sixteen thinnest files in the territory ═══════════════════════════════
// Chosen by MEASUREMENT, not by having an idea (rule 2b): these files carry 2 ledger rows each
// across all 44 ledger files, against 32 for 014 and 24 for 037.
head("B — the sixteen files the ledger barely covers, asked a real question (P104416–P104431)");
if (!db) {
  console.log("  – skipped: no database to ask (--static, or no .env.local)");
} else {
  const st = await body("lfh_session_state");
  check("P104416", "016's shared bill survived: lfh_session_state still returns subtotal/tax/total",
    /'bill'/.test(st) && /subtotal/.test(st) && /'tax'/.test(st), "eight later migrations rewrote this function");
  check("P104417", "027's call REASON survived: each call still carries its note",
    /'calls'[\s\S]{0,400}'note'/.test(st), "so the guest widget can say \"you asked for: Water\"");
  check("P104418", "028's order rows survived: the state still returns an `orders` array",
    /'orders'/.test(st), "this is what lets the head's tracker follow an order someone else placed");
  check("P104419", "033's decline answer survived: a removed token is still told 'removed'",
    /'removed'/.test(st) && /invalid_token/.test(st), "without it a declined guest waits on a spinner forever");
  check("P104420", "065's dish detail survived: each item still carries options / removed / note",
    /'options'/.test(st) && /'note'/.test(st), "the \"no milk\" the guest asked for stays visible in the live view");

  const cw = await body("lfh_call_waiter");
  check("P104421", "017 still holds: a waiter call is refused unless the table is OPEN and the guest let in",
    /session_closed/.test(cw) && /not_approved/.test(cw), "");
  check("P104422", "025 still holds: only an IDENTICAL pending request is de-duped, so Water and Napkins both land",
    /IS NOT DISTINCT FROM/i.test(cw), "the bug this fixed silently dropped the second tap");

  const js = await body("lfh_join_session");
  check("P104423", "021 still holds: a guest never opens a table — no open session means no_open_session",
    /no_open_session/.test(js) && !/INSERT\s+INTO\s+sessions/i.test(js),
    "migration 018's auto-open was reversed by the owner's rule and must not creep back");

  const lv = await body("lfh_leave_session");
  check("P104424", "023 still holds: leaving never closes the table — only staff do that",
    !/status\s*=\s*'closed'/i.test(lv), "");
  check("P104425", "026 still holds: the leaver's own waiter calls go with them",
    /waiter_calls\s+SET\s+resolved\s*=\s*true[\s\S]{0,120}member_id/i.test(lv),
    "otherwise the floor keeps flagging a request from someone who has gone");

  const locked = await db(`select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') as anon
                             from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                            where n.nspname='public'
                              and p.proname in ('lfh_staff_place_order','lfh_staff_shift_table','lfh_next_counter','lfh_next_seq')`);
  check("P104426", "038 still holds: none of the four staff-only functions it locked is callable with the public menu key",
    locked.length > 0 && locked.every((r) => !r.anon),
    locked.filter((r) => r.anon).map((r) => r.proname).join(", ") || `${locked.length} checked`);

  const six = ["feedback", "verification_codes", "payments", "aggregator_orders", "daily_counters", "seq_counters"];
  const rls = await db(`select c.relname, c.relrowsecurity,
                               (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname
                                  and (p.roles::text like '%anon%' or p.roles::text like '%public%')) as anon_policies
                          from pg_class c join pg_namespace n on n.oid=c.relnamespace
                         where n.nspname='public' and c.relname in (${six.map((t) => `'${t}'`).join(",")})`);
  check("P104427", "039 still holds: all six tables it locked have RLS on and no policy the guest key can use",
    rls.length === 6 && rls.every((r) => r.relrowsecurity && Number(r.anon_policies) === 0),
    rls.filter((r) => !r.relrowsecurity || Number(r.anon_policies)).map((r) => r.relname).join(", ") || "6 of 6");

  const bd = (await body("lfh_business_day")) + (await body("lfh_next_counter")) + (await body("lfh_next_counter_on"));
  check("P104428", "044 still holds: the daily number series still rolls over at 05:00 IST, not at UTC midnight",
    /Asia\/Kolkata/.test(bd) && /5 hours/.test(bd),
    "a late service past midnight keeps ONE day's KOT and bill numbering");

  const cwt = await body("lfh_call_waiter_table");
  check("P104429", "050 still holds: the bell throttles a repeat and caps the pile-up",
    /6 seconds/.test(cwt) && />=\s*6/.test(cwt), "so one guest cannot bury the floor in badges");

  const sh = await body("lfh_staff_shift_table");
  check("P104430", "061 still holds: a shift nudges the OLD table's guests too, not only the new one",
    /'table:'\s*\|\|\s*v_from/.test(sh),
    "without it a guest's table number only corrects itself on the 60s backstop");

  const pi = await body("lfh_platform_insert");
  check("P104431", "072 still holds: a Zomato/Swiggy order lands ACCEPTED, with no manual accept step",
    /'accepted'/.test(pi) && !/'new'/.test(pi), "the platform and the customer already confirmed it");
}

// ═════════════ D — does each restaurant still only see its own numbers ═══════════════════════
head("D — the objects these eighty files created, asked whether each restaurant stands alone (P104432–P104438)");
if (!db) {
  console.log("  – skipped: no database to ask");
} else {
  const dc = await one(`select count(*) c from information_schema.columns
                         where table_schema='public' and table_name='daily_counters' and column_name='restaurant_id'`);
  const dcPk = await one(`select pg_get_constraintdef(oid) d from pg_constraint
                           where conrelid='public.daily_counters'::regclass and contype='p'`);
  check("P104432", "036's daily KOT/bill series is per restaurant — two restaurants cannot share a ticket number",
    Number(dc.c) === 1 && /restaurant_id/.test(dcPk.d), dcPk.d);

  const sc = await one(`select pg_get_constraintdef(oid) d from pg_constraint
                         where conrelid='public.seq_counters'::regclass and contype='p'`);
  check("P104433", "037's forever-sequential invoice series is per restaurant",
    /restaurant_id/.test(sc.d), sc.d);

  const dn = await db(`select indexname, indexdef from pg_indexes where schemaname='public' and indexdef like '%dish_no%'`);
  const dnFn = await body("assign_dish_no");
  check("P104434", "032's dish number is unique per restaurant, and a new dish is numbered inside its own restaurant",
    dn.some((r) => /restaurant_id/.test(r.indexdef)) && !dn.some((r) => r.indexname === "menu_items_dish_no_key")
      && /restaurant_id\s*=\s*NEW\.restaurant_id/i.test(dnFn),
    dn.map((r) => r.indexname).join(", "));

  const vd = await one(`select pg_get_viewdef('public.item_ratings'::regclass, true) d`);
  check("P104435", "030's rating aggregate is grouped per restaurant — two restaurants sharing a dish slug do not pool stars",
    /restaurant_id/.test(vd.d), "");

  const fb = await body("lfh_leave_feedback");
  check("P104436", "037's feedback lands on the restaurant of the ORDER it rates, never on restaurant #1 by default",
    /v_o\.restaurant_id/.test(fb) && /restaurant_id/.test(fb), "");

  const un = await db(`select indexname, indexdef from pg_indexes where schemaname='public' and tablename='staff_users' and indexdef like '%username%'`);
  check("P104437", "054's staff username is unique per restaurant AND only among live rows, so a binned login frees its name",
    un.some((r) => /restaurant_id/.test(r.indexdef) && /UNIQUE/i.test(r.indexdef) && /deleted_at IS NULL/i.test(r.indexdef)),
    un.map((r) => r.indexname).join(", "));

  const created = ["menu_items", "categories", "filters", "settings", "orders", "waiter_calls", "sessions",
    "session_members", "customers", "requests", "blocklist", "otp_codes", "order_items", "reviews",
    "daily_counters", "seq_counters", "feedback", "verification_codes", "payments", "aggregator_orders",
    "staff_actions", "staff_users", "realtime_events"];
  const guess = await db(`select table_name from information_schema.columns
                           where table_schema='public' and column_name='restaurant_id' and column_default is not null
                             and table_name in (${created.map((t) => `'${t}'`).join(",")})`);
  const missing = await db(`select t.relname from pg_class t join pg_namespace n on n.oid=t.relnamespace
                             where n.nspname='public' and t.relkind='r' and t.relname in (${created.map((t) => `'${t}'`).join(",")})
                               and not exists (select 1 from information_schema.columns c
                                                where c.table_schema='public' and c.table_name=t.relname and c.column_name='restaurant_id')`);
  check("P104438", `all ${created.length} tables these eighty files create carry restaurant_id, and none of them GUESSES it`,
    guess.length === 0 && missing.length === 0,
    [...guess.map((r) => r.table_name + " still defaults"), ...missing.map((r) => r.relname + " has no column")].join(", ") || "none defaulted, none missing");
}

// ═════════════ E — reading the logic for a wrong result a real restaurant would get ══════════
head("E — is this how it should work for a real restaurant (P104439–P104442)");
if (!db) {
  console.log("  – skipped: no database to ask");
} else {
  const sot = await body("set_order_table_number");
  check("P104439", "007+051: a guest may still retype the table only on an order that belongs to NO table session",
    /session_id IS NOT NULL/i.test(sot) && /RETURN;/.test(sot),
    "a seated party's order is moved by staff, so the bill and the floor can never disagree");

  check("P104440", "043's ×84 money conversion is still double-gated — the one migration that could bankrupt a report",
    has("043_inr_base_currency.sql", /to_regprocedure\('public\.lfh_already_applied\(text\)'\)/i)
      && has("043_inr_base_currency.sql", /lfh_already_applied\('043_inr_base_currency'\)/i),
    "a second run once turned a ₹500 dish into ₹42,000");

  const pl = await body("lfh_prune_logs");
  check("P104441", "053's nightly cleanup still never touches a bill or a saved customer",
    !/DELETE\s+FROM\s+orders\b/i.test(pl) && !/DELETE\s+FROM\s+customers\b/i.test(pl),
    "logs are not bills — a sale can be cancelled, never deleted");

  const cc = await body("lfh_session_close_cleanup"), dc2 = await body("lfh_session_delete_cleanup");
  check("P104442", "020+024: a waiter call cannot outlive its party, by BOTH the close path and the delete path",
    /waiter_calls\s+SET\s+resolved\s*=\s*true/i.test(cc) && /waiter_calls\s+SET\s+resolved\s*=\s*true/i.test(dc2)
      && /restaurant_id\s*=\s*NEW\.restaurant_id/i.test(cc) && /restaurant_id\s*=\s*OLD\.restaurant_id/i.test(dc2),
    "and each path clears only its OWN restaurant's pending requests");
}

// ═════════════ C — driven in a real browser (recorded; run by the sweep's live pass) ═════════
head("C — P104443–P104450 are driven in a browser, not from here (see the ledger rows for what each one looked at)");

console.log(`\n${failed ? "✗" : "✓"} migrations 001–080: ${ran - failed} of ${ran} checks green`);
process.exit(failed ? 1 : 0);
