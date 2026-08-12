// verify-db-grants.mjs — WHO IS ALLOWED TO RUN WHAT, checked against the real database.
//
// WHY THIS EXISTS. The project's rule since migration 038 is that every staff-only function
// gets `REVOKE … FROM PUBLIC, anon, authenticated` + `GRANT … TO service_role`. The
// 2026-08-04 database sweep found that rule was TRUE IN THE MIGRATIONS and FALSE IN THE
// DATABASE for 17 functions — including `lfh_staff_close_all_tables` (closes every table on
// the floor, cancelling cooking food and unpaid bills) and `lfh_next_counter` (hands out bill
// numbers, so a stray call leaves a gap in the bill series). They had been runnable with the
// public menu key that ships in every guest's browser, for months.
//
// It drifted silently because NOTHING in this repo read grants. verify-db-parity.mjs compares
// function BODIES, indexes and triggers between the two databases — so both stacks could
// carry the same wrong grants and every check stayed green. This file is the missing check.
//
// Two things make it durable rather than a one-off:
//   1. It is an ALLOW-LIST, not a deny-list. Anything with anon/authenticated EXECUTE that is
//      not named below FAILS. So a NEW function also fails — which matters, because Supabase's
//      default privileges hand EXECUTE to anon on every function as it is created, and that is
//      precisely how a staff-only RPC becomes public without anyone typing a GRANT.
//   2. Every entry carries the reason it is allowed. Adding a line is then a decision someone
//      wrote down, not a silent widening.
//
// READ-ONLY. It runs SELECTs against pg_proc / pg_policies / cron.job and writes nothing.
// Safe to run while other sessions are working.
//
//   node scripts/verify-db-grants.mjs            # the backup/dev database
//   node scripts/verify-db-grants.mjs --quiet    # only failures
//   node scripts/verify-db-grants.mjs --av       # ALSO check AV live (read-only; needs .env.AV.live)
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const parseEnv = (t) => Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
  const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
}));
const QUIET = process.argv.includes("--quiet");
const WITH_AV = process.argv.includes("--av");

let failed = 0;
const pass = (m) => { if (!QUIET) console.log("  ✓ " + m); };
const fail = (m) => { console.log("  ✗ " + m); failed++; };
const head = (m) => console.log("\n" + m);

