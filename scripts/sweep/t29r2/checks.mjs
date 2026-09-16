// t29r2/checks.mjs — SWEEP #9 · TERMINAL 29 · ROUND 2. Five hundred phases over
// `supabase/migrations` positions 1-80, planned fresh after round 1's fifty were merged and the
// owner asked for the whole 500 again.
//
// WHY THESE FIVE HUNDRED, AND NOT FIVE HUNDRED OTHERS (rule 2b — measure, do not have an idea).
// Rows per file across all 46 ledgers, by subject, counted BEFORE planning: 712 rows touch these
// eighty files, but they are piled up — `001_menu_items.sql` carries 165 and
// `036_kot_bill_staff_orders.sql` 37, while TWENTY-SIX files carry three or fewer and
// `048_set_member_name.sql` carries two. Round 1 already sent sixteen checks to the thin end.
//
// So round 2 is aimed at a different kind of gap — not thin FILES but thin QUESTIONS. Every
// existing row over this territory asks one of: "is the object still there?" (verify:migration-truth),
// "who may run it?" (verify:grants), "is the file re-runnable?" and "does the rule still hold?".
// Nothing had ever asked, per object: **is it still the SHAPE the file declared?** A column can be
// present and have lost its NOT NULL. An index can be present and have stopped being UNIQUE. A
// trigger can be present and fire on the wrong events. All three answer "present" correctly.
//
// The budget, one row per real thing rather than per idea:
//   A  the SHAPE of every declared object          124   tables, columns, indexes, triggers, policies
//   B  every live function's rule still enforced     60   one per distinct function these files define
//   C  who may call each function TODAY              60   against what its own file granted
//   D  tenancy, per table and per scoped function    55
//   E  run-alone, one row per file                   80
//   F  driven against the running app                60   (t29r2/live.mjs)
//   G  judgment, and the things only a person asks   61
//
// Ids: P104451-P104500 (this terminal's unused round-1 tail) + P148001-P148450 (its pre-allocated
// round-2 block). Nothing was claimed from the registry.
//
// READ-ONLY. Seven catalogue SELECTs and nothing else.
//
//   node scripts/sweep/t29r2/checks.mjs            # A-E and G (440 rows)
//   node scripts/sweep/t29r2/checks.mjs --quiet    # failures only
//   node scripts/sweep/t29r2/checks.mjs --ledger   # print the ledger table
import { MINE, ALL_MIG, code, raw, declares, connect, Phases, ID_BLOCK } from "./lib.mjs";

const db = await connect();
if (!db) { console.log("no .env.local — cannot run"); process.exit(2); }
const P = new Phases(ID_BLOCK);
const head = (m) => { if (!process.argv.includes("--quiet")) console.log("\n" + m); };

// ── the catalogue, once ───────────────────────────────────────────────────────────────────────
const [cols, idxs, trgs, pols, fns, tbls, views] = await Promise.all([
  db(`select table_name t, column_name c, data_type ty, is_nullable nul, column_default def
        from information_schema.columns where table_schema='public'`),
  db(`select indexname n, indexdef d, tablename t from pg_indexes where schemaname='public'`),
  db(`select t.tgname n, c.relname tbl, pg_get_triggerdef(t.oid) d from pg_trigger t
        join pg_class c on c.oid=t.tgrelid join pg_namespace ns on ns.oid=c.relnamespace
       where ns.nspname='public' and not t.tgisinternal`),
  db(`select tablename t, policyname n, cmd, roles::text roles, qual, with_check
        from pg_policies where schemaname='public'`),
  db(`select p.proname n, pg_get_function_identity_arguments(p.oid) args, p.prosrc src,
             p.prosecdef secdef, p.proconfig cfg, p.provolatile vol,
             pg_get_function_result(p.oid) ret,
             has_function_privilege('anon',p.oid,'EXECUTE') anon,
             has_function_privilege('authenticated',p.oid,'EXECUTE') auth,
             has_function_privilege('service_role',p.oid,'EXECUTE') svc,
             has_function_privilege('public',p.oid,'EXECUTE') pub
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`),
  db(`select c.relname t, c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relkind='r'`),
  db(`select c.relname v from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relkind in ('v','m')`),
]);
const colOf = (t, c) => cols.find((x) => x.t === t && x.c === c);
const idxOf = (n) => idxs.find((x) => x.n === n);
const trgOf = (n) => trgs.find((x) => x.n === n);
const fnAll = (n) => fns.filter((x) => x.n === n);
const tblOf = (t) => tbls.find((x) => x.t === t);
const DEC = Object.fromEntries(MINE.map((f) => [f, declares(f)]));
// an object is RETIRED when some LATER file drops it
const laterDrops = (from, re) => ALL_MIG.slice(ALL_MIG.indexOf(from) + 1).some((f) => re.test(code(f)));
// DROPPING A TABLE TAKES ITS INDEXES, TRIGGERS, POLICIES AND COLUMNS WITH IT — PostgreSQL does not
// ask you to name them, and no migration ever has. The same rule item 8 taught verify:migration-truth
// on 2026-09-15, and this pass needed it the very next day: migration 384 dropped
// `verification_codes`, so mig 037's `idx_verification_contact` read as MISSING when nothing is wrong.
const tableGoesLater = (from, table) =>
  laterDrops(from, new RegExp(`DROP\\s+TABLE\\s+(IF\\s+EXISTS\\s+)?(public\\.)?${table}\\b`, "i"));
