#!/usr/bin/env node
/* apply-migration-avlive.mjs — run a migration on the AV LIVE database, deliberately.
 *
 * The other appliers in this folder are wired for the dev/sandbox project, so before this
 * existed an AV-live release meant pointing a dev script at live creds by hand — exactly the
 * thing the project rules forbid. This one only ever talks to AV live, and refuses if the
 * credentials it finds are not AV live's.
 *
 *   node scripts/apply-migration-avlive.mjs supabase/migrations/235_access_model_v2.sql
 *   node scripts/apply-migration-avlive.mjs --check          (connect + list nothing else)
 *
 * SAFETY
 *  · Reads AV live's keys from .env.AV.live and NEVER prints any part of them.
 *  · Hard-refuses unless the project ref is AV live's, so a mistyped env can't send a
 *    migration to the wrong database.
 *  · Prints the statement count and the server's answer only.
 *
 * This is a WRITE to a paying client's database: only run it as part of a release the owner
 * has explicitly approved.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const AV_REF = "kclqkmdxnwlhtyrducku";                 // AV live, and nothing else
const AV_ENV = "/Users/aevinite/Documents/Projects/backup_Menu/.env.AV.live";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const parse = (t) => Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
  const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
}));

let env;
try { env = parse(readFileSync(AV_ENV, "utf8")); }
catch { console.error(`REFUSING: cannot read ${AV_ENV}`); process.exit(2); }

const ref = (() => { try { return new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]; } catch { return ""; } })();
if (ref !== AV_REF) {
  console.error(`REFUSING: those credentials point at "${ref.slice(0, 6)}…", not AV live. Nothing was sent.`);
  process.exit(2);
}
if (!env.SUPABASE_ACCESS_TOKEN) { console.error("REFUSING: no SUPABASE_ACCESS_TOKEN for AV live."); process.exit(2); }

const run = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${AV_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const body = await r.text();
  return { ok: r.ok, status: r.status, body };
};

if (process.argv.includes("--check")) {
  const r = await run("select 1 as ok");
  console.log(`AV live reachable: ${r.ok ? "yes" : `no (${r.status})`}`);
  process.exit(r.ok ? 0 : 1);
}

const file = process.argv[2];
if (!file) { console.error("Usage: node scripts/apply-migration-avlive.mjs supabase/migrations/<file>.sql"); process.exit(1); }
const sql = readFileSync(join(root, file), "utf8");
const statements = (sql.match(/;/g) || []).length;

console.log(`→ AV LIVE · ${file} · ${sql.split("\n").length} lines, ~${statements} statements`);
const res = await run(sql);
if (!res.ok) {
  console.error(`✗ REFUSED (${res.status}): ${res.body.slice(0, 400)}`);
  process.exit(1);
}
console.log(`✓ applied · server said: ${res.body.slice(0, 120) || "(no rows)"}`);
