// Idempotently create the PUBLIC `branding` Storage bucket (per-restaurant logos).
// Public read so guest menus can <img src> the logo; writes happen only via the
// service role (the admin upload route). Run once: node scripts/create-branding-bucket.mjs
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await sb.storage.createBucket("branding", {
  public: true,
  fileSizeLimit: 1048576,
  allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"],
});
if (error && !/already exists/i.test(error.message)) { console.error("✗", error.message); process.exit(1); }
console.log("✓ branding bucket ready", data || "(existed)");
