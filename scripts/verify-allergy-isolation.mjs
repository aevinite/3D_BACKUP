// End-to-end check for the per-item allergy LEAK bug (tablet orders).
// Reproduces the exact payload the FIXED tablet sendOrder() now sends:
//   item 1: cappuccino with removed:["nuts"] + note "more ice"
//   item 2: a plain cappuccino (no allergy, no note)
//   order-level allergies: [] (the whole-order box left empty)
// Then reads the order back and asserts item 2 did NOT inherit "no nuts".
// Computes the SAME merge the kitchen/tablet/editor use: [...item.removed, ...order.allergies].
// Cleans up the test order afterwards. Prints only results — never any secret.
//
// ⚠️ IT SAID "Cleaned up test order." AND CLEANED UP NOTHING (sweep #6 / T28, 2026-08-22). The teardown
// hard-DELETEd the order. Every order carries a KOT number from the moment it exists (mig 036), and
// trg_block_issued_delete refuses to delete one (mig 190) — so the DELETE was refused, the response was
// never read, and the fixture stayed LIVE. Measured: table ALGTEST was sitting on My Little French
// House's Tables floor as a table that does not exist, with a new order on it, plus an open session that
// blocks the one-open-session-per-table index, plus a queued kitchen ticket whose red "hasn't printed —
// is the kitchen screen open?" banner stays on the manager's floor.
// It now retires the fixture the way a cancellation does, checks what it says, and does it in a finally
// so a failed assertion cannot skip it.

import { readFileSync } from "node:fs";

