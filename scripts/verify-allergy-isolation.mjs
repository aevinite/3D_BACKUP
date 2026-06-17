// End-to-end check for the per-item allergy LEAK bug (tablet orders).
// Reproduces the exact payload the FIXED tablet sendOrder() now sends:
//   item 1: cappuccino with removed:["nuts"] + note "more ice"
//   item 2: a plain cappuccino (no allergy, no note)
//   order-level allergies: [] (the whole-order box left empty)
// Then reads the order back and asserts item 2 did NOT inherit "no nuts".
// Computes the SAME merge the kitchen/tablet/editor use: [...item.removed, ...order.allergies].
// Cleans up the test order afterwards. Prints only results — never any secret.

import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n").filter(Boolean).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
  })
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const rest = (path, opts = {}) => fetch(`${URL}/rest/v1/${path}`, { ...opts, headers: { ...h, ...(opts.headers || {}) } });

function assert(cond, msg) { if (!cond) { console.error("❌ FAIL:", msg); process.exitCode = 1; } else { console.log("✅", msg); } }

const main = async () => {
  // 1) Grab any real dish id to order twice (cappuccino if present, else first dish).
  const dishesRes = await rest("menu_items?select=id,title&limit=50");
  const dishes = await dishesRes.json();
  const dish = dishes.find((d) => /cappuccino/i.test(d.title)) || dishes[0];
  console.log(`Using dish: ${dish.title} (${dish.id})`);

  const TABLE = "ALGTEST"; // a throwaway table number, no open session needed

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
    }),
  });
  const placed = await placeRes.json();
  if (!placed || placed.ok !== true) { console.error("❌ place failed:", placed); process.exit(1); }
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

  // 5) Clean up the throwaway order.
  await rest(`order_items?order_id=eq.${orderId}`, { method: "DELETE" });
  await rest(`orders?id=eq.${orderId}`, { method: "DELETE" });
  console.log("\nCleaned up test order.");
};
main();
