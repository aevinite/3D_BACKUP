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
//   node scripts/verify-fixtures-clean.mjs --age 0    # count anything, however fresh (run it alone)
//
// AGE IS THE WHOLE TRICK. "Is anything left?" has no answer while another guard is halfway through its
// own fixture — and this file sits in the middle of a suite that places them constantly, so it went red
// on a run where nothing was actually wrong. A LEFTOVER, by definition, outlives the run that made it.
// So only a fixture older than a few minutes counts. That removes the ordering sensitivity completely
// without weakening the check: a real leak is minutes or days old by the time anyone looks.
//
// It reads and writes ONLY the dev/test database and only these table names on the test restaurant.
// It never touches a table a real guest could be sitting at.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { refuseUnlessDevTestDb } from "./sweep/devStacks.mjs";
import { OFF_PLAN } from "./sweep/fixtureTables.mjs";

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
const AGE_MIN = (() => { const i = process.argv.indexOf("--age"); const v = i > -1 ? Number(process.argv[i + 1]) : NaN; return Number.isFinite(v) ? v : 6; })();
const CUTOFF = new Date(Date.now() - AGE_MIN * 60_000).toISOString();

// EVERY OFF-PLAN FIXTURE NAME THIS FOLDER USES, and the guard that owns each one. Off-plan means "no
// restaurant has a table called this", so a row here can only have come from a test — which is what
// makes the answer unambiguous with ten lanes running at once. On-plan numbers (9, 11, 21, 27 …) are
// deliberately NOT listed: another lane may legitimately have a party on one right now, and a guard
// that cries wolf about that is a guard people learn to skip.
const FIXTURES = OFF_PLAN;   // scripts/sweep/fixtureTables.mjs — one list, so a clash is visible
const names = FIXTURES.map(([n]) => n);
const owner = new Map(FIXTURES);

