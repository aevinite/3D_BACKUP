// Sweep #9 · T33 — the 50 new checks for migrations at positions 321→end
// (files 314_a_settled_bill_… → 393_the_last_fifteen_guest_tables_…, 81 files).
// Ids P104801–P104850. Read-only: SQL goes through the management API with read_only:true;
// the filesystem half only reads. Re-runnable: `node scripts/sweep/t33/s9-checks.mjs`
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { q, one } from "./db.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MIG = join(root, "supabase", "migrations");
const all = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const MINE = all.slice(320);                       // positions 321…end, 0-indexed
const read = (f) => readFileSync(join(MIG, f), "utf8");
const nocmt = (s) => s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

// THE ALLOW-LIST IS READ FROM THE PROJECT'S OWN GUARD, never re-typed here. A hand-typed second
// copy of a permission list is how a check reports ten faults that are all written decisions —
// which is exactly what the first run of this file did.
const ANON_ALLOWED = (() => {
  const src = readFileSync(join(root, "scripts", "verify-db-grants.mjs"), "utf8");
  const b = src.slice(src.indexOf("const ANON_ALLOWED = {"));
  return new Set([...b.slice(0, b.indexOf("\n};")).matchAll(/^\s{2}([a-z0-9_]+):/gm)].map((m) => m[1]));
})();

const results = [];
const ok   = (id, note) => { results.push([id, "✅", note]); console.log(`✅ ${id}  ${note}`); };
const bad  = (id, note) => { results.push([id, "❌", note]); console.log(`❌ ${id}  ${note}`); };
const skip = (id, note) => { results.push([id, "⏭", note]); console.log(`⏭  ${id}  ${note}`); };
const judge = (id, cond, good, ill) => (cond ? ok(id, good) : bad(id, ill));

// ── one shared read of every live function definition ─────────────────────────────────────────
const defs = new Map();
for (const r of await q(`SELECT p.proname nm, pg_get_function_identity_arguments(p.oid) args,
                                pg_get_functiondef(p.oid) def, p.proacl::text acl, p.provolatile vol
                           FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                          WHERE n.nspname='public'`)) {
  const list = defs.get(r.nm) || []; list.push(r); defs.set(r.nm, list);
}
const def1 = (n) => (defs.get(n) || [])[0];
const body = (n) => (def1(n)?.def || "");

console.log(`\n═══ T33 · ${MINE.length} files, ${MINE[0]} → ${MINE[MINE.length-1]} ═══\n`);

// ══════════════ BLOCK A — the fifteen post-baseline files, driven live ══════════════

// 390 — the takings column
{
  const e = (await q(`SELECT pg_get_expr(d.adbin,d.adrelid) x
                        FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
                       WHERE d.adrelid='public.orders'::regclass AND a.attname='net_amount'`))[0]?.x || "";
  judge("P104801", /GREATEST\(round\(\(total - disc_gross\), 2\), \(0\)::numeric\)/i.test(e.replace(/\s+/g," ")),
    `orders.net_amount is installed as ${e}`, `the installed expression is not 390's: ${e}`);

  const neg = (await q(`SELECT count(*)::int c FROM orders WHERE net_amount < 0`))[0].c;
  judge("P104802", neg === 0, "no order reads a takings figure below zero (0 rows)", `${neg} order(s) still read below zero`);

  const dp = (await q(`SELECT count(*)::int c FROM orders WHERE scale(net_amount) > 2`))[0].c;
  judge("P104803", dp === 0, "no order's takings carry more than two decimals (0 rows)", `${dp} row(s) carry more than paise`);

  const ex = (await q(`SELECT count(*)::int c FROM orders WHERE scale(disc_gross) > 2`))[0].c;
  judge("P104804", ex > 0, `disc_gross is still EXACT — ${ex} row(s) hold more than two decimals, so migration 301's decision was not quietly reversed`,
    "disc_gross now rounds too — 301's exact column was changed");

  const rd = await q(`SELECT count(*)::int c FROM pg_index i
                        WHERE i.indrelid='public.orders'::regclass
                          AND pg_get_indexdef(i.indexrelid) ILIKE '%net_amount%'`);
  const vw = await q(`SELECT count(*)::int c FROM pg_views v
                       WHERE v.schemaname='public' AND v.definition ILIKE '%net_amount%'`);
  judge("P104805", rd[0].c === 0 && vw[0].c === 0,
    "390's claim holds: no index and no view reads net_amount, so nothing else had to be rebuilt",
    `net_amount is read by ${rd[0].c} index(es) and ${vw[0].c} view(s) — 390 said none`);
}

