// Throwaway E2E: prove the NEW tablet endpoints' DB writes are valid (right
// tables/columns) AND that each one emits an ops breadcrumb (so the manager +
// kitchen + tablet refetch live). Subscribes anon (like the panels), performs the
// exact writes the new tablet routes run, on a throwaway table, then cleans up.
//   node scripts/verify-tablet-parity.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function parseEnv(t) { const o = {}; for (const l of t.split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, ""); } return o; }
const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const anon = createClient(URL, ANON, { realtime: { params: { eventsPerSecond: 10 } } });
const svc = createClient(URL, SERVICE, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TN = "9932";
// EVERY ROW BELONGS TO ONE RESTAURANT, AND EVERY RUN CLEANS UP (sweep #6 / T28, 2026-08-22).
// `sessions`, `session_members`, `orders`, `blocklist` and `customers` all gained a NOT NULL
// restaurant_id when the app went multi-tenant; not one insert here carried it. The session insert
// was refused, nothing read the error, and the script crashed one line later on `sess.id` of null —
// so all five breadcrumbs the waiter's panel depends on had gone unchecked for weeks. There was also
// no try/finally, so any throw skipped the whole teardown and left a LIVE "preparing" order on table
// 9932 — which the floor unions onto the plan as a table that does not exist.
// Migration 352 took the "assume French House" default off these tables, so a fixture has to say which
// restaurant it belongs to. This test already targeted restaurant #1 (see lfh_test_clear_table below);
// now its inserts say so too. (That sentence is the database terminal's, from its own fix to this file
// on main — kept, because it names WHEN the column stopped having a default. This version also keeps
// the rest of what was wrong here: the unread errors, the missing try/finally, and `customers`, which
// their fix left without a restaurant and which is therefore still refused.)
const RID = "00000000-0000-0000-0000-000000000001";
// A refused write must stop the run with its own sentence, not three lines later as a null.
const one = (what, res) => { if (res.error || !res.data) throw new Error(`${what}: ${res.error?.message || "no row came back"}`); return res.data; };

const got = [];
await new Promise((resolve) => {
  anon.channel("rt:ops")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "realtime_events", filter: "topic=eq.ops" }, (p) => got.push({ kind: p.new.kind, at: Date.now() }))
    .subscribe((s) => { if (s === "SUBSCRIBED") resolve(); });
});
console.log("subscribed to rt:ops\n");

const results = [];
async function expect(kind, label, write) {
  got.length = 0; const start = Date.now(); await write();
  while (Date.now() - start < 5000) { const h = got.find((e) => e.kind === kind && e.at >= start); if (h) { console.log(`✓ ${label}: ops/${kind} in ${h.at - start}ms`); return true; } await sleep(50); }
  console.log(`✗ ${label}: NO ops/${kind} within 5s`); return false;
}

// ---- set up a throwaway party on table 9932 ----
const clear = () => svc.rpc("lfh_test_clear_table", { p_rid: RID, p_table: TN }); // issued-bill lock (mig 190): clears order_items+orders+sessions for this test table
await clear();
let mem = null;
try {
const sess = one("session insert", await svc.from("sessions").insert({ restaurant_id: RID, table_number: TN, status: "open", auto_approve: true }).select("id").single());
mem = one("member insert", await svc.from("session_members").insert({ restaurant_id: RID, session_id: sess.id, name: "RT Selftest", role: "guest", approved: true, phone: "9990000000", token: "selftest-" + Date.now() }).select("id").single());
const ord = one("order insert", await svc.from("orders").insert({ restaurant_id: RID, table_number: TN, session_id: sess.id, items: [{ id: "x", title: "T", price: 100, qty: 1 }], subtotal: 100, total: 100, status: "preparing" }).select("id,total").single());
await sleep(400);

// 1) auto-approve toggle
results.push(await expect("session", "auto-approve toggle", () => svc.from("sessions").update({ auto_approve: false }).eq("id", sess.id)));
// 2) discount on the order
results.push(await expect("order", "per-order discount", () => svc.from("orders").update({ discount: 20, discount_note: "selftest" }).eq("id", ord.id)));
// 3) ban: blocklist insert (member_id+phone+reason) + customers upsert + member removed
results.push(await expect("block", "ban → blocklist", async () => {
  one("blocklist insert", await svc.from("blocklist").insert({ restaurant_id: RID, member_id: mem.id, phone: "9990000000", reason: "banned from tablet" }).select("id").single());
  one("customer upsert", await svc.from("customers").upsert({ restaurant_id: RID, phone: "9990000000", blocked: true }, { onConflict: "restaurant_id,phone" }).select("phone").single());
}));
// 4) kick: member removed
results.push(await expect("member", "kick (member removed)", () => svc.from("session_members").update({ removed: true }).eq("id", mem.id)));
// 5) restart: bulk archive+serve the table's active orders
results.push(await expect("order", "restart (archive round)", () => svc.from("orders").update({ status: "served", archived: true }).eq("session_id", sess.id).eq("archived", false).neq("status", "cancelled")));

} finally {
  // ---- cleanup, WHETHER OR NOT the checks above got that far ----
  // order_items + orders + sessions are cleared together via lfh_test_clear_table
  // (the served test order is "issued", so a direct DELETE is refused by mig 190's lock).
  const say = (what, e) => { if (e) console.log(`   cleanup: ${what} did not go — ${e.message}`); };
  if (mem) {
    say("session members", (await svc.from("session_members").delete().eq("restaurant_id", RID).eq("id", mem.id)).error);
    say("blocklist row", (await svc.from("blocklist").delete().eq("restaurant_id", RID).eq("member_id", mem.id)).error);
  }
  say("test customer", (await svc.from("customers").delete().eq("restaurant_id", RID).eq("phone", "9990000000")).error);
  say("the test table", (await clear()).error);
  // The one thing that must be true when we leave: nothing live on this table, or the manager's floor
  // grows a table that does not exist.
  const left = await svc.from("orders").select("id").eq("restaurant_id", RID).eq("table_number", TN).eq("archived", false).limit(5);
  if ((left.data || []).length) console.log(`   ⚠ table ${TN} still carries ${left.data.length} live order(s) — it will show on the floor`);
  await anon.removeAllChannels();
}

const pass = results.every(Boolean);
console.log("\n" + (pass ? "ALL PASS" : "SOME FAILED"));
process.exit(pass ? 0 : 1);