const q = async (env, sql) => {
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  if (!r.ok) throw new Error(`${ref.slice(0, 6)}…: ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

// ── THE ALLOW-LIST ───────────────────────────────────────────────────────────────────────────
// A function may be EXECUTE-able by anon/authenticated ONLY if it is named here. Keyed by name
// (not signature) because an overload of a guest RPC is the same decision.
//
// THE TRAP, WRITTEN DOWN SO IT IS NOT REDISCOVERED: `lfh_price_order` is SECURITY **INVOKER**
// and anon-callable — it runs as the CALLER, not as postgres. So every helper it uses must ALSO
// be anon-callable. It calls `lfh_nice_usd`. Revoking that helper does not look dangerous and
// would silently break guest pricing. Before removing anything from this list, check whether an
// INVOKER function above it depends on it.
//
// AND THE SECOND HALF OF THAT TRAP, which this file could not see and mig 300 fixed (T16 sweep):
// an EXECUTE grant is not the same thing as "this function works for that role". An INVOKER
// function also needs the caller to be able to read every TABLE in its body. `lfh_resolve_tax_mode`
// and `lfh_effective_tax_rate` were anon-granted INVOKER functions reading `public.settings` —
// which mig 283 revoked from anon when it moved the guest onto the two RPC doors. The grants were
// live, the functions were listed here as guest-facing, and a guest call would have failed on the
// table read. Mig 300 made both DEFINER so the chain above is true rather than merely written down.
// So: when you add an INVOKER function here, check its TABLE reads too, not just its grant.
const ANON_ALLOWED = {
  // ── the guest's own journey (the public menu holds the anon key by design) ──
  lfh_place_order:            "guest places an order from their phone (token-scoped)",
  lfh_place_order_public:     "guest orders from a table QR with no session (mig 264 re-grants it explicitly)",
  lfh_price_order:            "the guest cart prices itself server-side; SECURITY INVOKER (mig 253 reasons about this)",
  lfh_nice_usd:               "formatter called BY lfh_price_order, which is INVOKER — revoking it breaks guest pricing",
  // Added 2026-08-04 the day this guard shipped, and it is the trap above proving itself: mig 270
  // created lfh_resolve_tax_mode with Supabase's default anon grant, this check went red, and the
  // right answer was NOT to revoke it — lfh_price_order (SECURITY INVOKER, anon) calls it, so a
  // revoke would have silently broken every guest cart's pricing. Verified by reading the caller.
  lfh_resolve_tax_mode:       "decides a dish's tax mode; called BY lfh_price_order (INVOKER). DEFINER since mig 300 so its settings read works",
  lfh_phone10:                "phone-number formatter, pure",
  // THE TWO DOORS (mig 282). These exist so the guest does NOT need a table-wide read on
  // `settings` / `restaurants` — they return that restaurant's guest slice as one jsonb object,
  // `to_jsonb(row)` minus a denylist. They are the narrowest thing on this list, not the widest:
  // each returns strictly LESS than the table grant they replace. scripts/verify-guest-read.mjs
  // checks both halves — that they open for a guest AND that they still withhold gstin /
  // access_config / the rest.
  lfh_guest_settings:         "the guest menu's own settings, minus the staff-only fields (mig 282)",
  lfh_guest_restaurant:       "resolve a restaurant from its slug for a guest, minus the permission block (mig 282)",
  lfh_effective_tax_rate:     "the tax rate for a bill; called BY lfh_price_order (INVOKER). DEFINER since mig 300 so its settings read works",
  lfh_session_state:          "the guest's own table state, scoped by their session token",
  lfh_join_session:           "guest joins a table",
  // lfh_open_session was here until 2026-08-06 with the reason "guest/waiter opens a table
  // (legacy path, still granted)". That note recorded the grant but not the RULE: migration 021
  // retired guest-opened tables outright ("guests do NOT open tables… staff open a table's
  // session from the editor floor"), and this function does exactly what that forbids. It had
  // zero callers; staff open a table through lfh_staff_open_table (service_role). Mig 304 drops
  // it. Do not re-add the entry — a second, weaker door beside the real one is the fault.
  lfh_leave_session:          "guest leaves a table",
  lfh_touch_session:          "guest heartbeat; mig 099:108 revokes PUBLIC but keeps anon on purpose",
  lfh_get_cart:               "shared cart read, token-scoped",
  lfh_set_cart:               "shared cart write, token-scoped",
  lfh_merge_cart:             "shared cart merge, token-scoped",
  lfh_set_member_name:        "guest names themselves in the party",
  lfh_approve_member:         "party head approves a joiner (owner-token scoped)",
  lfh_remove_member:          "party head removes a joiner (owner-token scoped)",
  lfh_set_auto_approve:       "party head toggles auto-approve",
  lfh_call_waiter:            "guest calls a waiter (token-scoped, rate-limited)",
  lfh_call_waiter_table:      "guest calls a waiter from a table QR (rate-limited)",
  lfh_request:                "guest asks to open/join a table",
  lfh_table_status:           "guest checks whether their table is open",
  lfh_geo_ok:                 "geofence check for the guest's location",
  lfh_is_blocked:             "guest ban gate, called by 8 guest RPCs",
  lfh_greet_device:           "returns a returning guest's name",
  lfh_leave_feedback:         "guest rates their order (one per order, enforced by a unique index)",
  lfh_submit_review:          "guest reviews a dish (one per device per dish, unique index)",
  lfh_request_unban:          "a blocked guest asks to be let back in",
  // Restored by mig 290 after migs 267/281 dropped it on the stated grounds that nothing
  // called it — lib/session.ts:203 → components/BanGate.tsx has called it all along, so the
  // guest menu fired a 404 RPC on every load and the "You've been blocked" wall (with its
  // "leave your number" appeal) could never appear. It must be anon: it IS the guest's own
  // browser asking. Narrow by construction — it answers only about the calling device's own
  // device id / phone, returns no other guest's data and no restaurant data, and cannot write.
  lfh_check_ban:              "the guest menu asks whether THIS device is blocked, on load (mig 290)",
  lfh_send_otp:               "guest phone verification (answers 'disabled' while the feature is off)",
  lfh_verify_otp:             "guest phone verification",
  lfh_request_verification:   "mig-037 verification stub",
  get_order_status:           "guest polls their order's status + KOT number; no money in the result",
  set_order_table_number:     "narrow relabel: digits only, refuses session orders, derives the restaurant from the order (migs 007/051)",

  // ── trigger functions. PostgreSQL does NOT check EXECUTE when firing a trigger, so the
  //    grant is irrelevant to how these run; they are listed so the check stays quiet about
  //    them rather than being weakened. (mig 267 revoked the two whose direct call was worth
  //    stopping: lfh_rt_emit and lfh_resolve_open_requests.)
  lfh_assign_kot:                 "trigger: stamps kot_no BEFORE INSERT on orders",
  lfh_assign_bill_on_order:       "trigger: gives a session its bill_no on its first order",
  lfh_rt_emit_cart:               "trigger: the guest cart's own table-scoped breadcrumb (mig 109)",
  lfh_rt_emit_platform:           "trigger: delivery-order breadcrumb",
  lfh_set_topic_rid:              "trigger: builds topic_rid on a breadcrumb insert (mig 145)",
  lfh_session_close_cleanup:      "trigger: the close cleanup (migs 020/146/232/249)",
  lfh_session_delete_cleanup:     "trigger: the delete cleanup",
  lfh_sections_follow_table_count:"trigger: a growing floor never orphans a waiter's table",
  lfh_clear_table_tag_on_close:   "trigger: a table's mark belongs to the party that left",
  assign_dish_no:                 "trigger: next dish number",
  fix_request_resolve_error:      "trigger: links a fix request to its error row",
};

// Jobs the migrations schedule. Migs 053 and 060 wrapped cron.schedule in
// `EXCEPTION WHEN OTHERS THEN NULL/NOTICE`, so for months they reported success and created
// nothing — the activity log was never trimmed and breadcrumb cleanup ran only by luck.
// Mig 267 schedules them at top level; this check is what stops them going missing again.
const REQUIRED_CRON = {
  "lfh-prune-logs":                   "trims the activity log nightly (migs 053/152/158)",
  "lfh-rt-prune":                     "guaranteed breadcrumb sweep every 10 min (mig 060)",
  "refresh-owner-daily-agg":          "the owner report's daily rollup (mig 191)",
  "refresh-owner-report-monthly-agg": "the owner report's monthly rollup (mig 201)",
  // VACUUM reclaims the heap but not index space, so the breadcrumb table's indexes grow without
  // limit on ~1.5M inserts / 1.3M deletes — the sweep measured 21 MB of index on a 152 kB table.
  // Reclaimed by hand once (7,344 kB → 48 kB); mig 289 stops it needing a human to remember.
  "lfh-reindex-breadcrumbs":          "weekly REINDEX of realtime_events so its indexes stay small (mig 289)",
  // The AUDIT's window is in YEARS, not days — it is the money trail, not the activity diary, and it
  // is the record that answers "where did bill #217 go" long after the fact (mig 311). If this job
  // goes missing nothing breaks today; the setting simply stops meaning anything, which is worse than
  // it sounds on the one record the product's safety argument rests on.
  "lfh-prune-audit":                  "keeps the Audit to its retention window, in years (mig 311)",
};
// Deliberately absent — a table is ended only by a person tapping ✓ Close (mig 254).
const FORBIDDEN_CRON = { lfh_auto_close_idle_sessions: "no table ends itself (owner rule, mig 254)" };

async function checkDb(label, env) {
  head(`${label} — who may run what`);

  const fns = await q(env, `
    SELECT p.proname AS name,
           pg_get_function_identity_arguments(p.oid) AS args,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
           has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc,
           p.prosecdef AS definer,
           coalesce(array_to_string(p.proconfig, ','), '') AS cfg
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
     ORDER BY 1, 2`);

  // 1. Nothing outside the allow-list is reachable with the public key.
  const leaked = fns.filter((f) => (f.anon || f.auth) && !(f.name in ANON_ALLOWED));
  if (leaked.length) {
    for (const f of leaked) {
      fail(`${f.name}(${f.args}) is EXECUTE-able by ${f.anon ? "anon" : ""}${f.anon && f.auth ? "+" : ""}${f.auth ? "authenticated" : ""}`
         + ` — a staff-only function must be service_role only. Add a REVOKE in a new migration,`
         + ` or add it to ANON_ALLOWED with the reason a guest browser needs it.`);
    }
  } else {
    pass(`no function outside the ${Object.keys(ANON_ALLOWED).length}-entry allow-list is reachable with the public menu key`);
  }

  // 2. The allow-list has not rotted: every name in it still exists.
  const live = new Set(fns.map((f) => f.name));
  const ghosts = Object.keys(ANON_ALLOWED).filter((n) => !live.has(n));
  if (ghosts.length) fail(`ANON_ALLOWED names ${ghosts.length} function(s) that no longer exist: ${ghosts.join(", ")} — delete the entries`);
  else pass("every entry in the allow-list still exists (no stale permission written down)");

  // 2b. THE ALLOW-LIST IS A TWO-WAY PROMISE. Check 1 catches a function that is anon-callable
  //     and NOT written down. This catches the opposite, which nothing caught before and which
  //     cost the guest ban wall: a function that IS written down as needed by a guest browser,
  //     but has since been revoked from anon. Under-permission is as much a fault as
  //     over-permission - it is just silent, because the guest's request 401s in a browser
  //     nobody is watching instead of failing a test.
  //
  //     The story: mig 290 restored lfh_check_ban WITH its anon grant (BanGate calls it on every
  //     guest menu load). Mig 291 then revoked it, in good faith, reading it as a staff-only
  //     function - its own comment says "a guest browser has no business calling it". Because 291
  //     sorts later, a reseed left the guest's ban check un-callable and the wall could never
  //     appear. Mig 293 re-grants it, and this check is what stops the next round trip.
  //     ONLY the entries that are genuinely CALLED by a guest browser count. The allow-list also
  //     documents TRIGGER functions (their reason starts "trigger:"), which nothing calls by name
  //     and which are deliberately revoked from anon — mig 166 revokes lfh_clear_table_tag_on_close
  //     itself. Counting those would make this check permanently red for the wrong reason, which
  //     is how a guard stops meaning anything.
  const muted = Object.keys(ANON_ALLOWED).filter((n) => {
    if (/^trigger:/i.test(ANON_ALLOWED[n])) return false; // documented, not guest-called
    const f = fns.find((x) => x.name === n);
    return f && !f.anon; // it exists, we say a guest calls it, and a guest cannot run it
  });
  if (muted.length) {
    fail(`${muted.length} allow-listed function(s) are NOT executable by anon: ${muted.join(", ")}`
       + ` - a guest browser calls each of these, so a revoke here shows up as a 401 in the menu,`
       + ` not as a failing test. Re-GRANT in a new migration, or delete the caller AND the`
       + ` ANON_ALLOWED entry in the same commit.`);
  } else {
    pass("every allow-listed function is actually callable by anon (a guest's own request can't 401)");
  }

  // 3. Every function the app actually uses can be run by the server.
  const noSvc = fns.filter((f) => !f.svc);
  if (noSvc.length) fail(`${noSvc.length} function(s) are not executable by service_role: ${noSvc.slice(0, 5).map((f) => f.name).join(", ")}`);
  else pass("every function is executable by service_role (no route can be locked out of its own RPC)");

  // 4. A SECURITY DEFINER function without a pinned search_path resolves names as the caller
  //    chooses. Migration 038's other half of the same rule.
  const noPath = fns.filter((f) => f.definer && !/search_path/.test(f.cfg));
  if (noPath.length) fail(`${noPath.length} SECURITY DEFINER function(s) have no SET search_path: ${noPath.map((f) => f.name).join(", ")}`);
  else pass("every SECURITY DEFINER function pins its search_path");

  // 5. Scheduled maintenance exists. This is the check migs 053/060 needed and did not have.
  const jobs = await q(env, `SELECT jobname AS name, schedule, active FROM cron.job`).catch(() => null);
  if (!jobs) {
    fail("could not read cron.job — pg_cron missing? Migs 191/267 need it, and the log prune + breadcrumb sweep depend on it");
  } else {
    const have = new Map(jobs.map((j) => [j.name, j]));
    for (const [name, why] of Object.entries(REQUIRED_CRON)) {
      const j = have.get(name);
      if (!j) fail(`cron job "${name}" is MISSING — ${why}. Migs 053/060 swallowed this failure for months; re-run mig 267.`);
      else if (j.active === false) fail(`cron job "${name}" exists but is INACTIVE — ${why}`);
      else pass(`cron "${name}" scheduled (${j.schedule}) — ${why}`);
    }
    for (const [name, why] of Object.entries(FORBIDDEN_CRON)) {
      if ([...have.keys()].some((k) => k.includes(name))) fail(`cron job matching "${name}" EXISTS and must not — ${why}`);
    }
    if (!Object.keys(FORBIDDEN_CRON).some((n) => [...have.keys()].some((k) => k.includes(n)))) {
      pass("nothing is scheduled to end a table on its own (owner rule, mig 254)");
    }
  }

  // 6. Row-level rules: RLS on everywhere, and every wide-open read policy is one we chose.
  //    `USING (true)` on a table the public key can read means EVERY restaurant's rows.
  const KNOWN_PUBLIC_READ = {
    categories: "the guest menu's category strip",
    filters: "the guest menu's filter chips",
    menu_items: "the guest menu itself",
    restaurants: "tenant resolution from a slug; narrowed to 11 guest-facing COLUMNS — F9 narrowing was REVERTED by mig 274; see mig 281 for why",
    settings: "the guest's live settings subscription (mig 013); narrowed to 20 guest-facing COLUMNS — F9 narrowing was REVERTED by mig 274; see mig 281 for why",
    reviews: "dish reviews are public by design",
    realtime_events: "breadcrumbs; each panel/guest filters to its own restaurant via topic_rid",
  };
  // 6b. THE GUEST READ IS DELIBERATELY *NOT* CHECKED BY COLUMN HERE — read this before adding it.
  //     The sweep (F9) found that the guest menu key can read every restaurant's `settings` and
  //     `restaurants` row WHOLE, gstin and access_config included. That finding is real. The fix
  //     attempted for it — narrowing anon's SELECT to a column list — TOOK EVERY GUEST MENU DOWN
  //     on the backup site, because a column grant in the database has to stay in lockstep with a
  //     column list in the code and the two do not deploy together: mig 270 had added three
  //     columns to lib/menu.ts's own read, the grant listed the older 19, and PostgREST answered
  //     42501. Mig 274 restored the whole-table grant; mig 281 records the full post-mortem.
  //
  //     So there is no column assertion here on purpose. The guard that belongs to this question
  //     is scripts/verify-guest-read.mjs, which asks it the only way that cannot be fooled: with
  //     the ANON key, over HTTP, the way a guest asks. Run that, not a list of columns someone
  //     believed the app reads. If F9 is ever re-attempted it should be a guest-facing VIEW or
  //     RPC — one object the server owns — not a grant that a future migration can silently
  //     invalidate.

  const noRls = await q(env, `
    SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity ORDER BY 1`);
  if (noRls.length) fail(`${noRls.length} table(s) have row-level security OFF: ${noRls.map((r) => r.name).join(", ")}`);
  else pass("row-level security is enabled on every table");

  const pol = await q(env, `
    SELECT tablename AS name, policyname AS pol FROM pg_policies
     WHERE schemaname='public' AND cmd IN ('SELECT','ALL') AND coalesce(qual,'true')='true'
       AND roles::text ~ '(public|anon|authenticated)' ORDER BY 1, 2`);
  const unexpected = pol.filter((p) => !(p.name in KNOWN_PUBLIC_READ));
  if (unexpected.length) {
    for (const p of unexpected) fail(`${p.name} has a public read policy "${p.pol}" with USING (true) — every restaurant's rows are readable with the guest key. Scope it, or record why it is safe in KNOWN_PUBLIC_READ.`);
  } else {
    pass(`${pol.length} wide-open read policies, all of them ones we chose and wrote down`);
  }
}