let bad = 0;
const say = (ok, line) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${line}`); if (!ok) bad++; };

console.log(`\nDID OUR OWN TESTS LEAVE A TABLE ON THE FLOOR?  (anything newer than ${AGE_MIN} min is somebody's run in progress)\n`);

// A "live" order is one the floor would draw: not archived, not cancelled, not soft-deleted. Exactly
// the filter lfh_table_view_summary uses, so this cannot disagree with what a manager sees.
const orders = await svc.from("orders")
  .select("id, table_number, status, payment_status, created_at")
  .eq("restaurant_id", RID).in("table_number", names)
  .eq("archived", false).neq("status", "cancelled").is("deleted_at", null)
  .lt("created_at", CUTOFF).limit(200);
if (orders.error) { console.error("could not read the test tables: " + orders.error.message); process.exit(2); }

const sessions = await svc.from("sessions")
  .select("id, table_number, bill_no, opened_at, created_at")
  .eq("restaurant_id", RID).in("table_number", names)
  .eq("status", "open").lt("created_at", CUTOFF).limit(200);
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

// ── AND THE KITCHEN TICKET IT QUEUED ────────────────────────────────────────────────────────────
// Every order queues one print job (mig 335). lib/printQueue.ts dismisses a job whose order is gone or
// cancelled — but only when SOMETHING READS THE QUEUE. On a stack with no kitchen screen and no print
// helper open, nothing does, so a test's ticket sits `queued` and the manager's floor carries a red
// "KOT #192 · T11) hasn't printed in the kitchen — is the kitchen screen open?" banner for food nobody
// ordered. Measured and screenshotted at 1280x800: five of them at once, from one sweep's fixtures.
// The product is behaving correctly; the litter is ours.
const jobs = await svc.from("print_jobs")
  .select("id, kind, order_id, created_at").eq("restaurant_id", RID).eq("status", "queued")
  .lt("created_at", CUTOFF).limit(200);
const stray = [];
if (!jobs.error && (jobs.data || []).length) {
  const ids = (jobs.data || []).map((j) => j.order_id).filter(Boolean);
  const owners = ids.length
    ? await svc.from("orders").select("id, table_number").eq("restaurant_id", RID).in("id", ids).in("table_number", names).limit(200)
    : { data: [] };
  const mine = new Set(((owners.data) || []).map((o) => o.id));
  for (const j of jobs.data) if (mine.has(j.order_id)) stray.push(j);
}
// AND A TICKET WHOSE ORDER IS ALREADY GONE, whatever table it was on. lib/printQueue.ts calls exactly
// this "dead" — a job whose order is deleted or cancelled — and dismisses it the moment anything reads
// the queue. So a queued ticket for an archived or cancelled order is dead by the product's own
// definition, and clearing it is only doing what the app would do itself. That makes it safe to include
// ON-PLAN tables too, which the list above deliberately leaves out: a ticket waiting for a printer that
// is about to come back has a LIVE order behind it and is never touched here.
const deadJobs = [];
if (!jobs.error && (jobs.data || []).length) {
  const ids = (jobs.data || []).map((j) => j.order_id).filter(Boolean);
  const live = ids.length
    ? await svc.from("orders").select("id").eq("restaurant_id", RID).in("id", ids)
        .eq("archived", false).neq("status", "cancelled").is("deleted_at", null).limit(200)
    : { data: [] };
  const alive = new Set(((live.data) || []).map((o) => o.id));
  for (const j of jobs.data) if (j.order_id && !alive.has(j.order_id) && !stray.includes(j)) deadJobs.push(j);
}
say(stray.length === 0, stray.length
  ? `${stray.length} kitchen ticket(s) from a test table are still queued — the manager's floor keeps a red "hasn't printed" banner for each: ${stray.map((j) => j.kind).join(", ")}`
  : "no test ticket is left queued in the print basket");
// A NOTE, NOT A FAILURE. A queued ticket whose order is already gone is dead by the app's own
// definition, and lib/printQueue dismisses it the instant anything reads the queue — which in a real
// restaurant is constant, because a kitchen screen is open. So this is a DEV-STACK housekeeping item,
// not a fault: worth clearing (it puts a red banner on the floor here), never worth failing a run for.
// A LIVE order on a test table is different, and stays a failure: that is a phantom tile, and it stops
// the guard that owns the table from starting at all.
if (deadJobs.length) console.log(`  note  ${deadJobs.length} queued ticket(s) belong to an order that is already cancelled or archived — dead by the app's own definition. --clean takes them off the floor; nothing here is broken.`);
else console.log("  ok    no queued ticket is waiting on an order that no longer exists");

// ── --clean: retire what is left, the way the product does ───────────────────────────────────────
// NEVER a hard delete. An order carrying a KOT number and a session carrying a bill number are both
// refused by trg_block_issued_delete (mig 190) — that refusal is the whole reason the litter built up.
// Cancel + archive, close + soft-delete: the same two writes a real cancellation makes, by id.
if (CLEAN && (bad || deadJobs.length)) {
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
  for (const j of [...stray, ...deadJobs]) {
    // The SAME sentence lib/printQueue.ts writes, so the row reads exactly like one the app retired.
    const r = await svc.from("print_jobs")
      .update({ status: "dismissed", done_at: now, error: "the order was cancelled before this ticket printed" })
      .eq("restaurant_id", RID).eq("id", j.id);
    console.log(`    ${j.kind} ticket ${j.id} → ${r.error ? "REFUSED: " + r.error.message : "dismissed"}`);
  }
  // Say whether it actually worked, rather than assuming — that assumption is the original fault.
  const again = await svc.from("orders").select("id").eq("restaurant_id", RID).in("table_number", names)
    .eq("archived", false).neq("status", "cancelled").is("deleted_at", null).limit(50);
  const stillOpen = await svc.from("sessions").select("id").eq("restaurant_id", RID).in("table_number", names)
    .eq("status", "open").limit(50);
  const stillQueued = await svc.from("print_jobs").select("id").eq("restaurant_id", RID).eq("status", "queued")
    .in("id", [...stray, ...deadJobs].length ? [...stray, ...deadJobs].map((j) => j.id) : ["00000000-0000-0000-0000-000000000000"]).limit(50);
  const left = (again.data || []).length + (stillOpen.data || []).length + ((stillQueued.data) || []).length;
  console.log(left ? `\n❌ ${left} row(s) would not go — read the refusals above` : "\n✅ every test table is clear again");
  process.exit(left ? 1 : 0);
}

console.log(bad
  ? `\n❌ ${bad} test table(s) are still carrying something. Run with --clean to retire them, then fix the guard that owns each one:\n`
    + "   a teardown must CANCEL + ARCHIVE the order and CLOSE + soft-delete the session (mig 190 refuses a hard delete),\n"
    + "   and it must read its own .error — an unread refusal is how a phantom table reaches a manager's floor.\n"
  : `\n✅ all ${names.length} throwaway tables are clear, and no test ticket is stuck in the print basket — no test has left anything on anybody's floor.\n`);
process.exit(bad ? 1 : 0);
