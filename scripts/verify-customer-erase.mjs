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

// ── THIS GUARD WAS CHECKING A ROUTE THAT NO LONGER EXISTS (sweep 6 · T14, 2026-08-18) ──────────
// Three of its five static checks had been failing on a clean `main` for days, and none of them
// meant anything was wrong: the handler was REWRITTEN in August to walk the declared list in
// lib/personalData.ts (`ERASABLE`) instead of naming three tables inline, and to log through
// `ownerLogPanel(scope)` instead of the literal "owner". The regexes still looked for the old
// shape, found nothing, and shouted.
//
// That is worse than having no guard. A red that is always red gets ignored, and the next person to
// look at it is as likely to "fix" the ROUTE back to the old shape to make it green. So the checks
// now describe the code as it actually is — and the one thing this file exists for, the rule that a
// guest's erase can never take a SALE with it, is checked in two places instead of one: the literal
// deletes in the handler AND the declared list itself, which is where a forbidden table would
// realistically arrive now.
const ROUTE = "app/api/owner/customers/route.ts";
const DECLARED = "lib/personalData.ts";
// Tables that hold a sale, a session, an invoice or a record of what happened. Deleting any of them
// while erasing a guest is not a data-erasure any more — it is hiding a sale.
const FORBIDDEN = ["orders", "order_items", "sessions", "bills", "invoices", "daily_counters", "deletion_audit", "staff_actions"];
const src = read(ROUTE);
const declaredSrc = read(DECLARED);
if (!src) bad(`${ROUTE} not found (if it moved, update this guard)`);
else {
  const del = src.slice(src.indexOf("export async function DELETE"));

  // 1. What the handler deletes OUTRIGHT. Everything else it touches goes through the declared
  //    list below, so this should be the single `customers` row and nothing else.
  const tables = [...del.matchAll(/from\("([a-z_]+)"\)\s*\.delete\(\)/g)].map((m) => m[1]).sort();
  const inline = tables.filter((t) => t !== "customers");
  if (!inline.length) ok(`deletes exactly one table by name: customers`);
  else bad(`also deletes ${inline.join(", ")} by name — everything but customers must go through ${DECLARED}`);

  const badTable = FORBIDDEN.find((t) => tables.includes(t));
  if (!badTable) ok("no sales, session, invoice or audit table is deleted here");
  else bad(`the erase deletes "${badTable}" — that is hiding a sale (docs/COMPLIANCE-GUARDRAILS.md)`);

  // 2. The DECLARED list is now the thing that decides which tables are written to, so the same
  //    rule has to hold there. A `keep` entry is fine — `sessions` is listed precisely so the erase
  //    knows to leave the bills alone — what must never happen is one of these being erasable.
  if (!declaredSrc) bad(`${DECLARED} not found (if it moved, update this guard)`);
  else {
    const entries = [...declaredSrc.matchAll(/table:\s*"([a-z_]+)"[\s\S]{0,400}?policy:\s*"(erase|anonymise|keep)"/g)]
      .map((m) => ({ table: m[1], policy: m[2] }));
    if (!entries.length) bad(`could not read the declared list in ${DECLARED}`);
    else {
      const wrong = entries.filter((e) => e.policy !== "keep" && FORBIDDEN.includes(e.table));
      if (!wrong.length) ok(`the declared list writes to ${entries.filter((e) => e.policy !== "keep").length} table(s), none of them a sales record`);
      else bad(`${DECLARED} would ${wrong[0].policy} "${wrong[0].table}" — that is a sales record`);
      const sess = entries.find((e) => e.table === "sessions");
      if (sess && sess.policy === "keep") ok("the bill's own row (sessions) is declared KEEP, so a bill can never lose its guest");
      else bad("sessions is no longer declared KEEP — an issued bill could be rewritten by an erase");
    }
  }

  // 3. Every write is scoped to this restaurant and this one number. The handler builds them from
  //    the declared list, so the scoping lives in the builder rather than at each call site.
  const scopedBuilder = /p\.scopeBy === "restaurant" \? q\.eq\("restaurant_id", restaurantId\)/.test(del)
    && /p\.scopeBy === "session" \? q\.in\("session_id", sessionIds as string\[\]\)/.test(del)
    && /\.eq\(p\.phoneColumn, phone\)/.test(del);
  if (scopedBuilder) ok("every declared write is scoped to the restaurant (or its sessions) AND the one number");
  else bad("a declared write is no longer scoped to both the restaurant and the phone");
  if (/from\("customers"\)\.delete\(\)\.eq\("restaurant_id", restaurantId\)\.eq\("phone", phone\)/.test(del))
    ok("the customers row itself is deleted by (restaurant_id, phone)");
  else bad("the customers delete is not scoped to both restaurant_id and phone");

  // 4. The FACT of the erase has to be traceable, or a guest vanishing is indistinguishable from a
  //    bug — and with several co-owners nobody could say who did it.
  if (/logAction\([\s\S]{0,40}"customer_erase"/.test(del)) ok("the erase is recorded in the activity log");
  else bad("the erase is not recorded — nobody could say who did it");
  if (/from\("deletion_audit"\)\.insert\(/.test(del)) ok("…and in the removals record, where anyone would go looking");
  else bad("the erase never reaches the removals record");
  // …but neither record may become a second copy of the number just erased.
  if (/phone\.slice\(-4\)/.test(del)) ok("only the last 4 digits are recorded, not the whole number");
  else bad("the log may store the full phone number the owner asked us to erase");
  if (!/detail:[^\n]*\$\{phone\}/.test(del) && !/phone_full/.test(del)) ok("no line writes the whole number");
  else bad("something in the erase writes the full number into a record");

  // ── 5 · THE DEBT CHECK MUST ASK ABOUT THIS PERSON, NOT ABOUT THE TOP DEBTORS ─────────────────
  // (T20 sweep, 2026-08-19.) The erase REFUSES while a pay-later bill is outstanding — that is the
  // owner's own call ("why is there an erase button? there should be a paid button"), and it is the
  // only thing standing between an irreversible erase and a receivable nobody is attached to.
  //
  // It used to answer that question with `lfh_khata_outstanding(p_restaurant_ids, p_limit: 500)`,
  // which is bounded BY PERSON over `row_number() OVER (ORDER BY sum(bill_amount) DESC)` (mig 309) —
  // i.e. the 500 BIGGEST debtors and nobody else. A guest ranked 501st came back with no rows, read
  // as owing ₹0, and was erased with the debt standing. Raising the cap does not fix it; asking a
  // different question does.
  //
  // So the property, not the line: the refusal must not be computed from any top-N/ranked read, and
  // it must be scoped to the ONE person whose record is about to go.
  // CODE ONLY — the handler EXPLAINS the old ranked read in a comment, and a guard that cannot tell
  // an explanation from a call is a guard that punishes writing the reason down.
  const delCode = del.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  const TOP_N_READS = ["lfh_khata_outstanding", "p_limit"];
  const ranked = TOP_N_READS.filter((t) => delCode.includes(t));
  if (!ranked.length) ok("the pay-later refusal is not computed from a top-N/ranked read");
  else bad(`the pay-later refusal reads ${ranked.join(" + ")} — that is ranked and capped, so a small debt below the cap reads as ₹0 and the guest is erased anyway`);

  // It must read THIS person's own open bills, with mig 309's predicate and mig 301's arithmetic.
  const balBlock = (delCode.match(/rd\("khataBalance"[\s\S]{0,900}?\)\);/) || [])[0] || "";
  if (/from\("orders"\)/.test(balBlock) && /khata_customer_id/.test(balBlock)) ok("it reads this ONE person's own pay-later orders");
  else bad("the pay-later balance is not read per person from `orders` by khata_customer_id");
  const predicate = ['khata_at', 'payment_status', 'status', 'deleted_at', 'restaurant_id'];
  const missing = predicate.filter((k) => !balBlock.includes(k));
  if (!missing.length) ok("…with the whole mig-309 predicate (live, unpaid, uncancelled, this restaurant)");
  else bad(`the balance read is missing ${missing.join(", ")} — it would count a bill that is not owed, or miss one that is`);
  if (/disc_gross/.test(balBlock)) ok("…and the discount is taken from disc_gross, never re-derived from tax/subtotal (mig 301)");
  else bad("the amount owed does not subtract disc_gross — the figure will be wrong on any discounted bill");
  if (/\.limit\(/.test(balBlock)) ok("…and the read is still bounded");
  else bad("the balance read is unbounded");
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

    // Erase the three tables this fixture actually seeded, with the handler's own scoping. (The real
    // handler walks the whole declared list; the point being proved here is narrower and does not
    // need the rest — that the SALE is still standing afterwards.)
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