// ── STATIC: the migrations folder itself (no database needed) ────────────────────────────────
function checkMigrations() {
  head("supabase/migrations — the folder is one unambiguous sequence");
  const files = readdirSync(join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql"));

  const byNum = {};
  for (const f of files) (byNum[f.slice(0, 3)] ||= []).push(f);
  // The seeder applies these with readdirSync().sort(), so two files sharing a number tie-break
  // on the FILENAME, not on intent. Today's 18 duplicate pairs are all disjoint (checked
  // object-by-object in the sweep) so nothing breaks — but a worktree currently holds a
  // DIFFERENT 254_*.sql than main does, and merging it would make the order matter.
  const dups = Object.entries(byNum).filter(([, v]) => v.length > 1);
  // 19 since 2026-08-04: two sessions merged a 290 within half an hour of each other
  // (290_the_blocked_guest_must_be_told + 290_document_dates_follow_the_business_day). Checked
  // object-by-object like the other 18 and they are disjoint: the first touches only
  // lfh_check_ban, the second only lfh_doc_date_hi + the lfh_inv_report_* family. Neither is
  // renumbered because both are already merged AND applied to both databases, and renaming a
  // migration that has run buys nothing but a diff. The ORDER question that mattered here —
  // 291 revoking what 290 granted — is settled by mig 293, not by the filename.
  const KNOWN_DUP_COUNT = 19;
  if (dups.length > KNOWN_DUP_COUNT) {
    fail(`${dups.length} duplicate migration numbers (was ${KNOWN_DUP_COUNT}) — a NEW one was added: `
       + dups.filter(([, v]) => v.length > 1).slice(-3).map(([k, v]) => `${k}: ${v.join(" + ")}`).join("; ")
       + `. Two files sharing a number apply in filename order, not intent order. Renumber the new one.`);
  } else {
    pass(`no new duplicate migration numbers (${dups.length} historical pairs, all verified disjoint)`);
  }

  // THE OTHER HALF OF THE SAME QUESTION (sweep 3, F6): the check above counted duplicates and
  // could not see a HOLE. Migration 090 does not exist — 089 goes straight to 091 — and it never
  // has: nothing was ever committed under that number. So nobody could tell "090 was skipped"
  // from "090 was written and lost", which is a real answer to need when asking "did everything
  // apply?". A gap is now named, with an allow-list so a known one stays quiet and a NEW one
  // (the case that would actually mean a lost file) goes red.
  const nums = [...new Set(Object.keys(byNum).map(Number))].filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
  // Every hole in the sequence, with the reason it is one. Checked 2026-08-06 with
  // `git log --all --diff-filter=A -- 'supabase/migrations/<n>_*'` — i.e. "was a file under this
  // number EVER committed on any branch". Three kinds of answer, and only the first is boring:
  const KNOWN_GAPS = {
    // ── never existed: nothing was ever committed under the number, it was simply skipped ──
    90: "never existed (the 001–150 sweep's F6)", 165: "never existed", 168: "never existed",
    169: "never existed", 170: "never existed", 171: "never existed", 216: "never existed",
    255: "never existed",
    // ── written, then deliberately withdrawn ──
    252: "252_daily_money_in_hand.sql existed and was REVERTED on purpose — 'Revert today's "
       + "owner-reports work at the owner's request' (PR #697). The number stays spent.",
    // ── written, then renumbered before merge (the process working as intended) ──
    275: "was 275_refusals_carry_a_code_not_a_sentence.sql on its branch; renumbered to 278 on merge",
    276: "was 276_private_paperwork_buckets.sql on its branch; renumbered to 279 on merge",
  };
  const gaps = [];
  for (let n = nums[0]; n < nums[nums.length - 1]; n++) if (!byNum[String(n).padStart(3, "0")]) gaps.push(n);
  const newGaps = gaps.filter((n) => !(n in KNOWN_GAPS));
  if (newGaps.length) {
    fail(`migration number(s) ${newGaps.join(", ")} are MISSING from the sequence — either a file was `
       + `lost before it was committed, or the number was skipped. Say which, in KNOWN_GAPS above.`);
  } else {
    pass(`no unexplained gaps in the sequence (${gaps.length} known: ${gaps.join(", ") || "none"})`);
  }

  // THE COLLISION THAT ACTUALLY BITES (sweep F13). The 18 historical pairs are harmless — checked
  // object-by-object, they touch nothing in common. What is NOT harmless is a parked branch
  // holding a DIFFERENT file under a number main already uses: merging it later gives two
  // unrelated migrations one number, and the applier tie-breaks on the FILENAME, not on intent.
  // On 2026-08-04 a worktree held `254_where_the_money_came_from.sql` while main's 254 was
  // `254_no_table_ends_itself.sql`. Catch it now, while renumbering is a rename.
  // Find the MAIN checkout, not this one: run from a worktree, `root/.claude/worktrees` does not
  // exist and the check would silently pass — the exact quiet-skip that let F4's two cron jobs go
  // missing for months. `git rev-parse --git-common-dir` points at the main repo's .git from
  // anywhere, so the check works wherever it is run from, and SAYS SO if it truly cannot look.
  let wtRoot = join(root, ".claude", "worktrees");
  try {
    const common = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim();
    const mainRoot = dirname(common.startsWith("/") ? common : join(root, common));
    wtRoot = join(mainRoot, ".claude", "worktrees");
  } catch { /* not a git checkout — fall back to the relative guess */ }
  let checkedAny = false;
  const clashes = [];
  try {
    for (const wt of readdirSync(wtRoot)) {
      let names;
      try { names = readdirSync(join(wtRoot, wt, "supabase", "migrations")).filter((f) => f.endsWith(".sql")); }
      catch { continue; }
      checkedAny = true;
      for (const f of names) {
        const n = f.slice(0, 3);
        const here = byNum[n];
        if (here && !here.includes(f)) clashes.push(`${wt}/${f} vs main's ${here.join(" + ")}`);
      }
    }
  } catch { /* no worktrees dir — nothing to check */ }
  if (clashes.length) {
    // A NOTICE, not a failure — deliberately. The colliding file belongs to ANOTHER branch, so
    // this checkout cannot fix it, and a guard that goes red for work you don't own is a guard
    // people learn to ignore. It is printed loudly every run so whoever merges that branch sees
    // it while renumbering is still just a rename.
    console.log("  ⚠ a parked worktree holds a migration numbered the same as a DIFFERENT one here:");
    for (const c of clashes) console.log("      " + c);
    console.log("      Renumber it in that worktree BEFORE it is merged — afterwards the two apply");
    console.log("      in filename order, not intent order. (Notice only: it is not this branch's file.)");
  } else if (checkedAny) {
    pass("no parked worktree holds a migration number that would collide on merge");
  }

  // A migration that swallows its own failure is how the two cron jobs went missing for months.
  const swallowers = [];
  for (const f of files) {
    const t = readFileSync(join(root, "supabase", "migrations", f), "utf8");
    // Only flag the pattern that actually bit us: scheduling/DDL inside a block that discards
    // the error. A DO block that catches around pure bookkeeping (a log insert) is fine.
    const blocks = t.match(/DO \$\$[\s\S]*?END\s*\$\$/g) || [];
    for (const b of blocks) {
      if (!/EXCEPTION\s+WHEN\s+OTHERS/i.test(b)) continue;
      if (/cron\.schedule|CREATE\s+EXTENSION/i.test(b)) swallowers.push(f);
    }
  }
  const KNOWN_SWALLOWERS = ["053_log_retention.sql", "060_realtime_prune_cron.sql", "099_auto_close_idle_sessions.sql"];
  const newSwallowers = [...new Set(swallowers)].filter((f) => !KNOWN_SWALLOWERS.includes(f));
  if (newSwallowers.length) {
    fail(`${newSwallowers.join(", ")} schedules a cron job (or creates an extension) inside `
       + `EXCEPTION WHEN OTHERS, so a failure is invisible. That is exactly how lfh-prune-logs and `
       + `lfh-rt-prune were missing for months. Schedule at top level so it fails loudly.`);
  } else {
    pass("no new migration hides a cron/extension failure behind EXCEPTION WHEN OTHERS");
  }

  // THE TWO MIGRATIONS THAT DAMAGE DATA ON A SECOND RUN (mig 307). seed-supabase.mjs step 1 runs
  // EVERY file in this folder, every time, with no ledger — so a one-time migration that rewrites
  // data is a loaded gun. 043 multiplies all money by 84 (measured: ₹36.6M -> ₹3.08bn on a second
  // run) and 093 replaces restaurant #1's 24 permission keys with 5. Both are now wrapped in a
  // `lfh_already_applied(...)` guard. Unwrapping either — or "tidying" the DO block away — puts
  // the gun back, silently, and nothing else in the repo would notice.
  {
    const GUARDED = {
      "043_inr_base_currency.sql": "043_inr_base_currency",
      "093_grandfather_r1_manager_powers.sql": "093_grandfather_r1_manager_powers",
    };
    const bad = [];
    for (const [file, key] of Object.entries(GUARDED)) {
      const f = files.find((x) => x === file);
      if (!f) { bad.push(`${file} is missing from the folder entirely`); continue; }
      const sql = readFileSync(join(root, "supabase", "migrations", f), "utf8");
      if (!sql.includes(`lfh_already_applied('${key}')`)) bad.push(`${file} no longer checks lfh_already_applied('${key}')`);
    }
    if (bad.length) {
      fail(`a one-time DATA migration lost its re-run guard: ${bad.join("; ")}. `
         + `seed-supabase.mjs re-runs every file in this folder, so without the guard a re-seed `
         + `multiplies every price and bill by 84 (043) or wipes 19 of restaurant #1's permission `
         + `keys (093). Restore the guard — see migration 307.`);
    } else {
      pass("the two one-time data migrations (043 ×84 money, 093 permission bag) still refuse to run twice");
    }
  }
}

// ── A FUNCTION A MIGRATION CREATED, THAT THE DATABASE DOES NOT HAVE ──────────────────────────
// THE BLIND SPOT THIS CLOSES. The T8 sweep of migrations 001–150 found `lfh_check_verification`
// ABSENT from the database. Migration 040 created it and granted it to anon — a guest asks for a
// code with one function and hands the code back with the other — and only the request half ever
// landed. Nothing in the repo could see it:
//   • verify:db-parity compares function BODIES between the two stacks, and BOTH were missing it,
//     so it stayed green;
//   • checkDb() above walks the functions that EXIST, so a function that isn't there has no row
//     to fail on.
// An absent function is invisible to a check that can only look at what is present. So look from
// the other direction: everything the migrations CREATE must still be in pg_proc, unless a
// migration also DROPs it (a deliberate retirement, e.g. mig 281 removing the bulk close-all).
//
// Name-level, not signature-level, ON PURPOSE. Signatures change constantly here (a scoping pass
// adds a trailing p_restaurant_id and re-grants), and matching on them would cry wolf on every
// one. What actually went wrong — and what this catches — is a whole NAME going missing.
//
// REPLAY IN ORDER, don't just collect two sets. The first cut of this check kept a `created` set
// and a `dropped` set and exempted any name in both — which silently exempted almost every
// interesting function, because the house pattern for changing a signature is DROP the old one and
// CREATE the new one. Proof it was useless: with that logic, deleting `lfh_price_order` from the
// database was NOT flagged. So a name is expected LIVE when its last CREATE comes after its last
// DROP, in apply order.
//
// ONLY the absent-but-expected direction is checked, and that is a deliberate limit. The mirror
// ("still live after a deliberate drop") cannot be done safely at name level: the other common
// house pattern is to CREATE the new signature and THEN drop an obsolete OVERLOAD of the same name
// (mig 080 does it to lfh_next_seq, mig 213 to lfh_owner_sales_report and
// lfh_owner_payment_breakdown). Name-level replay reads those as retirements and cries wolf on
// three healthy functions — measured, not guessed. Telling those apart needs real signature
// parsing, and a function that lingers is a far smaller problem than one that has vanished.
function expectedLiveFunctions() {
  const dir = join(root, "supabase", "migrations");
  const lastCreate = new Map(); // name → "<file>#<offset>" of its last CREATE
  const lastDrop = new Map();   // name → same, for its last DROP
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, f), "utf8");
    const key = (at) => `${f}#${String(at).padStart(8, "0")}`;
    for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-zA-Z0-9_]+)"?\s*\(/g))
      lastCreate.set(m[1].toLowerCase(), key(m.index));
    for (const m of sql.matchAll(/DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z0-9_]+)"?/g))
      lastDrop.set(m[1].toLowerCase(), key(m.index));
  }
  const out = new Map();
  for (const [n, madeAt] of lastCreate) {
    const goneAt = lastDrop.get(n);
    if (!goneAt || madeAt > goneAt) out.set(n, madeAt.split("#")[0]); // created, and not retired since
  }
  return out;
}

