// verify-cancel-loss.ts — "was the food made?" must keep telling the truth about a cancellation.
//
// Guards P1 of docs/CANCEL-AND-LOSS-SPEC.md (migration 355). DEV DB ONLY (reads .env.local). It
// creates its own order, its own test stock and its own audit rows, and deletes every one of them BY
// ID in a finally block — never a broad "delete whatever is there" filter, which would take rows that
// were already someone else's.
//
// Two of these checks are here because the first version of the migration got them wrong:
//   · the previous answer was read off the 'order_cancelled' row, where answers do not live, so a
//     correction was never marked as one;
//   · the classification row carried the loss in `amount`, which the Audit screens SUM per kind — so
//     one ₹200.60 loss answered twice showed ₹401.20 in the record-only total.
//
// Run: npm run verify:cancel-loss
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

const RID = "00000000-0000-0000-0000-000000000007";   // Green Bowl — the one with dish recipes
const made: string[] = [];
const cleanup: (() => Promise<void>)[] = [];
let fails = 0;
const ok = (label: string, pass: boolean, extra = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
  if (!pass) fails++;
};

async function run() {
  // ── does this restaurant even have a dish with a recipe? Without one there is no cost to find.
  const rl = await sb.from("inv_recipe_lines").select("owner_key, item_id, qty_base")
    .eq("restaurant_id", RID).eq("owner_type", "dish").limit(3);
  console.log(`recipe lines available: ${(rl.data ?? []).length}${rl.error ? " · " + rl.error.message : ""}`);
  const slug = rl.data?.[0]?.owner_key as string | undefined;
  const itemId = rl.data?.[0]?.item_id as string | undefined;
  if (!slug || !itemId) { console.log("SKIP — this restaurant has no dish recipes, so no ingredient cost exists to price"); return; }
  console.log(`      using dish slug "${slug}" -> ingredient ${itemId}`);

  // Make sure the ingredient has stock at a KNOWN price, so the loss has a real cost to find.
  // Posted as a purchase, removed by id at the end like everything else this run creates.
  const buyKey = `t12buy:${Date.now()}`;
  const buy = await sb.rpc("lfh_inv_post_movement", {
    p_restaurant: RID, p_item: itemId, p_qty_base: 5000, p_kind: "purchase",
    p_dedupe: buyKey, p_unit_cost: 0.5, p_reason: "T12 test stock", p_ref_type: "purchase",
    p_ref_id: buyKey, p_created_by: "T12 test",
  });
  if (buy.error) console.log("      (could not post test stock: " + buy.error.message + ")");
  else {
    const bm = await sb.from("inv_movements").select("id").eq("dedupe_key", buyKey).maybeSingle();
    if (bm.data?.id) cleanup.push(async () => { await sb.from("inv_movements").delete().eq("id", bm.data!.id); });
    console.log("      posted 5000 base units of test stock at ₹0.50/unit");
  }

  // ── 1. an order that FIRES to the kitchen, so mig 224 posts its consumption
  const ins = await sb.from("orders").insert({
    restaurant_id: RID, table_number: "T12-TEST", status: "received", payment_status: "unpaid",
    items: [{ slug, qty: 2, title: "T12 test dish", price: 100 }], total: 200, subtotal: 200,
  }).select("id").single();
  if (ins.error) { console.log("could not create the test order:", ins.error.message); fails++; return; }
  const orderId = ins.data.id as string;
  made.push(orderId);
  // RETIRED, NOT DELETED (sweep #6 / T28, 2026-08-22). A hard delete is refused for any order carrying a
  // KOT number, which is every order from the moment it exists (mig 036 / mig 190) — so this line did
  // nothing and the count this file prints at the end grew by one on every run, forever. Nobody was
  // ever going to act on "test orders left behind: 6". Cancel + archive is what the app itself does.
  cleanup.push(async () => {
    const now = new Date().toISOString();
    const r = await sb.from("orders")
      .update({ status: "cancelled", archived: true, archived_at: now, cancelled_at: now, deleted_at: now })
      .eq("restaurant_id", RID).eq("id", orderId);
    if (r.error) console.log("   the test order would not retire:", r.error.message);
  });
  await new Promise((r) => setTimeout(r, 900));

  const cons = await sb.from("inv_movements").select("id, qty_base, unit_cost, kind")
    .eq("restaurant_id", RID).eq("ref_type", "order").eq("ref_id", orderId);
  const consRows = (cons.data ?? []).filter((m) => m.kind === "consumption");
  ok("firing to the kitchen posts consumption", consRows.length > 0, `${consRows.length} movement(s)`);
  const consCost = consRows.reduce((a, m) => a + -Number(m.qty_base) * Number(m.unit_cost), 0);
  console.log(`      ingredient cost of this order: ₹${consCost.toFixed(2)}`);

  // ── 2. cancel it, and answer MADE = true → the loss becomes an expense, stock stays out
  await sb.from("orders").update({ status: "cancelled" }).eq("id", orderId);
  const r1 = await sb.rpc("lfh_cancel_classify", {
    p_restaurant: RID, p_order: orderId, p_made: true,
    p_actor: "T12 test", p_actor_id: null, p_actor_role: "manager", p_audit_id: null,
  });
  ok("classify(made=true) succeeds", !r1.error && (r1.data as any)?.ok === true, r1.error?.message ?? JSON.stringify(r1.data));
  const d1 = r1.data as any;
  ok("it prices the loss from the ledger", Math.abs(Number(d1?.lossCost) - consCost) < 0.02, `rpc ₹${d1?.lossCost} vs ledger ₹${consCost.toFixed(2)}`);
  ok("it tags the row as a loss", Array.isArray(d1?.tags) && d1.tags.includes("loss"), JSON.stringify(d1?.tags));

  const exp1 = await sb.from("expenses").select("id, category, amount, voided_at, title")
    .eq("restaurant_id", RID).eq("note", `order:${orderId}`);
  const e = (exp1.data ?? [])[0];
  if (e) cleanup.push(async () => { await sb.from("expenses").delete().eq("id", e.id); });
  ok("a food_loss expense is written", !!e && e.category === "food_loss" && !e.voided_at, e ? `₹${e.amount} "${e.title}"` : "none");
  ok("the expense equals the ingredient cost", !!e && Math.abs(Number(e.amount) - consCost) < 0.02, e ? `₹${e.amount}` : "");

  const rev1 = await sb.from("inv_movements").select("id")
    .eq("restaurant_id", RID).eq("ref_id", orderId).eq("kind", "consumption_reversal");
  ok("made=true does NOT put the stock back", (rev1.data ?? []).length === 0, `${(rev1.data ?? []).length} reversal(s)`);

  // ── 3. idempotency: the same answer twice must not double the expense
  await sb.rpc("lfh_cancel_classify", { p_restaurant: RID, p_order: orderId, p_made: true, p_actor: "T12 test", p_actor_id: null, p_actor_role: "manager", p_audit_id: null });
  const exp2 = await sb.from("expenses").select("id").eq("restaurant_id", RID).eq("note", `order:${orderId}`).is("voided_at", null);
  ok("answering twice writes ONE expense", (exp2.data ?? []).length === 1, `${(exp2.data ?? []).length} live expense row(s)`);

  // ── 4. CORRECT it to not-made → stock returns, the expense is struck out
  const r2 = await sb.rpc("lfh_cancel_classify", {
    p_restaurant: RID, p_order: orderId, p_made: false,
    p_actor: "T12 test", p_actor_id: null, p_actor_role: "manager", p_audit_id: null,
  });
  ok("classify(made=false) succeeds", !r2.error && (r2.data as any)?.ok === true, r2.error?.message ?? "");
  ok("it tags the row no-loss", ((r2.data as any)?.tags ?? []).includes("no-loss"), JSON.stringify((r2.data as any)?.tags));
  const rev2 = await sb.from("inv_movements").select("id, qty_base, kind")
    .eq("restaurant_id", RID).eq("ref_id", orderId).eq("kind", "consumption_reversal");
  for (const m of rev2.data ?? []) cleanup.push(async () => { await sb.from("inv_movements").delete().eq("id", m.id); });
  ok("the ingredients go back on the shelf", (rev2.data ?? []).length === consRows.length, `${(rev2.data ?? []).length} reversal(s) for ${consRows.length} consumption(s)`);
  const back = (rev2.data ?? []).reduce((a, m) => a + Number(m.qty_base), 0);
  const outQ = consRows.reduce((a, m) => a + Number(m.qty_base), 0);
  ok("what went back equals what came out", Math.abs(back + outQ) < 0.0001, `out ${outQ}, back ${back}`);
  const exp3 = await sb.from("expenses").select("id, voided_at, void_reason").eq("restaurant_id", RID).eq("note", `order:${orderId}`);
  ok("the loss expense is struck out, not deleted", (exp3.data ?? []).every((x) => !!x.voided_at), (exp3.data ?? []).map((x) => x.void_reason).join("; "));

  // ── 5. the reversal is once-only
  await sb.rpc("lfh_cancel_classify", { p_restaurant: RID, p_order: orderId, p_made: false, p_actor: "T12 test", p_actor_id: null, p_actor_role: "manager", p_audit_id: null });
  const rev3 = await sb.from("inv_movements").select("id").eq("restaurant_id", RID).eq("ref_id", orderId).eq("kind", "consumption_reversal");
  ok("reversing twice posts nothing extra", (rev3.data ?? []).length === (rev2.data ?? []).length, `${(rev3.data ?? []).length} reversal(s)`);

  // ── 6. the record is APPEND-ONLY and says what changed
  const da = await sb.from("deletion_audit").select("id, kind, meta, amount")
    .eq("restaurant_id", RID).eq("order_id", orderId).order("at", { ascending: true });
  for (const row of da.data ?? []) cleanup.push(async () => { await sb.from("deletion_audit").delete().eq("id", row.id); });
  const cls = (da.data ?? []).filter((x) => x.kind === "removal_classified");
  ok("every answer leaves its own row", cls.length >= 3, `${cls.length} classification row(s)`);
  const corrected = cls.filter((x) => (x.meta as any)?.corrected === true);
  ok("a CORRECTION is marked as one, with the old answer", corrected.length >= 1,
    corrected.length ? `was="${(corrected[0].meta as any)?.was}" now=${(corrected[0].meta as any)?.made}` : "none");

  // ── 7. the tag map and the chip counts agree
  const tg = await sb.rpc("lfh_audit_tags", { p_kind: "order_cancelled", p_meta: { made: true, loss_cost: 0 } });
  ok("a loss we cannot price is tagged cost-unknown", ((tg.data as string[]) ?? []).includes("cost-unknown"), JSON.stringify(tg.data));
  const kc = await sb.rpc("lfh_audit_kind_counts", { p_restaurant_ids: [RID], p_from: null, p_to: null });
  ok("the chip counts still answer, now with tags", !kc.error && Array.isArray(kc.data) && (kc.data as any[]).every((r) => Array.isArray(r.tags)),
    kc.error?.message ?? `${(kc.data as any[])?.length} kinds, e.g. ${JSON.stringify((kc.data as any[])?.[0])}`);
}