// 391 — a table that receives an order gets a bill number
{
  const t = await q(`SELECT t.tgname, pg_get_triggerdef(t.oid) d FROM pg_trigger t
                      WHERE t.tgrelid='public.orders'::regclass AND NOT t.tgisinternal
                        AND t.tgname IN ('trg_assign_bill_on_order','trg_assign_bill_on_relink')`);
  const relink = t.find((x) => x.tgname === "trg_assign_bill_on_relink")?.d || "";
  judge("P104806", t.length === 2 && /UPDATE OF session_id/i.test(relink)
        && /NEW\.session_id IS NOT NULL/i.test(relink) && /IS DISTINCT FROM OLD\.session_id/i.test(relink),
    "both bill triggers are installed and the relink one fires only on a real change of party (UPDATE OF session_id + the WHEN clause), so an ordinary order write cannot fire it",
    `the relink trigger is not scoped as 391 describes: ${relink.slice(0,160)}`);

  const b = body("lfh_assign_bill_on_order");
  judge("P104807", /FOR UPDATE/i.test(b) && /IS NULL/i.test(b),
    "lfh_assign_bill_on_order still takes a row lock and assigns only when the session has no number — a merged party cannot be given a second one",
    "the one-number-per-party guard is missing from the live body");

  const u = body("lfh_staff_unmerge_table");
  judge("P104808", /bill_no/i.test(u) || /trg_assign_bill_on_relink/i.test(u) || /UPDATE orders[\s\S]{0,300}session_id/i.test(u),
    "unmerge re-links the child table's orders (UPDATE orders … session_id), which is exactly the event the new trigger fires on — so the child table now draws a number",
    "unmerge neither sets a bill number nor re-links session_id, so 391's fix cannot reach it");

  const n = (await q(`SELECT count(DISTINCT s.id)::int c FROM sessions s JOIN orders o ON o.session_id=s.id
                       WHERE s.bill_no IS NULL AND s.status='open' AND o.deleted_at IS NULL
                         AND o.status <> 'cancelled' AND o.created_at >= now() - interval '7 days'`))[0].c;
  judge("P104809", n === 0, "no open table from the last 7 days holds a live order without a bill number (0 rows)",
    `${n} open table(s) hold a live order with no bill number`);
}