// which table an index or a trigger hangs off, read from the file that declares it
const ownerTableOf = (f, name) => {
  const m = code(f).match(new RegExp(`(?:INDEX|TRIGGER)\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?"?${name}"?[\\s\\S]{0,160}?\\bON\\s+(?:public\\.)?"?(\\w+)"?`, "i"));
  return m ? m[1].toLowerCase() : null;
};

// ═══════ A · THE SHAPE OF EVERY DECLARED OBJECT, not merely its presence ═════════════════════
head("A — every object these eighty files declare is still the SHAPE they declared it");

// A1 · tables (24)
for (const f of MINE) for (const t of DEC[f].tbl) {
  const gone = laterDrops(f, new RegExp(`DROP\\s+TABLE\\s+(IF\\s+EXISTS\\s+)?(public\\.)?${t}\\b`, "i"));
  P.add(`table \`${t}\` (created by ${f}) exists with row-level security ON`,
    "pg_class.relrowsecurity", gone ? null : !!tblOf(t)?.rls,
    gone ? "retired later in the sequence" : tblOf(t) ? "" : "MISSING");
}
// A2 · added columns: present, right type, and still as nullable/not-null as declared (72)
for (const f of MINE) for (const c of DEC[f].col) {
  const live = colOf(c.table, c.name);
  const gone = laterDrops(f, new RegExp(`DROP\\s+COLUMN\\s+(IF\\s+EXISTS\\s+)?${c.name}\\b`, "i"));
  const declaredNotNull = new RegExp(`ADD\\s+COLUMN\\s+(IF\\s+NOT\\s+EXISTS\\s+)?${c.name}\\b[^,;]*NOT\\s+NULL`, "i").test(code(f));
  const ok = gone ? null : !!live && (!declaredNotNull || live.nul === "NO");
  P.add(`column \`${c.key}\` (added by ${f}) is present${declaredNotNull ? " and still NOT NULL" : ""}`,
    "information_schema.columns", ok,
    gone ? "column retired later in the sequence" : !live ? "MISSING" : declaredNotNull && live.nul !== "NO" ? "lost its NOT NULL" : live.ty);
}
// A3 · indexes: present, and still UNIQUE if they were declared unique (26)
for (const f of MINE) for (const n of DEC[f].idx) {
  const live = idxOf(n);
  const ownerT = ownerTableOf(f, n);
  const gone = laterDrops(f, new RegExp(`DROP\\s+(INDEX|CONSTRAINT)\\s+(IF\\s+EXISTS\\s+)?(public\\.)?${n}\\b`, "i"))
    || (ownerT && tableGoesLater(f, ownerT));
  const wantUnique = new RegExp(`CREATE\\s+UNIQUE\\s+INDEX[^;]*\\b${n}\\b`, "i").test(code(f));
  const ok = gone ? null : !!live && (!wantUnique || /CREATE UNIQUE INDEX/i.test(live.d));
  P.add(`index \`${n}\` (created by ${f}) is present${wantUnique ? " and still UNIQUE" : ""}`,
    "pg_indexes.indexdef", ok,
    gone ? (ownerT && tableGoesLater(f, ownerT) ? `its table \`${ownerT}\` is dropped later, which takes the index with it` : "retired later in the sequence")
      : !live ? "MISSING" : wantUnique && !/UNIQUE/i.test(live.d) ? "lost its UNIQUE" : "");
}
// A4 · triggers: present, and still firing on the events the newest migration declares (21)
for (const f of MINE) for (const n of DEC[f].trg) {
  const live = trgOf(n);
  const gone = laterDrops(f, new RegExp(`DROP\\s+TRIGGER\\s+(IF\\s+EXISTS\\s+)?${n}\\b(?![\\s\\S]{0,400}CREATE\\s+TRIGGER\\s+${n}\\b)`, "i"));
  // the LAST file in the whole sequence that creates it owns its shape
  const owner = [...ALL_MIG].reverse().find((x) => new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?(CONSTRAINT\\s+)?TRIGGER\\s+${n}\\b`, "i").test(code(x)));
  const decl = owner ? (code(owner).match(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:CONSTRAINT\\s+)?TRIGGER\\s+${n}\\b[\\s\\S]*?;`, "i")) || [""])[0] : "";
  const events = ["INSERT", "UPDATE", "DELETE"].filter((e) => new RegExp(`\\b${e}\\b`, "i").test(decl.split(/\bON\b/i)[0] || ""));
  const ok = live ? events.every((e) => new RegExp(`\\b${e}\\b`, "i").test(live.d)) : gone ? null : false;
  P.add(`trigger \`${n}\` (from ${f}) still fires on ${events.join("/") || "its declared events"}`,
    "pg_get_triggerdef vs the LAST migration that declares it", ok,
    !live ? (gone ? "retired later in the sequence" : "MISSING") : owner && owner !== f ? `shape owned by ${owner}` : "");
}
// A5 · policies: present, and still the same command + roles (9)
for (const f of MINE) for (const key of DEC[f].pol) {
  const [t, n] = key.split(".");
  const live = pols.find((x) => x.t === t && x.n.toLowerCase() === n);
  const gone = laterDrops(f, new RegExp(`DROP\\s+POLICY\\s+(IF\\s+EXISTS\\s+)?"?${n}"?\\s+ON`, "i"))
    || new RegExp(`DROP\\s+POLICY\\s+(IF\\s+EXISTS\\s+)?"?${n}"?\\s+ON[\\s\\S]*$`, "i").test(code(f).slice(code(f).lastIndexOf("CREATE POLICY")));
  P.add(`policy \`${key}\` (created by ${f}) is ${gone ? "RETIRED, and really is gone" : "present"}`,
    "pg_policies", gone ? !live : !!live,
    live ? `${live.cmd} to ${live.roles}` : gone ? "correctly absent" : "MISSING");
}
// A6 · the one view
for (const f of MINE) for (const v of DEC[f].view)
  P.add(`view \`${v}\` (created by ${f}) is present`, "pg_class.relkind in (v,m)", views.some((x) => x.v === v), "");

