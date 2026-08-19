// Apply ONE migration file to the PRODUCTION Supabase via the Management API.
// Reads the LIVE creds from the MAIN repo's .env.local (the worktree's is pointed at
// the sandbox). SAFETY: aborts unless the target project ref is DIFFERENT from the
// sandbox ref — so a mix-up can never silently run "prod" against the sandbox or
// vice-versa. Never prints any secret (only masked refs + HTTP status).
// Usage: node scripts/apply-migration-prod.mjs supabase/migrations/0XX_name.sql
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAIN_ENV = "/Users/aevinite/Documents/Projects/backup_Menu/.env.local";
const parse = (t) => Object.fromEntries(
  t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  })
);
const refOf = (u) => { try { return new URL(u).hostname.split(".")[0]; } catch { return null; } };

const prod = parse(readFileSync(MAIN_ENV, "utf8"));
const sandbox = parse(readFileSync(join(root, ".env.local"), "utf8"));
const prodRef = refOf(prod.NEXT_PUBLIC_SUPABASE_URL);
const sandboxRef = refOf(sandbox.NEXT_PUBLIC_SUPABASE_URL);
const token = prod.SUPABASE_ACCESS_TOKEN;
const mask = (s) => (s ? s.slice(0, 4) + "…" + s.slice(-3) : "(none)");

if (!prodRef) throw new Error("No NEXT_PUBLIC_SUPABASE_URL in main .env.local");
if (!token) throw new Error("No SUPABASE_ACCESS_TOKEN in main .env.local");
if (prodRef === sandboxRef) throw new Error(`ABORT: prod ref (${mask(prodRef)}) === sandbox ref — refusing to run.`);

const file = process.argv[2];
if (!file) throw new Error("Usage: node scripts/apply-migration-prod.mjs <path-to-sql>");
const query = readFileSync(join(root, file), "utf8");

const res = await fetch(`https://api.supabase.com/v1/projects/${prodRef}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "curl/8" },
  body: JSON.stringify({ query }),
});
const body = await res.text();
console.log(`PROD[${mask(prodRef)}] HTTP ${res.status} · ${body.slice(0, 200)}`);
if (!res.ok) process.exit(1);
console.log("✓ applied to PRODUCTION:", file);
