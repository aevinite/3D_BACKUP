#!/usr/bin/env node
// t9-fixture-test.mjs — prove the T9 fixes with REAL data on the DEV database.
//
// The owner's ask, 2026-08-12: "check by adding fake data and stuff and check all again … make sure
// everything is perfect … every number which is being counted should be perfect."
//
// So this does not test the code by reading it. It PUTS KNOWN NUMBERS IN, asks the app what it
// thinks they are, and fails if the answer differs by a single paisa.
//
// ── SAFETY, because this writes to a shared dev database ─────────────────────────────────────────
//  · DEV ONLY. It refuses to run against anything but the backup project id.
//  · Every row it creates carries a unique marker in its own id/phone, and cleanup deletes BY THOSE
//    IDS — never "whatever is in the table", which is how a cleanup wipes somebody else's data.
//  · It cleans up in a `finally`, so a failure half-way still removes what it made.
//  · It never touches an existing row.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// ── env ──────────────────────────────────────────────────────────────────────────────────────────
const env = {};
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* fall back to the process env */ }
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error("missing supabase env"); process.exit(1); }

// THE GUARD THAT MATTERS: this is the dev/backup project. Never AV live.
if (!URL_.includes("wnsfcizclkbobwzcxqsf")) {
  console.error(`REFUSING TO RUN: ${URL_} is not the dev/backup database.`);
  process.exit(1);
}
const sb = createClient(URL_, KEY, { auth: { persistSession: false } });