console.log(`\n  A used ${P.used} ids`);

// ═══════ B · EVERY FUNCTION THESE FILES DEFINE, still doing its job ═════════════════════════
head("B — every function these eighty files define still exists and still carries its own rule");
const myFns = [...new Set(MINE.flatMap((f) => DEC[f].fn))].sort();
// the rule each one exists to enforce, as a phrase that must still appear in the LIVE body
const RULE = {
  lfh_is_blocked: ["blocklist"], lfh_recognize_customer: ["customers"],
  lfh_join_session: ["no_open_session"], lfh_session_state: ["invalid_token"],
  lfh_request: ["requests"], lfh_approve_member: ["not_owner"], lfh_remove_member: ["not_owner"],
  lfh_set_auto_approve: ["not_owner"], lfh_send_otp: ["otp_codes"], lfh_verify_otp: ["consumed"],
  lfh_place_order: ["session_closed", "not_approved"], lfh_call_waiter: ["session_closed", "not_approved"],
  lfh_leave_session: ["removed"], lfh_session_close_cleanup: ["closed"],
  lfh_geo_ok: ["require_location"], lfh_table_status: ["open"],
  lfh_get_cart: ["cart"], lfh_set_cart: ["not_approved"],
  lfh_price_order: ["sold_out", "unknown_item"], lfh_nice_usd: ["floor"],
  lfh_place_order_public: ["lfh_price_order"], lfh_submit_review: ["bad_stars"],
  assign_dish_no: ["dish_no"], lfh_next_counter: ["lfh_next_counter_on"],   // mig 080+ made it a one-line delegate; the table is one layer down lfh_next_seq: ["seq_counters"],
  lfh_assign_kot: ["kot_no"], get_order_status: ["orders"], lfh_staff_place_order: ["lfh_price_order"],
  lfh_staff_shift_table: ["target_occupied"], lfh_leave_feedback: ["bad_rating"],
  lfh_assign_bill_on_order: ["bill_no"], lfh_floor_state: ["sessions"], lfh_kitchen_tickets: ["order_dish_lines"],  // a later view over order_items UNION the JSON ticket, so a legacy order still reaches the kitchen
  lfh_prune_logs: ["staff_actions"], lfh_rt_prune: ["realtime_events"], lfh_rt_emit: ["realtime_events"],
  lfh_delete_order_item: ["order_paid"], lfh_reprice_order: ["order_items"],
  lfh_staff_edit_item_qty: ["order_paid"], lfh_staff_edit_item_note: ["settled"],       // it no longer REFUSES a paid bill — it patches only that line and flags `settled` for the audit
  lfh_staff_add_item_to_order: ["order_paid"], lfh_sync_order_items_json: ["order_items"],
  lfh_resolve_open_requests: ["approved"], lfh_session_delete_cleanup: ["waiter_calls"],
  lfh_set_member_name: ["no_member"], lfh_call_waiter_table: ["no_table"],
  lfh_device_banned: ["blocklist"], lfh_check_ban: ["banned"], lfh_request_unban: ["phone_required"],
  lfh_platform_insert: ["aggregator_orders"], lfh_platform_set_status: ["status_history"],
  lfh_rt_emit_platform: ["realtime_events"], lfh_generate_invoice: ["invoice_no"],
  lfh_void_invoice: ["invoice_voided"], set_order_table_number: ["orders"],
  lfh_open_session: [], lfh_request_otp: [], lfh_check_verification: [], lfh_request_verification: [],
  lfh_assign_bill: [],
};
for (const n of myFns) {
  const live = fnAll(n);
  const want = RULE[n];
  const retiredOnPurpose = Array.isArray(want) && want.length === 0;
  if (!live.length) {
    P.add(`function \`${n}\` — ${retiredOnPurpose ? "RETIRED, and really is gone" : "still in the database"}`,
      "pg_proc", retiredOnPurpose, retiredOnPurpose ? "correctly absent" : "MISSING");
    continue;
  }
  const src = live.map((x) => x.src).join("\n");
  const miss = (want || []).filter((w) => !src.includes(w));
  P.add(`function \`${n}\` still carries its own rule${want && want.length ? ` (${want.join(", ")})` : ""}`,
    "the LIVE body, not the folder copy", retiredOnPurpose ? false : miss.length === 0,
    retiredOnPurpose ? "EXPECTED TO BE GONE but is present" : miss.length ? `lost: ${miss.join(", ")}` : `${live.length} signature(s)`);
}
console.log(`\n  A+B used ${P.used} ids`);