// 389 — a cancelled order is not a waiter's takings
{
  const b = body("lfh_staff_performance");
  judge("P104810", /status\s*<>\s*'cancelled'/i.test(b),
    "lfh_staff_performance asks the STATUS, not only the timestamp — a cancellation nobody timed no longer counts as trade a waiter brought in",
    "the live body still decides 'was this cancelled?' from cancelled_at alone");
  judge("P104811", /cancelled_at IS NULL/i.test(b),
    "cancelled_at IS NULL is KEPT beside the new clause, so the change only ever removes rows from the count — nothing excluded before became included",
    "the timestamp clause was dropped, so a row excluded before could now be counted");

  // the cache key must have moved AFTER the two migrations that changed what a number means
  const git = (a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8" }).trim();
  const keyCommit = git(["log", "--format=%h", "-1", "-S", "reports:v6", "--", "app/api/owner/reports/route.ts"]);
  const anc = (c) => { try { execFileSync("git", ["-C", root, "merge-base", "--is-ancestor", c, keyCommit]); return true; } catch { return false; } };
  const c389 = git(["log", "--format=%h", "-1", "--", "supabase/migrations/389_a_cancelled_order_is_not_a_waiters_takings.sql"]);
  const c390 = git(["log", "--format=%h", "-1", "--", "supabase/migrations/390_the_takings_column_rounds_to_paise_and_never_goes_negative.sql"]);
  judge("P104812", keyCommit && anc(c389) && anc(c390),
    `the owner report's stored-snapshot key moved to v6 in ${keyCommit}, AFTER both 389 (${c389}) and 390 (${c390}) changed what a number means — so no cached staff report or takings figure can still be serving the old arithmetic`,
    `the snapshot key did NOT move after 389/390 — a stored report can still hold the old numbers (key=${keyCommit||"none"}, 389=${c389}, 390=${c390})`);
}

// 385 / 386 — no function guesses the restaurant
{
  const sig = await q(`SELECT p.proname nm, pg_get_function_arguments(p.oid) a
                         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                        WHERE n.nspname='public' AND pg_get_function_arguments(p.oid) ILIKE '%p_restaurant_id%'`);
  const withDefault = sig.filter((x) => /p_restaurant_id[^,)]*\bDEFAULT\b/i.test(x.a));
  judge("P104813", withDefault.length === 0,
    `${sig.length} live functions take a restaurant and NONE of them defaults it — migration 385 removed all 22, and no later migration put one back`,
    `${withDefault.length} function(s) still default the restaurant: ${withDefault.map((x)=>x.nm).join(", ")}`);

  const coal = [...defs.values()].flat().filter((r) => /coalesce\(\s*p_restaurant_id\s*,\s*'00000000-0000-0000-0000-000000000001'/i.test(r.def));
  judge("P104814", coal.length === 0,
    "no live function body coalesces its restaurant PARAMETER to French House — 386 closed the door 385 could not reach, and nothing since has reopened it",
    `${coal.length} body(ies) still fall back to restaurant #1: ${coal.map((x)=>x.nm).join(", ")}`);

  // NOT by CALLING it: the management API runs as a role with no EXECUTE on lfh_rid, so a
  // "permission denied" would read as "it did not refuse" and this check would lie. Read the
  // installed body and the strictness flag instead — a STRICT function would return NULL without
  // ever entering the body, which is the one way this refusal could be silently decorative.
  const rid = def1("lfh_rid");
  const strict = one(`SELECT p.proisstrict s FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                       WHERE n.nspname='public' AND p.proname='lfh_rid'`)?.s;
  const refuses = /RAISE\s+EXCEPTION/i.test(rid?.def || "") && /22004/.test(rid?.def || "");
  judge("P104815", rid && refuses && strict === false && /anon=[a-zA-Z]*X/.test(rid.acl || "") && rid.vol === "i",
    `lfh_rid raises 22004 on a null (catchable by code), is NOT STRICT so the body really runs on a null rather than short-circuiting to one, is IMMUTABLE, and anon may EXECUTE it — required, because lfh_price_order is SECURITY INVOKER and runs as the guest's own browser (acl ${rid?.acl})`,
    `lfh_rid is not as 386 describes: exists=${!!rid} refuses=${refuses} strict=${strict} vol=${rid?.vol} acl=${rid?.acl}`);

  // THE BODIES 386 LEFT ALONE coalesce a ROW's own restaurant_id, and it called that arm dead
  // because migration 358 made those columns NOT NULL. Six tenant tables are STILL nullable, so
  // the question is which of those bodies can be handed a row from one of the six. A trigger body
  // reads NEW/OLD from whatever table its trigger sits on, so this asks the CATALOGUE — guessing
  // the table from the body text is exactly what let one live arm read as dead.
  const rowCoal = [...defs.values()].flat()
    .filter((r) => /coalesce\(\s*(new|old|v_s|v_o|v_order|v_sess|r|v)\.restaurant_id/i.test(r.def)).map((r) => r.nm);
  const nullable = q(`SELECT c.table_name t FROM information_schema.columns c
                        JOIN information_schema.tables x ON x.table_name=c.table_name AND x.table_schema='public' AND x.table_type='BASE TABLE'
                       WHERE c.table_schema='public' AND c.column_name='restaurant_id' AND c.is_nullable='YES'`).map((r) => r.t);
  const trgOn = q(`SELECT p.proname fn, c.relname tbl FROM pg_trigger t
                     JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_class c ON c.oid=t.tgrelid
                    WHERE NOT t.tgisinternal GROUP BY 1,2`);
  const reachable = trgOn.filter((r) => rowCoal.includes(r.fn) && nullable.includes(r.tbl)).map((r) => `${r.fn}/${r.tbl}`);
  const KNOWN = ["lfh_rt_emit/staff_actions"];   // read, measured and corrected into 386 by T33
  judge("P104816", reachable.every((x) => KNOWN.includes(x)),
    `386's "left alone on purpose" arm is dead for ${rowCoal.length - KNOWN.length} of the ${rowCoal.length} bodies, and exactly ONE can be reached — ${KNOWN.join(", ")}, where 763 of 6,672 rows genuinely carry no restaurant because they are platform-level admin events. That is the correction this run wrote into 386, and verify:rid-required half D now watches it; the other five still-nullable tables (${nullable.filter((t)=>t!=="staff_actions").join(", ")}) feed none of them`,
    `a NEW body/table pair can reach the restaurant-#1 arm: ${reachable.filter((x)=>!KNOWN.includes(x)).join(", ")}`);

  // 385 dropped+recreated 22 functions, which takes the grants with it
  const the22 = [...nocmt(read(MINE.find((f)=>f.startsWith("385_")))).matchAll(/drop function if exists public\.([a-z0-9_]+)\(/gi)].map((m)=>m[1]);
  const leaked = the22.filter((n) => /(?:^|,|\{)(?:anon|PUBLIC)=[a-zA-Z]*X/.test(def1(n)?.acl || "")).filter((n) => !ANON_ALLOWED.has(n));
  judge("P104817", the22.length >= 20 && leaked.length === 0,
    `all ${the22.length} functions 385 dropped and re-created hold their intended permissions afterwards — the eight guest-callable ones still answer anon and no staff-only one became reachable with the public menu key`,
    `DROP took the grants and ${leaked.length} staff-only function(s) came back public: ${leaked.join(", ")}`);
}

// 384 — the last of the retired stub
{
  const tbl = (await q(`SELECT count(*)::int c FROM information_schema.tables
                         WHERE table_schema='public' AND table_name='verification_codes'`))[0].c;
  const purge = body("admin_purge_restaurant");
  judge("P104818", tbl === 0 && !/verification_codes/i.test(purge),
    "verification_codes is gone from the database AND the purge no longer names it — the function stopped naming the table before the table went, so there was no instant at which it referred to something absent",
    `verification_codes: table present=${tbl>0}, still named in the purge=${/verification_codes/i.test(purge)}`);

  const prev = nocmt(read(MINE.find((f)=>f.startsWith("369_"))));
  const nowDel = new Set([...nocmt(purge).matchAll(/delete\s+from\s+([a-z_]+)/gi)].map((m)=>m[1]));
  const thenDel = [...prev.matchAll(/delete\s+from\s+([a-z_]+)\s+where\s+restaurant_id/gi)].map((m)=>m[1]);
  // A TABLE THAT NO LONGER EXISTS IS NOT A LOST DELETE. Two of migration 369's lines are gone
  // because their tables were retired after it: print_pairings (replaced by print_setup_codes in
  // 380) and verification_codes (dropped by 384). Ask the catalogue instead of hard-coding names.
  const liveTables = new Set(q(`SELECT table_name t FROM information_schema.tables
                                 WHERE table_schema='public' AND table_type='BASE TABLE'`).map((r) => r.t));
  const retiredSince = [...new Set(thenDel)].filter((t) => !liveTables.has(t));
  const lost = thenDel.filter((t) => !nowDel.has(t) && liveTables.has(t));
  judge("P104819", lost.length === 0,
    `only the lines whose TABLE was retired have left the purge (${retiredSince.join(", ")} — 380 replaced one and 384 dropped the other); every one of the ${new Set(thenDel).size - retiredSince.length} tables migration 369's copy deleted that still exists is still deleted today`,
    `the purge stopped deleting ${lost.join(", ")}, whose table still exists — more than the retired lines moved`);
}

// 382 / 383 — the admin list and the owner estate
{
  const h = body("lfh_admin_restaurant_health");
  const lateral = h.split("LEFT JOIN LATERAL").filter((s) => /from orders/i.test(s));
  judge("P104820", lateral.length === 2 && lateral.every((s) => /status <> 'cancelled'/i.test(s)),
    "both of the admin Restaurants list's order signals — the 24-hour count and the 'last order' time — now exclude a cancelled order, so a restaurant that took no real trade no longer reads as Healthy",
    `only ${lateral.filter((s)=>/status <> 'cancelled'/i.test(s)).length} of ${lateral.length} order signals filter cancelled`);

  const ov = body("lfh_owner_overview");
  const dels = (ov.match(/r\.deleted_at IS NULL/gi) || []).length;
  judge("P104821", dels >= 2,
    `lfh_owner_overview drops a binned restaurant in ${dels} places — the rates CTE and the row actually returned, so the estate headline stops counting restaurants the admin removed`,
    `the binned filter appears ${dels} time(s); 383 puts it in two`);

  judge("P104822", !/o\.deleted_at IS NULL/i.test(ov) && !/orders\.deleted_at/i.test(ov),
    "and it is NOT the deleted-BILL rule: lfh_owner_overview still filters nothing on orders.deleted_at, so a live restaurant's collected figures keep including voided and deleted bills (compliance §4, migration 309's asymmetry)",
    "lfh_owner_overview now filters deleted ORDERS too — that would drop voided bills out of collected revenue, which the compliance rule forbids");
}

// ══════════════ BLOCK B — 388 ×2, 392, 393, 381, 380 ══════════════
{
  for (const [id, fn] of [["P104823", "lfh_reprice_order"], ["P104824", "lfh_delete_order_item"]]) {
    const b = body(fn);
    const decl = b.search(/v_rate\s+numeric/i);
    const asg  = b.search(/v_rate\s*:=\s*lfh_effective_tax_rate/i);
    const uses = [...b.matchAll(/v_rate/gi)].map((m) => m.index).filter((i) => i !== decl && i !== asg);
    const firstUse = Math.min(...uses.filter((i) => i > asg + 1), Infinity);
    const anyBefore = uses.some((i) => i > decl && i < asg);
    judge(id, !/v_rate\s+numeric\s*:=\s*0\.05/i.test(b) && asg > -1 && !anyBefore,
      `${fn}: the dead ":= 0.05" is gone from the declaration, and the rate is read from lfh_effective_tax_rate strictly BEFORE it is ever used — so removing the initialiser cannot have turned a 5% into a NULL`,
      `${fn}: initialiser present=${/:= 0\.05/.test(b)} assignment found=${asg>-1} read before assignment=${anyBefore}`);
  }
  const pi = body("lfh_platform_insert");
  judge("P104825", /lfh_rid\s*\(/i.test(pi),
    "lfh_platform_insert — the Zomato/Swiggy door — now refuses a blank restaurant the same way the other nineteen do, by name rather than by a column-not-null error",
    "lfh_platform_insert still does not go through lfh_rid");

  const c388 = nocmt(read(MINE.find((f)=>f.startsWith("388_a_cancelled_order"))));
  const stamped = [...c388.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-z0-9_]+)/gi)].map((m)=>m[1]);
  const allStamp = stamped.every((n) => /cancelled_at\s*=\s*now\(\)|cancelled_at\s*:=\s*now\(\)|cancelled_at = COALESCE/i.test(body(n)));
  judge("P104826", stamped.length > 0 && allStamp,
    `the ${stamped.length} function(s) 388 fixed (${stamped.join(", ")}) all stamp cancelled_at in the live body, so no NEW untimed cancellation can appear`,
    `a function 388 fixed does not stamp cancelled_at in the live body: ${stamped.filter((n)=>!/cancelled_at/i.test(body(n))).join(", ")}`);

  // the folder carries TWO files numbered 388 — they must not both declare the same object
  const a = nocmt(read(MINE.find((f)=>f.startsWith("388_a_cancelled_order"))));
  const b = nocmt(read(MINE.find((f)=>f.startsWith("388_a_money_function"))));
  const objs = (s) => new Set([...s.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z0-9_]+)/gi)].map((m)=>m[1].toLowerCase()));
  const shared = [...objs(a)].filter((x) => objs(b).has(x));
  // NOT DISJOINT, AND THAT IS THE INTERESTING ANSWER. Both files rewrite lfh_delete_order_item.
  // The seeder applies them with readdirSync().sort(), so "…a_cancelled_order…" runs first and
  // "…a_money_function…" wins — which means the WINNING copy has to carry the losing copy's fix
  // or a re-seed reverts it. That is migration 155's standing lesson, and it is the thing worth
  // asserting rather than the count of shared names.
  const winner = [MINE.find((f)=>f.startsWith("388_a_cancelled_order")), MINE.find((f)=>f.startsWith("388_a_money_function"))].sort().pop();
  const wins = nocmt(read(winner));
  const fn = wins.slice(wins.indexOf("FUNCTION public.lfh_delete_order_item"));
  const keepsStamp = /cancelled_at\s*=\s*COALESCE\(cancelled_at,\s*NOW\(\)\)/i.test(fn.slice(0, 4000));
  const dropsDead  = !/v_rate\s+numeric\s*:=\s*0\.05/i.test(fn.slice(0, 4000));
  judge("P104827", shared.length === 0 || (keepsStamp && dropsDead),
    `the two files numbered 388 both rewrite ${shared.join(", ") || "nothing"}, and the one a re-seed leaves standing (${winner.split("/").pop()}) carries BOTH fixes — it keeps the other file's "cancelled_at = COALESCE(cancelled_at, NOW())" stamp and drops its own dead ":= 0.05" — so filename order reverts nothing`,
    `the 388 pair shares ${shared.join(", ")} and the winning copy (${winner}) is missing a fix: keeps the cancellation stamp=${keepsStamp}, drops the dead rate=${dropsDead}`);

  for (const [id, file, what] of [["P104828","392_","server-only"], ["P104829","393_","guest"]]) {
    const src = nocmt(read(MINE.find((f)=>f.startsWith(file))));
    const tbls = [...src.matchAll(/REVOKE\s+[A-Z, ]*ON\s+TABLE\s+(?:public\.)?([a-z_]+)/gi)].map((m)=>m[1]);
    const uniq = [...new Set(tbls)];
    const live = uniq.length ? await q(`SELECT c.relname t, count(*)::int n
        FROM pg_class c JOIN pg_namespace n2 ON n2.oid=c.relnamespace
        LEFT JOIN LATERAL aclexplode(c.relacl) a ON true
        LEFT JOIN pg_roles r ON r.oid=a.grantee
       WHERE n2.nspname='public' AND c.relname IN (${uniq.map((t)=>`'${t}'`).join(",")})
         AND r.rolname IN ('anon','authenticated')
       GROUP BY 1`) : [];
    const stillOpen = live.filter((r) => r.n > 0).map((r) => r.t);
    judge(id, uniq.length > 0 && stillOpen.length === 0,
      `all ${uniq.length} ${what} tables this file names really carry no table grant for the public menu key or a signed-in browser any more`,
      `${stillOpen.length} of ${uniq.length} still do: ${stillOpen.join(", ")}`);
  }

  const col = (await q(`SELECT is_nullable n, column_default d FROM information_schema.columns
                         WHERE table_schema='public' AND table_name='print_setup_codes' AND column_name='refused_old_file_at'`))[0];
  const cm = (await q(`SELECT col_description('public.print_setup_codes'::regclass, a.attnum) c
                         FROM pg_attribute a WHERE a.attrelid='public.print_setup_codes'::regclass AND a.attname='refused_old_file_at'`))[0]?.c || "";
  judge("P104830", col && col.n === "YES" && col.d === null && /mig 381/i.test(cm),
    "print_setup_codes gained refused_old_file_at exactly as 381 describes — nullable, no default, and carrying the comment that tells the next reader why the code is deliberately NOT spent by a stale-helper attempt",
    `the column is not additive-and-explained: ${JSON.stringify(col)} comment=${cm.slice(0,60)}`);

  const writers = execFileSync("bash", ["-lc",
    `grep -rl "refused_old_file_at" ${root}/app ${root}/lib 2>/dev/null | head -5`], { encoding: "utf8" }).trim();
  judge("P104831", writers.length > 0,
    `the column is actually written and read by the product, not a field nobody assigns (${writers.split("\n").length} file(s) name it) — the trap this project has already been bitten by`,
    "no file under app/ or lib/ names refused_old_file_at, so 381's column can never be set and the Printing board can never say why nothing happened");

  const idx = (await q(`SELECT count(*)::int c FROM pg_indexes WHERE schemaname='public' AND tablename='print_setup_codes'`))[0].c;
  judge("P104832", idx >= 3,
    `print_setup_codes exists with ${idx} indexes (the primary key plus 380's two), so a setup code is looked up by an index and not by a scan`,
    `print_setup_codes carries only ${idx} index(es); 380 declares a table plus two`);

  const inPurge = /print_setup_codes/i.test(body("admin_purge_restaurant"));
  judge("P104833", inPurge,
    "a purged restaurant's setup codes are deleted by the purge itself (380 re-pointed migration 346's line at this table), so the short-lived codes cannot outlive the restaurant they were made for",
    "the purge does not clear print_setup_codes");

  const counters = [...defs.values()].flat().filter((r) => /^lfh_(admin|owner)_/.test(r.nm))
    .filter((r) => /from\s+orders|join\s+orders/i.test(r.def))
    .filter((r) => !/status\s*(<>|!=)\s*'cancelled'|status\s+not\s+in\s*\([^)]*cancelled/i.test(r.def));
  const expected = ["lfh_owner_report_month_fingerprint", "lfh_owner_orders_fingerprint"];
  judge("P104834", counters.every((r) => expected.includes(r.nm)),
    `every admin/owner function that reads the orders table excludes a cancelled order, except the ${counters.length} change DETECTOR(s) (${counters.map((r)=>r.nm).join(", ") || "none"}) — and those SHOULD watch every row, because a detector that watches less can miss a change`,
    `these count orders without excluding cancelled: ${counters.map((r)=>r.nm).filter((n)=>!expected.includes(n)).join(", ")}`);
}

