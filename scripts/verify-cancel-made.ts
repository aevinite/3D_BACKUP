// verify-cancel-made.ts — the manager's answer must reach the stock, the cost and the record.
//
// Guards P2 of docs/CANCEL-AND-LOSS-SPEC.md through the REAL endpoint, not the RPC: it signs in as the
// diag manager and PATCHes /api/editor/orders/<id> exactly as the panel does. DEV DB ONLY, and it
// needs the app running (pass --base, default http://localhost:4112).
//
// It exists because the RPC passing told me nothing about the endpoint. The first wiring called the
// classifier from INSIDE the cancel block — before the row is updated at the bottom of the handler —
// so the RPC correctly refused an order that was not cancelled yet, returned {ok:false}, and did
// nothing. Nothing failed and nothing was logged. That is why a refusal is now logged, and why this
// guard asserts the EFFECTS (a real expense row, a real reversal) rather than an HTTP 200.
//
// Every row it creates is deleted by id in a finally block, including the trigger-written movement it
// never held an id for.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

const RID = "00000000-0000-0000-0000-000000000001";   // French House — diagm1's restaurant
// `--base <url>` or `--base=<url>`; anything else falls back to the sweep's own port. The naive
// `argv[indexOf("--base")+1]` picked up argv[0] (the node binary) when the flag was absent, which is
// how this first ran against a URL of "/opt/homebrew/.../node/api/panel-login".
const argv = process.argv.slice(2);
const eq = argv.find((a) => a.startsWith("--base="));
const flag = argv.indexOf("--base");
const BASE = eq ? eq.slice(7) : (flag >= 0 && argv[flag + 1] ? argv[flag + 1] : "http://localhost:4112");
const cleanup: (() => Promise<void>)[] = [];
let fails = 0;
const ok = (l: string, pass: boolean, extra = "") => { console.log(`${pass ? "PASS" : "FAIL"}  ${l}${extra ? ` — ${extra}` : ""}`); if (!pass) fails++; };

