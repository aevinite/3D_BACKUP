// verify-fixtures-clean.mjs — DID OUR OWN TESTS LEAVE A TABLE ON THE FLOOR?
//
// WHY THIS EXISTS (sweep #6 / T28, 2026-08-22). Every guard in this folder that drives a real order
// works on a throwaway table with a name no diner ever sits at — 288, ALGTEST, 9931, 9932, E2E-TAX,
// OWNCHK, T12-TEST. Those names are OFF-PLAN: they are not in the restaurant's 1..table_count, so they
// exist only because a test made them. And the manager's floor UNIONS off-plan table numbers onto the
// plan on purpose (verify:floor-offplan — a banquet or a special session must be visible). So a
// leftover from a test is not invisible litter. It is a table on the manager's screen.
//
// Measured on 2026-08-22, before this file existed: My Little French House's Tables floor showed
//
//     288 · 🪑4 · Preparing · ＋ Take order
//
// sitting after table 30 with a red unpaid ring, and the header read "1/31 OCCUPIED · 1 TO PAY" on a
// 30-table restaurant. Screenshotted at 1280x800 and at 360x780 dpr3. It had been there because
// verify-cancelled-tile-parity's teardown hard-DELETEd its rows and the database refuses that for
// anything carrying a KOT or a bill number (mig 036 / mig 190) — and nothing read the refusal. The
// same leftover then blocked that guard from ever running again: one open session per table is a
// unique index, so its next run died at the very first insert.
//
// One phantom table costs a manager a real tap and a moment of doubt about their own floor. And a
// guard that cannot start is a guard that has stopped protecting anything. This asks the one question
// that catches both: is any test table still carrying something live?
//
//   node scripts/verify-fixtures-clean.mjs            # ask
//   node scripts/verify-fixtures-clean.mjs --clean    # ask, then retire whatever is left, by id
//
// It reads and writes ONLY the dev/test database and only these table names on the test restaurant.
// It never touches a table a real guest could be sitting at.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { refuseUnlessDevTestDb } from "./sweep/devStacks.mjs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)).filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL, SRK = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB || !SRK) { console.error("missing supabase env — nothing was checked"); process.exit(2); }
refuseUnlessDevTestDb(SB);

const svc = createClient(SB, SRK, { auth: { persistSession: false } });
const RID = "00000000-0000-0000-0000-000000000001";   // My Little French House — the only one written to
const CLEAN = process.argv.includes("--clean");

// EVERY OFF-PLAN FIXTURE NAME THIS FOLDER USES, and the guard that owns each one. Off-plan means "no
// restaurant has a table called this", so a row here can only have come from a test — which is what
// makes the answer unambiguous with ten lanes running at once. On-plan numbers (9, 11, 21, 27 …) are
// deliberately NOT listed: another lane may legitimately have a party on one right now, and a guard
// that cries wolf about that is a guard people learn to skip.
const FIXTURES = [
  ["288", "verify-cancelled-tile-parity.mjs"],
  ["ALGTEST", "verify-allergy-isolation.mjs"],
  ["9931", "verify-realtime.mjs"],
  ["9932", "verify-tablet-parity.mjs"],
  ["E2E-TAX", "verify-tax-mode-e2e.mjs"],
  ["OWNCHK", "verify-table-ownership.mjs"],
  ["T12-TEST", "verify-cancel-loss.ts"],
  ["T12-P2", "verify-cancel-made.ts"],
  ["9990", "verify-two-parties.mjs"],
];
const names = FIXTURES.map(([n]) => n);
const owner = new Map(FIXTURES);

