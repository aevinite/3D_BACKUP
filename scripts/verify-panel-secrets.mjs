#!/usr/bin/env node
// verify-panel-secrets.mjs — a settings row handed to a PANEL must go through panelSafeSettings().
//
// WHY (T17 API sweep, 2026-08-13, finding F1). The manager panel's boot bundle and the waiter
// tablet's floor refresh both read `settings` with `select("*")` and shipped the whole row to the
// browser. That row carries `platform_channels`, i.e. the delivery apps' connection KEYS — the two
// admin screens that manage those keys deliberately never hand the value back, and these two did,
// once a minute per tablet, for a value no panel file reads at all.
//
// The fix is one shared strip (lib/panelSettings.ts). This is the guard that keeps it: the reason a
// rule like this comes back is that the NEXT person to add a settings-shaped payload has no way to
// know the rule exists. Now the build tells them.
//
// WHAT IT CHECKS, deliberately narrowly (a guard that cries wolf gets switched off):
//   1. lib/panelSettings.ts still exists and still names the credential columns.
//   2. Every route that reads `settings` with `select("*")` AND sends a row to a client either
//      strips it or is on the NOT_A_PANEL list below with a stated reason.
//   3. No panel-facing route mentions a credential column by name outside the shared list.
//
// Run: node scripts/verify-panel-secrets.mjs   (or npm run verify:panel-secrets)
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
const oks = [];
const ok = (m) => oks.push(m);
const fail = (m) => fails.push(m);

// Routes that read the settings row with `select("*")` and do NOT hand it to a browser. Each is
// listed with WHY, so this is a set of decisions rather than a way to silence the check.
const NOT_A_PANEL = {
  "app/api/admin/restaurants/route.ts": "reads restaurant #1 as a TEMPLATE for a new tenant; nothing is returned",
  "app/api/admin/restaurants/settings/route.ts": "same template clone; the response is the admin's own allow-listed set",
  "app/api/admin/restaurants/staff-features/route.ts": "same template clone",
  "app/api/admin/restaurants/google-review/route.ts": "same template clone",
  "app/api/admin/restaurants/access-tree/route.ts": "same template clone",
  "app/api/admin/restaurants/platform-channels/route.ts": "same template clone; its own answer is hasKey only",
  "app/api/admin/restaurants/quick-features/route.ts": "same template clone",
  "app/api/admin/restaurants/bill-preview/route.ts": "renders HTML server-side; the row never leaves as data",
  // NOT listed: app/api/admin/restaurants/export/route.ts. The recovery backup is a FILE that
  // leaves the building, which is the one case where "it's only the admin" stops being a reason —
  // so it has to pass the same strip as the panels, and the check below enforces exactly that.
};

// 1 ── the shared list still exists
const libPath = join(root, "lib/panelSettings.ts");
if (!existsSync(libPath)) {
  fail("lib/panelSettings.ts is gone — the one list of credential columns has no home");
} else {
  const lib = readFileSync(libPath, "utf8");
  if (!/PRIVATE_SETTINGS_COLUMNS/.test(lib) || !/platform_channels/.test(lib)) {
    fail("lib/panelSettings.ts no longer names platform_channels — the delivery keys would ship again");
  } else {
    ok("lib/panelSettings.ts names the credential columns");
  }
  if (!/export function panelSafeSettings/.test(lib)) fail("panelSafeSettings() is gone from lib/panelSettings.ts");
  else ok("panelSafeSettings() is exported");
}

// 2 ── every settings-row payload strips, or says why it isn't one
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === "route.ts") out.push(p);
  }
  return out;
}
const routes = walk(join(root, "app/api"));
// NOTHING TO CHECK IS A FAILURE, NOT A PASS (sweep #7 / T28, 2026-08-27). The route half of this
// guard walks app/api for its subjects; an empty walk would leave only the two named-file checks
// running and still print "all N checks passed". The floor is well below today's real count.
if (routes.length < 30) {
  console.log(`\n✗ verify:panel-secrets walked only ${routes.length} route file(s) under app/api — there are dozens. The route checks did not run.`);
  process.exit(1);
}
let checked = 0;
for (const file of routes) {
  const src = readFileSync(file, "utf8");
  const rel = relative(root, file);
  // Does it read the whole settings row?
  if (!/from\("settings"\)\s*\.select\("\*"\)/.test(src)) continue;
  checked++;
  if (NOT_A_PANEL[rel]) { ok(`${rel} — not a panel payload (${NOT_A_PANEL[rel]})`); continue; }
  if (/panelSafeSettings\(/.test(src)) { ok(`${rel} — strips the credential columns before sending`); continue; }
  fail(`${rel} reads the whole settings row and hands it on without panelSafeSettings() — the delivery-channel key would reach a browser`);
}
if (!checked) fail("no route reads settings with select(\"*\") any more — this guard is checking nothing; retire it or fix the pattern");
else ok(`${checked} route(s) read the whole settings row; every one is accounted for`);

// 3 ── the export's staff rows still drop their hashes (the sibling promise in the same file)
const exp = join(root, "app/api/admin/restaurants/export/route.ts");
if (existsSync(exp)) {
  const src = readFileSync(exp, "utf8");
  if (/password_hash|pin_hash/.test(src.replace(/^\s*\/\/.*$/gm, ""))) {
    fail("the recovery backup selects a password/pin hash — a backup must never carry one");
  } else ok("the recovery backup still leaves password + PIN hashes out");
}

for (const m of oks) console.log("  ok   " + m);
for (const m of fails) console.log("  FAIL " + m);
console.log(fails.length
  ? `\n✗ ${fails.length} problem(s) — a credential could reach a panel.`
  : `\n✅ all ${oks.length} checks passed — no panel payload carries a stored credential.`);
process.exit(fails.length ? 1 : 0);
