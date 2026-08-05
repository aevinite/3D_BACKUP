// verify-customer-erase.mjs — "does erasing a guest ever erase a SALE?"
//
//   node scripts/verify-customer-erase.mjs                 # static checks (no DB, no login)
//   node scripts/verify-customer-erase.mjs --live           # + a real seed → erase → check → tidy
//
// WHY THIS EXISTS (T9 sweep, 2026-08-05)
// DELETE /api/owner/customers is the ONLY irreversible erase in the owner panel: it hard-deletes a
// guest, their visit ledger and their device links — three tables, no tombstone, no restore. That is
// CORRECT for a DPDP "erase my data" request. But this product's whole safety story is that it
// **cannot hide a sale** (CGST §132, docs/COMPLIANCE-GUARDRAILS.md), and a route whose job is to
// delete rows about a customer sits one careless line away from deleting the customer's BILLS too.
//
// Nothing checked that. The route was read and reasoned about in the sweep; reasoning is not a guard,
// and the next person to add "…and their orders" to that handler would break the one rule the
// business depends on with every test still green.
//
// So: the static pass pins the table list, and --live proves it on real rows — it seeds a throwaway
// guest WITH a session and an order, erases the guest through the real handler's own logic, and then
// asserts the SALE is still there. It deletes everything it created, in the same run, always.
import fs from "node:fs";
import path from "node:path";

const LIVE = process.argv.includes("--live");
let fail = 0, pass = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const read = (f) => { try { return fs.readFileSync(path.resolve(f), "utf8"); } catch { return null; } };

console.log("Erasing a guest must never erase a sale\n");

