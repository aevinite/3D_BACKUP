#!/usr/bin/env node
// t9-leftovers-check.mjs — did the fixture test leave ANYTHING behind on the dev database?
//
// "Delete the exact rows you inserted" is only half a promise; this is the half that checks it.
// Read-only: it looks for rows carrying the fixture's marker and reports them. It deletes nothing —
// if it finds something, a human decides.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = {};
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* process env */ }
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_.includes("wnsfcizclkbobwzcxqsf")) { console.error("not the dev database — refusing"); process.exit(1); }
const sb = createClient(URL_, KEY, { auth: { persistSession: false } });

let found = 0;
const look = async (table, col, pattern, label) => {
  // `customers` is keyed on (restaurant_id, phone) and has no `id` column, so select the marker
  // column alone — every table here can answer that.
  const r = await sb.from(table).select(col).ilike(col, pattern).limit(20);
  if (r.error) { console.log(`  ??   ${table}: ${r.error.message}`); return; }
  const n = (r.data || []).length;
  if (n) { found += n; console.log(`  LEFT ${n} row(s) in ${table} (${label})`); for (const x of r.data) console.log(`         ${JSON.stringify(x)}`); }
  else console.log(`  ok   ${table} — nothing left (${label})`);
};

console.log("\n── looking for anything the T9 fixture test left behind ─────────────────────────\n");
await look("customers", "name", "t9fix%", "seeded guests");
await look("khata_customers", "name", "t9fix%", "seeded pay-later people");
await look("issues", "subject", "%t9fix%", "seeded complaints");
await look("deletion_audit", "actor", "t9fix%", "seeded audit rows");

// Orders are soft-deleted by the fixture (the compliance trigger forbids a hard delete), so a
// LIVE one would be the leak. A cancelled + deleted_at row is the intended end state.
const o = await sb.from("orders").select("id, status, deleted_at, table_number").eq("table_number", "T9FIX").limit(20);
if (o.error) console.log(`  ??   orders: ${o.error.message}`);
else {
  const live = (o.data || []).filter((r) => !r.deleted_at || r.status !== "cancelled");
  if (live.length) { found += live.length; console.log(`  LEFT ${live.length} LIVE fixture order(s) on table T9FIX`); }
  else console.log(`  ok   orders — ${(o.data || []).length} fixture bill(s), all cancelled + soft-deleted as required`);
}

console.log(found ? `\nFOUND ${found} leftover row(s) — clean them by id.\n` : "\nClean — the fixture left nothing live behind.\n");
process.exit(found ? 1 : 0);