async function managerCookies(): Promise<string> {
  const r = await fetch(`${BASE}/api/panel-login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "diagm1", password: "diag-mgr-2026" }),
  });
  const sc = r.headers.getSetCookie?.() ?? [];
  if (!r.ok || !sc.length) throw new Error(`panel-login ${r.status}`);
  return sc.map((c) => c.split(";")[0]).join("; ");
}

async function run() {
  const cookie = await managerCookies();

  // a dish this restaurant really sells
  const dish = await sb.from("menu_items").select("slug, title").eq("restaurant_id", RID).limit(1).single();
  if (dish.error) throw new Error("no menu item: " + dish.error.message);
  const slug = dish.data.slug as string;

  // an ingredient + a recipe line for it, so there is a cost to find
  const item = await sb.from("inv_items").insert({
    restaurant_id: RID, name: `T12 test flour ${Date.now()}`, base_uom: "g", category: "general",
  }).select("id").single();
  if (item.error) throw new Error("inv item: " + item.error.message);
  const itemId = item.data.id as string;
  cleanup.push(async () => {
    // Movements reference the item, and the kitchen-fire consumption was written by a TRIGGER — so the
    // test never held its id. Clear everything that points at THIS item (scoped to the item we just
    // created, never a blanket delete), then the item itself.
    const m = await sb.from("inv_movements").delete().eq("item_id", itemId);
    if (m.error) console.log("   movements would not go:", m.error.message);
    const r = await sb.from("inv_recipe_lines").delete().eq("item_id", itemId);
    if (r.error) console.log("   recipe lines would not go:", r.error.message);
    const i = await sb.from("inv_items").delete().eq("id", itemId);
    if (i.error) console.log("   the ingredient would not go:", i.error.message);
  });
  const rl = await sb.from("inv_recipe_lines").insert({
    restaurant_id: RID, owner_type: "dish", owner_key: slug, item_id: itemId, qty_base: 100,
  }).select("id").single();
  if (rl.error) throw new Error("recipe line: " + rl.error.message);
  cleanup.push(async () => { await sb.from("inv_recipe_lines").delete().eq("id", rl.data.id); });

  const buyKey = `t12p2:${Date.now()}`;
  await sb.rpc("lfh_inv_post_movement", { p_restaurant: RID, p_item: itemId, p_qty_base: 10000,
    p_kind: "purchase", p_dedupe: buyKey, p_unit_cost: 2, p_reason: "T12 test stock",
    p_ref_type: "purchase", p_ref_id: buyKey, p_created_by: "T12" });
  const bm = await sb.from("inv_movements").select("id").eq("dedupe_key", buyKey).maybeSingle();
  if (bm.data?.id) cleanup.push(async () => { await sb.from("inv_movements").delete().eq("id", bm.data!.id); });

  // an order that fires to the kitchen → consumption posts (3 × 100g @ ₹2 = ₹600)
  const o = await sb.from("orders").insert({
    restaurant_id: RID, table_number: "T12-P2", status: "received", payment_status: "unpaid",
    items: [{ slug, qty: 3, title: dish.data.title, price: 200 }], total: 600, subtotal: 600,
  }).select("id").single();
  if (o.error) throw new Error("order: " + o.error.message);
  const orderId = o.data.id as string;
  cleanup.push(async () => { await sb.from("orders").delete().eq("id", orderId); });
  await new Promise((r) => setTimeout(r, 900));
  const cons = await sb.from("inv_movements").select("id, qty_base, unit_cost")
    .eq("ref_id", orderId).eq("kind", "consumption");
  // MEASURE, never assume a count or a price. The dish may have any number of recipe lines — and did,
  // once four earlier seed runs had each added one, which failed this guard on its own leftovers
  // rather than on the product. The expected loss is whatever the LEDGER says came out.
  const consRows = cons.data ?? [];
  const expectLoss = consRows.reduce((a, m) => a + -Number(m.qty_base) * Number(m.unit_cost), 0);
  const expectQty = consRows.reduce((a, m) => a + Number(m.qty_base), 0);
  ok("the order consumed its ingredients at kitchen-fire", consRows.length >= 1,
    `${consRows.length} movement(s), ₹${expectLoss.toFixed(2)} of ingredients`);

  // ── CANCEL THROUGH THE REAL ENDPOINT, answering "it was cooked" ─────────────────────────────
  const res = await fetch(`${BASE}/api/editor/orders/${orderId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ status: "cancelled", reason_code: "kitchen_error", reason_note: "T12 test", made: true }),
  });
  ok("the endpoint accepts the cancel with its answer", res.ok, `HTTP ${res.status}`);
  await new Promise((r) => setTimeout(r, 1200));

  const exp = await sb.from("expenses").select("id, category, amount, title, voided_at")
    .eq("restaurant_id", RID).eq("note", `order:${orderId}`);
  const e = (exp.data ?? [])[0];
  if (e) cleanup.push(async () => { await sb.from("expenses").delete().eq("id", e.id); });
  ok("a food-loss expense appears, from the endpoint", !!e && e.category === "food_loss" && !e.voided_at,
    e ? `₹${e.amount} "${e.title}"` : "none");
  ok("its amount is exactly what the ledger says was consumed", !!e && Math.abs(Number(e.amount) - expectLoss) < 0.02,
    e ? `expense ₹${e.amount} vs ledger ₹${expectLoss.toFixed(2)}` : "no expense");
  const rev = await sb.from("inv_movements").select("id").eq("ref_id", orderId).eq("kind", "consumption_reversal");
  ok("made=true leaves the stock deducted", (rev.data ?? []).length === 0, `${(rev.data ?? []).length} reversal(s)`);

  const da = await sb.from("deletion_audit").select("id, kind, meta").eq("order_id", orderId).order("at");
  for (const r of da.data ?? []) cleanup.push(async () => { await sb.from("deletion_audit").delete().eq("id", r.id); });
  const cancelRow = (da.data ?? []).find((r) => r.kind === "order_cancelled");
  const clsRow = (da.data ?? []).find((r) => r.kind === "removal_classified");
  ok("the cancellation is still recorded as a removal", !!cancelRow, cancelRow ? `reason kept` : "missing");
  ok("the answer is recorded as its own row", !!clsRow && (clsRow.meta as any)?.made === true,
    clsRow ? `made=${(clsRow.meta as any)?.made} cost=₹${(clsRow.meta as any)?.loss_cost}` : "missing");
  ok("the classification links to the removal row it answers", !!clsRow && (clsRow.meta as any)?.of === cancelRow?.id,
    clsRow ? `of=${(clsRow.meta as any)?.of} vs row ${cancelRow?.id}` : "");
  const tags = await sb.rpc("lfh_audit_tags", { p_kind: "order_cancelled", p_meta: { made: true, loss_cost: 600 } });
  ok("the row tags as a loss", ((tags.data as string[]) ?? []).includes("loss"), JSON.stringify(tags.data));

  // ── and the correction path, through the RPC the Audit screen will use (P3) ──────────────────
  const fix = await sb.rpc("lfh_cancel_classify", { p_restaurant: RID, p_order: orderId, p_made: false,
    p_actor: "T12 test", p_actor_id: null, p_actor_role: "manager", p_audit_id: null });
  ok("it can be corrected to never-made", !fix.error && (fix.data as any)?.ok === true, fix.error?.message ?? "");
  const rev2 = await sb.from("inv_movements").select("id, qty_base").eq("ref_id", orderId).eq("kind", "consumption_reversal");
  for (const m of rev2.data ?? []) cleanup.push(async () => { await sb.from("inv_movements").delete().eq("id", m.id); });
  const back = (rev2.data ?? []).reduce((a, m) => a + Number(m.qty_base), 0);
  ok("the ingredients come back, line for line and to the gram",
    (rev2.data ?? []).length === consRows.length && Math.abs(back + expectQty) < 0.0001,
    `${(rev2.data ?? []).length} reversal(s) for ${consRows.length} consumption(s); out ${expectQty}, back ${back}`);
  const exp2 = await sb.from("expenses").select("voided_at").eq("note", `order:${orderId}`);
  ok("the loss expense is struck out", (exp2.data ?? []).every((x) => !!x.voided_at));
  const da2 = await sb.from("deletion_audit").select("id, kind, meta").eq("order_id", orderId).eq("kind", "removal_classified");
  for (const r of da2.data ?? []) cleanup.push(async () => { await sb.from("deletion_audit").delete().eq("id", r.id); });
  ok("the correction says what it changed from", (da2.data ?? []).some((r) => (r.meta as any)?.corrected === true && (r.meta as any)?.was === "true"),
    JSON.stringify((da2.data ?? []).map((r) => ({ made: (r.meta as any)?.made, was: (r.meta as any)?.was }))));
}

try { await run(); } catch (err) { console.log("THREW:", err instanceof Error ? err.message : String(err)); fails++; }
finally {
  let n = 0;
  // A cleanup that swallows its own failure is how a shared dev database fills up with other
  // people's leftovers. Keep going, but SAY what would not go.
  for (const f of cleanup.reverse()) {
    try { await f(); n++; } catch (e) { console.log("   cleanup step failed:", e instanceof Error ? e.message : String(e)); }
  }
  const left = await sb.from("orders").select("id").eq("restaurant_id", RID).eq("table_number", "T12-P2");
  const leftItems = await sb.from("inv_items").select("id").eq("restaurant_id", RID).like("name", "T12 test flour%");
  console.log(`\ncleaned up ${n} row(s) by id · orders left: ${(left.data ?? []).length} · test items left: ${(leftItems.data ?? []).length}`);
  console.log(fails ? `\n${fails} check(s) FAILED` : "\nall checks passed");
  process.exit(fails ? 1 : 0);
}
