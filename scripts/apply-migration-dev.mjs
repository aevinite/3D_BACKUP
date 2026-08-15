// ⚠️ THIS SCRIPT CANNOT RUN TODAY, AND THAT IS THE CORRECT OUTCOME (measured 2026-08-16).
//
// It applies a migration to the DEV SANDBOX named by SUPABASE_DEV_PROJECT_REF. That family of keys
// in .env.local still points at **lfh-saas-dev**, the throwaway project from the June-2026 SaaS
// phase-1 work: ~100 migrations behind, and no staff action has ever been recorded in it. The
// allow-list (scripts/sweep/devStacks.mjs) does not include it, so this refuses — read the long
// note there before "fixing" that, because adding it is the one change that would make this script
// silently apply migrations to a database nobody uses.
//
// TO APPLY A MIGRATION TO THE WORKING DEV DATABASE, use:
//     node scripts/run-migration.mjs <file>.sql
// which reads NEXT_PUBLIC_SUPABASE_URL (backup-1) and is allow-listed.
//
// Kept rather than deleted because the sandbox workflow is worth having again one day — and a file
// that explains why it is dormant is worth more than a deleted one somebody re-invents. Never
// prints secrets (only status + body).
// Usage: node scripts/apply-migration-dev.mjs supabase/migrations/00X_name.sql
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { refuseUnlessDevTestDb } from "./sweep/devStacks.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const parseEnv = (t) =>
  Object.fromEntries(
    t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
  );

const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
const pat = env.SUPABASE_DEV_ACCESS_TOKEN;
// Which database is this? (T10 sweep, 2026-08-12 — this script had no answer.)
// One shared allow-list, in scripts/sweep/devStacks.mjs, so it knows about BOTH dev stacks
// (backup-1 and the backup-2 failover) and never about the client one.
refuseUnlessDevTestDb(env.SUPABASE_DEV_URL, "this applies a migration");

const projectRef = env.SUPABASE_DEV_PROJECT_REF || new URL(env.SUPABASE_DEV_URL).hostname.split(".")[0];
if (!pat) throw new Error("Missing SUPABASE_DEV_ACCESS_TOKEN in .env.local");
if (!projectRef) throw new Error("Missing SUPABASE_DEV_PROJECT_REF / SUPABASE_DEV_URL in .env.local");

const file = process.argv[2];
if (!file) throw new Error("Usage: node scripts/apply-migration-dev.mjs <path-to-sql>");
const query = readFileSync(join(root, file), "utf8");

const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json", "User-Agent": "curl/8" },
  body: JSON.stringify({ query }),
});
const body = await res.text();
console.log("HTTP", res.status, "·", body.slice(0, 300));
if (!res.ok) process.exit(1);
console.log("✓ applied to DEV sandbox:", file);
