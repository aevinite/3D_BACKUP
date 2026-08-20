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
// Step 2 is belt-and-braces: mig 183's trigger already clears the group when status flips (present
// on BOTH databases, checked 2026-07-28). Doing it explicitly still earns its keep — it reports the
// exact count back to the terminal, writes the diary line the trigger doesn't, and still clears the
// board for a ticket that was already marked fixed (the trigger only fires on a status CHANGE).
//
// Usage:
//   node scripts/resolve-fix-request.mjs --id <fix-request-uuid> [--pr <url>] [--stack dev|av]
//                                        [--status fixed|dismissed] [--actor "Claude live fix"] [--dry]
//   --stack dev (default) = this repo's dev/backup database (.env.local)
//   --stack av            = the AV LIVE client database (.env.AV.live) — use this when the ticket
//                           was filed on aevinite.shop, i.e. the AV-live watcher popped the window.
//
// ---- THE TICKET CAN BE GONE, AND THE BOARD STILL RED (2026-08-20) -----------------------------
// A Fix-NOW window was opened for `PRINT_SETUP_URL is not defined`, and by the time the session
// got here the fix_requests row had been deleted — a T19 sweep had created that ticket to test the
// "send to Claude" flow and then tidied its own row away, which is correct of the sweep. But this
// script REQUIRED the ticket row and exited 1 without it, so the ten red rows it should have
// cleared stayed on the Repair board, and the loop had to be finished by hand. A red tile nobody
// can clear is exactly as bad as a red tile nobody can trust.
//
// So the board can now be cleared BY THE ERROR MESSAGE, with no ticket at all:
//   node scripts/resolve-fix-request.mjs --sig "PRINT_SETUP_URL is not defined" [--restaurant <uuid>]
// and `--id` + `--sig` together means "close the ticket if it is still there, clear the board
// either way". `--sig` is a plain case-insensitive substring of staff_actions.detail — NOT a LIKE
// pattern, deliberately: the very message that prompted this has an `_` in it, and `_` is LIKE's
// single-character wildcard, so a pattern match would quietly clear more than it was asked to.
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
const sig = flag("sig");
const onlyRestaurant = flag("restaurant");
const prUrl = flag("pr");
const stack = (flag("stack", "dev") || "dev").toLowerCase();
const status = (flag("status", "fixed") || "fixed").toLowerCase();
const actor = flag("actor", "Claude live fix");
const dry = has("dry") || has("dry-run");
// How many DIFFERENT error groups one --sig may clear before it stops and asks to be narrowed.
// A short or vague piece of text ("TimeoutError") matches half the board, and a board wiped by a
// typo is a board the owner cannot trust. Six is generous for one crash's variants (the real case
// was three) and small enough that a runaway match stops instead of scrolling past.
const MAX_GROUPS = Number(flag("max-groups", "6")) || 6;
const SIG_MIN = 12;   // long enough that it names one fault, not a whole category

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

