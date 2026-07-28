// Gather the overnight repair agent's INPUT: every OPEN fix_request + the last 24h of
// error-level log rows, written as a plain-language markdown file the agent reads.
// Reads PROD via the Management API (same PAT pattern as apply-migration.mjs). Prints only
// a summary + the output path — never a secret. Usage: node scripts/fetch-fix-requests.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const parseEnv = (t) =>
  Object.fromEntries(
    t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
      const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
  );

const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
const pat = env.SUPABASE_ACCESS_TOKEN;
const projectRef = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (!pat) throw new Error("Missing SUPABASE_ACCESS_TOKEN in .env.local");

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json", "User-Agent": "curl/8" },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`query failed HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const requests = await q(`
  SELECT fr.id, fr.restaurant_id, r.name AS restaurant, fr.created_at, fr.source, fr.summary, fr.note, fr.context
  FROM fix_requests fr LEFT JOIN restaurants r ON r.id = fr.restaurant_id
  WHERE fr.status = 'open' ORDER BY fr.created_at DESC LIMIT 50;
`);
const errors = await q(`
  SELECT sa.panel, sa.action, sa.detail, r.name AS restaurant, sa.created_at
  FROM staff_actions sa LEFT JOIN restaurants r ON r.id = sa.restaurant_id
  WHERE sa.level = 'error' AND sa.created_at > now() - interval '24 hours'
  ORDER BY sa.created_at DESC LIMIT 100;
`);
// Problems ALREADY dealt with (mig 218). Read this BEFORE building anything: if the request
// matches a 'fixed' row whose fixed_at is later than the error rows, the fix already exists and
// rebuilding it wastes the session (that happened 2026-07-28 — duplicate PR #522 vs #527).
const handled = await q(`
  SELECT es.panel, es.action, es.sig, es.state, es.fixed_at, es.fixed_by, es.pr_url,
         es.recurrences, es.last_seen_at, r.name AS restaurant
  FROM error_signatures es LEFT JOIN restaurants r ON r.id = es.restaurant_id
  ORDER BY es.fixed_at DESC LIMIT 60;
`).catch(() => []); // table absent on a stack that hasn't run mig 218 yet — don't break the fetch

const DATE = new Date().toISOString().slice(0, 10);
const out = join(root, ".claude", "audits", `repair-input-${DATE}.md`);
mkdirSync(dirname(out), { recursive: true });

let md = `# Repair agent input — ${DATE}\n\n`;
md += `## Open fix requests (${requests.length})\n\n`;
if (!requests.length) md += `_None._\n\n`;
for (const r of requests) {
  md += `### ${r.summary}\n`;
  md += `- id: \`${r.id}\` · restaurant: ${r.restaurant || "(platform)"} · source: ${r.source || "?"} · at: ${r.created_at}\n`;
  if (r.note) md += `- owner note: ${r.note}\n`;
  if (r.context) md += `- context:\n\`\`\`json\n${JSON.stringify(r.context, null, 2).slice(0, 4000)}\n\`\`\`\n`;
  md += `\n`;
}
md += `## Problems already dealt with — CHECK BEFORE BUILDING (${handled.length})\n\n`;
md += `_A 'fixed' row whose fixed_at is LATER than the error rows means the answer already exists —\n`;
md += `report it and stop, don't rebuild it. 'ignored' = the owner said it isn't a real problem.\n`;
md += `A 'fixed' row with recurrences > 0 means that fix did NOT hold — fix it properly this time._\n\n`;
if (!handled.length) md += `_None recorded._\n\n`;
for (const h of handled) {
  md += `- **${h.state}** · ${h.restaurant || "(all restaurants)"} · ${h.panel}/${h.action} — \`${h.sig}\`\n`;
  md += `  - ${h.state === "ignored" ? "muted" : "fixed"} ${h.fixed_at} by ${h.fixed_by || "?"}${h.pr_url ? ` · ${h.pr_url}` : ""}`;
  md += h.recurrences ? ` · ⚠ happened ${h.recurrences}× since (last ${h.last_seen_at})\n` : `\n`;
}
md += `\n`;

md += `## Error-level log rows, last 24h (${errors.length})\n\n`;
if (!errors.length) md += `_None._\n`;
for (const e of errors) md += `- [${e.created_at}] ${e.restaurant || "(platform)"} · ${e.panel}/${e.action}: ${e.detail || ""}\n`;

writeFileSync(out, md);
console.log(`✓ wrote ${out}`);
console.log(`  open fix requests: ${requests.length} · errors(24h): ${errors.length} · already handled: ${handled.length}`);