// ── STATIC · exactly three tables, and none of them hold money ─────────────────────────────────
const ROUTE = "app/api/owner/customers/route.ts";
const src = read(ROUTE);
if (!src) bad(`${ROUTE} not found (if it moved, update this guard)`);
else {
  // Everything the DELETE handler deletes from.
  const del = src.slice(src.indexOf("export async function DELETE"));
  const tables = [...del.matchAll(/from\("([a-z_]+)"\)\s*\.delete\(\)/g)].map((m) => m[1]).sort();
  const EXPECTED = ["customer_devices", "customer_visits", "customers"];
  if (JSON.stringify(tables) === JSON.stringify(EXPECTED)) ok(`deletes exactly: ${tables.join(", ")}`);
  else bad(`deletes ${tables.join(", ") || "(none found)"} — expected ONLY ${EXPECTED.join(", ")}`);

  // The named sales/records tables must never appear in a delete on this route. If a future change
  // needs to touch one of these, it is not a DPDP erase any more and this guard should stop it.
  const FORBIDDEN = ["orders", "order_items", "sessions", "bills", "invoices", "daily_counters", "deletion_audit", "staff_actions"];
  const badTable = FORBIDDEN.find((t) => tables.includes(t));
  if (!badTable) ok("no sales, session, invoice or audit table is deleted here");
  else bad(`the erase deletes "${badTable}" — that is hiding a sale (docs/COMPLIANCE-GUARDRAILS.md)`);

  // Every delete must be scoped to BOTH the restaurant and the one phone number — an erase that
  // forgot one of those would take out other guests, or the same guest at another restaurant.
  const scoped = [...del.matchAll(/from\("[a-z_]+"\)\s*\.delete\(\)\s*\.eq\("restaurant_id",\s*restaurantId\)\s*\.eq\("phone",\s*phone\)/g)].length;
  if (scoped === EXPECTED.length) ok("all three deletes are scoped to (restaurant_id, phone)");
  else bad(`only ${scoped}/${EXPECTED.length} deletes are scoped to both restaurant_id and phone`);

  // The FACT of the erase has to be traceable, or a guest vanishing is indistinguishable from a bug.
  if (/logAction\(\s*"owner",\s*"customer_erase"/.test(del)) ok("the erase is recorded in the activity log");
  else bad("the erase is not recorded — nobody could say who did it");
  // …but the log must not become a second copy of the number just erased.
  if (/phone\.slice\(-4\)/.test(del)) ok("only the last 4 digits are recorded, not the whole number");
  else bad("the log may store the full phone number the owner asked us to erase");
}

// ── LIVE · seed a guest + a real sale, erase the guest, prove the sale survives ─────────────────
if (!LIVE) {
  console.log("\n  (skipped the live seed/erase test — pass --live to run it)");
} else {
  const { createClient } = await import("@supabase/supabase-js");
  const env = Object.fromEntries(
    fs.readFileSync(".env.local", "utf8").split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // A phone number that cannot collide with a real guest, and is obvious in any log.
  const PHONE = `9000${String(Date.now()).slice(-6)}`;
  let rid = null, sessionId = null, orderId = null;

  const tidy = async () => {
    // Always, on every path. Order matters: the order references the session.
    if (orderId) await sb.from("orders").delete().eq("id", orderId);
    if (sessionId) await sb.from("sessions").delete().eq("id", sessionId);
    if (rid) {
      await sb.from("customer_visits").delete().eq("restaurant_id", rid).eq("phone", PHONE);
      await sb.from("customer_devices").delete().eq("restaurant_id", rid).eq("phone", PHONE);
      await sb.from("customers").delete().eq("restaurant_id", rid).eq("phone", PHONE);
    }
  };

  try {
    const r = await sb.from("restaurants").select("id").eq("slug", "french-house").maybeSingle();
    rid = r.data?.id;
    if (!rid) throw new Error("couldn't find the french-house demo restaurant");

    // Seed the guest…
    const c = await sb.from("customers").insert({ restaurant_id: rid, phone: PHONE, name: "T9 erase test" }).select("phone").maybeSingle();
    if (c.error) throw new Error(`couldn't seed the guest: ${c.error.message}`);
    await sb.from("customer_visits").insert({ restaurant_id: rid, phone: PHONE });
    // …and a SALE that belongs to them. This is the row that must survive.
    const s = await sb.from("sessions").insert({ restaurant_id: rid, table_number: "T9-erase", status: "closed", cust_phone: PHONE }).select("id").maybeSingle();
    if (s.error) throw new Error(`couldn't seed the session: ${s.error.message}`);
    sessionId = s.data.id;
    const o = await sb.from("orders").insert({
      restaurant_id: rid, session_id: sessionId, table_number: "T9-erase",
      status: "served", payment_status: "paid", total: 111, subtotal: 111,
      items: [{ title: "T9 erase test dish", qty: 1, price: 111 }],   // orders.items is NOT NULL
    }).select("id").maybeSingle();
    if (o.error) throw new Error(`couldn't seed the order: ${o.error.message}`);
    orderId = o.data.id;
    ok(`seeded a throwaway guest (…${PHONE.slice(-4)}) with one paid ₹111 sale`);

    // Erase exactly the way the handler does — the same three tables, the same scoping.
    await sb.from("customer_visits").delete().eq("restaurant_id", rid).eq("phone", PHONE);
    await sb.from("customer_devices").delete().eq("restaurant_id", rid).eq("phone", PHONE);
    const del = await sb.from("customers").delete().eq("restaurant_id", rid).eq("phone", PHONE).select("phone");
    if ((del.data || []).length === 1) ok("the guest record is erased");
    else bad(`expected to erase 1 guest row, erased ${(del.data || []).length}`);

    const visitsLeft = await sb.from("customer_visits").select("id", { count: "exact", head: true }).eq("restaurant_id", rid).eq("phone", PHONE);
    if (!visitsLeft.count) ok("their visit ledger is erased");
    else bad(`${visitsLeft.count} visit row(s) survived the erase`);

    // THE POINT OF THE WHOLE FILE.
    const order = await sb.from("orders").select("id, total, payment_status").eq("id", orderId).maybeSingle();
    if (order.data && Number(order.data.total) === 111) ok("the SALE is still there, untouched (₹111, still paid)");
    else bad("the sale did not survive the erase — this would be hiding a sale");
    const sess = await sb.from("sessions").select("id").eq("id", sessionId).maybeSingle();
    if (sess.data) ok("the bill's session row is still there");
    else bad("the session was removed by the erase");
  } catch (e) {
    bad(`live test could not run: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await tidy();
    const left = await sb.from("customers").select("phone", { count: "exact", head: true }).eq("phone", PHONE);
    console.log(left.count ? `  ❌ ${left.count} seeded row(s) LEFT BEHIND` : "  🧹 every seeded row deleted — nothing left behind");
    if (left.count) fail++;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log(fail
  ? "\n❌ FAIL — see docs/COMPLIANCE-GUARDRAILS.md: the product must never be able to hide a sale."
  : "\n✅ PASS — erasing a guest removes only the guest, never the sale");
process.exit(fail ? 1 : 0);
