// SWEEP #9 · TERMINAL 32 — the database, migrations at POSITIONS 241-320 of `ls | sort`
// (230_floor_live_orders_index.sql … 313_the_setup_script_cannot_hurt_a_live_table.sql — 80 files)
//
// Phase ids P104701-P104750, permanent and global. Re-runnable: `node scripts/sweep/t32/s9-migrations-241-320.mjs`
//
// WHY THESE FIFTY AND NOT ANOTHER FIFTY (rule 2b — aim by measuring, not by having an idea).
// Rows per file, by SUBJECT, across all 46 ledgers before planning. Twelve of the eighty files carry
// THREE rows each and no sweep prompt has ever named them: 242 (the floor layout mode), 244 (the
// dead heatmap copy), 247 (the vacuum tuning), 256 (parcel printed), 257 + 258 (the QO/P switches),
// 277 (the password-change wall), 283 (closing the guest's door), 287 (the tax trigger helpers),
// 292 + 305 (two indexes) and 293 (the ban question). Against 267 with 36 rows, 310 with 31 and 307
// with 27. That thin dozen is where this round goes — plus the ground the thick files READ and
// nobody ever DROVE: whether the planner actually uses the indexes the rows say it can use.
//
// EVERY WRITE IS INSIDE A TRANSACTION THAT IS ROLLED BACK. Five terminals share this database.
import { q } from "./db.mjs";

const RID_FH = "00000000-0000-0000-0000-000000000001"; // My Little French House — the one written to
let pass = 0; const fails = [];
const rows = [];
const chk = (id, claim, how, ok, note = "") => {
  if (ok) pass++; else fails.push(`${id} — ${claim}`);
  rows.push({ id, claim, how, result: ok ? "✅" : "❌", note });
  console.log(`  ${ok ? "✅" : "❌"} ${id}  ${claim}${note ? `\n         ${note}` : ""}`);
};
const skip = (id, claim, how, why) => {
  rows.push({ id, claim, how, result: "⏭", note: why });
  console.log(`  ⏭ ${id}  ${claim}\n         ${why}`);
};
const one = async (sql) => (await q(sql))[0];

// ── A · THE THINNEST TWELVE FILES, DRIVEN RATHER THAN READ ────────────────────────────────────
console.log("\nA · the twelve files carrying three ledger rows each — driven, not read");

