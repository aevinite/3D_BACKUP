// Read-mostly SQL against the DEV/TEST database, for sweep #9 terminal 32's phase script.
// Every write this script makes is inside a transaction it rolls back — five terminals share
// this database. It refuses to run against anything that is not the dev/test project.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { refuseUnlessDevTestDb } from "../devStacks.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const env = {};
for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const pat = env.SUPABASE_ACCESS_TOKEN;
if (!SUPABASE_URL || !pat) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_ACCESS_TOKEN in .env.local");
refuseUnlessDevTestDb(SUPABASE_URL, "this runs sweep #9 T32's migration phases");
const ref = new URL(SUPABASE_URL).hostname.split(".")[0];

export async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`SQL ${res.status}: ${t.slice(0, 700)}`);
  return JSON.parse(t);
}
