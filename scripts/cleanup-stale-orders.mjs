// One-off cleanup: archive (and cancel, if still unfinished) any leftover order
// whose table has NO live session. These are stale rows from sessions that were
// closed without their orders being cleared — they used to keep painting the floor
// tile as "Preparing"/"Served". This mirrors the new server-side close behaviour,
// applied retroactively to the rows already stranded in the DB.
//
// Reads the Management-API token from .env.local and uses it ONLY in the request
// header — never printed. Output is status / row-counts only. The MCP is read-only,
// so writes go through the Management API like the migration scripts do.
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
if (!ref) { console.error("could not derive project ref"); process.exit(1); }
console.log(`project ref: ${ref} (token present: ${token.length} chars)`);

// A "live" session is anything not closed (matches the server's .neq('status','closed')).
// Cancel unfinished orders at tables with no live session, archive everything stale.
const sql = `
update orders o
set status = case when o.status in ('received','preparing') then 'cancelled' else o.status end,
    archived = true
where o.archived = false
  and not exists (
    select 1 from sessions s
    where s.table_number = o.table_number and s.status <> 'closed'
  )
returning o.id, o.table_number, o.status;
`;

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
console.log("HTTP", res.status);
console.log(text.slice(0, 800));
process.exit(res.ok ? 0 : 1);