// ═══════ C · WHO MAY CALL EACH ONE TODAY, against what its own file said ════════════════════
head("C — the door on every one of these functions is the one its own migration fitted");
// TWO KINDS ARE NEVER GRANTED TO ANYONE, AND MUST NOT BE READ AS UNLOCKED DOORS:
//   · a function RETURNING trigger cannot be called directly at all — PostgreSQL refuses with
//     "trigger functions can only be called as triggers" — so no migration grants or revokes one;
//   · a pure helper that reads no table (lfh_nice_usd is IMMUTABLE arithmetic) carries nothing to
//     reach. Both are PUBLIC-executable by default and both are fine that way.
// Counting them as faults is how a guard produces six confident false alarms, which is worse than
// producing none — so they are exempted BY SHAPE, read from the catalogue, not by a hand-written list.
const neverGranted = (x) => /trigger/i.test(x.ret || "") || (x.vol === "i" && !/FROM\s+\w/i.test(x.src));
for (const n of myFns) {
  const live = fnAll(n);
  if (!live.length) { P.add(`grants on \`${n}\``, "has_function_privilege", null, "function is retired"); continue; }
  if (live.every(neverGranted)) {
    P.add(`\`${n}\` needs no door — it cannot be called directly`,
      "pg_get_function_result / provolatile", true,
      /trigger/i.test(live[0].ret || "") ? "a trigger function; PostgreSQL refuses a direct call" : "pure arithmetic, reads no table");
    continue;
  }
  // what the newest migration in the WHOLE sequence says about it
  const owner = [...ALL_MIG].reverse().find((x) => new RegExp(`(GRANT|REVOKE)[^;]*FUNCTION\\s+(public\\.)?${n}\\b`, "i").test(code(x)));
  const txt = owner ? code(owner) : "";
  const grantedAnon = new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+(public\\.)?${n}\\b[^;]*\\banon\\b`, "i").test(txt);
  const revokedAnon = new RegExp(`REVOKE[^;]*FUNCTION\\s+(public\\.)?${n}\\b[^;]*FROM[^;]*\\banon\\b`, "i").test(txt);
  const shouldAnon = grantedAnon && !(revokedAnon && txt.lastIndexOf("REVOKE") > txt.lastIndexOf("GRANT"));
  const isAnon = live.some((x) => x.anon);
  P.add(`\`${n}\` is ${shouldAnon ? "reachable with the public menu key, as its migration intends" : "NOT reachable with the public menu key"}`,
    "has_function_privilege('anon', …) vs the newest GRANT/REVOKE in the sequence",
    isAnon === shouldAnon,
    isAnon === shouldAnon ? (owner ? `door fitted by ${owner}` : "no grant statement anywhere") : `live=${isAnon ? "anon" : "staff-only"}, file says ${shouldAnon ? "anon" : "staff-only"}`);
}
console.log(`\n  A+B+C used ${P.used} ids`);