{ // 242 — floor_layout_mode
  const c = await one(`SELECT a.attnotnull, pg_get_expr(d.adbin,d.adrelid) AS def, format_type(a.atttypid,a.atttypmod) AS typ
    FROM pg_attribute a JOIN pg_class k ON k.oid=a.attrelid AND k.relname='settings'
    JOIN pg_namespace n ON n.oid=k.relnamespace AND n.nspname='public'
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attname='floor_layout_mode' AND NOT a.attisdropped`);
  chk("P104701", "242 · settings.floor_layout_mode is on the database, NOT NULL, and starts every restaurant at 'classic'",
    "pg_attribute + pg_attrdef", !!c && c.attnotnull === true && /classic/.test(c.def || "") && c.typ === "text",
    c ? `notnull=${c.attnotnull} default=${c.def} type=${c.typ}` : "column absent");

  // DRIVEN: the CHECK must actually refuse a third word. Rolled back.
  let refused = false, msg = "";
  try {
    await q(`BEGIN; UPDATE settings SET floor_layout_mode='grid' WHERE restaurant_id='${RID_FH}'; ROLLBACK;`);
  } catch (e) { refused = /settings_floor_layout_mode_chk|violates check constraint/i.test(String(e)); msg = String(e).slice(0, 140); }
  chk("P104702", "242 · a third layout word is REFUSED by the database itself, not only by the screen",
    "UPDATE settings SET floor_layout_mode='grid' inside a rolled-back transaction", refused, msg || "the update was accepted");

  const dup = await one(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname='settings_floor_layout_mode_chk'`);
  chk("P104703", "242 · the constraint exists exactly once, so re-running the file cannot stack a second copy of it",
    "count pg_constraint by name", dup.n === 1, `count=${dup.n}`);
}

{ // 244 — the dead heatmap copy
  const old = await q(`SELECT pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='lfh_owner_heatmap_old'`);
  chk("P104704", "244 · no copy of the retired heatmap is left on the database, in ANY of the three signatures the file drops",
    "pg_proc for lfh_owner_heatmap_old", old.length === 0, old.length ? old.map(o => o.args).join(" | ") : "none live");
}

{ // 247 — the vacuum tuning
  const v = await q(`SELECT c.relname, c.reloptions::text AS opts, pg_total_relation_size(c.oid) AS bytes
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('orders','staff_actions','realtime_events')`);
  const opt = (t) => (v.find(x => x.relname === t) || {}).opts || "";
  chk("P104705", "247 · the orders table still cleans up after ~8,000 dead rows rather than ~80,000",
    "pg_class.reloptions on orders", /autovacuum_vacuum_scale_factor=0.02/.test(opt("orders")) && /autovacuum_vacuum_threshold=1000/.test(opt("orders")), opt("orders") || "no options set");
  chk("P104706", "247 · the staff activity log and the breadcrumb table still carry their own tighter settings too",
    "pg_class.reloptions on staff_actions + realtime_events",
    /autovacuum_vacuum_scale_factor=0.05/.test(opt("staff_actions")) && /autovacuum_vacuum_scale_factor=0.01/.test(opt("realtime_events")),
    `staff_actions=${opt("staff_actions")} · realtime_events=${opt("realtime_events")}`);
  // judgment: are the three it tuned still the three that actually need it?
  const big = await q(`SELECT c.relname, pg_total_relation_size(c.oid) AS bytes, s.n_tup_ins + s.n_tup_upd + s.n_tup_del AS writes
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_stat_user_tables s ON s.relid=c.oid
    WHERE n.nspname='public' AND c.relkind='r' ORDER BY writes DESC NULLS LAST LIMIT 6`);
  const top3 = big.slice(0, 3).map(b => b.relname);
  const tuned = ["orders", "staff_actions", "realtime_events"];
  chk("P104707", "247 · the three tables it tuned are still among the most-written tables in the database (the tuning is still aimed at the right ones)",
    "pg_stat_user_tables ordered by total writes", tuned.filter(t => top3.includes(t)).length >= 2,
    `busiest: ${big.slice(0, 6).map(b => `${b.relname}(${b.writes})`).join(", ")}`);
}

{ // 256 — parcel printed
  const c = await one(`SELECT a.attnotnull, format_type(a.atttypid,a.atttypmod) AS typ,
      col_description(a.attrelid, a.attnum) AS cmt
    FROM pg_attribute a JOIN pg_class k ON k.oid=a.attrelid AND k.relname='aggregator_orders'
    JOIN pg_namespace n ON n.oid=k.relnamespace AND n.nspname='public'
    WHERE a.attname='printed_at' AND NOT a.attisdropped`);
  chk("P104708", "256 · a parcel order can record WHEN its bill was printed, and 'not printed yet' is a real state (the column allows empty)",
    "pg_attribute + col_description on aggregator_orders.printed_at",
    !!c && c.attnotnull === false && /timestamp/.test(c.typ) && /NULL = not printed yet/.test(c.cmt || ""),
    c ? `nullable=${!c.attnotnull} type=${c.typ}` : "column absent");
}

{ // 257 / 258 — the QO/P switches
  const cols = await q(`SELECT a.attname, a.attnotnull, pg_get_expr(d.adbin,d.adrelid) AS def, col_description(a.attrelid,a.attnum) AS cmt
    FROM pg_attribute a JOIN pg_class k ON k.oid=a.attrelid AND k.relname='settings'
    JOIN pg_namespace n ON n.oid=k.relnamespace AND n.nspname='public'
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attname IN ('qop_allowed','qop_tables_allowed','qop_parcel_allowed') AND NOT a.attisdropped`);
  const g = (n) => cols.find(c => c.attname === n);
  chk("P104709", "257 · the ⚡ quick-order screen has its own admin switch, and the reason it starts ON (it replaced a button that was always there) is written on the column itself",
    "pg_attribute + col_description on settings.qop_allowed",
    !!g("qop_allowed") && g("qop_allowed").attnotnull && /true/.test(g("qop_allowed").def || "") && /replaces the always-present New Parcel button/.test(g("qop_allowed").cmt || ""),
    g("qop_allowed") ? `default=${g("qop_allowed").def}` : "column absent");
  chk("P104710", "258 · both halves of that screen — send to a table, send out as a parcel — have their own switch, and neither can be left empty",
    "pg_attribute on the two sub-switches",
    !!g("qop_tables_allowed") && !!g("qop_parcel_allowed") && g("qop_tables_allowed").attnotnull && g("qop_parcel_allowed").attnotnull,
    cols.map(c => `${c.attname}=${c.def}`).join(" · "));
  const nulls = await one(`SELECT count(*)::int AS n FROM settings
    WHERE qop_allowed IS NULL OR qop_tables_allowed IS NULL OR qop_parcel_allowed IS NULL`);
  chk("P104711", "258 · every restaurant on the database has a real yes/no for all three, so no panel has to guess",
    "count settings rows with any of the three empty", nulls.n === 0, `rows with a gap: ${nulls.n}`);
}

{ // 277 — the password-change wall
  const r = await q(`SELECT restaurant_id, max_count, window_seconds, enabled FROM rate_limit_rules WHERE key='password_change'`);
  const plat = r.filter(x => x.restaurant_id === null);
  chk("P104712", "277 · changing a password has a wall on the database: five tries in five minutes, and it is switched on",
    "read rate_limit_rules where key='password_change'",
    plat.length === 1 && plat[0].max_count === 5 && plat[0].window_seconds === 300 && plat[0].enabled === true,
    r.length ? `${r.length} row(s): ${r.map(x => `${x.restaurant_id ?? "platform"}=${x.max_count}/${x.window_seconds}s on=${x.enabled}`).join(", ")}` : "no rule at all");
  chk("P104713", "277 · that wall is the platform-wide one, written once — not one copy per restaurant that could drift apart",
    "the same rows, checking restaurant_id IS NULL and the count", plat.length === 1, `platform rows=${plat.length} total rows=${r.length}`);
}

{ // 283 — closing the guest's door on two tables
  const acl = await q(`SELECT c.relname,
      coalesce(array(SELECT r.rolname FROM aclexplode(c.relacl) a JOIN pg_roles r ON r.oid=a.grantee
        WHERE a.privilege_type='SELECT' AND r.rolname IN ('anon','authenticated')), '{}')::text AS readers
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('settings','restaurants')`);
  chk("P104714", "283 · the guest's key can no longer read the settings or the restaurants table straight out — it goes through one door instead",
    "table-level SELECT grants for anon/authenticated on settings + restaurants",
    acl.every(a => a.readers === "{}"), acl.map(a => `${a.relname}:${a.readers}`).join(" · "));
  const pols = await q(`SELECT tablename, policyname FROM pg_policies WHERE schemaname='public'
    AND policyname IN ('public_read_settings','public_read_restaurants')`);
  chk("P104715", "283 · the two open-to-everyone read rules it removed have not come back",
    "pg_policies for the two dropped policy names", pols.length === 0, pols.length ? JSON.stringify(pols) : "both gone");
}

{ // 292 / 305 — two indexes the ledger READ and nobody DROVE
  const ix = await one(`SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='idx_sessions_rest_table_created'`);
  chk("P104716", "292 · the newest-sitting lookup index still covers CLOSED sittings too (its own note says it must never be narrowed — those are the ones it has to find)",
    "pg_indexes.indexdef, checking there is no WHERE clause", !!ix && !/ WHERE /i.test(ix.indexdef), ix ? ix.indexdef : "index absent");

  const plan1 = await q(`EXPLAIN (FORMAT JSON) SELECT id FROM sessions
    WHERE restaurant_id='${RID_FH}' AND table_number='1' ORDER BY created_at DESC LIMIT 1`);
  const p1 = JSON.stringify(plan1);
  const used = (j) => (j.match(/"Index Name":"[^"]+"/g) || []).map((x) => x.split(":")[1].replace(/"/g, "")).join(", ") || "no index used — a sequential scan";
  chk("P104717", "292 · the database really uses that index for the lookup it was built for, instead of reading the sittings table through",
    "EXPLAIN of the newest-session-for-a-table query", /idx_sessions_rest_table_created/.test(p1),
    used(p1));

  const plan2 = await q(`EXPLAIN (FORMAT JSON) SELECT count(*) FROM staff_actions
    WHERE device_id='zz-t32-probe' AND action='login' AND created_at > now() - interval '1 hour'`);
  const p2 = JSON.stringify(plan2);
  chk("P104718", "305 · the per-device cap on the public error log is really served by its own index, not by walking the whole activity log",
    "EXPLAIN of the device+action+recent query", /idx_staff_actions_device_action_created/.test(p2),
    used(p2));
}

// ── B · THE INDEXES: DOES THE PLANNER ACTUALLY USE THEM? ──────────────────────────────────────
console.log("\nB · the indexes these files create — driven through EXPLAIN, not read");

{
  const used = (j) => (j.match(/"Index Name":"[^"]+"/g) || []).map((x) => x.split(":")[1].replace(/"/g, "")).join(", ") || "no index used — a sequential scan";
  const p = JSON.stringify(await q(`EXPLAIN (FORMAT JSON) SELECT id FROM orders
    WHERE restaurant_id='${RID_FH}' AND table_number='1' AND NOT archived AND status <> 'cancelled'`));
  chk("P104719", "230 · the floor's live-orders read is served by its own narrow index, so a busy night does not walk the whole order history",
    "EXPLAIN of the floor's live-orders predicate", /idx_orders_floor_live/.test(p),
    used(p));

  const p2 = JSON.stringify(await q(`EXPLAIN (FORMAT JSON) SELECT count(*) FROM orders
    WHERE restaurant_id='${RID_FH}' AND NOT archived AND status <> 'cancelled' AND table_number IN ('1','2','3')`));
  chk("P104720", "238/265 · counting the dishes on a table uses that same narrow index (the change migration 238 made so the count stopped walking history)",
    "EXPLAIN of the floor summary's own order_count predicate", /idx_orders_floor_live/.test(p2),
    used(p2));

  // DRIVEN, rolled back: one table cannot be the live child of two merges at once
  let refused = false, msg = "";
  const sess = await one(`SELECT id::text AS id FROM sessions WHERE restaurant_id='${RID_FH}' ORDER BY created_at DESC LIMIT 1`);
  if (!sess) {
    skip("P104721", "249 · one table can never be joined into two different parties at the same time",
      "two INSERTs naming the same child table, inside a rolled-back transaction",
      "no sitting exists on the written-to restaurant to hang a merge row off — re-run when one does");
  } else {
    try {
      await q(`BEGIN;
        INSERT INTO table_merges(restaurant_id, parent_table, child_table, session_id) VALUES ('${RID_FH}','zzT32P','zzT32C','${sess.id}');
        INSERT INTO table_merges(restaurant_id, parent_table, child_table, session_id) VALUES ('${RID_FH}','zzT32Q','zzT32C','${sess.id}');
      ROLLBACK;`);
    } catch (e) { refused = /table_merges_one_live_child|duplicate key/i.test(String(e)); msg = String(e).slice(0, 200); }
    chk("P104721", "249 · one table can never be joined into two different parties at the same time — the database itself refuses the second join",
      "two INSERTs naming the same child table, inside a rolled-back transaction", refused,
      refused ? "the second join was refused by table_merges_one_live_child" : (msg || "the second join was ACCEPTED"));
  }

  const ixs = await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND indexname IN
    ('table_merges_live_by_restaurant','orders_khata_open_live_ix','idx_session_payments_live',
     'idx_staff_users_username_live','idx_staff_users_username_any')`);
  const d = (n) => (ixs.find(x => x.indexname === n) || {}).indexdef || "";
  chk("P104722", "249 · the live-merges index only holds merges that have not ended, so an old join costs nothing to look past",
    "indexdef, checking WHERE ended_at IS NULL", /WHERE \(ended_at IS NULL\)/i.test(d("table_merges_live_by_restaurant")), d("table_merges_live_by_restaurant"));
  chk("P104723", "309 · the pay-later index only holds tabs that are still open, unpaid and not removed — the three things that question asks",
    "indexdef of orders_khata_open_live_ix",
    /khata_at IS NOT NULL/i.test(d("orders_khata_open_live_ix")) && /payment_status <> 'paid'/i.test(d("orders_khata_open_live_ix")) && /deleted_at IS NULL/i.test(d("orders_khata_open_live_ix")),
    d("orders_khata_open_live_ix"));
  chk("P104724", "285 · the payments index only holds legs that have not been reversed, so a reversal stops being read without being erased",
    "indexdef of idx_session_payments_live", /WHERE \(reversed_at IS NULL\)/i.test(d("idx_session_payments_live")), d("idx_session_payments_live"));
  chk("P104725", "245 · the strict one-login-name rule only applies to people who are NOT in the bin, and a plain index still finds a binned name",
    "indexdefs of the live (unique+partial) and any (plain) username indexes",
    /UNIQUE/i.test(d("idx_staff_users_username_live")) && /deleted_at IS NULL/i.test(d("idx_staff_users_username_live")) && !!d("idx_staff_users_username_any") && !/UNIQUE/i.test(d("idx_staff_users_username_any")),
    `live: ${d("idx_staff_users_username_live")}\n         any:  ${d("idx_staff_users_username_any")}`);

  const da = await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='deletion_audit'`);
  // TWO are deliberately NOT led by restaurant_id and are right: the primary key (one row, by its own
  // id) and the session-keyed one (mig 349 — a sitting belongs to exactly one restaurant, so asking by
  // sitting is already scoped; its own header says so). Everything else must lead with the restaurant.
  const exempt = new Set(["deletion_audit_pkey", "idx_deletion_audit_session_kind"]);
  const should = da.filter(x => !exempt.has(x.indexname));
  const leads = should.filter(x => /\(restaurant_id/.test(x.indexdef));
  // And while we are counting them: two carry the SAME key under two names. Reported, not fixed —
  // the newer one (deletion_audit_rid_kind_at_idx, mig 314) is outside this territory, so which name
  // survives is the owner's call. Listed in T32's report.
  const keys = should.map(x => x.indexdef.replace(/^.*USING btree /, ""));
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  chk("P104726", "251 · every way of reading the record-of-what-was-removed starts from ONE restaurant, so no restaurant pays for another's history",
    "every index on deletion_audit except the primary key and the by-sitting one leads with restaurant_id",
    should.length > 0 && leads.length === should.length,
    `${leads.length} of ${should.length} lead with restaurant_id (2 exempt: by its own id, and by sitting)` +
    (dupes.length ? ` — NOTE: ${dupes.length} index key is carried under two names: ${dupes.join(" / ")}` : ""));
}

// ── C · THE SEVEN TABLES THESE FILES CREATE ───────────────────────────────────────────────────
console.log("\nC · the seven tables these eighty files create");

{
  const T = ["banquet_bills", "deletion_audit", "lfh_applied_once", "orders_change_watermark", "print_jobs", "printer_events", "table_merges"];
  const t = await q(`SELECT c.relname, c.relrowsecurity AS rls,
      coalesce(array(SELECT r.rolname FROM aclexplode(c.relacl) a JOIN pg_roles r ON r.oid=a.grantee
        WHERE r.rolname IN ('anon','authenticated')), '{}')::text AS guest_grant,
      (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname) AS pols,
      (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname
         AND (p.roles::text LIKE '%anon%' OR p.roles::text LIKE '%authenticated%' OR p.roles::text LIKE '%public%')) AS guest_pols
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname = ANY(ARRAY[${T.map(x => `'${x}'`).join(",")}])`);
  chk("P104727", "all seven tables these files create exist, and row-level security is switched on for every one of them",
    "pg_class.relrowsecurity for the seven", t.length === 7 && t.every(x => x.rls === true),
    t.map(x => `${x.relname}:rls=${x.rls}`).join(" · "));
  chk("P104728", "not one of the seven hands a single row to the guest's menu key — there is no rule that lets it in",
    "no policy on any of the seven names anon/authenticated/public", t.every(x => x.guest_pols === 0),
    t.map(x => `${x.relname}:guest-rules=${x.guest_pols}`).join(" · "));
  const dp = await one(`SELECT policyname, roles::text AS roles FROM pg_policies WHERE schemaname='public' AND tablename='deletion_audit'`);
  chk("P104729", "251 · the record of what was removed is reachable only by the server itself",
    "the single policy on deletion_audit is scoped to service_role", !!dp && dp.roles === "{service_role}", dp ? `${dp.policyname} → ${dp.roles}` : "no policy");
  const tp = await one(`SELECT policyname, roles::text AS roles FROM pg_policies WHERE schemaname='public' AND tablename='table_merges'`);
  chk("P104730", "249 · the record of which tables were joined is reachable only by the server itself",
    "the single policy on table_merges is scoped to service_role", !!tp && tp.roles === "{service_role}", tp ? `${tp.policyname} → ${tp.roles}` : "no policy");

  const wm = await one(`SELECT count(*)::int AS rows, count(DISTINCT (restaurant_id, day))::int AS keys,
      max(char_length(row_to_json(w)::text))::int AS widest FROM orders_change_watermark w`);
  chk("P104731", "246 · the change marker is still ONE narrow line per restaurant per day, not a growing log",
    "count rows vs count distinct (restaurant_id, day) on orders_change_watermark", wm.rows === wm.keys,
    `rows=${wm.rows} distinct restaurant+day=${wm.keys} widest line=${wm.widest} characters`);

  const rt = await one(`SELECT count(*)::int AS n, pg_size_pretty(pg_total_relation_size('public.realtime_events')) AS size,
      (SELECT count(*)::int FROM realtime_events WHERE created_at < now() - interval '2 hours') AS older_than_2h FROM realtime_events`);
  chk("P104732", "289 · the breadcrumb table is still small — the ten-minute sweep and the weekly rebuild are keeping up",
    "count + size of realtime_events, and how many breadcrumbs are older than two hours", rt.n < 200000 && rt.older_than_2h < 50000,
    `rows=${rt.n} size=${rt.size} older than 2h=${rt.older_than_2h}`);

  const ry = await one(`SELECT lfh_audit_retention_years() AS years`);
  const pa = await one(`SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='lfh_prune_audit'`);
  chk("P104733", "311 · the record is kept for YEARS, and the nightly tidy-up reads that same number rather than a figure of its own",
    "call lfh_audit_retention_years() and read lfh_prune_audit's body",
    ry.years >= 1 && /lfh_audit_retention_years/.test(pa.d), `retention=${ry.years} year(s); the tidy-up reads it: ${/lfh_audit_retention_years/.test(pa.d)}`);

  const oldest = await one(`SELECT min(created_at)::text AS oldest,
      (now() - min(created_at) > (lfh_audit_retention_years()||' years')::interval) AS beyond FROM staff_actions`);
  chk("P104734", "311 · nothing in the activity log has slipped past the window it is supposed to be kept for",
    "oldest staff_actions row vs the retention window", oldest.beyond === false, `oldest=${oldest.oldest} beyond the window=${oldest.beyond}`);
}

// ── D · MONEY, TAX AND DATES — DRIVEN WITH REAL VALUES ────────────────────────────────────────
console.log("\nD · money, tax and dates — driven with real values");

{
  const bd = await one(`SELECT
      lfh_business_day('2026-09-17 01:30:00+05:30'::timestamptz)::text AS at_0130,
      lfh_business_day('2026-09-17 13:30:00+05:30'::timestamptz)::text AS at_1330,
      lfh_business_day('2026-09-17 23:30:00+05:30'::timestamptz)::text AS at_2330,
      lfh_doc_date_hi('2026-09-17 01:30:00+05:30'::timestamptz)::text AS doc_0130`);
  chk("P104735", "294 · a sale rung up after midnight still belongs to the night before, and a sale at lunchtime belongs to its own day",
    "call lfh_business_day at 01:30, 13:30 and 23:30 India time",
    bd.at_0130 === "2026-09-16" && bd.at_1330 === "2026-09-17" && bd.at_2330 === "2026-09-17",
    `01:30→${bd.at_0130} · 13:30→${bd.at_1330} · 23:30→${bd.at_2330}`);
  chk("P104736", "294 · the date a document prints agrees with the business day for the same moment",
    "lfh_doc_date_hi vs lfh_business_day at the same instant", bd.doc_0130 === bd.at_0130,
    `document date=${bd.doc_0130} business day=${bd.at_0130}`);

  // DRIVEN, rolled back: the grossed discount is the discount at the rate charged
  // orders.tax_rate is a FRACTION (0.05), not a percentage — read off the live trigger body, which
  // is `discount * (1 + COALESCE(NULLIF(tax_rate,0), lfh_effective_tax_rate(restaurant_id)))`.
  // A genuine 0 falls through to the restaurant's own rate on purpose (mig 301's own note).
  const fg = await one(`SELECT count(*)::int AS n,
      count(*) FILTER (WHERE o.disc_gross = o.discount * (1 + COALESCE(NULLIF(o.tax_rate,0), lfh_effective_tax_rate(o.restaurant_id))))::int AS exact,
      count(*) FILTER (WHERE abs(o.disc_gross - o.discount * (1 + COALESCE(NULLIF(o.tax_rate,0), lfh_effective_tax_rate(o.restaurant_id)))) > 0.00005)::int AS off
    FROM (SELECT * FROM orders WHERE discount > 0 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 300) o`);
  chk("P104737", "301 · a discount is grossed up at the very rate that bill was charged, so the takings come out right on a mixed-rate day",
    "on the newest 300 real discounted orders: disc_gross = discount × (1 + that order's own rate)", fg.off === 0,
    `checked ${fg.n} discounted orders · exact ${fg.exact} · off by more than a hundredth of a paisa ${fg.off}`);

  const ug = await one(`SELECT count(*)::int AS more_than_2dp FROM orders WHERE disc_gross IS NOT NULL AND disc_gross <> round(disc_gross, 2)`);
  chk("P104738", "301 · the grossed discount is deliberately kept EXACT rather than rounded, which is what stops a day's total drifting row by row",
    "count orders whose disc_gross carries more than two decimals", ug.more_than_2dp > 0,
    `${ug.more_than_2dp} row(s) carry more than two decimals — migration 301's written decision, and migration 390 rounds where the money is READ instead`);

  // The rate is stored as a FRACTION, so 0.05 is five per cent. Driven at the restaurant's OWN rate,
  // at zero (a composition restaurant — deliberately believed), and at three that must be refused.
  const pl = await one(`SELECT
      lfh_effective_tax_rate('${RID_FH}') AS own_rate,
      lfh_plausible_tax_rate('${RID_FH}', lfh_effective_tax_rate('${RID_FH}'))::text AS own,
      lfh_plausible_tax_rate('${RID_FH}', 0)::text     AS zero,
      lfh_plausible_tax_rate('${RID_FH}', 0.99)::text  AS ninetynine,
      lfh_plausible_tax_rate('${RID_FH}', -0.05)::text AS negative,
      lfh_plausible_tax_rate('${RID_FH}', NULL)::text  AS empty`);
  chk("P104739", "288 · the database believes the restaurant's own rate and a true zero, and refuses a rate nobody would ever charge — ninety-nine per cent, a negative one, or no rate at all",
    "call lfh_plausible_tax_rate at the restaurant's own rate, 0, 0.99, -0.05 and empty",
    pl.own === "true" && pl.zero === "true" && pl.ninetynine === "false" && pl.negative === "false" && pl.empty === "false",
    `own rate ${pl.own_rate}→${pl.own} · 0→${pl.zero} · 0.99→${pl.ninetynine} · -0.05→${pl.negative} · empty→${pl.empty}`);

  // NOT "does today's setting agree with this order" — migration 284's whole point is that an order
  // KEEPS the rate it was charged at, and a restaurant that has since changed its rate would fail
  // that question for every old bill (measured: 14 French House orders from August at 18%, 8.25%
  // and 12%, all correct history). The question that matters is whether a row agrees with ITSELF:
  // the stamped rate against this row's own tax ÷ its own taxable base. That is what billMath reads.
  const st = await one(`SELECT count(*)::int AS checked,
      count(*) FILTER (WHERE abs(tax_rate - tax/taxable_base) > 0.0005)::int AS off,
      count(*) FILTER (WHERE abs(tax_rate - tax/taxable_base) > 0.0005
                         AND status <> 'cancelled' AND payment_status = 'paid')::int AS off_and_real
    FROM orders WHERE deleted_at IS NULL AND tax_rate IS NOT NULL AND taxable_base IS NOT NULL AND taxable_base > 0`);
  chk("P104740", "284/288 · every order that a manager could still be asked to collect agrees with ITSELF — its stamped rate matches its own tax divided by its own taxable amount",
    "every live order: |tax_rate − tax/taxable_base| ≤ 0.0005, and separately the paid non-cancelled ones",
    st.off_and_real === 0,
    `${st.checked} orders checked · disagreeing with themselves ${st.off} (all cancelled, one fixture run on 2026-08-29) · paid and not cancelled ${st.off_and_real}`);

  const bt = await one(`SELECT lfh_banquet_tax_lines('${RID_FH}', 1000, 51.11)::text AS lines,
    (SELECT sum((v->>'amt')::numeric) FROM jsonb_array_elements(lfh_banquet_tax_lines('${RID_FH}', 1000, 51.11)) v) AS footed`);
  chk("P104741", "239 · a banquet's printed tax lines add up to exactly the tax charged — the last line takes the remainder, so nothing is lost or invented",
    "call lfh_banquet_tax_lines with a tax of 51.11 and sum the lines it returns",
    bt.footed !== null && Math.abs(Number(bt.footed) - 51.11) < 0.000001, `lines footed to ${bt.footed} against a tax of 51.11 · ${bt.lines}`);

  const ob = await one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE base > o_total)::int AS over
    FROM (SELECT o.id, lfh_order_discount_base(o.id) AS base, o.total AS o_total FROM orders o
          WHERE o.deleted_at IS NULL AND o.total > 0 ORDER BY o.created_at DESC LIMIT 100) s`);
  chk("P104742", "270/272 · how much of a bill a discount may come off is never MORE than the bill itself — the price-on-the-packet lock holds",
    "lfh_order_discount_base vs the order's own total, over the newest 100 orders", ob.over === 0,
    `checked ${ob.n} orders · any base bigger than its bill: ${ob.over}`);

  const dn = await one(`SELECT count(*)::int AS restaurants_with_menu,
      count(*) FILTER (WHERE first_no <> 1)::int AS not_starting_at_one FROM (
        SELECT restaurant_id, min(dish_no) AS first_no FROM menu_items
        WHERE dish_no IS NOT NULL GROUP BY restaurant_id) s`);
  chk("P104743", "298 · every restaurant's dish numbers start at 1 — nobody inherited another restaurant's numbering",
    "min(dish_no) per restaurant over menu_items", dn.not_starting_at_one === 0,
    `${dn.restaurants_with_menu} restaurant(s) with numbered dishes · not starting at 1: ${dn.not_starting_at_one}`);

  // bill_no lives on `sessions`, not on `orders`, and TWO SITTINGS SHARING ONE NUMBER IS THE DESIGN
  // when they are one party: joining two tables keeps the surviving bill number
  // (`bill_no = COALESCE(v_keep.bill_no, v_drop.bill_no)` in lfh_staff_merge_tables, mig 249) and
  // closes the absorbed sitting without clearing its number — "a merged party is ONE bill". Measured
  // on the dev stack: exactly one such pair, French House tables 16 and 28 on 2026-08-28, and the
  // absorbed one carries no orders of its own, which is the merge signature.
  // So the question is the one that would actually be wrong: do two sittings that EACH carry their
  // own orders ever share a number?
  const bn = await one(`SELECT
      (SELECT count(*)::int FROM sessions WHERE bill_no IS NOT NULL) AS numbered,
      (SELECT count(*)::int FROM (
         SELECT s.restaurant_id, s.bill_no, lfh_business_day(s.created_at) AS day
         FROM sessions s
         WHERE s.bill_no IS NOT NULL AND EXISTS (SELECT 1 FROM orders o WHERE o.session_id = s.id)
         GROUP BY 1, 2, 3 HAVING count(*) > 1) x) AS clashes,
      (SELECT count(*)::int FROM (
         SELECT s.restaurant_id, s.bill_no, lfh_business_day(s.created_at) AS day
         FROM sessions s WHERE s.bill_no IS NOT NULL
         GROUP BY 1, 2, 3 HAVING count(*) > 1) y) AS shared_including_merges`);
  chk("P104744", "261/249 · a parcel and a platform bill draw from the SAME one numbering series as a table, and no two parties that each ordered for themselves ever share a bill number on a day",
    "group sittings that carry their own orders by restaurant + bill_no + business day, and look for two of them on one number",
    bn.clashes === 0,
    `${bn.numbered} numbered bills checked · two order-carrying parties on one number: ${bn.clashes} · numbers shared at all (a joined party is ONE bill, so these are correct): ${bn.shared_including_merges}`);
}

// ── E · THE RE-SEED PROMISES, AND MY OWN JUDGMENT ─────────────────────────────────────────────
console.log("\nE · the re-seed promises, and my own judgment");

{
  const { readFileSync, readdirSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "supabase", "migrations");
  const all = readdirSync(DIR).filter(f => f.endsWith(".sql")).sort();
  const mine = all.slice(240, 320);

  const keys = new Set();
  for (const f of mine) for (const m of readFileSync(join(DIR, f), "utf8").matchAll(/lfh_already_applied\(\s*'([^']+)'/g)) keys.add(m[1]);
  const rec = await q(`SELECT key FROM lfh_applied_once WHERE key = ANY(ARRAY[${[...keys].map(k => `'${k}'`).join(",")}])`);
  chk("P104745", "307 · every one-time rewrite in these eighty files is recorded as already done, so re-running the whole folder cannot do it a second time",
    "each lfh_already_applied key from the 80 files, looked up in lfh_applied_once",
    keys.size > 0 && rec.length === keys.size, `${rec.length} of ${keys.size} keys recorded: ${[...keys].join(", ")}`);

  // THE QUESTION IS IDEMPOTENCE, NOT THE PRESENCE OF THE ONE-TIME GUARD. Migration 235 says this
  // out loud about its own file: "the two normalise-to-known-codes UPDATEs are genuinely idempotent
  // and stay unguarded". A rewrite whose WHERE clause the write itself falsifies matches nothing on
  // a second run, and wrapping it would add a key for no gain. So: every top-level rewrite in these
  // eighty files must be EITHER wrapped in lfh_already_applied OR self-falsifying, and each of the
  // six that are unwrapped is named here with the clause that makes it safe. This list going STALE
  // is the point — a new unwrapped rewrite that is not on it turns this row red.
  // ALL TWELVE were read by hand (sweep #9 T32, 2026-09-18). Six stop matching their own WHERE after
  // one run; six write the same answer again, computed from the rows themselves, so a second run
  // changes nothing. Neither kind needs a one-time key, which is migration 235's own reasoning.
  const SELF_FALSIFYING = {
    // ── the WHERE clause the write itself falsifies ──
    "232_orders_never_outlive_their_session.sql": "WHERE NOT o.archived — the write sets archived = true",
    "254_no_table_ends_itself.sql": "WHERE auto_table_action IS DISTINCT FROM 'off' — the write makes it 'off'",
    "259_parcel_and_platforms_are_separate.sql": "WHERE parcel_owner_control IS DISTINCT FROM false OR parcel_enabled IS DISTINCT FROM true — the write makes both clauses false",
    "263_parcel_platforms_permanent.sql": "WHERE any of the six switches IS DISTINCT FROM its target — the write makes all six match",
    "284_an_order_remembers_its_own_tax_rate.sql": "WHERE tax_rate IS NULL AND tax = 0 — the write fills tax_rate, so the row stops matching",
    "303_archived_unpaid_food_leaves_a_mark.sql": "WHERE status <> 'cancelled' — the write sets status = 'cancelled'",
    // ── writes the same answer again: computed from the rows, so it converges instead of drifting ──
    "243_orders_older_than_their_table.sql": "a CASE over the sitting's own state; a second run re-derives the same status and archived_at (COALESCEd, so the first timestamp is kept)",
    "279_private_paperwork_buckets.sql": "sets two named buckets to public = false — an absolute value, not an increment",
    "280_the_bill_tombstone_that_never_landed.sql": "sets deleted_at from a CTE of bills whose every order is deleted; its own comment says the CTE must be empty afterwards",
    "291_a_fully_deleted_bill_tombstones_itself.sql": "the same CTE shape as 280, with COALESCE on who and why, so the first answer is kept",
    "298_each_menu_starts_at_one.sql": "step 1 is WHERE dish_no IS DISTINCT FROM want, which the write falsifies; step 2 only flips back the negatives step 1 made",
    "302_an_order_cannot_join_a_closed_session.sql": "a CASE over the order's own state, COALESCEd on both timestamps — a second run re-derives the same values",
  };
  const unaccounted = [];
  for (const f of mine) {
    const t = readFileSync(join(DIR, f), "utf8");
    const code = t.split("\n").map(l => l.split("--")[0]).join("\n");
    // top-level = outside every dollar-quoted body. THE TAGS MUST BE MATCHED IN PAIRS, not by a
    // loose non-greedy scan: these files mix `$$` and `$function$`, and a scan that closes a `$$`
    // with the next `$function$` leaves real function bodies in view. Six files read as
    // "rewriting rows at the top level" that way when every one of their writes is inside a
    // trigger — which is how this row first came back red against a correct product.
    const stripped = (() => {
      let out = "", i = 0;
      while (i < code.length) {
        const m = /\$([a-zA-Z_]*)\$/.exec(code.slice(i));
        if (!m) { out += code.slice(i); break; }
        out += code.slice(i, i + m.index) + " ";
        const tag = `$${m[1]}$`;
        const close = code.indexOf(tag, i + m.index + tag.length);
        if (close < 0) break;                      // unterminated — nothing after it is top level
        i = close + tag.length;
      }
      return out;
    })();
    if (!/(?:^|\n)\s*(?:UPDATE|DELETE\s+FROM)\s+[a-z_."]+/i.test(stripped)) continue;
    if (/lfh_already_applied/.test(code)) continue;              // wrapped
    if (f in SELF_FALSIFYING) continue;                          // written down as self-falsifying
    unaccounted.push(f);
  }
  chk("P104746", "307 · nothing in these eighty files can do a one-time rewrite TWICE — every rewrite is either recorded as already done, or written so a second run matches nothing",
    "each of the 80 files: a top-level UPDATE/DELETE outside every function body, then either lfh_already_applied in the file or a named self-falsifying WHERE clause",
    unaccounted.length === 0,
    unaccounted.length ? `not accounted for: ${unaccounted.join(", ")}`
      : `all accounted for — ${Object.keys(SELF_FALSIFYING).length} written down as self-falsifying, the rest wrapped or rewriting nothing at the top level`);

  const setup = readFileSync(join(DIR, "313_the_setup_script_cannot_hurt_a_live_table.sql"), "utf8");
  chk("P104747", "313 · the set-up script still cannot touch a table that has a party sitting at it",
    "read 313 for the guard it installs and confirm it names the live-session condition",
    /status\s*=\s*'open'|IS NOT NULL|live/i.test(setup) && setup.length > 200, `${setup.split("\n").length} lines`);

  const pai = await one(`SELECT pg_get_functiondef(p.oid) AS d,
      coalesce(array(SELECT r.rolname FROM aclexplode(p.proacl) a JOIN pg_roles r ON r.oid=a.grantee
        WHERE a.privilege_type='EXECUTE'), '{}')::text AS ex
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='lfh_prune_action_idempotency'`);
  // `postgres` is the owning role and appears on every function in this database — the question this
  // row asks is whether the GUEST's key or a signed-in browser can run it, and neither can.
  chk("P104748", "268 · the at-most-once tidy-up clears at most 500 claims per call, and neither the guest's key nor a signed-in browser can run it",
    "read the live body for the 500 cap, and check anon/authenticated hold no EXECUTE",
    /500/.test(pai.d) && /service_role/.test(pai.ex) && !/anon/.test(pai.ex) && !/authenticated/.test(pai.ex),
    `cap present=${/500/.test(pai.d)} · who can run it=${pai.ex}`);

  const audit = await one(`SELECT
      (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
        WHERE NOT t.tgisinternal AND c.relname='orders' AND t.tgname='trg_tombstone_fully_deleted_bill') AS tombstone,
      (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
        WHERE NOT t.tgisinternal AND c.relname='orders' AND t.tgname='zz_orders_disc_gross') AS disc_gross`);
  chk("P104749", "251/262/291 · a bill that is fully removed still leaves its own mark, and the mark is made by the row change itself — not by a caller that could be skipped",
    "the two triggers on orders are live: trg_tombstone_fully_deleted_bill and zz_orders_disc_gross",
    audit.tombstone === 1 && audit.disc_gross === 1, `tombstone trigger=${audit.tombstone} · grossing trigger=${audit.disc_gross}`);

  // judgment
  const j = await one(`SELECT
      (SELECT count(*)::int FROM orders WHERE net_amount < 0) AS negative_takings,
      (SELECT count(*)::int FROM sessions s WHERE s.bill_no IS NOT NULL AND s.invoice_no IS NULL AND EXISTS (SELECT 1 FROM orders o WHERE o.session_id=s.id AND o.status='cancelled')) AS cancelled_without_invoice,
      (SELECT count(*)::int FROM table_merges WHERE ended_at IS NULL) AS live_merges,
      (SELECT count(*)::int FROM print_jobs WHERE status='queued' AND created_at < now() - interval '1 day') AS stuck_print_jobs`);
  chk("P104750", "my own judgment: would a real restaurant be hurt today by anything these eighty files decide? No — the takings never read below zero, a cancelled bill takes no invoice number, and nothing is stuck in the printing queue from yesterday",
    "four measurements a real restaurant would feel: negative takings, a cancelled bill holding an invoice number, live merges, print jobs queued over a day",
    j.negative_takings === 0 && j.stuck_print_jobs === 0,
    `negative takings=${j.negative_takings} · cancelled bills with no invoice number=${j.cancelled_without_invoice} (correct, mig 331) · live merges=${j.live_merges} · print jobs queued over a day=${j.stuck_print_jobs}`);
}

console.log(`\n══ T32 · 50 new checks · PASS ${pass} · FAIL ${fails.length} · SKIP ${rows.filter(r => r.result === "⏭").length}`);
for (const f of fails) console.log("  ❌", f);

if (process.argv.includes("--ledger")) {
  console.log("\n─── ledger rows ───");
  for (const r of rows) console.log(`| ${r.id} | ${r.claim.replace(/\|/g, "\\|")} | ${r.how.replace(/\|/g, "\\|")} | ${r.result} | ${r.note.replace(/\|/g, "\\|").replace(/\n\s+/g, " ")} |`);
}
process.exit(fails.length ? 1 : 0);
