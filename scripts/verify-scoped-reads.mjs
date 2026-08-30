#!/usr/bin/env node
// verify:scoped-reads — a shared library never reads or writes a restaurant's row without saying
// WHICH restaurant.
//
// ── WHY THIS EXISTS (T25 round 2, sweep #7, 2026-08-31) ──────────────────────────────────────────
//
// The architecture rule is one line long and older than most of this codebase: every tenant row
// carries `restaurant_id`, and every query is scoped by it. The database's own row-level rules are
// the backstop — but `lib/supabaseAdmin.ts` is the service-role client, which is exempt from them by
// design, so inside `lib/` the WHERE clause is the only scope there is.
//
// Two things this sweep found, both in shared helpers that every panel calls:
//
//  · `lib/tableOfAction.ts` answered "which table is this action about?" by reading a session, an
//    order, an order item, a waiter call, a request or a session member BY ID ALONE. Both callers had
//    the restaurant to hand and neither passed it: the tablet dispatcher, which uses the answer to
//    decide whether a waiter may write to that table, and `lib/clash.ts`, which uses it to decide
//    whether a different party is sitting there now. MEASURED after the fix, on French House's own
//    rows: its own restaurant → `{"tables":["12"],"unknown":false}`; a restaurant id nobody owns →
//    `{"tables":[],"unknown":true}`.
//
//  · `lib/sessionClose.ts` ran its ownership check as `if (ctx.restaurantId)` — with the field marked
//    optional and a note saying *"kept optional so an unscoped caller still works"*. All eight
//    callers pass it, so nothing was wrong on the floor; what was wrong is that eight writes keyed on
//    `session_id` alone depended on every future caller remembering. Required now, and refused when
//    absent.
//
// Neither was a live fault. Both were the same shape: the rule was kept in 100 statements and left
// out of the last few, and being right depended on a caller's memory. That is what a guard is for.
//
// ── WHAT IT CHECKS ───────────────────────────────────────────────────────────────────────────────
//
// Every `.from("<tenant table>")` statement in `lib/` must mention `restaurant_id`. A statement is
// the whole fluent chain, taken by bracket-matching, so a wrapped `.eq()` three lines down counts.
//
// Exemptions are NAMED, one line each, with the reason — and each one is re-checked, so a stale
// allowance cannot quietly become a hole (this repo has had two of those).
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Tables that carry `restaurant_id`. Confirmed against the live dev schema on 2026-08-31 by reading
// one row of each and looking at its columns — not from memory, and not from the migrations, which
// add the column in a dozen different places.
const TENANT_TABLES = [
  "orders", "order_items", "sessions", "session_members", "waiter_calls", "requests", "settings",
  "menu_items", "categories", "filters", "customers", "customer_visits", "customer_devices",
  "khata_customers", "khata_entries", "print_jobs", "print_agents", "table_merges", "table_tags",
  "staff_users", "aggregator_orders", "inventory_items", "stock_moves", "issues", "blocklist",
  "otp_codes", "ratings", "reviews", "staff_actions", "banquet_bookings", "expenses",
];

// EXEMPT, with the reason. Keyed by file, then by a distinctive fragment of the statement — never by
// line number, which moves. `why` is printed when the exemption is used, so it is read.
const EXEMPT = {
  "lib/userAuth.ts": [
    ['.eq("username", uname)', "a login is looked up by username BEFORE anyone knows which restaurant the person belongs to — the row itself carries the answer"],
    ['.eq("id", u.id)', "the row was already found by the scoped read above; this updates it by its own primary key"],
    ['.eq("id", id).eq("active", true)', "a staff row fetched by its own primary key, for a session that already named it"],
    ["failed_count: 0", "clears the lock on the row the login just matched, by its own id"],
  ],
  "lib/ownerHome.ts": [
    ['.eq("username", key)', "same as userAuth: an owner's login is found by username before their restaurant is known"],
  ],
  "lib/viewAsPerson.ts": [
    ['.eq("id", id).eq("active", true)', "the ?as= pin names one staff row by its primary key; the caller checks the restaurant afterwards"],
  ],
  "lib/alerts.ts": [
    ['.eq("action", "alert_sent")', "the alert de-duplication key is platform-wide on purpose: one alert per key, whichever restaurant raised it"],
  ],
  "lib/publicCap.ts": [
    ['.eq("device_id", capKey)', "a per-DEVICE cap on a public endpoint — the device is the subject, and it may have no restaurant yet"],
  ],
  "lib/printHelpers.ts": [
    ['.eq("token_hash", hashAgentToken(t))', "a helper's token is globally unique and IS the thing that identifies its restaurant — the row read here is what supplies the rid"],
    ['.eq("id", agent.id)', "updates the agent row that the scoped read above returned, by its own primary key"],
  ],
  "lib/printPair.ts": [
    ['.eq("id", made.id)', "updates the row this function itself just created, by its own primary key"],
  ],
  "lib/removalAudit.ts": [
    ['.eq("id", Stri', "reads the bill numbers of the session the caller is already acting on, to write them into the audit row"],
  ],
  "lib/sessionClose.ts": [
    ['.eq("session_id", sessionId)', "the session is proved to belong to ctx.restaurantId at the top of closeSession() — required, not optional, since 2026-08-31"],
    ['.eq("id", sessionId)', "same: the ownership check has already run for this session id"],
  ],
};