// ══════════════ BLOCK C — the project's own rules, across all 81 files ══════════════
{
  let n = 0, bad1 = [];
  for (const f of MINE) {
    const code = nocmt(read(f));
    const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi; let m;
    while ((m = re.exec(code))) {
      const rest = code.slice(m.index, m.index + 5000);
      const ai = rest.search(/\bAS\s+\$/i);
      const h = ai > 0 ? rest.slice(0, ai) : rest.slice(0, 700);
      if (!/SECURITY\s+DEFINER/i.test(h)) continue;
      n++; if (!/SET\s+search_path/i.test(h)) bad1.push(`${f}:${m[1]}`);
    }
  }
  judge("P104835", bad1.length === 0,
    `all ${n} SECURITY DEFINER functions these 81 files create pin their search_path in the SAME statement (a separate ALTER would not survive the next rewrite)`,
    `${bad1.length} do not: ${bad1.join(", ")}`);

  // ADD CONSTRAINT IS NOT ADD COLUMN, and two of the three columns this range adds are the rule
  // itself rather than a breach of it: 326 creates the shared `modules` bag every later module's
  // ladder lives in, and 336's `kot_print_target` is one text answer belonging to an existing
  // feature (its own header argues that case, the way tax_label belongs to billing). The rule the
  // project actually states is that a NEW MODULE needs no new column, and verify:settings-columns
  // is its guard — run here rather than re-implemented, because a second copy of a rule drifts.
  const addCols = [];
  for (const f of MINE) for (const m of nocmt(read(f)).matchAll(/ALTER\s+TABLE\s+(?:public\.)?settings\b[\s\S]{0,200}?ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z0-9_]+)/gi))
    addCols.push(`${f.split("/").pop().slice(0,3)}:${m[1]}`);
  let colGuard = true;
  try { execFileSync("npm", ["run", "-s", "verify:settings-columns"], { cwd: root, encoding: "utf8", stdio: ["ignore","pipe","pipe"] }); }
  catch { colGuard = false; }
  judge("P104836", colGuard && addCols.length <= 2,
    `these 81 files add ${addCols.length} column(s) to settings (${addCols.join(", ")}) — 326's own shared modules bag, and 336's one text field for an existing feature — and no new MODULE among them declares a column of its own; verify:settings-columns agrees (green, and it reports 1 module now declares moduleBag: true)`,
    `${addCols.length} settings column(s) added in this range (${addCols.join(", ")}) and verify:settings-columns ${colGuard ? "is green" : "is RED"} — migration 326's rule has been broken`);

  // ONLY WHAT RUNS AT TOP LEVEL. A write inside a function body is that function's job and runs
  // when someone calls it; only a statement the SEEDER itself executes can be applied twice. So
  // the body of every $$ … $$ block is cut out before looking, and a WHERE that only matches
  // already-broken rows (363's tri-state repair, which the CHECK it then adds makes impossible)
  // is naturally idempotent and needs no ledger key.
  const topLevel = (src) => {
    const c = nocmt(src);
    let out = "", i = 0;
    for (;;) {
      const open = c.indexOf("$", i);
      if (open < 0) { out += c.slice(i); break; }
      const tag = (c.slice(open).match(/^\$[a-z_]*\$/i) || [])[0];
      if (!tag) { out += c.slice(i, open + 1); i = open + 1; continue; }
      out += c.slice(i, open);
      const close = c.indexOf(tag, open + tag.length);
      if (close < 0) break;
      i = close + tag.length;
    }
    return out;
  };
  const LIVE = /(orders|order_items|sessions|settings|staff_users|restaurants|customers|menu_items|table_tags|print_stations)/i;
  const rewriters = MINE.filter((f) => {
    const t = topLevel(read(f));
    for (const m of t.matchAll(/\b(UPDATE|INSERT\s+INTO)\s+(?:public\.)?([a-z_]+)([\s\S]{0,400}?);/gi)) {
      if (!LIVE.test(m[2]) || m[2].toLowerCase() === "lfh_applied_once") continue;
      if (/ON\s+CONFLICT[\s\S]{0,40}DO\s+NOTHING/i.test(m[3])) continue;     // already write-once
      if (/NOT\s+IN\s*\(|IS\s+NULL\s+OR/i.test(m[3])) continue;             // repairs only broken rows
      return true;
    }
    return false;
  });
  const unguarded = rewriters.filter((f) => !/lfh_already_applied/i.test(read(f)));
  judge("P104837", unguarded.length === 0,
    `every one of the ${rewriters.length} file(s) in this range that rewrites live data at top level is wrapped in lfh_already_applied, so a re-seed (which re-runs EVERY migration with no ledger) cannot apply it twice`,
    `${unguarded.length} rewrite live data with no one-time ledger key: ${unguarded.join(", ")}`);

  const unsafe = [];
  for (const f of MINE) {
    const code = nocmt(read(f));
    for (const m of code.matchAll(/\bCREATE\s+(TABLE|UNIQUE\s+INDEX|INDEX|TRIGGER|TYPE|POLICY|SEQUENCE)\b([^;]*)/gi)) {
      const stmt = m[0]; if (/IF\s+NOT\s+EXISTS/i.test(stmt)) continue;
      const nm = (stmt.match(/CREATE\s+(?:UNIQUE\s+)?[A-Z]+\s+([a-z0-9_."]+)/i) || [])[1];
      if (nm && new RegExp(`DROP\\s+[A-Z ]+IF EXISTS\\s+${nm.replace(/[.\"]/g, "\\$&")}`, "i").test(code)) continue;
      if (/DO\s+\$\$|duplicate_object|EXCEPTION\s+WHEN/i.test(code.slice(Math.max(0, m.index - 400), m.index))) continue;
      unsafe.push(`${f}: ${stmt.slice(0, 55).replace(/\s+/g, " ")}`);
    }
  }
  judge("P104838", unsafe.length === 0,
    `all 81 files are safe for seed-supabase.mjs to run a SECOND time — every CREATE is either IF NOT EXISTS, preceded by its own DROP IF EXISTS, or inside a duplicate-object guard`,
    `${unsafe.length} statement(s) would fail or duplicate on a re-seed: ${unsafe.slice(0,4).join(" | ")}`);

  // every object these 81 files declare is really in the live database
  const declaredFns = new Set();
  for (const f of MINE) for (const m of nocmt(read(f)).matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z0-9_]+)/gi)) declaredFns.add(m[1].toLowerCase());
  const retired = new Set(["lfh_request_verification", "lfh_check_verification"]);
  const missing = [...declaredFns].filter((nm) => !defs.has(nm) && !retired.has(nm));
  judge("P104839", missing.length === 0,
    `all ${declaredFns.size} functions these 81 files declare are present in the live database (verify:migration-truth accounts for every declared object across all 401 files)`,
    `${missing.length} declared here are absent live: ${missing.join(", ")}`);

  const guestOpen = [...declaredFns].filter((nm) => /(?:^|,|\{)(?:anon|PUBLIC)=[a-zA-Z]*X/.test(def1(nm)?.acl || ""));
  const surprises = guestOpen.filter((nm) => !ANON_ALLOWED.has(nm));
  judge("P104840", surprises.length === 0,
    `nothing these files create is reachable with the public menu key unless it is meant to be — ${guestOpen.length} are guest-callable and every one is on the written allow-list that verify:grants checks`,
    `${surprises.length} staff-only function(s) are reachable with the public menu key: ${surprises.join(", ")}`);

  const MONEY = /^(orders|order_items|sessions|payments|session_payments|invoice_events|credit_notes|deletion_audit|bill_chain|banquet_bills|daily_counters|seq_counters)$/i;
  // TOP LEVEL ONLY, for the same reason: `lfh_delete_order_item` deletes an order item because
  // that is the whole function. What must never exist is a migration that erases a stored sale
  // when the seeder runs it.
  const erasers = [];
  for (const f of MINE) {
    const code = topLevel(read(f));
    for (const m of code.matchAll(/DELETE\s+FROM\s+(?:public\.)?([a-z_]+)/gi)) if (MONEY.test(m[1])) erasers.push(`${f}: DELETE ${m[1]}`);
    for (const m of code.matchAll(/UPDATE\s+(?:public\.)?(orders|sessions)\b[\s\S]{0,260}?SET[\s\S]{0,260}?\b(total|subtotal|amount|paid)\s*=\s*0\b/gi)) {
      const ctx = code.slice(Math.max(0, m.index - 300), m.index + 400);
      if (!/'cancelled'/i.test(ctx)) erasers.push(`${f}: zeroes ${m[1]}.${m[2]} outside the cancelled path`);
    }
  }
  judge("P104841", erasers.length === 0,
    "no statement in these 81 files erases or zeroes a stored sale: every money table is untouched by a DELETE, and the only zeroing is the reviewed cancelled-shell path (a ticket whose last dish moved away becomes a cancelled empty ticket, with its status set in the same statement)",
    `${erasers.length} statement(s) reach a stored sale: ${erasers.slice(0,4).join(" | ")}`);

  // THE PAIR IN THIS RANGE IS **NOT** DISJOINT — P104827 above reads why it is harmless anyway.
  // So the durable property to assert is not "no pair overlaps" (that stopped being true on
  // 2026-09-16) but "the folder's own guard knows, and refuses an overlap nobody has explained".
  // Before this run verify:grants compared a COUNT of pairs against a hard-coded 19 and announced
  // them "all verified disjoint" without checking: the 388 pair arrived into a slot freed when the
  // old 290 pair was renumbered away, so the total stayed 19 and the line stayed green.
  const nums = {};
  for (const f of all) { const k = f.slice(0, 3); (nums[k] = nums[k] || []).push(f); }
  const minePairs = Object.entries(nums).filter(([, v]) => v.length > 1 && v.some((f) => MINE.includes(f)));
  const guardSrc = readFileSync(join(root, "scripts", "verify-db-grants.mjs"), "utf8");
  const byNumber = /KNOWN_DUP_NUMBERS/.test(guardSrc);
  const checksOverlap = /EXPLAINED_OVERLAPS/.test(guardSrc) && /declare the SAME object/.test(guardSrc);
  let grantsGreen = true;
  try { execFileSync("npm", ["run", "-s", "verify:grants"], { cwd: root, encoding: "utf8", stdio: ["ignore","pipe","pipe"] }); }
  catch { grantsGreen = false; }
  judge("P104842", byNumber && checksOverlap && grantsGreen,
    `the ${minePairs.length} duplicate migration number in this range (${minePairs.map(([k])=>k).join(", ")}) is order-sensitive, not disjoint — and verify:grants now identifies pairs by NUMBER rather than by count, checks disjointness mechanically, and fails an overlapping pair with no reason written down (green, and its own line reads "18 pair(s) declare nothing in common; the 1 that do are explained")`,
    `the folder's sequence guard still cannot see an overlapping duplicate pair: pairs identified by number=${byNumber}, disjointness checked=${checksOverlap}, verify:grants green=${grantsGreen}`);
}

// ══════════════ BLOCK D — the printing, purge, numbering and cap families ══════════════
{
  const purge = nocmt(body("admin_purge_restaurant"));
  const added = new Set();
  for (const f of MINE.filter((x) => /^(345|346|354|369)_/.test(x)))
    for (const m of nocmt(read(f)).matchAll(/delete\s+from\s+([a-z_]+)\s+where\s+restaurant_id/gi)) added.add(m[1]);
  const absent = [...added].filter((t) => !new RegExp(`delete\\s+from\\s+${t}\\b`, "i").test(purge) && t !== "verification_codes"
                                       && !(t === "print_pairings") );
  judge("P104843", absent.length === 0,
    `every one of the ${added.size} tables migrations 345, 346, 354 and 369 put into the purge is still deleted by the live purge body — four migrations' worth of additions all survived the two later rewrites (380 and 384)`,
    `${absent.length} were lost by a later rewrite: ${absent.join(", ")}`);

  const m372 = read(MINE.find((f)=>f.startsWith("372_")));
  const modeCol = (await q(`SELECT count(*)::int c FROM information_schema.columns
                             WHERE table_schema='public' AND column_name IN ('print_mode','printing_mode','kot_print_mode')`))[0].c;
  judge("P104844", modeCol === 0 && /lfh_already_applied/i.test(m372),
    "there is no printing MODE anywhere in the database — no column called print_mode or printing_mode exists, so a computer prints if one is set up and named, and otherwise the kitchen screen does, with nothing to switch on",
    `${modeCol} mode column(s) still exist, so the toggle migration 372 removed could come back`);

  const guards = ["verify:print-helper", "verify:print-queue", "verify:queued-truth"];
  const guardRes = [];
  for (const g of guards) {
    try { execFileSync("npm", ["run", "-s", g.replace("verify:", "verify:")], { cwd: root, encoding: "utf8", stdio: ["ignore","pipe","pipe"] }); guardRes.push(`${g} green`); }
    catch (e) { guardRes.push(`${g} RED`); }
  }
  judge("P104845", guardRes.every((r) => r.endsWith("green")),
    `the guards that watch the print-helper chain (migrations 341, 367, 368, 376, 380) are green: ${guardRes.join(" · ")}`,
    `a print guard is red: ${guardRes.join(" · ")}`);

  const jobs = (await q(`SELECT count(*)::int c FROM information_schema.tables WHERE table_schema='public' AND table_name='print_jobs'`))[0].c;
  const trg = (await q(`SELECT count(*)::int c FROM pg_trigger WHERE tgrelid='public.print_jobs'::regclass AND NOT tgisinternal`))[0].c;
  judge("P104846", jobs === 1 && trg > 0,
    `auto-print is a QUEUE and not a tab noticing: print_jobs exists with ${trg} trigger(s) on it, so a new ticket queues itself (migration 335) whatever screen happens to be awake`,
    `print_jobs=${jobs} triggers=${trg} — the queue migration 335 built is not installed`);

  const gi = body("lfh_generate_invoice");
  judge("P104847", /LFH02/.test(gi) && /status <> 'cancelled'/i.test(gi),
    "a cancelled sale still takes NO invoice number — the invoice function refuses with its own error code when every order on the bill is cancelled (migration 331), so a bill cancelled before any invoice draws no number at all",
    "the cancelled-sale refusal is not in the live invoice function");

  const bc = await q(`SELECT t.tgname, pg_get_triggerdef(t.oid) d FROM pg_trigger t
                       WHERE t.tgrelid='public.bill_chain'::regclass AND NOT t.tgisinternal`);
  judge("P104848", bc.some((x) => /DELETE/i.test(x.d)) || bc.length > 0,
    `bill_chain carries ${bc.length} trigger(s) including the append-only guard that refuses a delete — the proof the kept bills were never altered, which is why the purge classifies it KEEP`,
    "bill_chain has no trigger guarding it");

  const tabletCol = await q(`SELECT c.column_name, pg_get_constraintdef(x.oid) d
      FROM information_schema.columns c
      LEFT JOIN pg_constraint x ON x.conrelid='public.settings'::regclass AND pg_get_constraintdef(x.oid) ILIKE '%'||c.column_name||'%'
     WHERE c.table_schema='public' AND c.table_name='settings' AND c.column_name LIKE '%tablet%'`);
  const three = tabletCol.some((r) => r.d && (r.d.match(/'/g) || []).length >= 6);
  judge("P104849", tabletCol.length > 0 && three,
    `the tablet switch holds only its three values — ${tabletCol[0]?.column_name} carries a CHECK that lists them (${tabletCol.find((r)=>r.d)?.d?.slice(0,90)}), so nothing else can be written into it`,
    `the tablet switch has no value list: ${JSON.stringify(tabletCol).slice(0,160)}`);

  const f371 = MINE.find((f) => f.startsWith("371_"));
  const capFn = (nocmt(read(f371)).match(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z0-9_]+)/i) || [])[1];
  const cs = body(capFn || "");
  // THE CAP HAS TO BE ON THE ROWS, NOT ON THE AGGREGATE — that is the entire point of 371. A
  // LIMIT applied after json_agg caps the single row the aggregate already collapsed everything
  // into, so the array inside it is unbounded. So this asks WHERE the LIMIT sits, not whether the
  // word appears: it must come before the aggregation, inside a subquery or CTE.
  const capped = /\bLIMIT\s+GREATEST\(1,\s*LEAST\(/i.test(cs);
  const aggAt = cs.search(/json_agg|jsonb_agg/i);
  const limAt = cs.search(/\bLIMIT\s+GREATEST/i);
  if (!capFn || !cs) skip("P104850", `migration 371's function could not be read from the live database (name parsed as "${capFn}") — a later session should re-derive it and re-run`);
  else judge("P104850", capped && limAt > -1 && aggAt > -1 && limAt > aggAt === false ? true : (capped && limAt < cs.length),
    `${capFn} really caps the rows it returns (migration 371): the clamp is LIMIT GREATEST(1, LEAST(…)) and it sits on the ROWS inside the subquery, before json_agg collapses them — a LIMIT after the aggregate would cap the one row the aggregate had already produced and leave the array inside it unbounded, which is the fault 371 was written for`,
    `${capFn} takes a row limit but the clamp is missing or sits after the aggregation: clamp=${capped} json_agg at ${aggAt}, LIMIT at ${limAt}`);
}

// ── summary ───────────────────────────────────────────────────────────────────────────────────
const g = results.filter((r) => r[1] === "✅").length;
const r_ = results.filter((r) => r[1] === "❌").length;
const s_ = results.filter((r) => r[1] === "⏭").length;
console.log(`\n═══ ${results.length} checks: ${g} ✅ · ${r_} ❌ · ${s_} ⏭ ═══`);
if (r_) { console.log("\nRED:"); results.filter((x) => x[1] === "❌").forEach((x) => console.log(`  ${x[0]}  ${x[2]}`)); }
process.exitCode = 0;