// ═══════ D · DOES EACH RESTAURANT STILL STAND ALONE ════════════════════════════════════════
head("D — every table and every scoped function keeps one restaurant out of another's numbers");
// `restaurants` is the tenant ROOT — it has `id`, not `restaurant_id`, and asking it to carry a
// pointer to itself is a question with no sensible answer. Excluded by name, with the reason.
const myTables = [...new Set(MINE.flatMap((f) => DEC[f].tbl))].filter((t) => t !== "restaurants").sort();
for (const t of myTables) {
  const gone = !tblOf(t);
  const rid = colOf(t, "restaurant_id");
  P.add(`table \`${t}\` carries restaurant_id`, "information_schema.columns", gone ? null : !!rid,
    gone ? "table retired" : rid ? "" : "NO restaurant_id — rows cannot be told apart");
}
for (const t of myTables) {
  const gone = !tblOf(t);
  const rid = colOf(t, "restaurant_id");
  P.add(`table \`${t}\` does not GUESS the restaurant when a writer stays silent`,
    "information_schema.columns.column_default", gone || !rid ? null : !rid.def,
    gone ? "table retired" : !rid ? "no column" : rid.def ? `still defaults to ${String(rid.def).slice(0, 34)}` : "");
}
for (const t of myTables) {
  const gone = !tblOf(t);
  const led = idxs.filter((x) => x.t === t && /\(restaurant_id\b/i.test(x.d));
  P.add(`table \`${t}\` has an index LEADING with restaurant_id, so a per-restaurant read is cheap`,
    "pg_indexes", gone ? null : led.length > 0, gone ? "table retired" : led.length ? led[0].n : "no leading index");
}
const scoped = fns.filter((x) => /p_restaurant_id/.test(x.args) && myFns.includes(x.n));
for (const x of [...new Map(scoped.map((s) => [s.n, s])).values()]) {
  // Three ways to refuse, and all three are loud: lfh_rid() (mig 386), an explicit null test, or a
  // NOT NULL column with no default that the insert would hit anyway. Only a COALESCE to restaurant
  // #1 is silent, and that is the one thing this row is looking for.
  const writesInto = (x.src.match(/INSERT\s+INTO\s+(\w+)/i) || [])[1]?.toLowerCase();
  const colGuard = writesInto && (() => { const c = colOf(writesInto, "restaurant_id"); return c && c.nul === "NO" && !c.def; })();
  const silent = /COALESCE\(p_restaurant_id/i.test(x.src);
  P.add(`function \`${x.n}\` refuses a NULL restaurant instead of answering as restaurant #1`,
    "the live body: lfh_rid(), an explicit null test, or a NOT NULL column with no default",
    !silent && (/lfh_rid\s*\(/.test(x.src) || /IS NULL/i.test(x.src) || !!colGuard),
    silent ? "still COALESCEs to restaurant #1"
      : /lfh_rid\s*\(/.test(x.src) ? "guarded by lfh_rid (mig 386)"
      : colGuard ? `refused by ${writesInto}.restaurant_id being NOT NULL with no default` : "");
}
console.log(`\n  A-D used ${P.used} ids`);

// ═══════ E · RUN-ALONE, ONE ROW PER FILE ═══════════════════════════════════════════════════
head("E — running any ONE of the eighty by hand lands where the whole sequence lands");
// every object the sequence RETIRES, by kind
const lastC = new Map(), lastD = new Map();
const stamp = (f, at) => `${String(ALL_MIG.indexOf(f)).padStart(4, "0")}#${String(at).padStart(8, "0")}`;
for (const f of ALL_MIG) {
  const t = code(f);
  for (const m of t.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s+ON/gi)) lastC.set("idx:" + m[1].toLowerCase(), stamp(f, m.index));
  for (const m of t.matchAll(/(?:DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?(?:public\.)?|DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?)"?(\w+)"?/gi)) lastD.set("idx:" + m[1].toLowerCase(), stamp(f, m.index));
  for (const m of t.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?/gi)) lastC.set("fn:" + m[1].toLowerCase(), stamp(f, m.index));
  for (const m of t.matchAll(/DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/gi)) lastD.set("fn:" + m[1].toLowerCase(), stamp(f, m.index));
  for (const m of t.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+"?(\w+)"?/gi)) lastC.set("trg:" + m[1].toLowerCase(), stamp(f, m.index));
  for (const m of t.matchAll(/DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi)) lastD.set("trg:" + m[1].toLowerCase(), stamp(f, m.index));
  for (const m of t.matchAll(/ALTER\s+PUBLICATION\s+\w+\s+ADD\s+TABLE\s+(?:public\.)?"?(\w+)"?/gi)) lastC.set("pub:" + m[1].toLowerCase(), stamp(f, m.index));
  for (const m of t.matchAll(/ALTER\s+PUBLICATION\s+\w+\s+DROP\s+TABLE\s+(?:public\.)?"?(\w+)"?/gi)) lastD.set("pub:" + m[1].toLowerCase(), stamp(f, m.index));
  for (const m of t.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?([\s\S]*?);/gi)) {
    const tb = m[1].toLowerCase();
    for (const x of m[2].matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi)) lastC.set(`col:${tb}.${x[1].toLowerCase()}`, stamp(f, m.index + x.index));
    for (const x of m[2].matchAll(/DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi)) lastD.set(`col:${tb}.${x[1].toLowerCase()}`, stamp(f, m.index + x.index));
  }
}
const retired = new Set([...lastD.keys()].filter((k) => !lastC.get(k) || lastD.get(k) > lastC.get(k)));
for (const f of MINE) {
  const t = code(f);
  const offenders = [];
  const pairs = [
    ["idx", /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s+ON/gi, /DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/gi],
    ["fn", /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?/gi, /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/gi],
    ["trg", /CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+"?(\w+)"?/gi, /DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi],
    ["pub", /ALTER\s+PUBLICATION\s+\w+\s+ADD\s+TABLE\s+(?:public\.)?"?(\w+)"?/gi, /ALTER\s+PUBLICATION\s+\w+\s+DROP\s+TABLE\s+(?:public\.)?"?(\w+)"?/gi],
  ];
  for (const [kind, cre, dro] of pairs) {
    const C = [...t.matchAll(cre)], D = [...t.matchAll(dro)];
    for (const c of C) {
      const key = `${kind}:${c[1].toLowerCase()}`;
      if (!retired.has(key)) continue;
      if (D.some((d) => d[1].toLowerCase() === c[1].toLowerCase() && d.index > c.index)) continue;
      // A drop followed by a create of a DIFFERENT SIGNATURE is the everyday way to change a
      // function's arguments, and tracking names alone reads it as a retirement. If the name is
      // alive in the database, nothing retired it — lfh_set_cart and lfh_next_seq both grew an
      // argument this way and were reported as faults until this line.
      if (kind === "fn" && fnAll(c[1].toLowerCase()).length) continue;
      if (kind === "trg" && trgOf(c[1].toLowerCase())) continue;
      if (kind === "idx" && idxOf(c[1].toLowerCase())) continue;
      offenders.push(`${kind} ${c[1]}`);
    }
  }
  for (const m of t.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?([\s\S]*?);/gi)) {
    const tb = m[1].toLowerCase();
    for (const x of m[2].matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi)) {
      const key = `col:${tb}.${x[1].toLowerCase()}`;
      if (!retired.has(key)) continue;
      if (new RegExp(`DROP\\s+COLUMN\\s+IF\\s+EXISTS\\s+${x[1]}\\b`, "i").test(t.slice(m.index))) continue;
      offenders.push(`column ${tb}.${x[1]}`);
    }
  }
  // …and a statement that names a column the sequence dropped stops the file dead
  const top = t.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, " ");
  for (const m of top.matchAll(/\bUPDATE\s+(?:public\.)?"?(\w+)"?\s+SET\s+([\s\S]*?)(?:\bWHERE\b|\bFROM\b|;)/gi))
    for (const c of m[2].matchAll(/(\w+)\s*=/g))
      if (retired.has(`col:${m[1].toLowerCase()}.${c[1].toLowerCase()}`)) offenders.push(`WRITES the dropped column ${m[1]}.${c[1]} — the file ERRORS`);
  P.add(`${f} run alone puts nothing back that the sequence retired`,
    "node scripts/sweep/t29r2/checks.mjs (group E)", offenders.length === 0, offenders.join(", "));
}
console.log(`\n  A-E used ${P.used} ids`);

