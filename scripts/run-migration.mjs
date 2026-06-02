// Run ONE migration file against Supabase via the Management API — without the
// full reseed (which would re-upsert menu_items from menu.json and clobber
// editor edits). Idempotent migrations (CREATE OR REPLACE / IF NOT EXISTS) are
// safe to re-run.
//
// Usage:  node scripts/run-migration.mjs 018_head_model_autoopen.sql

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const pat = env.SUPABASE_ACCESS_TOKEN;
if (!SUPABASE_URL || !pat) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_ACCESS_TOKEN in .env.local");

const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];

async function runSql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`SQL failed (${res.status}): ${body}`);
  return body;
}

const file = process.argv[2];
if (!file) throw new Error("Pass a migration filename, e.g. node scripts/run-migration.mjs 018_head_model_autoopen.sql");

const sql = readFileSync(join(root, "supabase", "migrations", file), "utf8");
await runSql(sql);
console.log(`✓ ran migration ${file}`);