async function checkAbsentFunctions(label, env) {
  head(`${label} — every function the migrations still expect is actually there`);
  const expected = expectedLiveFunctions();
  const live = new Set(
    (await q(env, `SELECT lower(p.proname) AS n FROM pg_proc p
                     JOIN pg_namespace ns ON ns.oid = p.pronamespace
                    WHERE ns.nspname = 'public'`)).map((r) => r.n)
  );
  const missing = [...expected.entries()].filter(([n]) => !live.has(n));
  for (const [n, f] of missing)
    fail(`${n}() — ${f} creates it and no later migration retires it, but it is NOT in the database. `
       + `Either that migration never applied, or something removed it by hand. If it is meant to be `
       + `gone, DROP it in a migration so the intent is written down where the next reader will see it.`);
  if (!missing.length) pass(`all ${expected.size} functions the migrations still expect are present`);
}

// ── run ──────────────────────────────────────────────────────────────────────────────────────
checkMigrations();
const dev = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
await checkDb("BACKUP / DEV database", dev);
await checkAbsentFunctions("BACKUP / DEV database", dev);

if (WITH_AV) {
  // READ-ONLY on AV live: SELECTs against the catalog only, never a write. The sweep found the
  // same drift is LIKELY there (parity only ever compared function bodies), and this answers it
  // without touching a row.
  try {
    const av = parseEnv(readFileSync("/Users/aevinite/Documents/Projects/backup_Menu/.env.AV.live", "utf8"));
    await checkDb("AV LIVE database (read-only)", av);
  } catch (e) {
    console.log("\n  – AV live keys not readable here; skipped (" + String(e.message).slice(0, 80) + ")");
  }
}

console.log(failed ? `\n✗ ${failed} check(s) failed\n` : "\n✓ every function, policy and scheduled job is what the migrations say it is\n");
process.exit(failed ? 1 : 0);