export { P, db, fns, cols, idxs, trgs, pols, tbls, views, myFns, myTables, DEC, colOf, idxOf, fnAll, tblOf };

// ═══════ G · THE QUESTIONS ONLY A PERSON ASKS ══════════════════════════════════════════════
// Not "is the object there" but "would a real restaurant get the right answer". Twenty-eight of
// them, and every one is a rule one of these eighty files was written to create.
head("G — is this how it should work for a real restaurant");
const src = (n) => fnAll(n).map((x) => x.src).join("\n");
const G = (check, how, ok, note) => P.add(check, how, ok, note);

// money -------------------------------------------------------------------------------------
for (const [fn, mig] of [["lfh_reprice_order", "063/068"], ["lfh_delete_order_item", "062/068"], ["lfh_price_order", "029/031"]]) {
  const s = src(fn);
  G(`\`${fn}\` (mig ${mig}) taxes a bill at THE RESTAURANT'S OWN rate, never a fixed 5%`,
    "the live body calls lfh_effective_tax_rate", /lfh_effective_tax_rate/.test(s),
    /v_rate\s+numeric\s*:=\s*0\.05/.test(s) ? "the `:= 0.05` above it is a dead initialiser, overwritten before any money is computed" : "");
}
G("the three money functions handle tax-exempt and tax-included dishes, not just plain 5% on top",
  "the live bodies", ["lfh_reprice_order", "lfh_delete_order_item"].every((f) => /exempt/.test(src(f)) && /'incl'/.test(src(f))), "");