// THIS CHECKOUT'S OWN KEYS. `readFileSync(".env.local")` is relative to whatever directory you happen
// to be standing in, so it only worked from the repo root. (globalThis.URL because the line below
// shadows the global `URL` with the Supabase one.)
const env = Object.fromEntries(
  readFileSync(new globalThis.URL("../.env.local", import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
  })
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const rest = (path, opts = {}) => fetch(`${URL}/rest/v1/${path}`, { ...opts, headers: { ...h, ...(opts.headers || {}) } });
const RID = "00000000-0000-0000-0000-000000000001";   // My Little French House

function assert(cond, msg) { if (!cond) { console.error("❌ FAIL:", msg); process.exitCode = 1; } else { console.log("✅", msg); } }

const main = async () => {
  // 1) Grab any real dish id to order twice (cappuccino if present, else first dish).
  const dishesRes = await rest(`menu_items?select=id,title&restaurant_id=eq.${RID}&limit=50`)  // scoped: the place RPC
    // defaults to restaurant #1, so an unscoped pick returned another restaurant's dish and the
    // server answered `unknown_item` — the test was failing on fixture drift. (2026-07-30);
  const dishes = await dishesRes.json();
  const dish = dishes.find((d) => /cappuccino/i.test(d.title)) || dishes[0];
  console.log(`Using dish: ${dish.title} (${dish.id})`);


  // 2) Place the order EXACTLY as the fixed frontend now builds it.
  const placeRes = await rest("rpc/lfh_staff_place_order", {
    method: "POST",
    body: JSON.stringify({
      p_table: TABLE,
      p_items: [
        { id: dish.id, qty: 1, removed: ["nuts"], note: "more ice" }, // edited item
        { id: dish.id, qty: 1 },                                       // plain item
      ],
      p_allergies: [], // whole-order avoid box left EMPTY
      p_note: null,
      p_restaurant_id: RID,          // named, never left to the RPC's default
      p_confirm_duplicate: true,     // two rounds of the same dish in one run are not a double-tap
    }),
  });
  const placed = await placeRes.json();
  if (!placed || placed.ok !== true) throw new Error("place failed: " + JSON.stringify(placed));
  const orderId = placed.order_id;
  console.log(`Placed order ${orderId} (KOT #${placed.kot_no})`);

  // 3) Read the order + its item rows back (this is what the panels read).
  const order = (await (await rest(`orders?id=eq.${orderId}&select=allergies,items`)).json())[0];
  const itemRows = await (await rest(`order_items?order_id=eq.${orderId}&select=title,note,removed&order=created_at.asc`)).json();

  console.log("\norder.allergies =", JSON.stringify(order.allergies));
  console.log("order_items:");
  itemRows.forEach((r, i) => console.log(`  [${i}] removed=${JSON.stringify(r.removed)} note=${JSON.stringify(r.note)}`));

  // 4) The merge every display does: line shows [...item.removed, ...order.allergies] as "NO x".
  const orderAllergies = Array.isArray(order.allergies) ? order.allergies : [];
  const merged = itemRows.map((r) => [...new Set([...(r.removed || []), ...orderAllergies])]);
  console.log("\nWhat the kitchen/tablet would show as 'NO …' per line:");
  merged.forEach((m, i) => console.log(`  [${i}] -> ${m.length ? "NO " + m.join(", NO ") : "(nothing)"}`));

  console.log("\n--- assertions ---");
  assert(orderAllergies.length === 0, "order-level allergies stays EMPTY (no per-item leak into it)");
  assert(JSON.stringify(merged[0]) === JSON.stringify(["nuts"]), "item 1 shows NO NUTS");
  assert(itemRows[0].note === "more ice", "item 1 keeps its note 'more ice'");
  assert(merged[1].length === 0, "item 2 shows NOTHING (the bug would show NO NUTS here)");
  assert(!itemRows[1].note, "item 2 has no note");

};

// 5) Clean up the throwaway table — the product's own way, and SAY what would not go.
async function cleanup() {
  const now = new Date().toISOString();
  const say = async (what, res) => {
    if (res.ok) return;
    console.log(`   cleanup: ${what} did not go — ${res.status} ${(await res.text()).slice(0, 120)}`);
  };
  // The dish rows can go (they carry no number of their own), then the order is CANCELLED + ARCHIVED
  // and the session CLOSED, which is exactly what the app does when a round is voided.
  // PostgREST takes an id LIST, never a sub-select, so read the ids first.
  const ours = await (await rest(`orders?restaurant_id=eq.${RID}&table_number=eq.${TABLE}&select=id`)).json().catch(() => []);
  const ourIds = (Array.isArray(ours) ? ours : []).map((o) => o.id);
  if (ourIds.length) {
    await say("the dish rows", await rest(`order_items?restaurant_id=eq.${RID}&order_id=in.(${ourIds.join(",")})`, { method: "DELETE" }));
  }
  await say("retire the test order", await rest(`orders?restaurant_id=eq.${RID}&table_number=eq.${TABLE}&archived=is.false`, {
    method: "PATCH", body: JSON.stringify({ status: "cancelled", archived: true, archived_at: now, cancelled_at: now }) }));
  await say("close the test session", await rest(`sessions?restaurant_id=eq.${RID}&table_number=eq.${TABLE}&status=eq.open`, {
    method: "PATCH", body: JSON.stringify({ status: "closed", closed_at: now, deleted_at: now }) }));
  // The kitchen ticket this run queued. On a stack with no kitchen screen open nothing polls the
  // queue, so lib/printQueue's own "the order was cancelled before this ticket printed" dismissal
  // never runs — and the manager's floor keeps a red "hasn't printed" banner for a ticket nobody
  // ordered. Use the product's own wording so the row reads the same as one the app retired.
  const jobs = await (await rest(`print_jobs?restaurant_id=eq.${RID}&status=eq.queued&select=id,order_id`)).json().catch(() => []);
  const ids = (Array.isArray(jobs) ? jobs : []).filter((j) => ourIds.includes(j.order_id)).map((j) => j.id);
  if (ids.length) {
    await say("dismiss the queued ticket(s)", await rest(`print_jobs?restaurant_id=eq.${RID}&id=in.(${ids.join(",")})`, {
      method: "PATCH", body: JSON.stringify({ status: "dismissed", done_at: now, error: "the order was cancelled before this ticket printed" }) }));
  }
  // The one thing that must be true when we leave.
  const left = await (await rest(`orders?restaurant_id=eq.${RID}&table_number=eq.${TABLE}&archived=is.false&select=id`)).json().catch(() => []);
  console.log(left.length
    ? `\n⚠ table ${TABLE} still carries ${left.length} live order(s) — it will show on the manager's floor as a table that does not exist`
    : `\nCleaned up: nothing is left on table ${TABLE}.`);
  if (left.length) process.exitCode = 1;
}

const TABLE = "ALGTEST";
try { await main(); } finally { await cleanup(); }
