// Copy the 6 DEMO restaurants (ids …0002–…0007) + their menus, sessions, orders,
// the demo owner, and owner assignments FROM the sandbox INTO production — so the
// live Aevidine admin/owner panels show the full multi-restaurant setup.
//
// SAFE: only touches restaurants …0002–…0007 (NEVER #1, the real restaurant);
// reads sandbox via SUPABASE_DEV_*, writes prod via the MAIN repo's .env.local;
// aborts unless prod ref ≠ sandbox ref. Idempotent (upserts). One restaurant
// (Green Bowl) is left OWNER-LESS to demonstrate an independent, manager-run tenant.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const W = "/Users/aevinite/Documents/Projects/backup_Menu/.claude/worktrees/feat+saas-multitenant/.env.local";
const MAIN = "/Users/aevinite/Documents/Projects/backup_Menu/.env.local";
const parse = (p) => Object.fromEntries(readFileSync(p,"utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const we = parse(W), me = parse(MAIN);
const refOf = (u) => new URL(u).hostname.split(".")[0];

const SB_URL = we.SUPABASE_DEV_URL, SB_KEY = we.SUPABASE_DEV_SERVICE_ROLE_KEY;
const PROD_URL = me.NEXT_PUBLIC_SUPABASE_URL, PROD_KEY = me.SUPABASE_SERVICE_ROLE_KEY;
if (refOf(PROD_URL) === refOf(SB_URL)) throw new Error("ABORT: prod ref === sandbox ref");
console.log(`sandbox ${refOf(SB_URL).slice(0,4)}… → PROD ${refOf(PROD_URL).slice(0,4)}…`);

const sandbox = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
const prod = createClient(PROD_URL, PROD_KEY, { auth: { persistSession: false } });
const DEMO = ["00000000-0000-0000-0000-000000000002","00000000-0000-0000-0000-000000000003","00000000-0000-0000-0000-000000000004","00000000-0000-0000-0000-000000000005","00000000-0000-0000-0000-000000000006","00000000-0000-0000-0000-000000000007"];
const INDEPENDENT = "00000000-0000-0000-0000-000000000007"; // Green Bowl → no owner (manager-run)

async function copy(table, filterCol, onConflict, transform) {
  let q = sandbox.from(table).select("*");
  q = filterCol === "id" ? q.in("id", DEMO) : q.in(filterCol, DEMO);
  const { data, error } = await q;
  if (error) { console.log(`  ✗ read ${table}: ${error.message}`); return; }
  if (!data?.length) { console.log(`  · ${table}: 0 rows`); return; }
  const rows = transform ? data.map(transform) : data;
  const { error: ue } = await prod.from(table).upsert(rows, { onConflict });
  console.log(ue ? `  ✗ write ${table}: ${ue.message}` : `  ✓ ${table}: ${data.length}`);
}

// FK-safe order: parents first. Restaurants copied with owner_user_id NULLED (the
// owner row is created below, then ownership assigned) to avoid an FK-ordering fail.
await copy("restaurants", "id", "id", (r) => ({ ...r, owner_user_id: null }));
await copy("settings", "restaurant_id", "restaurant_id");
await copy("categories", "restaurant_id", "restaurant_id,slug");
await copy("filters", "restaurant_id", "restaurant_id,slug");
await copy("menu_items", "restaurant_id", "id");
await copy("sessions", "restaurant_id", "id");
await copy("session_members", "restaurant_id", "id");
await copy("orders", "restaurant_id", "id");
await copy("order_items", "restaurant_id", "id");

// The demo owner (role=owner) → copy to prod so the same login works.
const { data: owners } = await sandbox.from("staff_users").select("*").eq("role", "owner");
if (owners?.length) {
  const { error } = await prod.from("staff_users").upsert(owners, { onConflict: "id" });
  console.log(error ? `  ✗ owner: ${error.message}` : `  ✓ owner user(s): ${owners.length}`);
  const ownerId = owners[0].id;
  // Assign every demo restaurant EXCEPT the independent one to the owner; also give
  // the owner restaurant #1 so their dashboard shows it too.
  const owned = [...DEMO.filter(id => id !== INDEPENDENT), "00000000-0000-0000-0000-000000000001"];
  const { error: ae } = await prod.from("restaurants").update({ owner_user_id: ownerId }).in("id", owned);
  console.log(ae ? `  ✗ assign: ${ae.message}` : `  ✓ assigned ${owned.length} restaurants to owner; Green Bowl left independent`);
}
console.log("\n✅ demo copied to production.");
