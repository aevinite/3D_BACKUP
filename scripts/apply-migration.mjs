// Apply ONE migration file via the Supabase Management API (uses the PAT in
// .env.local). Usage: node scripts/apply-migration.mjs supabase/migrations/00X_name.sql
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const parseEnv = (t) =>
  Object.fromEntries(
    t
      .split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      })
  );

const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
const pat = env.SUPABASE_ACCESS_TOKEN;
const projectRef = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (!pat) throw new Error("Missing SUPABASE_ACCESS_TOKEN in .env.local");

const file = process.argv[2];
if (!file) throw new Error("Usage: node scripts/apply-migration.mjs <path-to-sql>");
const query = readFileSync(join(root, file), "utf8");

const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});
const body = await res.text();
console.log(res.status, body.slice(0, 500));
if (!res.ok) process.exit(1);
console.log("✓ applied", file);
