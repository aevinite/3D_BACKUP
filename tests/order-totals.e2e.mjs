// tests/order-totals.e2e.mjs — proves the CLIENT's money math and the SERVER's
// order calculator agree to the cent, end to end, without creating any orders.
//
// How: pick real dishes from the live DB, price a pretend cart locally with
// lib/money.mjs (the exact module the UI uses), then ask the server's
// read-only lfh_price_order() to price the same cart, and compare.
//
// Run with: npm run test:totals   (needs .env.local)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { niceUsd } from "../lib/money.mjs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const URL_ = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)[1].trim();
const ANON = env.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)$/m)[1].trim();
// WHICH KEY, AND WHY IT IS NOT THE ANON ONE (2026-08-04).
//
// This test asks lfh_price_order() to price a cart. That function is deliberately INVOKER, not
// SECURITY DEFINER (mig 273 says so), so it reads `settings` — for the tax mode and rate — with
// the CALLER's privileges. Anon has no direct SELECT on `settings` any more: the guest's config
// now comes through one RPC door instead of a table grant (migs 282/283). So calling it as anon
// answers 401 `permission denied for table settings` — and this test failed on that for every run
// after those migrations, which made phase 15 of verify:everything permanently red for a reason
// that has nothing to do with money.
//
// THE PRODUCT IS NOT AFFECTED and that is the point worth writing down: nothing in the app calls
// lfh_price_order from a browser. A guest order reaches it INSIDE lfh_place_order /
// lfh_place_order_public, both of which are SECURITY DEFINER (verified against the live database),
// so the settings read happens with the definer's rights and real pricing works.
//
// What this test is FOR is the arithmetic — does the server's calculator agree with lib/money.mjs
// to the cent. So call it the way the product effectively does, with rights that can read
// settings, and keep the anon key for the plain table read below (which anon genuinely does do).
const SERVICE = env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)[1].trim();
const HEADERS = { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" };
const PRICING_HEADERS = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };

// Client-side mirror of the bill: unit = nice(base) + add-ons at face value;
// subtotal = Σ unit × qty; tax = 5% rounded to cents. (All in USD — the
// canonical currency; INR is a display conversion of these numbers.)
function clientTotals(lines) {
  const sub = lines.reduce((s, l) => s + (niceUsd(l.base) + l.addons.reduce((a, b) => a + b, 0)) * l.qty, 0);
  const tax = Math.round(sub * 0.05 * 100) / 100;
  return { subtotal: sub, tax, total: sub + tax };
}

// lfh_price_order is tenant-scoped (mig 118) and DEFAULTS to restaurant #1, so the dishes we
// price must come from that same restaurant. This test used to ask for dishes with no
// restaurant filter: once the dev DB held several restaurants, the first rows returned belonged
// to another one and the server answered `unknown_item` — the test had been failing on fixture
// drift, not on any money bug (the app never calls lfh_price_order with a mismatched pair;
// pricing runs inside lfh_staff_place_order, which passes the acting restaurant). Pinning both
// sides to one restaurant makes the test prove what it claims again. (2026-07-30)
const RESTAURANT_ID = "00000000-0000-0000-0000-000000000001";

test("server lfh_price_order matches client money math to the cent", async () => {
  // Grab three real, not-sold-out dishes (one with option groups if available).
  const r = await fetch(`${URL_}/rest/v1/menu_items?select=id,price,options,tags&restaurant_id=eq.${RESTAURANT_ID}&limit=59`, { headers: HEADERS });
  const items = (await r.json()).filter((i) => !(i.tags || []).includes("sold-out"));
  assert.ok(items.length >= 3, "need at least 3 orderable dishes");
  const plain = items.slice(0, 2);
  const withOpts = items.find((i) => Array.isArray(i.options) && i.options.length > 0 && i.options[0].choices?.length);

  // Build the pretend cart the way the app sends it (ids + qty + option labels).
  const cartReq = [
    { id: plain[0].id, qty: 2 },
    { id: plain[1].id, qty: 1 },
  ];
  const cartLocal = [
    { base: parseFloat(plain[0].price), addons: [], qty: 2 },
    { base: parseFloat(plain[1].price), addons: [], qty: 1 },
  ];
  if (withOpts) {
    const grp = withOpts.options[0];
    const choice = grp.choices.find((c) => (c.price || 0) > 0) || grp.choices[0];
    cartReq.push({ id: withOpts.id, qty: 3, options: [{ group: grp.name, label: choice.label }] });
    cartLocal.push({ base: parseFloat(withOpts.price), addons: [choice.price || 0], qty: 3 });
  }

  // Ask the SERVER to price the same cart (read-only function, no order created).
  const rpc = await fetch(`${URL_}/rest/v1/rpc/lfh_price_order`, {
    method: "POST", headers: PRICING_HEADERS, body: JSON.stringify({ p_items: cartReq, p_restaurant_id: RESTAURANT_ID }),
  });
  // Name the cause in the failure itself: a bare status number sent me looking for a money bug
  // when the answer was a table grant. The body says exactly which table and which role.
  assert.equal(rpc.status, 200, `rpc status ${rpc.status} — ${(await rpc.clone().text()).slice(0, 160)}`);
  const server = await rpc.json();
  assert.equal(server.ok, true, `server refused: ${server.reason || "?"}`);

  const client = clientTotals(cartLocal);
  // Compare to the cent. Number() because the server returns numerics as JSON numbers.
  assert.equal(Number(server.subtotal).toFixed(2), client.subtotal.toFixed(2), "subtotal mismatch");
  assert.equal(Number(server.tax).toFixed(2), client.tax.toFixed(2), "tax mismatch");
  assert.equal(Number(server.total).toFixed(2), client.total.toFixed(2), "total mismatch");
});
