// Seed a DEMO OWNER on the dev sandbox so the owner panel is testable end-to-end:
//   • creates (idempotently) a staff_users row {username:"owner", role:"owner"} with
//     a known demo password, hashed in the SAME pbkdf2$ format lib/userAuth expects;
//   • assigns owner_user_id = that owner on EVERY sandbox restaurant (one owner owns
//     all demo restaurants), so the owner dashboard + staff mgmt show them all.
// Dev sandbox ONLY (uses SUPABASE_DEV_*). Re-runnable. Prints the demo login.
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { refuseUnlessDevTestDb } from "./sweep/devStacks.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
// Which database is this? (T10 sweep, 2026-08-12 — this script had no answer.)
// One shared allow-list, in scripts/sweep/devStacks.mjs, so it knows about BOTH dev stacks
// (backup-1 and the backup-2 failover) and never about the client one.
refuseUnlessDevTestDb(env.SUPABASE_DEV_URL, "this creates owner dev data");

const url = env.SUPABASE_DEV_URL, key = env.SUPABASE_DEV_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing SUPABASE_DEV_URL / SUPABASE_DEV_SERVICE_ROLE_KEY");
const sb = createClient(url, key, { auth: { persistSession: false } });

// Mirror lib/userAuth.hashSecret: pbkdf2$<iters>$<b64url salt>$<b64url 32-byte hash>.
function hashSecret(plain) {
  const salt = crypto.randomBytes(16);
  const h = crypto.pbkdf2Sync(plain, salt, 120_000, 32, "sha256");
  return `pbkdf2$120000$${salt.toString("base64url")}$${h.toString("base64url")}`;
}

const DEFAULT_RID = "00000000-0000-0000-0000-000000000001";
const NAME = "owner";          // normalizeLoginName("owner") === "owner"
const PASSWORD = "owner12345"; // demo cred (sandbox only)

// 1) Find or create the owner (home restaurant = #1).
let { data: existing } = await sb.from("staff_users").select("id").eq("username", NAME).eq("role", "owner").limit(1);
let ownerId = existing?.[0]?.id;
if (ownerId) {
  await sb.from("staff_users").update({ password_hash: hashSecret(PASSWORD), active: true, token_version: 0, failed_count: 0, locked_until: null }).eq("id", ownerId);
  console.log("• reused existing owner", ownerId);
} else {
  const { data, error } = await sb.from("staff_users")
    .insert({ username: NAME, name: "Owner", role: "owner", restaurant_id: DEFAULT_RID, password_hash: hashSecret(PASSWORD), active: true })
    .select("id").single();
  if (error) throw new Error("create owner: " + error.message);
  ownerId = data.id;
  console.log("• created owner", ownerId);
}

// 2) Assign every restaurant to this owner.
const { data: rests, error: re } = await sb.from("restaurants").select("id, name");
if (re) throw new Error("list restaurants: " + re.message);
const { error: ue } = await sb.from("restaurants").update({ owner_user_id: ownerId }).neq("id", "00000000-0000-0000-0000-000000000000");
if (ue) throw new Error("assign restaurants: " + ue.message);
console.log(`• assigned ${rests.length} restaurant(s) to the owner:`, rests.map((r) => r.name).join(", "));

console.log("\n✅ Demo owner ready. Log in at /staff-login →");
console.log(`   Name: ${NAME}`);
console.log(`   Password: ${PASSWORD}`);
console.log("   Then open /owner");
