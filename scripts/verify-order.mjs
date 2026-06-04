// Verify the order flow still works the same for legit orders, and that the
// direct-insert hole is now closed. Places a test order via the new server
// function, reads it back, then DELETES it. No lasting data change.
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
const items = await runSql(`SELECT id, price, title FROM menu_items WHERE NOT ('sold-out' = ANY(tags)) ORDER BY sort_order LIMIT 2;`);
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

// 4) Clean up the test order so we leave no trace.
await runSql(`DELETE FROM orders WHERE id = '${r.order_id}';`);
console.log("✓ test order placed, verified, and deleted");

// 5) Prove the OLD hole is closed: a raw anon insert must now be rejected.
const res = await fetch(`${URL_}/rest/v1/orders`, {
  method: "POST",
  headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json", Prefer: "return=minimal" },
  body: JSON.stringify({ table_number: "9", items: [{ id: "x", title: "Free lunch", price: "0", qty: 1 }], subtotal: 0, tax: 0, total: 0 }),
});
console.log(`anon direct insert -> HTTP ${res.status} (expect 401/403 = blocked):`, (await res.text()).slice(0, 160));
