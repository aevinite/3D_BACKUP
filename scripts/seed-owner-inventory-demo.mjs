#!/usr/bin/env node
// seed-owner-inventory-demo.mjs — put believable stock, purchases, expenses and waste into the
// DEV restaurants of the seven-restaurant demo owner (diagop7), so the owner console's
// "Inventory & expenses" estate screen has something real to draw.
//
//   node scripts/seed-owner-inventory-demo.mjs          # seed (idempotent — re-running replaces)
//   node scripts/seed-owner-inventory-demo.mjs --undo   # remove every row this script created
//
// WHY (owner, 2026-08-18): "You can check by filling data in the inventory and all that stuff for
// owner which has seven restaurants." Three of his seven already had a little stock data; the other
// four had none and had the module switched off, so there was nothing to look at and no way to see
// whether the boxes add up.
//
// EVERY ROW IS TAGGED `created_by = 't14-demo-seed'` and is removed by --undo. Nothing else is
// touched: existing inventory rows on burger-barn, green-bowl and taco-fiesta are left exactly as
// they are. DEV DATABASE ONLY — this script refuses to run against any other project ref.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const TAG = "t14-demo-seed";
const DEV_REF = "wnsfcizclkbobwzcxqsf";                 // the dev/test Supabase project, and only that one
const UNDO = process.argv.includes("--undo");

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
if (!String(env.NEXT_PUBLIC_SUPABASE_URL).includes(DEV_REF)) {
  console.error("Refusing to run: this is not the dev database."); process.exit(1);
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// The seven-restaurant demo owner. Resolved by username so a re-seeded database still works.
const owner = (await sb.from("staff_users").select("id").eq("username", "diagop7").maybeSingle()).data;
if (!owner) { console.error("diagop7 (the seven-restaurant demo owner) does not exist here."); process.exit(1); }
const links = (await sb.from("restaurant_owners").select("restaurant_id").eq("user_id", owner.id)).data || [];
const ids = links.map((l) => l.restaurant_id);
const rests = (await sb.from("restaurants").select("id, name, slug").in("id", ids).is("deleted_at", null)).data || [];
console.log(`${rests.length} restaurants in the demo owner's estate: ${rests.map((r) => r.slug).join(", ")}\n`);

// ── UNDO ────────────────────────────────────────────────────────────────────────────────────────
if (UNDO) {
  for (const r of rests) {
    const items = (await sb.from("inv_items").select("id").eq("restaurant_id", r.id).eq("created_by", TAG)).data || [];
    const itemIds = items.map((i) => i.id);
    if (itemIds.length) {
      await sb.from("inv_waste_entries").delete().in("item_id", itemIds);
      await sb.from("inv_movements").delete().in("item_id", itemIds);
    }
    await sb.from("inv_purchases").delete().eq("restaurant_id", r.id).eq("created_by", TAG);
    await sb.from("expenses").delete().eq("restaurant_id", r.id).eq("created_by", TAG);
    if (itemIds.length) await sb.from("inv_items").delete().in("id", itemIds);
    console.log(`  ${r.slug.padEnd(22)} removed ${itemIds.length} seeded ingredient(s) and their paperwork`);
  }
  console.log("\nDone. The module switches are left as they are — flip them in the admin console if you want them off.");
  process.exit(0);
}

// ── the shopping list, per restaurant, so the boxes don't all read the same ─────────────────────
// name, purchase unit, unit cost, how much is on the shelf, the par level below which it is "low"
const KITCHENS = {
  "french-house":  [["Butter", "kg", 480, 12, 8], ["Baguette flour", "kg", 62, 90, 40], ["Brie", "kg", 720, 4, 6], ["Coffee beans", "kg", 1150, 9, 5], ["Cream", "l", 210, 3, 10]],
  "pizza-palace":  [["Mozzarella", "kg", 540, 22, 15], ["Tomato passata", "l", 145, 40, 25], ["00 flour", "kg", 58, 120, 60], ["Pepperoni", "kg", 690, 5, 8], ["Olive oil", "l", 820, 11, 6]],
  "sakura-sushi":  [["Sushi rice", "kg", 165, 60, 30], ["Nori sheets", "pack", 320, 18, 12], ["Salmon", "kg", 1450, 7, 10], ["Wasabi", "kg", 980, 2, 2], ["Soy sauce", "l", 260, 14, 8]],
  "spice-route":   [["Basmati rice", "kg", 128, 150, 80], ["Paneer", "kg", 420, 9, 12], ["Ghee", "kg", 640, 16, 10], ["Garam masala", "kg", 890, 3, 2], ["Onions", "kg", 34, 210, 100]],
  "burger-barn":   [["Cheddar slices", "pack", 260, 24, 20], ["Potatoes", "kg", 32, 180, 90]],
  "green-bowl":    [["Quinoa", "kg", 310, 26, 15], ["Avocado", "pc", 95, 40, 30]],
  "taco-fiesta":   [["Tortillas", "pack", 140, 55, 30], ["Black beans", "kg", 180, 34, 20]],
};
const VENDORS = ["Ram Traders", "Shree Fresh", "Metro Cash & Carry", "Daily Dairy Co", "Coastal Supplies"];
const EXPENSES = [
  ["utilities", "Electricity bill", 4200], ["repair", "Chimney service", 1850], ["breakage", "Broken plates", 640],
  ["cleaning", "Deep clean — kitchen", 2300], ["supplies", "Cling film & foil", 780], ["transport", "Vegetable run", 520],
];
const WASTE_REASONS = ["spoiled", "burnt", "expired", "spilled"];

// This IST month, so the figures land in the month the screen opens on.
const istNow = new Date(Date.now() + 5.5 * 3600_000);
const Y = istNow.getUTCFullYear(), M = istNow.getUTCMonth();
const day = (n) => { const d = new Date(Date.UTC(Y, M, Math.min(n, istNow.getUTCDate()))); return d.toISOString().slice(0, 10); };
const stamp = (n) => new Date(Date.UTC(Y, M, Math.min(n, istNow.getUTCDate()), 9, 0, 0)).toISOString();
const pick = (a, i) => a[i % a.length];

let totals = [];
for (const r of rests) {
  const list = KITCHENS[r.slug];
  if (!list) { console.log(`  ${r.slug.padEnd(22)} skipped (no shopping list for it)`); continue; }

  // Idempotent: clear only what THIS script made here before, then rebuild it.
  const old = (await sb.from("inv_items").select("id").eq("restaurant_id", r.id).eq("created_by", TAG)).data || [];
  if (old.length) {
    const oldIds = old.map((i) => i.id);
    await sb.from("inv_waste_entries").delete().in("item_id", oldIds);
    await sb.from("inv_movements").delete().in("item_id", oldIds);
    await sb.from("inv_items").delete().in("id", oldIds);
  }
  await sb.from("inv_purchases").delete().eq("restaurant_id", r.id).eq("created_by", TAG);
  await sb.from("expenses").delete().eq("restaurant_id", r.id).eq("created_by", TAG);

  // Stock switched ON for this restaurant (the module is admin-controlled; these are DEV demo
  // restaurants and the whole point of the exercise is to see the estate screen with data in it).
  await sb.from("settings").update({ inventory_allowed: true }).eq("restaurant_id", r.id);

  // ── the ingredients ──
  const rows = list.map(([name, uom, cost, have, par], i) => ({
    restaurant_id: r.id, name, category: "kitchen", track_level: "FULL",
    base_uom: uom, purchase_uom: uom, purchase_factor: 1,
    par_qty: par, qty_base: have, avg_cost: cost, last_rate: cost,
    active: true, created_by: TAG,
  }));
  const ins = await sb.from("inv_items").insert(rows).select("id, name, qty_base, avg_cost");
  if (ins.error) { console.log(`  ${r.slug}: items failed — ${ins.error.message}`); continue; }
  const items = ins.data;

  // ── supplier bills, this month ──
  const bills = [1, 8, 15].map((d, i) => ({
    restaurant_id: r.id, kind: "bill", vendor_name: pick(VENDORS, i + r.slug.length),
    bill_no: `T14-${d}`, bill_date: day(d),
    subtotal: 0, tax: 0, total: Math.round((list.reduce((s, l) => s + l[2], 0) / (3 - i * 0.4)) * 10) / 10,
    created_by: TAG,
  }));
  await sb.from("inv_purchases").insert(bills);

  // ── the expense book, this month ──
  const exps = EXPENSES.slice(0, 3 + (r.slug.length % 3)).map((e, i) => ({
    restaurant_id: r.id, category: e[0], title: e[1],
    amount: Math.round(e[2] * (0.8 + ((r.slug.length + i) % 5) / 10)),
    expense_date: day(2 + i * 4), created_by: TAG,
  }));
  await sb.from("expenses").insert(exps);

  // ── waste: the ENTRY (for the count) and the MOVEMENT (which is what the money comes from) ──
  const wasteRows = [], moveRows = [];
  items.slice(0, 2).forEach((it, i) => {
    const qty = Math.max(1, Math.round(Number(it.qty_base) * 0.05));
    wasteRows.push({ restaurant_id: r.id, item_id: it.id, qty_base: qty, reason: pick(WASTE_REASONS, i + r.slug.length),
      note: "demo", unit_cost_snap: Number(it.avg_cost), waste_date: day(6 + i * 5), created_by: TAG });
    // outflows are stored NEGATIVE — the summary does -SUM(qty_base * unit_cost) to get a positive
    // "this much was lost", so the sign here is what makes the money come out right.
    moveRows.push({ restaurant_id: r.id, item_id: it.id, qty_base: -qty, kind: "waste",
      reason: pick(WASTE_REASONS, i + r.slug.length), ref_type: "waste", unit_cost: Number(it.avg_cost),
      dedupe_key: `${TAG}:waste:${it.id}:${i}`, created_by: TAG, created_at: stamp(6 + i * 5) });
  });
  await sb.from("inv_waste_entries").insert(wasteRows);
  await sb.from("inv_movements").insert(moveRows);

  const stock = items.reduce((s, i) => s + Number(i.qty_base) * Number(i.avg_cost), 0);
  totals.push({ slug: r.slug, items: items.length, stock,
    bought: bills.reduce((s, b) => s + b.total, 0),
    spent: exps.reduce((s, e) => s + e.amount, 0),
    wasted: moveRows.reduce((s, m) => s + -m.qty_base * m.unit_cost, 0) });
  console.log(`  ${r.slug.padEnd(22)} ${items.length} ingredients · stock ₹${Math.round(stock)} · bought ₹${Math.round(totals.at(-1).bought)} · expenses ₹${totals.at(-1).spent} · waste ₹${Math.round(totals.at(-1).wasted)}`);
}

console.log(`\nESTATE TOTAL  stock ₹${Math.round(totals.reduce((s, t) => s + t.stock, 0))} · bought ₹${Math.round(totals.reduce((s, t) => s + t.bought, 0))} · expenses ₹${totals.reduce((s, t) => s + t.spent, 0)} · waste ₹${Math.round(totals.reduce((s, t) => s + t.wasted, 0))}`);
console.log("These are the numbers the estate screen must show. Undo with --undo.");
