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
import { roundPaise } from "../lib/tax.ts";

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
// subtotal = Σ unit × qty; tax = the restaurant's OWN rate, rounded by the app's ONE exact rule.
// (Sweep #10 T30 round 5, item 33: this used `Math.round(sub * 0.05 * 100) / 100` — the float rounding
// item 10 removed from the app, against a database that rounds exactly, so a cart landing on a half
// paisa would have failed for no reason; and a hard-coded 5%, which docs/COMPLIANCE-GUARDRAILS.md §3
// forbids. The rate now comes from lfh_effective_tax_rate, the database's own answer.)
function clientTotals(lines, rate) {
  const sub = roundPaise(lines.reduce((s, l) => s + (niceUsd(l.base) + l.addons.reduce((a, b) => a + b, 0)) * l.qty, 0));
  const tax = roundPaise(sub * rate);
  return { subtotal: sub, tax, total: roundPaise(sub + tax) };
}

// lfh_price_order is tenant-scoped (mig 118) and DEFAULTS to restaurant #1, so the dishes we
// price must come from that same restaurant. This test used to ask for dishes with no
// restaurant filter: once the dev DB held several restaurants, the first rows returned belonged
// to another one and the server answered `unknown_item` — the test had been failing on fixture
// drift, not on any money bug (the app never calls lfh_price_order with a mismatched pair;
// pricing runs inside lfh_staff_place_order, which passes the acting restaurant). Pinning both
// sides to one restaurant makes the test prove what it claims again. (2026-07-30)
const RESTAURANT_ID = "00000000-0000-0000-0000-000000000001";

test("server lfh_price_order matches client money math to the cent — eight carts, the restaurant's own rate", async () => {
  // The restaurant's rate, as the database itself works it out (never a number typed here).
  const rr = await fetch(`${URL_}/rest/v1/rpc/lfh_effective_tax_rate`, { method: "POST", headers: PRICING_HEADERS, body: JSON.stringify({ p_restaurant_id: RESTAURANT_ID }) });
  assert.equal(rr.status, 200, `rate status ${rr.status}`);
  const rate = Number(await rr.json());
  assert.ok(rate >= 0 && rate <= 0.5, `a rate, not ${rate}`);

  // Real, not-sold-out dishes of that restaurant.
  const r = await fetch(`${URL_}/rest/v1/menu_items?select=id,price,options,tags&restaurant_id=eq.${RESTAURANT_ID}&limit=59`, { headers: HEADERS });
  const items = (await r.json()).filter((i) => !(i.tags || []).includes("sold-out"));
  assert.ok(items.length >= 3, "need at least 3 orderable dishes");
  const withOpts = items.filter((i) => Array.isArray(i.options) && i.options.length > 0 && i.options[0].choices?.length);

  // Eight carts, built the same way every run (a fixed walk through the dishes), the way the app sends
  // them: ids + qty + option labels — one with an option group whenever the menu has one.
  for (let c = 0; c < 8; c++) {
    const cartReq = [], cartLocal = [];
    for (let k = 0; k < 1 + (c % 4); k++) {
      const it = items[(c * 7 + k * 3) % items.length]; const qty = 1 + ((c + k) % 3);
      cartReq.push({ id: it.id, qty }); cartLocal.push({ base: parseFloat(it.price), addons: [], qty });
    }
    if (withOpts.length && c % 2 === 0) {
      const it = withOpts[c % withOpts.length]; const grp = it.options[0];
      const choice = grp.choices.find((x) => (x.price || 0) > 0) || grp.choices[0];
      cartReq.push({ id: it.id, qty: 2, options: [{ group: grp.name, label: choice.label }] });
      cartLocal.push({ base: parseFloat(it.price), addons: [choice.price || 0], qty: 2 });
    }
    // Ask the SERVER to price the same cart (read-only function, no order created).
    const rpc = await fetch(`${URL_}/rest/v1/rpc/lfh_price_order`, {
      method: "POST", headers: PRICING_HEADERS, body: JSON.stringify({ p_items: cartReq, p_restaurant_id: RESTAURANT_ID }),
    });
    // Name the cause in the failure itself: a bare status number sent me looking for a money bug
    // when the answer was a table grant. The body says exactly which table and which role.
    assert.equal(rpc.status, 200, `cart ${c}: rpc status ${rpc.status} — ${(await rpc.clone().text()).slice(0, 160)}`);
    const server = await rpc.json();
    assert.equal(server.ok, true, `cart ${c}: server refused: ${server.reason || "?"}`);
    const client = clientTotals(cartLocal, rate);
    // Compare to the cent. Number() because the server returns numerics as JSON numbers.
    assert.equal(Number(server.subtotal).toFixed(2), client.subtotal.toFixed(2), `cart ${c}: subtotal mismatch`);
    assert.equal(Number(server.tax).toFixed(2), client.tax.toFixed(2), `cart ${c}: tax mismatch`);
    assert.equal(Number(server.total).toFixed(2), client.total.toFixed(2), `cart ${c}: total mismatch`);
  }
});