const files = readdirSync(join(ROOT, "lib")).filter((f) => /\.tsx?$/.test(f)).map((f) => `lib/${f}`);

/** Whole fluent chains beginning at `.from(`, taken by bracket-matching (a wrapped `.eq()` counts). */
function statements(src) {
  const out = [];
  for (const m of src.matchAll(/(?:sb|supabaseAdmin|client|db|admin)\s*\.from\(/g)) {
    let j = m.index, depth = 0, inStr = null;
    for (; j < src.length; j++) {
      const c = src[j];
      if (inStr) { if (c === "\\") j++; else if (c === inStr) inStr = null; continue; }
      if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) { depth--; if (depth < 0) break; }
      else if (c === ";" && depth === 0) break;
    }
    out.push(src.slice(m.index, j));
  }
  return out;
}

const bad = [];
const usedExemptions = new Set();
let scoped = 0, total = 0;

for (const rel of files) {
  const raw = readFileSync(join(ROOT, rel), "utf8");
  // Line comments dropped so a statement QUOTED in a note is not counted. Never a block-comment
  // stripper: a `/*` inside a regex literal pairs with a `*/` thousands of characters later and eats
  // the file (measured at 42 KB on one route in this repo).
  const code = raw.split("\n").filter((l) => !/^\s*(\/\/|\*\s|\*\/|\/\*|\*$)/.test(l)).join("\n");
  for (const st of statements(code)) {
    const table = (st.match(/\.from\(\s*["'`](\w+)["'`]/) || [])[1] || "";
    if (!TENANT_TABLES.includes(table)) continue;
    total++;
    if (/restaurant_id/.test(st)) { scoped++; continue; }
    const allowed = (EXEMPT[rel] || []).find(([frag]) => st.includes(frag));
    if (allowed) { usedExemptions.add(`${rel} :: ${allowed[0]}`); continue; }
    bad.push(`${rel} · ${table} · ${st.replace(/\s+/g, " ").slice(0, 120)}…`);
  }
}

// ── AND EVERY READ HAS A CEILING (T25 round 2, item 31, 2026-08-31) ──────────────────────────────
//
// The other half of the same rule, and the reason it matters: **a select with no `.limit()` is
// silently capped at 1,000 rows by PostgREST** — no error, no warning, just a shorter answer. Eleven
// reads in lib/ had no ceiling of any kind. None of them reaches a thousand rows today, which is
// exactly why nobody would have noticed the day one did: the orders on a table being printed, the
// blockers that stop a table being closed, the item lines on a kitchen slip.
//
// A read is bounded when its own STATEMENT carries `.limit()`, `.range()`, `.maybeSingle()`,
// `.single()` or `head: true` — the statement being the whole thing up to the `;`, taken by
// bracket-matching so a wrapped, multi-line chain counts. When the read is built up in a variable
// (`let q = sb.from(...)`, bounded three lines later at `await q.order(...).limit(1)`), the check
// follows that variable to its first `await`.
//
// ⚠️ THE FIRST CUT OF THIS CHECK USED A 15-LINE WINDOW AND WAS TOOTHLESS: deleting a real
// `.limit(500)` from lib/sessionClose.ts still passed, because the NEXT read's limit was inside the
// window. Judged by sabotage, not by reading — which is the only way that showed up.
// A BUILDER THAT IS ALWAYS PAGED BY ITS CONSUMER. Named, with the reason, and re-checked below like
// every other exemption in this file.
const CEILING_EXEMPT = {
  "lib/liveBoard.ts": [
    ["let q = sb.from(\"orders\").select(ORDER_COLS)", "baseOrders() is a FACTORY: every consumer wraps it in pageBoard((from, to) => …range(from, to)), which is the paging this rule asks for — asserted from the other side by verify:board-sig and verify:id-chunks"],
  ],
};
{
  let selects = 0;
  const unbounded = [];
  const usedCeilingExemptions = new Set();
  const BOUND = /\.limit\(|\.range\(|maybeSingle\(|\.single\(|head:\s*true|pageBoard|pageAll/;
  for (const rel of files) {
    const raw = readFileSync(join(ROOT, rel), "utf8");
    const code = raw.split("\n").filter((l) => !/^\s*(\/\/|\*\s|\*\/|\/\*|\*$)/.test(l)).join("\n");
    const lines = code.split("\n");
    for (const m of code.matchAll(/\.from\(\s*["'`](\w+)["'`]\s*\)\s*\.select\(/g)) {
      selects++;
      // The statement: from the start of this line to the first `;` at depth 0 (or a `,` that ends an
      // element inside an array/Promise.all — hence the depth test below allowing a comma at depth 1).
      const lineStart = code.lastIndexOf("\n", m.index) + 1;
      let j = m.index, depth = 0, inStr = null, stop = code.length;
      for (; j < code.length; j++) {
        const c = code[j];
        if (inStr) { if (c === "\\") j++; else if (c === inStr) inStr = null; continue; }
        if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
        if ("([{".includes(c)) depth++;
        else if (")]}".includes(c)) { depth--; if (depth < 0) { stop = j; break; } }
        else if ((c === ";" || c === ",") && depth === 0) { stop = j; break; }
      }
      let statement = code.slice(lineStart, stop);
      // Follow a builder variable to where it is awaited: `let q = sb.from(...)` … `await q.…limit(1)`
      const decl = (lines[code.slice(0, m.index).split("\n").length - 1].match(/(?:let|const)\s+(\w+)\s*=/) || [])[1];
      if (decl) {
        const rest = code.slice(stop, stop + 1200);
        const use = rest.match(new RegExp(`await\\s+${decl}[^;]*;`));
        if (use) statement += use[0];
        const reassign = rest.match(new RegExp(`${decl}\\s*=\\s*${decl}[^;]*;`, "g"));
        if (reassign) statement += reassign.join("");
      }
      if (BOUND.test(statement)) continue;
      const line = lines[code.slice(0, m.index).split("\n").length - 1].trim();
      const allowed = (CEILING_EXEMPT[rel] || []).find(([frag]) => line.includes(frag) || statement.includes(frag));
      if (allowed) { usedCeilingExemptions.add(`${rel} :: ${allowed[0]}`); continue; }
      unbounded.push(`${rel} · ${lines[code.slice(0, m.index).split("\n").length - 1].trim().slice(0, 100)}`);
    }
  }
  if (selects < 100) {
    bad.push(`the ceiling check found only ${selects} select(s) in lib/ — it should see over a hundred, so it checked nothing`);
  }
  for (const [rel, list] of Object.entries(CEILING_EXEMPT)) {
    for (const [frag, why] of list) {
      if (!usedCeilingExemptions.has(`${rel} :: ${frag}`)) {
        bad.push(`stale ceiling exemption: ${rel} no longer has an unbounded read matching \`${frag}\` (${why}). Delete it — an exemption nobody re-reads is how the next unbounded read gets in free.`);
      }
    }
  }
  for (const u of unbounded) {
    bad.push(`${u}\n         → this read has no ceiling. PostgREST silently caps an unbounded select at 1,000 rows, so the answer just comes back short. Add .limit(N) with N far past anything real (the bounds added on 2026-08-31 are 200 for staff/agents, 500 for one table's orders, 1,000 for an owner's estate).`);
  }
}

// A STALE EXEMPTION IS A HOLE. Every allowance must still match a statement, or it is describing code
// that no longer exists — and the next unscoped read in that file inherits the allowance silently.
for (const [rel, list] of Object.entries(EXEMPT)) {
  for (const [frag, why] of list) {
    if (!usedExemptions.has(`${rel} :: ${frag}`)) {
      bad.push(`stale exemption: ${rel} no longer contains an unscoped statement matching \`${frag}\` (${why}). Delete the exemption — leaving it there hands the allowance to the next unscoped read in that file.`);
    }
  }
}

// NOTHING TO CHECK IS A FAILURE, NOT A PASS. This walks a folder to find its subjects; rename the
// folder and every check passes because none ran. The floor sits well below today's real count.
if (total < 80) {
  console.log(`\n✗ verify:scoped-reads found only ${total} tenant-table statement(s) in lib/ — it should see over a hundred. Its walk found nothing, so nothing was checked.`);
  process.exit(1);
}

if (bad.length) {
  console.log(`\n✗ verify:scoped-reads — ${bad.length} problem(s) out of ${total} tenant-table statements in lib/:\n`);
  for (const b of bad) console.log("  · " + b);
  console.log(`
Inside lib/ the WHERE clause is the only scope there is: lib/supabaseAdmin.ts is the service-role
client and the database's row-level rules do not apply to it. Add \`.eq("restaurant_id", rid)\`, or —
if the lookup genuinely has to be platform-wide (a login by username, a globally unique token) — add
it to EXEMPT in this file WITH the reason, so the next person reads why instead of guessing.
`);
  process.exit(1);
}

console.log(`✓ verify:scoped-reads — ${scoped} of ${total} tenant-table statements in lib/ name their restaurant; the other ${total - scoped} are exempt for a written reason, and every exemption still matches real code`);
