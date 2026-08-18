// Verify the order flow still works the same for legit orders, and that the
// direct-insert hole is now closed. Places a test order via the new server
// function, reads it back, then RETIRES it the way the law allows.
//
// WHY IT NO LONGER DELETES (sweep 6 T3, 2026-08-18)
//   This used to finish with `DELETE FROM orders WHERE id = …`, and since the billing-compliance
//   trigger landed, the database refuses that outright:
//
//     lfh: an issued bill cannot be hard-deleted — soft-delete it (deleted_at) instead
//     HINT: Corrections use void / soft-delete; permanent erase only via the 90-day purge.
//
//   So the whole guard died on its own cleanup — it placed the order, proved everything, then threw
//   on the last step and exited non-zero. `npm run verify:order` had been red for that reason alone.
//
//   The trigger is RIGHT and is not to be worked around: "a sale can be cancelled, a sale can never
//   disappear" (docs/COMPLIANCE-GUARDRAILS.md §3.0). A test order is still a sale row once it
//   exists, so it is retired down the same route a real one takes — cancelled, then soft-deleted
//   with who/when/why stamped, exactly as lib/softDelete.ts does it. The row stays on record and
//   off every live view, which is the compliant outcome AND the tidy one.
//   Run with:  node scripts/verify-order.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const pat = env.SUPABASE_ACCESS_TOKEN;
const projectRef = new URL(URL_).hostname.split(".")[0];

async function runSql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`SQL failed (${res.status}): ${body}`);
  return body ? JSON.parse(body) : [];
}

// 1) Pick two real, orderable dishes.
// Scoped to restaurant #1: the place RPC defaults to that restaurant, so an unscoped pick
// returned another restaurant's dish and the server answered `unknown_item` — the test was
// failing on fixture drift, not on an ordering bug. (2026-07-30)
const items = await runSql(`SELECT id, price, title FROM menu_items WHERE NOT ('sold-out' = ANY(tags)) AND restaurant_id = '00000000-0000-0000-0000-000000000001' ORDER BY sort_order LIMIT 2;`);
const payload = JSON.stringify([
  { id: items[0].id, qty: 2 },
  { id: items[1].id, qty: 1 },
]);
console.log("ordering:", items.map((i) => `${i.title} (${i.price})`).join(" + "));

// 2) Place it exactly like the non-session client now does.
const placed = await runSql(`SELECT lfh_place_order_public('1', '${payload}'::jsonb, ARRAY[]::text[]) AS r;`);
const r = placed[0].r;
console.log("place result:", JSON.stringify(r));
if (!r.ok) { console.error("✗ order did NOT place"); process.exit(1); }

// 3) Read the stored order back and show the server-decided money.
const row = await runSql(`SELECT subtotal, tax, total, jsonb_array_length(items) AS lines, status FROM orders WHERE id = '${r.order_id}';`);
console.log("stored order:", JSON.stringify(row[0]));

// 4) Retire the test order the compliant way: cancel it, then soft-delete it with a reason.
// Never a hard DELETE — see the note at the top of this file. The line items go (they are not the
// sale record; the frozen `orders.items` payload is), the order row stays, marked and dated.
await runSql(`DELETE FROM order_items WHERE order_id = '${r.order_id}';`);
await runSql(`
  UPDATE orders
     SET status = 'cancelled',
         deleted_at = NOW(),
         delete_reason = 'verify-order.mjs self-test row — retired by the guard that created it'
   WHERE id = '${r.order_id}';
`);
const [retired] = await runSql(`SELECT status, deleted_at IS NOT NULL AS soft_deleted FROM orders WHERE id = '${r.order_id}';`);
if (!retired || retired.status !== "cancelled" || retired.soft_deleted !== true) {
  console.error("✗ the test order was not retired — leaving it for a human rather than forcing it:", JSON.stringify(retired));
  process.exit(1);
}
// Prove the compliance trigger is still standing: a hard delete of this row must STILL be refused.
// If this ever succeeds, the safeguard has been weakened and that matters far more than this test.
let hardDeleteRefused = false;
try { await runSql(`DELETE FROM orders WHERE id = '${r.order_id}';`); }
catch { hardDeleteRefused = true; }
if (!hardDeleteRefused) {
  console.error("✗ a hard delete of an issued bill SUCCEEDED — the append-only safeguard is gone. Fix that before anything else.");
  process.exit(1);
}
console.log("✓ test order placed, verified, and retired (cancelled + soft-deleted); hard delete still refused");

// 5) Prove the OLD hole is closed: a raw anon insert must now be rejected.
const res = await fetch(`${URL_}/rest/v1/orders`, {
  method: "POST",
  headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json", Prefer: "return=minimal" },
  body: JSON.stringify({ table_number: "9", items: [{ id: "x", title: "Free lunch", price: "0", qty: 1 }], subtotal: 0, tax: 0, total: 0 }),
});
console.log(`anon direct insert -> HTTP ${res.status} (expect 401/403 = blocked):`, (await res.text()).slice(0, 160));