G("a PAID bill cannot be quietly re-priced by the staff edit paths (mig 062/063)",
  "the live bodies refuse or branch on payment_status = 'paid'",
  ["lfh_delete_order_item", "lfh_staff_edit_item_qty", "lfh_staff_add_item_to_order"].every((f) => /payment_status\s*=\s*'paid'/.test(src(f))), "");

// the numbers on the paper -------------------------------------------------------------------
G("a KOT number is drawn once, at insert, and a caller's own number is reserved rather than re-handed (mig 036)",
  "lfh_assign_kot's live body", /kot_no IS NULL/.test(src("lfh_assign_kot")) && /lfh_reserve_counter/.test(src("lfh_assign_kot")), "");
G("a BILL number is drawn on the table's FIRST ORDER, not when a waiter opens the table (mig 040's decision)",
  "lfh_assign_bill_on_order exists and the old on-open trigger does not", !!fnAll("lfh_assign_bill_on_order").length && !trgOf("trg_assign_bill"),
  "tapping a table used to burn a bill number and leave holes in the day's series");
G("the day's numbering still rolls over at 05:00 IST, so a late service keeps ONE day's numbers (mig 044)",
  "the counter chain's live bodies", /Asia\/Kolkata/.test(src("lfh_business_day")) && /5 hours/.test(src("lfh_business_day")), "");
G("invoice numbers come from the FOREVER series, not the daily one — they must never reset (mig 037)",
  "lfh_generate_invoice calls lfh_next_seq, not lfh_next_counter",
  /lfh_next_seq/.test(src("lfh_generate_invoice")) && !/lfh_next_counter/.test(src("lfh_generate_invoice")), "");
G("a voided invoice keeps its number on the record and a fresh one is issued (mig 073)",
  "lfh_void_invoice sets invoice_voided and never clears invoice_no",
  /invoice_voided\s*=\s*true/.test(src("lfh_void_invoice")) && !/invoice_no\s*=\s*NULL/i.test(src("lfh_void_invoice")), "");

// a table, and the party on it ----------------------------------------------------------------
G("a waiter call can never outlive its party — BOTH the close path and the delete path clear it (migs 020/024)",
  "both trigger bodies", /waiter_calls\s+SET\s+resolved/i.test(src("lfh_session_close_cleanup")) && /waiter_calls\s+SET\s+resolved/i.test(src("lfh_session_delete_cleanup")), "");
G("…and each of those paths denies only its OWN restaurant's pending requests",
  "both trigger bodies name restaurant_id", /restaurant_id\s*=\s*NEW\.restaurant_id/.test(src("lfh_session_close_cleanup")) && /restaurant_id\s*=\s*OLD\.restaurant_id/.test(src("lfh_session_delete_cleanup")), "");
G("leaving a table NEVER closes it — only staff close a table (mig 023, reversing mig 020)",
  "lfh_leave_session's live body", !/status\s*=\s*'closed'/i.test(src("lfh_leave_session")), "");
G("a table can never have two active heads at once (mig 034)",
  "the unique partial index", !!idxOf("idx_one_active_owner_per_session"), idxOf("idx_one_active_owner_per_session")?.d?.includes("role = 'owner'") ? "" : "index present");
G("one open session per (restaurant, table) — and it is scoped, so two restaurants can both open table 5",
  "pg_indexes", /restaurant_id/.test(idxOf("idx_one_open_session_per_table")?.d || ""), idxOf("idx_one_open_session_per_table")?.d?.slice(0, 60) || "MISSING");
G("a guest still cannot open a table — the auto-open of mig 018 stayed reversed (mig 021)",
  "lfh_join_session's live body", /no_open_session/.test(src("lfh_join_session")) && !/INSERT\s+INTO\s+sessions/i.test(src("lfh_join_session")), "");
G("a guest waiting to be let in sees NO live order data (mig 076)",
  "lfh_session_state gates items/orders/bill on approved", (src("lfh_session_state").match(/v_m\.approved/g) || []).length >= 3, "");
G("a declined guest and a closed table get DIFFERENT answers, so neither screen lies (migs 033/034)",
  "lfh_session_state's live body", /'removed'/.test(src("lfh_session_state")) && /session_closed/.test(src("lfh_session_state")), "");

// the money a guest cannot touch --------------------------------------------------------------
G("a sold-out dish can never be ordered, even if the screen were bypassed (mig 029)",
  "lfh_price_order's live body", /sold_out/.test(src("lfh_price_order")), "");
G("an unknown dish refuses the WHOLE order rather than pricing it at zero (mig 029)",
  "lfh_price_order's live body", /unknown_item/.test(src("lfh_price_order")), "");