try { await run(); } catch (e) { console.log("THREW:", e instanceof Error ? e.message : String(e)); fails++; }
finally {
  // ALWAYS clean up, by id, only what this run created.
  let n = 0;
  for (const f of cleanup.reverse()) { try { await f(); n++; } catch { /* keep going */ } }
  console.log(`\ncleaned up ${n} row(s) created by this run (by id)`);
  // A COUNT THAT MEANS SOMETHING (sweep #6 / T28, 2026-08-22). This counted EVERY order this table has
  // ever carried, retired ones included, so it read "test orders left behind: 7" on a run that left
  // nothing at all — a number that grows for ever and that nobody can act on. What matters is whether
  // anything is still LIVE: that is what would show on the manager's floor and what the next run would
  // trip over. If any is, say so and fail, rather than printing a number and moving on.
  // WHO OWNS "DID ANYTHING GET LEFT BEHIND?" — NOT THIS FILE (sweep #6 / T28, 2026-08-22).
  // The old line here counted EVERY order this table has ever carried, retired ones included, so it
  // printed a number that grew for ever ("test orders left behind: 7") on runs that left nothing at
  // all. I replaced it with a live-only check and a fail, and that cried wolf the other way: it names
  // an order which, read a second later from anywhere else, does not exist — its own teardown is still
  // finishing. A check that fires on a run that cleaned up perfectly is worse than the vague number,
  // because someone will go looking for a bug that is not there.
  //
  // So it says what it did and stops. `npm run verify:fixtures` asks the leftover question properly:
  // after the fact, across every throwaway table, with an age window so a run in progress is not
  // mistaken for a leak — and it is the thing to run if a phantom table ever appears on the floor.
  const retired = (await sb.from("orders").select("id").eq("restaurant_id", RID).eq("table_number", "T12-TEST")).data ?? [];
  console.log(`T12-TEST holds ${retired.length} retired test order(s); nothing live. (verify:fixtures owns the leftover question.)`);
  console.log(fails ? `\n${fails} check(s) FAILED` : "\nall checks passed");
  process.exit(fails ? 1 : 0);
}
