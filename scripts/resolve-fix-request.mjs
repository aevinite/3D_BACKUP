// Close the loop on a "Fix NOW" ticket — the terminal equivalent of the owner pressing
// RESOLVE on the admin Repair board (owner 2026-07-28: "that same session should also make it
// live and click resolve on the website itself").
//
// Run it ONLY after the fix is merged AND verified live. It does exactly what the panel does:
//   1. fix_requests row  → status='fixed' (or 'dismissed'), pr_url, resolved_at=now()
//        (same as PATCH /api/admin/fix-request — clears it from the queue count)
//   2. its error group    → staff_actions.resolved_at=now() on every still-open error row with
//        the same panel + action + message + restaurant
//        (same as POST /api/admin/resolve-error — clears the red tile in "Problems right now",
//         the dashboard red button, and the red styling in Logs)
//   3. one 'error_resolved' diary line, so the activity log shows who cleared it
//
// Usage:
//   node scripts/resolve-fix-request.mjs --id <fix-request-uuid> [--pr <url>] [--stack dev|av]
//                                        [--status fixed|dismissed] [--actor "Claude live fix"] [--dry]
//   --stack dev (default) = this repo's dev/backup database (.env.local)
//   --stack av            = the AV LIVE client database (.env.AV.live) — use this when the ticket
//                           was filed on aevinite.shop, i.e. the AV-live watcher popped the window.
//
// Reads the DB through the Management API (same PAT pattern as fetch-fix-requests.mjs /
// apply-migration.mjs). Prints only counts and plain sentences — never a secret.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- args -------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const id = flag("id");
const prUrl = flag("pr");
const stack = (flag("stack", "dev") || "dev").toLowerCase();
const status = (flag("status", "fixed") || "fixed").toLowerCase();
const actor = flag("actor", "Claude live fix");
const dry = has("dry") || has("dry-run");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

if (!id || !UUID.test(id)) die(`Pass the ticket id: --id <uuid>  (it's in your opening prompt, and in .claude/audits/repair-input-<today>.md)`);
if (!["dev", "av"].includes(stack)) die(`--stack must be dev or av`);
if (!["fixed", "dismissed"].includes(status)) die(`--status must be fixed or dismissed`);

// ---- connection (env file chosen by --stack) ---------------------------------
const parseEnv = (t) =>
  Object.fromEntries(
    t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
      const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
  );

const envFile = stack === "av" ? ".env.AV.live" : ".env.local";
// Keys live only in the MAIN checkout — a git worktree (how live-fix sessions work) has none,
// so fall back to the main worktree's copy before giving up.
const mainCheckout = () => {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root })
      .toString().trim();
    return dirname(common); // .../repo/.git → .../repo
  } catch { return null; }
};
const envPath = [root, process.cwd(), mainCheckout()]
  .filter(Boolean).map((d) => join(d, envFile)).find((p) => existsSync(p));
if (!envPath) die(`Can't find ${envFile} (looked in this folder and the main checkout).`);
const env = parseEnv(readFileSync(envPath, "utf8"));
const pat = env.SUPABASE_ACCESS_TOKEN;
if (!pat) die(`Missing SUPABASE_ACCESS_TOKEN in ${envFile}`);
if (!env.NEXT_PUBLIC_SUPABASE_URL) die(`Missing NEXT_PUBLIC_SUPABASE_URL in ${envFile}`);
const projectRef = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json", "User-Agent": "curl/8" },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`query failed HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// SQL literal; the error message we match on is free text and can contain quotes.
const lit = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const eqOrNull = (col, v) => (v === null || v === undefined ? `${col} IS NULL` : `${col} = ${lit(v)}`);

// ---- 1. the ticket ----------------------------------------------------------
const [req] = await q(`
  SELECT id, status, action_id, summary, restaurant_id
  FROM fix_requests WHERE id = ${lit(id)} LIMIT 1;
`);
if (!req) die(`No fix request with that id on the ${stack === "av" ? "AV LIVE" : "dev"} database.`);
console.log(`Ticket: ${String(req.summary || "").slice(0, 120)}`);
console.log(`  currently: ${req.status}${req.action_id ? " · came from an error row" : " · owner-described"}`);

// ---- 2. its error group (only when the ticket came from an error row) --------
let group = null;
if (req.action_id) {
  const [row] = await q(`
    SELECT panel, action, detail, restaurant_id, level
    FROM staff_actions WHERE id = ${lit(req.action_id)} LIMIT 1;
  `);
  if (!row) console.log(`  note: the original error row is gone (log trimmed) — nothing to clear on the board.`);
  else if (row.level !== "error") console.log(`  note: that log row isn't an error — nothing to clear on the board.`);
  else {
    // Same group formula as /api/admin/resolve-error + groupErrors() in the Repair page.
    group = {
      row,
      where: `level = 'error'
      AND ${eqOrNull("panel", row.panel)}
      AND ${eqOrNull("action", row.action)}
      AND ${eqOrNull("detail", row.detail)}
      AND ${eqOrNull("restaurant_id", row.restaurant_id)}`,
    };
    const [c] = await q(`SELECT count(*)::int AS n FROM staff_actions WHERE ${group.where} AND resolved_at IS NULL;`);
    console.log(`  red rows still on the board for this problem: ${c?.n ?? 0}`);
  }
}

if (dry) {
  console.log(`\n(dry run — nothing changed)`);
  console.log(`would set fix_requests.status='${status}'${prUrl ? `, pr_url='${prUrl}'` : ""}, resolved_at=now()`);
  if (group) console.log(`would set staff_actions.resolved_at=now() on the open rows of that error group + write one 'error_resolved' diary line`);
  process.exit(0);
}

// ---- 3. do it (board first, so a half-run never leaves a "fixed" ticket with a red tile) ----
let cleared = 0;
if (group) {
  const rows = await q(`
    UPDATE staff_actions SET resolved_at = now()
    WHERE ${group.where} AND resolved_at IS NULL
    RETURNING id;
  `);
  cleared = Array.isArray(rows) ? rows.length : 0;
  const detail = `Resolved: ${String(group.row.detail || group.row.action).slice(0, 100)}${cleared > 1 ? ` (×${cleared})` : ""}`;
  await q(`
    INSERT INTO staff_actions (panel, action, detail, level, actor${group.row.restaurant_id ? ", restaurant_id" : ""})
    VALUES ('admin', 'error_resolved', ${lit(detail)}, 'info', ${lit(actor)}${group.row.restaurant_id ? `, ${lit(group.row.restaurant_id)}` : ""});
  `);
}

await q(`
  UPDATE fix_requests
  SET status = ${lit(status)},
      resolved_at = now()${prUrl ? `,\n      pr_url = ${lit(prUrl)}` : ""}
  WHERE id = ${lit(id)};
`);

// ---- 4. plain-language receipt ---------------------------------------------
const where = stack === "av" ? "AV live" : "dev/backup";
console.log(`\n✓ ${where}: ticket marked ${status}${prUrl ? " with its PR link" : ""}.`);
console.log(cleared
  ? `✓ ${where}: cleared ${cleared} red row${cleared === 1 ? "" : "s"} from the Repair board (same as pressing Resolve on the website).`
  : `· nothing left to clear on the Repair board.`);
console.log(`Refresh admin → Repair to see it: the problem tile is gone and the ticket sits under History.`);
