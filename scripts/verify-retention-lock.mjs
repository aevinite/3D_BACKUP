// verify-retention-lock.mjs — the admin can LOCK how long logs are kept, and the restaurant SEES it.
//
// WHERE THIS BITES:
//   · Admin console → Settings → "Log retention" card → the "Lock this for every restaurant" switch.
//   · Manager panel → Audit & logs → Activity log / Customer log → the "Logs kept for …" chip in
//     the header. Locked, it reads "🔒 set by Aevidine"; unlocked and viewed by a manager, it reads
//     "owner only". Neither is a dropdown for them.
//
// THE RULE (owner, 2026-08-21, answering "should the 1-month cap be enforced?"):
//   *"make sure admin can do only lock for mangaer and ever admin do will be visible to manager"*
// So the admin does NOT silently cap the product — the admin locks, and the lock is visible to the
// restaurant. Three things have to stay true, and each of them broke once while being built:
//
//   1. THE CHECK MUST SIT ABOVE THE MANAGER GATES. Placed next to the strip list it was dead code:
//      a manager hits permDenied("change that setting") first, which blames a permission that
//      cannot exist for this field.
//   2. THE LOCK MUST NOT BE CACHED. A 30-second cache meant that after locking, a manager's screen
//      still said "owner only" and an owner's write was still ACCEPTED for up to half a minute.
//   3. THE PANEL MUST REPEAT THE SERVER'S ANSWER, never draw a control it cannot prove is allowed.
//
// READ-ONLY: four source files, no database, no network.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const QUIET = process.argv.includes("--quiet");
let failed = 0;
const want = (cond, msg) => { if (cond) { if (!QUIET) console.log("  ✓ " + msg); } else { console.log("  ✗ " + msg); failed++; } };

const ADMIN_API = read("app/api/admin/settings/route.ts");
const ADMIN_UI  = read("app/aevinite/settings/page.tsx");
const EDITOR    = read("app/api/editor/[...path]/route.ts");
const PANEL     = read("public/panels/editor/app.js");

// ── the admin end ────────────────────────────────────────────────────────────────────────────
want(/log_retention_lock/.test(ADMIN_API) && /app_config/.test(ADMIN_API),
  "the lock lives in app_config, not as two more columns on `settings`");
want(/retention_lock/.test(ADMIN_API) && /upsert\(\{ key: LOCK_KEY/.test(ADMIN_API),
  "the admin console can write the lock");
want(/log retention LOCKED for every restaurant/.test(ADMIN_API),
  "…and turning it on is AUDITED as its own event, not folded into a window change");
want(/Lock this for every restaurant/.test(ADMIN_UI),
  "the admin screen actually shows the switch (a backend-only lock would be invisible)");
want(!/platform default<\/span>/.test(ADMIN_UI) && /applies the window to every restaurant/.test(ADMIN_UI),
  "the card stops calling it a 'default' — saving rewrites every restaurant, and now says so");
want(/set by Aevidine/.test(ADMIN_UI),
  "…and it tells the admin that the restaurant will SEE the lock (his actual requirement)");

// ── the server end ───────────────────────────────────────────────────────────────────────────
want(/function canSetRetention/.test(EDITOR) && /retention_manager_blocked/.test(EDITOR) && /retention_locked/.test(EDITOR),
  "the panel's server refuses retention with a REASON CODE, so the screen can name which reason");
want(/role !== "owner"\) return \{ ok: false, code: "retention_manager_blocked" \}/.test(EDITOR),
  "a manager can never set it — not a permission an owner can grant (compliance §3)");
want(!/retLockCache|Cached for 30s/.test(EDITOR),
  "the lock is NOT cached — locking has to take effect on the next request, not 30s later");
want(/if \(r\.error\) return \{ locked: true, at: null \}/.test(EDITOR),
  "…and a failed read fails CLOSED, so a database hiccup can never widen what a restaurant may do");
{
  // The ordering bug, guarded by position rather than by prose.
  const check = EDITOR.indexOf('"oplog_retention_days" in body');
  const gate  = EDITOR.indexOf('return permDenied("change that setting")');
  want(check > -1 && gate > -1 && check < gate,
    "the retention answer comes BEFORE permDenied('change that setting'), or it is unreachable");
}

// ── the screen ───────────────────────────────────────────────────────────────────────────────
want(/XRAY_WHO\.retention/.test(PANEL),
  "the panel repeats whoami.retention instead of guessing who may edit");
want(/if \(!R \|\| R\.canEdit !== true\)/.test(PANEL),
  "…and with no proven yes it draws the READ-ONLY form — never a control that can only fail");
want(/set by Aevidine/.test(PANEL) && /owner only/.test(PANEL),
  "the read-only chip carries its reason: who set it, or that it is the owner's to set");
want(/e\.data && e\.data\.code/.test(PANEL),
  "a refusal is read from api()'s real contract (e.data.code), or the branch never runs");
want(/ret-ctl-ro/.test(read("public/panels/editor/style.css")),
  "the read-only chip has styles, so it doesn't render as bare text");

console.log(failed
  ? `\n✗ ${failed} check${failed === 1 ? "" : "s"} failed — the retention lock is not holding\n`
  : "\n✓ the admin can lock log retention, and the restaurant is told who did\n");
process.exit(failed ? 1 : 0);
