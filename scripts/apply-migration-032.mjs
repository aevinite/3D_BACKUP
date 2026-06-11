// One-off: apply supabase/migrations/032_dish_no.sql via the Supabase Management
// API (the MCP is read-only; a full reseed would clobber editor edits). Reads the
// access token from .env.local and uses it ONLY in the request header — it is
// never printed. Output is status/row-counts only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Tiny .env.local parser (no deps).
const env = {};
for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const token = env.SUPABASE_ACCESS_TOKEN;
const url = env.NEXT_PUBLIC_SUPABASE_URL || "";
const ref = (url.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
if (!token) { console.error("missing SUPABASE_ACCESS_TOKEN"); process.exit(1); }
if (!ref) { console.error("could not derive project ref from NEXT_PUBLIC_SUPABASE_URL"); process.exit(1); }
console.log(`project ref: ${ref} (token present: ${token.length} chars)`);

const sql = readFileSync(join(root, "supabase/migrations/032_dish_no.sql"), "utf8");

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
console.log("HTTP", res.status);
console.log(text.slice(0, 500));
process.exit(res.ok ? 0 : 1);