let bad = 0;
const say = (ok, line) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${line}`); if (!ok) bad++; };

console.log("\nDID OUR OWN TESTS LEAVE A TABLE ON THE FLOOR?\n");

// A "live" order is one the floor would draw: not archived, not cancelled, not soft-deleted. Exactly
// the filter lfh_table_view_summary uses, so this cannot disagree with what a manager sees.
const orders = await svc.from("orders")
  .select("id, table_number, status, payment_status")
  .eq("restaurant_id", RID).in("table_number", names)
  .eq("archived", false).neq("status", "cancelled").is("deleted_at", null).limit(200);
if (orders.error) { console.error("could not read the test tables: " + orders.error.message); process.exit(2); }

const sessions = await svc.from("sessions")
  .select("id, table_number, bill_no")
  .eq("restaurant_id", RID).in("table_number", names)
  .eq("status", "open").limit(200);
if (sessions.error) { console.error("could not read the test sessions: " + sessions.error.message); process.exit(2); }

const byTable = {};
for (const o of orders.data || []) (byTable[o.table_number] ||= { orders: [], sessions: [] }).orders.push(o);
for (const s of sessions.data || []) (byTable[s.table_number] ||= { orders: [], sessions: [] }).sessions.push(s);

for (const t of names) {
  const hit = byTable[t];
  if (!hit) { say(true, `table "${t}" is clear`); continue; }
  const bits = [];
  if (hit.orders.length) bits.push(`${hit.orders.length} live order(s) [${hit.orders.map((o) => o.status).join(", ")}]`);
  if (hit.sessions.length) bits.push(`${hit.sessions.length} OPEN session(s)`);
  say(false, `table "${t}" still carries ${bits.join(" and ")} — left by ${owner.get(t)}. `
    + (hit.orders.length ? "A manager sees it as a table that does not exist. " : "")
    + (hit.sessions.length ? "The guard that owns it cannot start again: one open session per table is a unique index. " : ""));
}

// ── --clean: retire what is left, the way the product does ───────────────────────────────────────
// NEVER a hard delete. An order carrying a KOT number and a session carrying a bill number are both
// refused by trg_block_issued_delete (mig 190) — that refusal is the whole reason the litter built up.
// Cancel + archive, close + soft-delete: the same two writes a real cancellation makes, by id.
if (CLEAN && bad) {
  console.log("\n  · retiring what is left, by id:");
  const now = new Date().toISOString();
  for (const o of orders.data || []) {
    const r = await svc.from("orders").update({ status: "cancelled", archived: true, archived_at: now, cancelled_at: now })
      .eq("restaurant_id", RID).eq("id", o.id);
    console.log(`    order ${o.id} on "${o.table_number}" → ${r.error ? "REFUSED: " + r.error.message : "retired"}`);
  }
  for (const s of sessions.data || []) {
    const r = await svc.from("sessions").update({ status: "closed", closed_at: now, deleted_at: now })
      .eq("restaurant_id", RID).eq("id", s.id);
    console.log(`    session ${s.id} on "${s.table_number}" → ${r.error ? "REFUSED: " + r.error.message : "closed"}`);
  }
  // Say whether it actually worked, rather than assuming — that assumption is the original fault.
  const again = await svc.from("orders").select("id").eq("restaurant_id", RID).in("table_number", names)
    .eq("archived", false).neq("status", "cancelled").is("deleted_at", null).limit(50);
  const stillOpen = await svc.from("sessions").select("id").eq("restaurant_id", RID).in("table_number", names)
    .eq("status", "open").limit(50);
  const left = (again.data || []).length + (stillOpen.data || []).length;
  console.log(left ? `\n❌ ${left} row(s) would not go — read the refusals above` : "\n✅ every test table is clear again");
  process.exit(left ? 1 : 0);
}

console.log(bad
  ? `\n❌ ${bad} test table(s) are still carrying something. Run with --clean to retire them, then fix the guard that owns each one:\n`
    + "   a teardown must CANCEL + ARCHIVE the order and CLOSE + soft-delete the session (mig 190 refuses a hard delete),\n"
    + "   and it must read its own .error — an unread refusal is how a phantom table reaches a manager's floor.\n"
  : `\n✅ all ${names.length} throwaway tables are clear — no test has left a table on anybody's floor.\n`);
process.exit(bad ? 1 : 0);