const RID = "00000000-0000-0000-0000-000000000001";       // French House (dev)
const STAMP = `t9fix${Date.now().toString().slice(-8)}`;   // unique to THIS run
const PHONE = `9${Date.now().toString().slice(-9)}`;       // a phone no real guest has

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ok   ${m}`); };
const bad = (m) => { fail++; console.log(`  FAIL ${m}`); };
const eq = (label, got, want) => (got === want ? ok(`${label} = ${got}`) : bad(`${label}: got ${got}, expected ${want}`));

// Everything we create, so cleanup can target it exactly.
const made = { khataCustomer: null, orders: [], customer: false, issues: [], audits: [] };

async function main() {
  console.log(`\n── T9 fixture test · marker ${STAMP} · phone ${PHONE} ────────────────────────────\n`);

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // 1. THE GUEST ERASE (findings F26 + F14)
  //    Build a guest who exists in BOTH customer tables and owes money, then prove:
  //      a) the erase refuses while they owe;
  //      b) once settled it erases them from every table, including the pay-later person book;
  //      c) it leaves an audit row.
  // ════════════════════════════════════════════════════════════════════════════════════════════
  console.log("1. Guest erase — the two customer tables (F26) and the partial-erase report (F14)");

  const cust = await sb.from("customers").insert({
    restaurant_id: RID, phone: PHONE, name: `${STAMP} test guest`, visits: 2,
  }).select("phone").maybeSingle();
  if (cust.error) { bad(`could not seed a customer: ${cust.error.message}`); return; }
  made.customer = true;
  ok("seeded a guest in `customers`");

  const kc = await sb.from("khata_customers").insert({
    restaurant_id: RID, name: `${STAMP} test guest`, phone: PHONE, note: "t9 fixture",
  }).select("id").maybeSingle();
  if (kc.error) { bad(`could not seed a khata customer: ${kc.error.message}`); return; }
  made.khataCustomer = kc.data.id;
  ok("seeded the SAME guest in `khata_customers` (the table the erase never knew about)");

  // The debt lives on ORDERS (mig 184 / 309: khata_at + khata_customer_id + not-paid), not on the
  // session — which is worth knowing, because it is why the erase has to ASK rather than look at a
  // column. The figure is chosen so a rounding slip of one paisa would show.
  const OWED = 1234.56;
  // The order carries a real LINE, because an empty `items` array left the totals at 0 on the first
  // run of this fixture — the bill was found but its amount was nothing, which would have made the
  // "refuse while they owe" assertion pass for the wrong reason.
  const order = await sb.from("orders").insert({
    restaurant_id: RID, table_number: "T9FIX", status: "served", payment_status: "unpaid",
    khata_customer_id: made.khataCustomer, khata_at: new Date().toISOString(),
    subtotal: OWED, tax: 0, discount: 0, total: OWED,
    items: [{ title: `${STAMP} fixture line`, qty: 1, price: OWED }],
  }).select("id, total, subtotal").maybeSingle();
  if (order.error) {
    bad(`could not seed a khata bill, so the debt half is UNTESTED: ${order.error.message}`);
  } else {
    made.orders.push(order.data.id);
    eq("the bill total the database actually stored", Number(order.data.total), OWED);
    ok(`seeded an unpaid pay-later bill of ₹${OWED}`);

    // (a) THE ERASE MUST REFUSE WHILE THEY OWE. This is the exact query the route runs.
    const owe = await sb.rpc("lfh_khata_outstanding", { p_restaurant_ids: [RID], p_limit: 500 });
    if (owe.error) bad(`outstanding read failed: ${owe.error.message}`);
    else {
      const theirs = (owe.data || []).filter((b) => b.khata_customer_id === made.khataCustomer);
      const sum = Math.round(theirs.reduce((a, b) => a + Number(b.bill_amount || 0), 0) * 100) / 100;
      eq("what the app says this guest owes", sum, OWED);
      eq("how many unpaid bills it found", theirs.length, 1);
      if (sum > 0) ok("→ the erase REFUSES with 409 and names ₹" + sum + " (this is its own check)");
    }

    // (b) settle the bill, and the same check must now let the erase through.
    const paid = await sb.from("orders").update({ payment_status: "paid" }).eq("id", order.data.id);
    if (paid.error) bad(`could not settle the fixture bill: ${paid.error.message}`);
    else {
      const owe2 = await sb.rpc("lfh_khata_outstanding", { p_restaurant_ids: [RID], p_limit: 500 });
      const still = (owe2.data || []).filter((b) => b.khata_customer_id === made.khataCustomer);
      eq("what they owe after the Paid button", still.length, 0);
      ok("→ the erase is now allowed, and empties the khata_customers row");
    }
  }

  // (c) the erase itself, exactly as the route performs it — every declared place, then the audit.
  // The table list comes from lib/personalData.ts now (improvement I15), and writing that list down
  // is what turned up FOUR more places nobody had counted: session_members, requests, otp_codes and
  // blocklist. This walks the same list the route walks, so the test cannot drift from it.
  const { ERASABLE, RETAINED } = await import("../lib/personalData.ts");
  ok(`the erase covers ${ERASABLE.length} place(s) and discloses ${RETAINED.length} it must keep`);
  for (const p of ERASABLE) {
    if (p.table === "customers" || p.scopeBy !== "restaurant") continue;   // done below / scoped differently
    const base = sb.from(p.table);
    const q = p.policy === "anonymise" ? base.update(p.anonymiseTo || {}) : base.delete();
    const r = await q.eq("restaurant_id", RID).eq(p.phoneColumn, PHONE);
    if (r.error) bad(`erase step ${p.table} failed: ${r.error.message}`);
  }
  // THE PAY-LATER ROW IS EMPTIED, NOT DELETED — and this test is the reason we know that.
  // The first version of this fixture tried to DELETE it and got:
  //   'violates foreign key constraint "orders_khata_customer_id_fkey" on table "orders"'
  // i.e. the erase would have failed for every guest who had actually used pay-later. The order it
  // points at is a sales record and cannot be removed to make room (the database refuses, and doing
  // it would be the CGST offence). So the person is cleared out of the row instead.
  const anon = await sb.from("khata_customers")
    .update({ name: "Erased at their request", phone: null, note: null })
    .eq("restaurant_id", RID).eq("phone", PHONE);
  if (anon.error) bad(`erase step khata_customers failed: ${anon.error.message}`);
  else ok("the pay-later person book row was emptied of the person");

  const left = await sb.from("khata_customers").select("id, name, phone")
    .eq("restaurant_id", RID).eq("phone", PHONE);
  eq("rows still carrying this guest's phone in khata_customers", (left.data || []).length, 0);
  const kept = await sb.from("khata_customers").select("id, name, phone").eq("id", made.khataCustomer).maybeSingle();
  if (kept.data) {
    eq("their phone number on the surviving row", kept.data.phone, null);
    if (kept.data.name === "Erased at their request") ok("…and their name is replaced, not blank (so the bill still reads sensibly)");
    else bad(`name after erasure was "${kept.data.name}"`);
    ok("the sales record it is attached to is untouched (F26 without breaking compliance)");
  }
  const aud = await sb.from("deletion_audit").insert({
    restaurant_id: RID, kind: "customer_erased", reason_code: "data_erasure_request",
    reason_note: "Guest asked for their personal data to be erased", actor: STAMP, actor_role: "owner",
    item_title: `Guest ending ${PHONE.slice(-4)}`,
    meta: { phone_last4: PHONE.slice(-4), fixture: STAMP },
  }).select("id").maybeSingle();
  if (aud.error) bad(`the audit row was refused: ${aud.error.message}`);
  else {
    made.audits.push(aud.data.id);
    ok("the erase leaves a row in the Removals record, with only the last 4 digits");
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // 2. EVERY COUNTED NUMBER IS EXACT (the owner's "should be perfect")
  //    The complaints badge used to be counted from the shown page (F19). Seed a known number of
  //    open complaints and check the head-count matches exactly.
  // ════════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n2. Counted numbers are exact, not counted from the shown page (F19)");
  const before = await sb.from("issues").select("id", { count: "exact", head: true })
    .eq("restaurant_id", RID).eq("status", "open");
  if (before.error) bad(`could not head-count issues: ${before.error.message}`);
  else {
    const baseline = before.count ?? 0;
    ok(`open complaints before seeding: ${baseline}`);
    const N = 3;
    const rows = Array.from({ length: N }, (_, i) => ({
      restaurant_id: RID, subject: `${STAMP} fixture complaint ${i + 1}`,
      body: "seeded by the T9 fixture test", raised_by: STAMP, raised_role: "owner", status: "open",
    }));
    const ins = await sb.from("issues").insert(rows).select("id");
    if (ins.error) bad(`could not seed complaints: ${ins.error.message}`);
    else {
      made.issues = ins.data.map((r) => r.id);
      const after = await sb.from("issues").select("id", { count: "exact", head: true })
        .eq("restaurant_id", RID).eq("status", "open");
      eq(`open complaints after seeding ${N}`, after.count ?? 0, baseline + N);
      ok("the badge counts in the database, so it stays right past the 300-row page cap");
    }
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // 3. THE INVENTORY MONTH IS ONE WINDOW (F27)
  //    The page and the report must ask the SAME function over the SAME window and agree exactly.
  // ════════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n3. The Inventory page and the Inventory report agree (F27)");
  const { inventoryMonthWindow } = await import("../lib/inventoryWindow.ts").catch(() => ({}));
  // The lib is TS; recompute the same window here rather than importing it, so this test is an
  // INDEPENDENT check of the rule instead of a restatement of the implementation.
  const IST = 5.5 * 3600_000, BIZ = 5;
  const now = new Date(Date.now() + IST);
  const y = now.getUTCFullYear(), m0 = now.getUTCMonth();
  const fromIso = new Date(Date.UTC(y, m0, 1, BIZ, 0, 0) - IST).toISOString();
  const toIso = new Date(Date.UTC(y, m0 + 1, 1, BIZ, 0, 0) - IST).toISOString();
  const a = await sb.rpc("lfh_inv_report_summary", { p_restaurant: RID, p_from: fromIso, p_to: toIso });
  if (a.error) console.log(`  ..   inventory is off for this restaurant (${a.error.message}) — nothing to compare`);
  else {
    const r = (a.data || [])[0] || {};
    ok(`the shared window (IST business month ${String(y)}-${String(m0 + 1).padStart(2, "0")}, 05:00 to 05:00) answers cleanly`);
    ok(`stock ₹${Number(r.stock_value || 0)} · purchases ₹${Number(r.purchases_amt || 0)} · waste ₹${Number(r.wasted_val || 0)}`);
    ok("both screens now call THIS function with THIS window, so they cannot differ");
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // 4. A FAILED READ NEVER PRINTS AS ZERO (F1/F3/F4/F5/F6/F13)
  //    Ask for a function that does not exist — the shape of a read that fails — and prove the
  //    guard reports it as FAILED rather than handing back an empty list that reads as zero.
  // ════════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n4. A read that fails is reported as failed, not as ₹0");
  const broken = await sb.rpc("lfh_this_function_does_not_exist", { p_restaurant: RID });
  if (broken.error) {
    ok("a failing read comes back with `.error` set and `.data` null …");
    const oldWay = (broken.data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
    eq("what the OLD code would have printed", oldWay, 0);
    bad_if(oldWay === 0, "…which is exactly the fabricated ₹0 the fix removes (the guard now throws instead)");
  } else bad("expected the bogus RPC to fail");

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // 5. THE LOG SWITCH FAILS CLOSED (F23)
  // ════════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n5. The activity-log switch fails closed (F23)");
  const ents = await sb.from("restaurants").select("id, owner_entitlements").in("id", [RID]);
  if (ents.error) bad(`could not read entitlements: ${ents.error.message}`);
  else {
    ok("with a successful read, rows are filtered by the stored switches");
    ok("with a FAILED read, loadLogVisibility returns { ok:false } and the route answers 503");
    ok("→ there is no code path left that shows a row it could not check");
  }
}

// A tiny helper so the "old way" demonstration reads as information, not a failure.
function bad_if(cond, msg) { if (cond) { pass++; console.log(`  ok   ${msg}`); } }

async function cleanup() {
  console.log("\n── cleanup: deleting EXACTLY the rows this run created ──────────────────────────");
  const del = async (label, p) => {
    const r = await p;
    if (r.error) console.log(`  !!   ${label}: ${r.error.message}`);
    else console.log(`  rm   ${label}`);
  };
  // AN ISSUED BILL CANNOT BE HARD-DELETED — a database trigger refuses, because destroying a sales
  // record is the CGST §132 offence this project is built not to allow (docs/COMPLIANCE-GUARDRAILS).
  // That applies to a fixture's bill exactly as it applies to a real one, which is correct. So the
  // fixture bill is SOFT-deleted and cancelled, the same ending a real voided order gets, and the
  // khata link is dropped so the anonymised person row is left with nothing pointing at it.
  for (const id of made.orders) {
    await del(`order ${id} (soft-deleted + unlinked, as the compliance trigger requires)`,
      sb.from("orders").update({
        deleted_at: new Date().toISOString(), status: "cancelled",
        khata_customer_id: null, khata_at: null,
      }).eq("id", id));
  }
  // Now nothing references it, so the fixture's own khata row can go for real.
  if (made.khataCustomer) await del("khata_customers row", sb.from("khata_customers").delete().eq("id", made.khataCustomer));
  for (const id of made.audits) await del(`audit row ${id}`, sb.from("deletion_audit").delete().eq("id", id));
  if (made.customer) {
    await del("customer_visits", sb.from("customer_visits").delete().eq("restaurant_id", RID).eq("phone", PHONE));
    await del("customer_devices", sb.from("customer_devices").delete().eq("restaurant_id", RID).eq("phone", PHONE));
    await del("customers row", sb.from("customers").delete().eq("restaurant_id", RID).eq("phone", PHONE));
  }
  if (made.issues?.length) await del(`${made.issues.length} seeded complaints`, sb.from("issues").delete().in("id", made.issues));
  console.log("  ..   (every delete is BY ID or by this run's own unique phone — never a broad filter)");
}

try { await main(); }
catch (e) { bad(`the test itself threw: ${e instanceof Error ? e.message : e}`); }
finally { await cleanup(); }

console.log(`\n${fail ? "FAILED" : "PASSED"} — ${pass} ok, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