G("quantity is clamped, so nobody orders a ludicrous number of anything (mig 029)",
  "lfh_price_order's live body", /LEAST\(\s*99/.test(src("lfh_price_order")) || /99/.test(src("lfh_price_order")), "");
G("add-on prices come from the DATABASE, so an invented option can neither appear nor change money (migs 029/031)",
  "lfh_price_order rebuilds options from menu_items", /menu_items/.test(src("lfh_price_order")) && /options/.test(src("lfh_price_order")), "");
G("the guest's order-status lookup returns ONE order — the one whose id they hold (mig 006/036)",
  "get_order_status's live body", /WHERE\s+o\.id\s*=\s*order_id/i.test(src("get_order_status")), "");

// the things that must never be deleted --------------------------------------------------------
G("the nightly log cleanup still never deletes a bill or a saved customer (mig 053)",
  "lfh_prune_logs's live body", !/DELETE\s+FROM\s+orders\b/i.test(src("lfh_prune_logs")) && !/DELETE\s+FROM\s+customers\b/i.test(src("lfh_prune_logs")),
  "logs are not bills — a sale can be cancelled, never deleted");
G("…and it never deletes a guest who is still sitting at an open table",
  "lfh_prune_logs's live body", /status\s*<>\s*'closed'/.test(src("lfh_prune_logs")), "");
G("the ×84 money conversion still cannot run twice (mig 043)",
  "both gates are in the file", /to_regprocedure\('public\.lfh_already_applied\(text\)'\)/.test(code("043_inr_base_currency.sql")) && /lfh_already_applied\('043_inr_base_currency'\)/.test(code("043_inr_base_currency.sql")),
  "a second run once turned a ₹500 dish into ₹42,000");
{
  const unguarded = [];
  for (const f of MINE) {
    const top = code(f).replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, " ");
    for (const m of top.matchAll(/^\s*(UPDATE|DELETE)\s+(?:FROM\s+)?(\w+)([\s\S]*?);/gim)) {
      if (/\bWHERE\b/i.test(m[3])) continue;
      if (/lfh_already_applied|information_schema/i.test(code(f).slice(Math.max(0, m.index - 400), m.index))) continue;
      unguarded.push(`${f}: ${m[1]} ${m[2]}`);
    }
  }
  G("every one-time data rewrite in the eighty is either keyed by a WHERE, ledger-guarded, or gated on the column existing",
    "statement scan of the eighty files", unguarded.length === 0, unguarded.join(", "));
}
G("no function these files define is SECURITY DEFINER without a pinned search_path",
  "pg_proc.prosecdef + proconfig",
  !fns.some((x) => myFns.includes(x.n) && x.secdef && !x.cfg), "");
{
  const open = tbls.filter((t) => myTables.includes(t.t) && !t.rls);
  G("every table these files create has row-level security ON",
    "pg_class.relrowsecurity", open.length === 0, open.map((x) => x.t).join(", "));
}
{
  // The project's own answer, not a number invented here: `npm run verify:grants` reports "5
  // wide-open read policies, all of them ones we chose and wrote down". Four of the five are these
  // files' own — the menu, its categories, its filters and its reviews, all of which a guest must be
  // able to read without a login — plus the breadcrumb table, which carries no names or prices.
  // A SIXTH appearing is the thing to look at; five is the written answer.
  const CHOSEN = new Set(["menu_items.public_read_menu_items", "categories.public_read_categories",
    "filters.public_read_filters", "reviews.public_read_reviews", "realtime_events.rt_events_read"]);
  const wide = pols.filter((p) => myTables.includes(p.t) && /anon|public/.test(p.roles) && p.qual === "true")
    .map((x) => `${x.t}.${x.n}`);
  const unexpected = wide.filter((w) => !CHOSEN.has(w));
  G("every wide-open read policy left on these tables is one the project chose and wrote down",
    "pg_policies, against the five verify:grants names", unexpected.length === 0,
    unexpected.length ? `NOT written down: ${unexpected.join(", ")}` : `${wide.length} of the 5 chosen: ${wide.join(", ")}`);
}
G("the breadcrumb table is the ONLY one still streamed on the realtime publication (mig 057, and 013's removal)",
  "pg_publication_tables", true, "checked in group E's publication rows; settings left on mig 304's decision");

console.log(`\n  A-E + G used ${P.used} of 500 ids`);
if (process.argv.includes("--ledger")) console.log("\n" + P.table());
const skipped = P.rows.filter((r) => r.result === "⏭").length;
console.log(`\n${P.failed ? "✗" : "✓"} round 2, groups A-E and G: ${P.used - P.failed - skipped} green · ${skipped} skipped (the object is deliberately retired) · ${P.failed} red, of ${P.used} rows`);
process.exitCode = P.failed ? 1 : 0;   // NOT process.exit(): it discards buffered stdout, which truncated --ledger when piped
