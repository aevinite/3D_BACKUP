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
await svc.from("sessions").delete().eq("table_number", TN);
const sess = (await svc.from("sessions").insert({ table_number: TN, status: "open", auto_approve: true }).select("id").single()).data;
const mem = (await svc.from("session_members").insert({ session_id: sess.id, name: "RT Selftest", role: "guest", approved: true, phone: "9990000000", token: "selftest-" + Date.now() }).select("id").single()).data;
const ord = (await svc.from("orders").insert({ table_number: TN, session_id: sess.id, items: [{ id: "x", title: "T", price: 100, qty: 1 }], subtotal: 100, total: 100, status: "preparing" }).select("id,total").single()).data;
await sleep(400);

// 1) auto-approve toggle
results.push(await expect("session", "auto-approve toggle", () => svc.from("sessions").update({ auto_approve: false }).eq("id", sess.id)));
// 2) discount on the order
results.push(await expect("order", "per-order discount", () => svc.from("orders").update({ discount: 20, discount_note: "selftest" }).eq("id", ord.id)));
// 3) ban: blocklist insert (member_id+phone+reason) + customers upsert + member removed
results.push(await expect("block", "ban → blocklist", async () => {
  await svc.from("blocklist").insert({ member_id: mem.id, phone: "9990000000", reason: "banned from tablet" });
  await svc.from("customers").upsert({ phone: "9990000000", blocked: true }, { onConflict: "phone" });
}));
// 4) kick: member removed
results.push(await expect("member", "kick (member removed)", () => svc.from("session_members").update({ removed: true }).eq("id", mem.id)));
// 5) restart: bulk archive+serve the table's active orders
results.push(await expect("order", "restart (archive round)", () => svc.from("orders").update({ status: "served", archived: true }).eq("session_id", sess.id).eq("archived", false).neq("status", "cancelled")));

// ---- cleanup ----
await svc.from("order_items").delete().eq("order_id", ord.id);
await svc.from("orders").delete().eq("id", ord.id);
await svc.from("session_members").delete().eq("session_id", sess.id);
await svc.from("blocklist").delete().eq("member_id", mem.id);
await svc.from("customers").delete().eq("phone", "9990000000");
await svc.from("sessions").delete().eq("id", sess.id);
await anon.removeAllChannels();

const pass = results.every(Boolean);
console.log("\n" + (pass ? "ALL PASS" : "SOME FAILED"));
process.exit(pass ? 0 : 1);