if (!id && !sig) die(`Pass the ticket id: --id <uuid>  (it's in your opening prompt, and in .claude/audits/repair-input-<today>.md)\n  …or, when the ticket row is gone but the board is still red: --sig "<part of the error message>"`);
if (id && !UUID.test(id)) die(`--id must be a uuid (that's the ticket id from your opening prompt)`);
if (sig !== null && sig.trim().length < SIG_MIN) die(`--sig needs at least ${SIG_MIN} characters — a short one matches unrelated problems and would clear the board too widely.`);
if (onlyRestaurant && !UUID.test(onlyRestaurant)) die(`--restaurant must be a uuid`);
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
// stdio silences git's OWN stderr. This probe is EXPECTED to fail whenever the script runs from
// outside a checkout — which is the documented `/tmp/rfr.mjs` fallback in live-fix-prompt.md — and
// the catch below already handles that. Letting git print `fatal: not a git repository` first put
// a red-looking line at the top of a Fix-NOW terminal the owner is watching, above a run that then
// worked perfectly. A message that says "fatal" about something deliberately optional is a lie.
const mainCheckout = () => {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
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

const dbName = stack === "av" ? "AV LIVE" : "dev";

// ---- 1. the ticket (skipped entirely when only --sig was given) --------------
let req = null;
if (id) {
  [req] = await q(`
    SELECT id, status, action_id, summary, restaurant_id
    FROM fix_requests WHERE id = ${lit(id)} LIMIT 1;
  `);
  if (!req && !sig) {
    die(`No fix request with that id on the ${dbName} database.\n` +
        `  If the ticket row is gone but the board is still red, clear it by message instead:\n` +
        `    --sig "<part of the error message>"   (and drop --id, or keep both)`);
  }
  if (!req) console.log(`· that ticket row is gone (deleted, or the queue was trimmed) — clearing the board by message instead.`);
  else {
    console.log(`Ticket: ${String(req.summary || "").slice(0, 120)}`);
    console.log(`  currently: ${req.status}${req.action_id ? " · came from an error row" : " · owner-described"}`);
  }
}

// ---- 2. the error group(s) --------------------------------------------------
// One group = one panel + action + message + restaurant. Same formula as
// /api/admin/resolve-error + groupErrors() in the Repair page, so this clears exactly what the
// website's Resolve button clears — no more, no less.
const groupWhere = (row) => `level = 'error'
      AND ${eqOrNull("panel", row.panel)}
      AND ${eqOrNull("action", row.action)}
      AND ${eqOrNull("detail", row.detail)}
      AND ${eqOrNull("restaurant_id", row.restaurant_id)}`;

const groups = [];
const seenGroup = new Set();                     // --id and --sig can name the same group; clear it once
const addGroup = (row, openCount) => {
  const where = groupWhere(row);
  if (seenGroup.has(where)) return;
  seenGroup.add(where);
  groups.push({ row, where, openCount });
};

// 2a. the group the ticket points at (only when the ticket came from an error row)
if (req?.action_id) {
  const [row] = await q(`
    SELECT panel, action, detail, restaurant_id, level
    FROM staff_actions WHERE id = ${lit(req.action_id)} LIMIT 1;
  `);
  if (!row) console.log(`  note: the original error row is gone (log trimmed) — nothing to clear from the ticket itself.`);
  else if (row.level !== "error") console.log(`  note: that log row isn't an error — nothing to clear from the ticket itself.`);
  else {
    const [c] = await q(`SELECT count(*)::int AS n FROM staff_actions WHERE ${groupWhere(row)} AND resolved_at IS NULL;`);
    addGroup(row, c?.n ?? 0);
  }
}

// 2b. every still-red group whose message CONTAINS --sig. `position(... in ...)` is a literal
// substring test, so `_` and `%` in a crash message mean themselves and nothing else.
if (sig) {
  const needle = sig.trim();
  const found = await q(`
    SELECT panel, action, detail, restaurant_id, count(*)::int AS n
    FROM staff_actions
    WHERE level = 'error' AND resolved_at IS NULL
      AND position(lower(${lit(needle)}) in lower(detail)) > 0
      ${onlyRestaurant ? `AND restaurant_id = ${lit(onlyRestaurant)}` : ""}
    GROUP BY 1, 2, 3, 4
    ORDER BY n DESC
    LIMIT ${MAX_GROUPS + 1};
  `);
  if (!found.length) console.log(`· no red rows on the ${dbName} board contain that text — nothing to clear by message.`);
  if (found.length > MAX_GROUPS) {
    die(`"${needle}" matches more than ${MAX_GROUPS} different problems on the board.\n` +
        `  That is almost always a too-vague --sig. Paste more of the exact message, add --restaurant <uuid>,\n` +
        `  or raise the ceiling on purpose with --max-groups <n>.`);
  }
  for (const row of found) addGroup(row, row.n);
}

for (const g of groups) {
  console.log(`  ${String(g.openCount).padStart(3)} red row${g.openCount === 1 ? " " : "s"} · ${g.row.panel}/${g.row.action} — ${String(g.row.detail || "").slice(0, 90)}`);
}

if (dry) {
  console.log(`\n(dry run — nothing changed)`);
  if (req) console.log(`would set fix_requests.status='${status}'${prUrl ? `, pr_url='${prUrl}'` : ""}, resolved_at=now()`);
  else if (id) console.log(`would leave the ticket alone — its row no longer exists`);
  console.log(groups.length
    ? `would set staff_actions.resolved_at=now() on the open rows of ${groups.length} error group${groups.length === 1 ? "" : "s"} above, + one 'error_resolved' diary line each`
    : `would clear nothing from the Repair board`);
  process.exit(0);
}

// ---- 3. do it (board first, so a half-run never leaves a "fixed" ticket with a red tile) ----
let cleared = 0;
for (const group of groups) {
  const rows = await q(`
    UPDATE staff_actions SET resolved_at = now()
    WHERE ${group.where} AND resolved_at IS NULL
    RETURNING id;
  `);
  const n = Array.isArray(rows) ? rows.length : 0;
  cleared += n;
  if (!n) continue;                              // another session cleared it between the read and here
  const detail = `Resolved: ${String(group.row.detail || group.row.action).slice(0, 100)}${n > 1 ? ` (×${n})` : ""}`;
  await q(`
    INSERT INTO staff_actions (panel, action, detail, level, actor${group.row.restaurant_id ? ", restaurant_id" : ""})
    VALUES ('admin', 'error_resolved', ${lit(detail)}, 'info', ${lit(actor)}${group.row.restaurant_id ? `, ${lit(group.row.restaurant_id)}` : ""});
  `);
}

if (req) {
  await q(`
    UPDATE fix_requests
    SET status = ${lit(status)},
        resolved_at = now()${prUrl ? `,\n        pr_url = ${lit(prUrl)}` : ""}
    WHERE id = ${lit(id)};
  `);
}

// ---- 4. plain-language receipt ---------------------------------------------
const where = stack === "av" ? "AV live" : "dev/backup";
console.log(req
  ? `\n✓ ${where}: ticket marked ${status}${prUrl ? " with its PR link" : ""}.`
  : `\n· ${where}: no ticket to mark${id ? " — that row was already gone" : ""}.`);
console.log(cleared
  ? `✓ ${where}: cleared ${cleared} red row${cleared === 1 ? "" : "s"} from the Repair board (same as pressing Resolve on the website).`
  : `· nothing left to clear on the Repair board.`);
console.log(`Refresh admin → Repair to see it: the problem tile is gone${req ? " and the ticket sits under History" : ""}.`);
