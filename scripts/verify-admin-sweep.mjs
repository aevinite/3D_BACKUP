#!/usr/bin/env node
// verify-admin-sweep.mjs — SWEEP #8 · TERMINAL 17, ROUND 2. Phases P98201–P98700 (500).
//
// ── WHY THIS RUN EXISTS ─────────────────────────────────────────────────────────────────────────
//
// Owner, 2026-09-02, after his four items were merged and deployed to backup:
//
//   "after making it live and merging plan 500 phases test within your boundaries make sure it
//    cover everthing within your boundries and test everything again if any error left
//    your boundary is the admin panel all this error and stuff things"
//
// So the territory is the ADMIN CONSOLE — `/aevinite` and `/api/admin/*` — which is T17's ground
// in `.claude/sweep/LEDGER/T17.md` (health, logs, issues & limits), widened here to the whole
// console because he said "everything within your boundaries".
//
// ── HOW THE 500 WERE PLANNED: BY MEASURING, NEVER BY IMAGINATION ─────────────────────────────────
//
// The ledger's own rule, learned the hard way across five sweeps that each invented a different
// set of checks and converged on nothing. Every count below was READ off the repo at plan time,
// and every one is re-read at RUN time by this file rather than trusted:
//
//     find app/aevinite -name page.tsx | wc -l      → 23 pages
//     find app/api/admin -name route.ts | wc -l     → 49 routes
//     grep -rl tokenIsValid app/api/admin           → 49 (must equal the above)
//
// That is why bands B, C and E are GENERATED from the filesystem instead of typed out: a hand-typed
// list of 23 pages goes stale the day someone adds the 24th, and then the sweep quietly stops
// covering it while still reporting 500 passes. A generated band cannot drift from the product.
//
// ── THE BANDS ───────────────────────────────────────────────────────────────────────────────────
//
//   A · P98201–P98300 (100) — the four things he asked for in this same message, every rule and
//                             every surface: plain-English logs, alerts landing on their control,
//                             the Fix-now door, the night-run labelling.
//   B · P98301–P98380  (80) — every admin page actually renders, at 1440px and at 390px.
//   C · P98381–P98460  (80) — every admin request requires being signed in, and answers when it is.
//   D · P98461–P98540  (80) — a failed read never draws an all-clear; unknown is said as unknown.
//   E · P98541–P98620  (80) — every link and button on every admin screen leads somewhere real.
//   F · P98621–P98700  (80) — every word a person reads: no raw codes, no machine language.
//
// ── SAFE-AUDIT WORDING (CLAUDE.md, read first every session) ────────────────────────────────────
//
// Band C is a PRODUCT-CORRECTNESS check, asked and worded as one: "does every admin request
// require being logged in?" It reads the code and makes ordinary, signed-out requests to its own
// dev server — exactly what a browser does before you log in. It swaps no ids, replays nothing as
// anybody else, and proves nothing by trickery. A gap found by reading is REPORTED, never poked at.
//
// ── SAFETY ──────────────────────────────────────────────────────────────────────────────────────
//
//   · Refuses to run against anything but the dev/test database (shared devStacks allow-list).
//   · READ-ONLY: every request is a GET. Nothing in this file writes a row, so there is nothing to
//     clean up and no chance of it reporting another session's writes as faults.
//   · Signs in ZERO times: it presents the admin cookie the gate already accepts (sha256 of
//     ADMIN_PASSWORD), so it can never raise a failed-login row, trip the IP throttle, or alert.
//     Posting JSON to /api/staff-login silently fails there — three "checks" once became three
//     wrong-password attempts and raised a limit event about the owner's own panel (2026-07-30).
//   · One at a time (pid lock), like the printing sweep, so two copies cannot read each other's
//     half-loaded pages and report them as faults.
//
// Run:  node scripts/verify-admin-sweep.mjs --base http://localhost:4000
//       npm run verify:admin-sweep -- --base http://localhost:4000 --from 1 --to 50
import { readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { refuseUnlessDevTestDb } from "./sweep/devStacks.mjs";
// The shared app-up preflight: a guard that drives the app must say "the app is not running" in
// one plain sentence and exit 2, never throw a stack trace at somebody who simply forgot to start
// the dev server. A guard that cannot run looks exactly like a guard nobody ran.
import { requireUp } from "./sweep/appUp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };

// ── one at a time ───────────────────────────────────────────────────────────────────────────────
const LOCK = "/tmp/admin-sweep.pid";
try {
  const alive = Number(readFileSync(LOCK, "utf8"));
  if (alive && alive !== process.pid) {
    try { process.kill(alive, 0); } catch { throw new Error("stale"); }
    console.log(`\nAnother admin sweep is already running (pid ${alive}). Two of them read each other's\nhalf-loaded pages and report them as faults. Waiting is the right move.`);
    process.exit(2);
  }
} catch { /* stale or absent — take it */ }
try { writeFileSync(LOCK, String(process.pid)); } catch {}
const dropLock = () => { try { if (Number(readFileSync(LOCK, "utf8")) === process.pid) unlinkSync(LOCK); } catch {} };
process.on("exit", dropLock);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { dropLock(); process.exit(130); });

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = (arg("--base", "http://localhost:4000") || "").replace(/\/$/, "");
const FROM = Number(arg("--from", 0)) || 0;
const TO = Number(arg("--to", 0)) || Infinity;
const QUIET = process.argv.includes("--quiet");
// --ledger: plan every phase and print the markdown table, without executing anything. Used to
// regenerate .claude/sweep/LEDGER/T17-R2.md so the rows and the checks cannot disagree.
const LEDGER = process.argv.includes("--ledger");

const env = Object.fromEntries(read(".env.local").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "the admin console sweep");

const ADMIN_COOKIE = "lfh_staff_auth=" + createHash("sha256").update(env.ADMIN_PASSWORD || "").digest("hex");
const get = (path, opts = {}) => fetch(BASE + path, {
  redirect: "manual", cache: "no-store",
  headers: { ...(opts.signedOut ? {} : { cookie: ADMIN_COOKIE }) },
}).catch((e) => ({ ok: false, status: 0, _err: e.message, text: async () => "", headers: new Map() }));

// ── the phase runner ────────────────────────────────────────────────────────────────────────────
const FIRST_ID = 98201;
let n = 0;
const pass = [], fail = [], skipped = [];
const idOf = (i) => "P" + (FIRST_ID + i - 1);
// The LEDGER rows are generated from this file, never typed alongside it (--ledger). A hand-kept
// table drifts from the checks it claims to describe within days, and then "re-run row P98317" is
// a sentence that means nothing — which is the exact failure the ledger exists to prevent.
let band = "?";
const rows = [];
async function phase(title, fn) {
  n += 1;
  const id = idOf(n);
  rows.push({ id, band, title });
  if (LEDGER) return;
  if (n < FROM || n > TO) { skipped.push(id); return; }
  let r;
  try { r = await fn(); } catch (e) { r = `threw: ${e && e.message ? e.message : String(e)}`; }
  if (r === true) { pass.push(id); if (!QUIET) console.log(`  ✓ ${id}  ${title}`); }
  else { fail.push({ id, title, why: typeof r === "string" ? r : "returned " + JSON.stringify(r) }); console.log(`  ✗ ${id}  ${title}\n        ${r}`); }
}
// A phase that cannot be answered here is recorded as UNANSWERED, never as a pass. "Not reachable
// on the screen I opened" is a statement about the screen, not about the product (ledger lesson).
const unanswered = [];
async function needs(cond, title, why) {
  n += 1; const id = idOf(n);
  rows.push({ id, band, title });
  if (LEDGER) return false;
  if (n < FROM || n > TO) { skipped.push(id); return false; }
  if (cond) return true;
  unanswered.push({ id, title, why });
  console.log(`  ? ${id}  ${title}\n        UNANSWERED: ${why}`);
  return false;
}

// ── measured territory, re-read at run time ─────────────────────────────────────────────────────
const walk = (dir, out = []) => {
  for (const e of readdirSync(join(root, dir))) {
    const rel = `${dir}/${e}`;
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
};
const ADMIN_PAGES = walk("app/aevinite").filter((f) => f.endsWith("/page.tsx"))
  .map((f) => "/" + f.replace(/^app\//, "").replace(/\/page\.tsx$/, "").replace(/^aevinite$/, "aevinite"))
  .map((u) => (u === "/aevinite" ? "/aevinite" : u))
  .filter((u) => !/\[/.test(u))                                  // no dynamic admin pages today
  .sort();
const ADMIN_ROUTES = walk("app/api/admin").filter((f) => f.endsWith("/route.ts")).sort();
const routeUrl = (f) => "/" + f.replace(/^app\//, "").replace(/\/route\.ts$/, "").replace(/\[\.\.\.[^\]]+\]/g, "x").replace(/\[[^\]]+\]/g, "x");

const SRC = {
  plainError: read("lib/plainError.ts"),
  adminJump: read("lib/adminJump.ts"),
  logs: read("app/aevinite/logs/page.tsx"),
  repair: read("app/aevinite/repair/page.tsx"),
  health: read("app/aevinite/health/page.tsx"),
  limits: read("app/aevinite/rate-limits/page.tsx"),
  dash: read("app/aevinite/page.tsx"),
  rests: read("app/aevinite/restaurants/page.tsx"),
  owners: read("app/aevinite/owners/page.tsx"),
  shared: read("components/admin/shared.tsx"),
  modal: read("components/admin/LogDetailModal.tsx"),
  bell: read("components/admin/NotificationBell.tsx"),
  creds: read("components/admin/CredentialsCard.tsx"),
  oplog: read("lib/oplog.ts"),
  clientErr: read("app/api/log/client-error/route.ts"),
  ownerAct: read("app/owner/activity/page.tsx"),
  panelJs: read("public/panels/editor/app.js"),
  editorRoute: read("app/api/editor/[...path]/route.ts"),
  dashRoute: read("app/api/admin/dashboard/route.ts"),
  healthRoute: read("app/api/admin/health/route.ts"),
};
// Comments are not the code. Line comments first: a `/*` inside a `//` line opens a block that
// swallows to the next `*/`, which once hid 190 lines from two shipped guards.
const strip = (s) => s.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
const CODE = Object.fromEntries(Object.entries(SRC).map(([k, v]) => [k, strip(v)]));

const { plainProblem, plainHeadline, screenName, legacyJsonDetail } = await import("../lib/plainError.ts");

// Every one of these was READ OUT OF THE DEV DATABASE on 2026-09-02 — the 60 newest level:'error'
// rows plus a 3,000-row sweep over every distinct action. Not invented.
const REAL_ERRORS = [
  "Failed to load chunk /_next/static/chunks/1g1jwpgiikpwc.js from module 64893 @ /manager/no-such-page [Safari · Mac]",
  "Failed to load chunk /_next/static/chunks/1g1jwpgiikpwc.js from module 64893 @ /no-such-thing/at-all [Safari · Mac]",
  "Failed to load chunk /_next/static/chunks/1g1jwpgiikpwc.js from module 64893 @ /signup [Safari · Mac]",
  "Failed to load chunk /_next/static/chunks/1g1jwpgiikpwc.js from module 64893 @ /aevinite/no-such-page [Safari · Mac]",
  "Failed to load chunk /_next/static/chunks/1g1jwpgiikpwc.js from module 64893 @ /owner/no-such-page [Safari · Mac]",
  "Failed to load chunk /_next/static/chunks/1g1jwpgiikpwc.js from module 64893 @ /tablet/no-such-page [Safari · Mac]",
  "Failed to load chunk /_next/static/chunks/1g1jwpgiikpwc.js from module 64893 @ /kitchen/no-such-page [Safari · Mac]",
  "Failed to load chunk /_next/static/chunks/1g1jwpgiikpwc.js from module 64893 @ /r/french-house/menu/no-such-page [Safari · Mac]",
  "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node. @ /r/aangan-garden-restaurant/menu [Safari · Mac]",
  "GET summary — TimeoutError: The operation was aborted due to timeout",
  "Invalid count value: -1 @ /owner/issues [Safari · Mac]",
  "Couldn't look up restaurant \"french-house\": TypeError: fetch failed @ /r/french-house/menu #2220843683 [Safari · Mac]",
  "mode is not defined @ app.js@e5b15272:13942 <- app.js@e5b15272:2676 [Safari · Mac]",
  "Cannot read properties of undefined (reading 'length') @ /aevinite/revenue [Safari · Mac]",
  "Cannot read properties of undefined (reading 'tone') @ /aevinite/bill-audit [Safari · Mac]",
  "Cannot read properties of undefined (reading 'length') @ /aevinite [Safari · Mac]",
  "Cannot convert undefined or null to object @ /aevinite/revenue [Safari · Mac]",
  "Uncaught ReferenceError: PRINT_SETUP_URL is not defined @ /kitchen [Chrome · Mac]",
];
// Shapes the app can produce that were NOT in the sample — checked so the translator covers the
// classes it claims to, not only the rows that happened to be there on one day.
const PLAUSIBLE_ERRORS = [
  "the server replied with an error page instead of data: \"supabase.co | 522: Connection timed out\"",
  "permission denied for table staff_actions",
  "new row violates row-level security policy for table \"orders\"",
  "duplicate key value violates unique constraint \"menu_items_slug_key\"",
  "insert or update on table \"orders\" violates foreign key constraint \"orders_session_id_fkey\"",
  "invalid input syntax for type uuid: \"undefined\"",
  "JWT expired",
  "deadlock detected",
  "remaining connection slots are reserved for non-replication superuser connections",
  "Maximum call stack size exceeded @ /aevinite/floor [Chrome · Mac]",
  "Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.",
  "AbortError: The user aborted a request. @ /aevinite/analytics [Safari · Mac]",
  "Load failed @ /aevinite/logs [Safari · iPhone]",
  "x is not a function @ app.js@abc12345:100 [Chrome · Mac]",
];
// Words that mean the sentence is still the machine's. Checked against the PLAIN half only.
const MACHINE = [
  /TypeError|ReferenceError|DOMException|TimeoutError|AbortError|ChunkLoadError/,
  /\bundefined\b|\bnull\b/,
  /_next|\.js:\d|removeChild|insertBefore|JSON|uuid/i,
  /[{}]|"[a-z_]+":/,
  /\bupdated_at\b|\bupdated_by\b|\bmax_count\b|\bwindow_seconds\b|\brestaurant_id\b|\bstaff_actions\b/,
];
const machineWordIn = (s) => MACHINE.find((re) => re.test(s));

// Bands B, C, E and part of F drive the running site, so the preflight happens before any of it —
// once, with a sentence, rather than eighty phases each failing with "no answer".
await requireUp(BASE, "the admin console sweep (bands B, C, E and the live half of F)");

console.log(`\nADMIN CONSOLE SWEEP — sweep #8 · T17 round 2 · phases ${idOf(1)}–P98700`);
console.log(`base ${BASE} · ${ADMIN_PAGES.length} pages · ${ADMIN_ROUTES.length} admin routes · read-only, zero logins\n`);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND A · P98201–P98300 — the four things he asked for, checked rule by rule
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "A · the four items just shipped";
console.log("── A · the four items just shipped ─────────────────────────────────────────────");

// A1 · every measured real error row reads as English, and the exact text survives (18 + 14)
for (const raw of [...REAL_ERRORS, ...PLAUSIBLE_ERRORS]) {
  await phase(`reads as English: "${raw.slice(0, 46)}…"`, () => {
    const p = plainProblem(raw);
    if (!p.translated) return `no plain words — the browser's own sentence would print on the Errors list`;
    const bad = machineWordIn(p.headline);
    if (bad) return `plain sentence still machine-worded (${bad}): "${p.headline}"`;
    if (p.technical !== raw) return `the exact text was altered — Send to Claude and the ×N grouping read it byte for byte`;
    if (p.headline.length > 100) return `headline is ${p.headline.length} chars; the log row is one line and clips it`;
    if (/\n/.test(plainHeadline(raw))) return `list line is more than one line`;
    return true;
  });
}
// A2 · an unmapped message is quoted, never dressed up
await phase("an unmapped message is quoted in full and flagged untranslated", () => {
  const p = plainProblem("zzz nobody has written a rule for this @ /aevinite/health [Safari · Mac]");
  if (p.translated) return "reported itself as translated — the honest fallback became a lie";
  if (!p.headline.includes("zzz nobody has written a rule for this")) return "the message was not quoted in full";
  return true;
});
await phase("an empty detail still says something", () => {
  const p = plainProblem("");
  return (p.headline && !p.translated) || "an empty detail must produce a sentence, and must not claim to be translated";
});
await phase("a detail that is only whitespace is treated as empty", () => plainProblem("   ").headline.length > 0 || "no sentence for a blank detail");
// A3 · no address prints as a raw path (20)
for (const [path, want] of [
  ["/aevinite", "Dashboard"], ["/aevinite/revenue", "Revenue"], ["/aevinite/bill-audit", "Bills"],
  ["/aevinite/logs", "Audit & logs"], ["/aevinite/repair", "Repair & support"], ["/aevinite/health", "System health"],
  ["/aevinite/rate-limits", "Rate limits"], ["/aevinite/access", "Access & permissions"],
  ["/owner/issues", "Feedback"], ["/owner/reports", "Reports"], ["/owner", "Owner dashboard"],
  ["/manager", "Manager panel"], ["/kitchen", "Kitchen screen"], ["/tablet", "Waiter tablet"],
  ["/menu", "Guest menu"], ["/q/ABC123", "QR"], ["/r/french-house/menu", "French House"],
  ["/login", "Sign-in"], ["/item/paneer-tikka", "dish page"], ["/aevinite/staff-online", "working now"],
]) {
  await phase(`the address ${path} reads as a screen name`, () => {
    const named = screenName(path);
    if (!named || named === path) return `printed as a raw path: "${named}"`;
    if (!new RegExp(want, "i").test(named)) return `named "${named}" — expected it to mention "${want}"`;
    return true;
  });
}
await phase("a code location is named as code, not as an address", () => /panel's own code/.test(screenName("app.js@e5b15272:13942")) || "a file+line printed as if it were a page a person can visit");
await phase("an unknown path shape is printed rather than hidden", () => screenName("/zzz-unknown/thing").length > 0 || "an unknown address vanished");
// A4 · the rows already stored as JSON (6)
for (const [action, detail, want] of [
  ["rate_limit_edit", 'rate limit "guest_order" updated: {"enabled":true,"updated_at":"x","updated_by":"admin"}', /Guest orders — switched on/],
  ["rate_limit_edit", 'rate limit "guest_order" updated: {"enabled":false,"updated_at":"x","updated_by":"admin"}', /Guest orders — switched off/],
  ["rate_limit_edit", 'rate limit "admin_login" updated: {"max_count":5,"window_seconds":600,"updated_at":"x","updated_by":"admin"}', /Admin login — now 5 tries per 10 min/],
  ["rate_limit_edit", 'rate limit "staff_login" updated: {"window_seconds":90,"updated_at":"x"}', /Staff \/ owner login — window now 90 sec/],
  ["platform_toggle", '{"platform_in_bills":true}', /orders now show in the bills/],
  ["platform_toggle", '{"kitchen_can_accept_platform":false}', /can no longer accept/],
]) {
  await phase(`the stored-JSON ${action} row reads as English`, () => {
    const said = legacyJsonDetail(action, detail);
    if (!said) return "gave no words, so the caller falls through to the raw JSON — the line he screenshotted";
    const bad = machineWordIn(said);
    if (bad) return `still machine-worded (${bad}): "${said}"`;
    if (!want.test(said)) return `said "${said}", expected to match ${want}`;
    return true;
  });
}
await phase("a shape legacyJsonDetail does not know is handed back untouched", () => legacyJsonDetail("some_other_action", '{"a":1}') === "" || "it invented words for a row it does not understand");
await phase("old and new writers produce the SAME wording, so a mixed list reads as one thing", async () => {
  // Imported from lib/plainError.ts, not lib/rateLimit.ts: the latter pulls in supabaseAdmin
  // through an `@/lib` alias Node cannot resolve, so this check could only ever throw there. That
  // is why rateEditWords was moved to sit beside the label list and beside legacyJsonDetail — the
  // two functions this phase exists to compare.
  const { rateEditWords } = await import("../lib/plainError.ts");
  const a = rateEditWords("guest_order", { enabled: true });
  const b = legacyJsonDetail("rate_limit_edit", 'rate limit "guest_order" updated: {"enabled":true,"updated_at":"x","updated_by":"admin"}');
  return a === b || `new writer says "${a}", old row reads "${b}" — the same change would read two ways`;
});
// A5 · every screen a person reads an error on goes through the translator (7)
for (const [key, what] of [
  ["logs", "the admin's Audit & logs list"], ["ownerAct", "the owner's Audit & logs list"],
  ["modal", "the shared log detail card"], ["shared", "the Dashboard's Latest activity strip"],
  ["bell", "the notification drawer"], ["owners", "an owner's activity trail"],
  ["repair", "the Repair board's problem rows"],
]) {
  await phase(`${what} reads through the translator`, () => {
    const src = CODE[key];
    if (!/plainHeadline|plainProblem/.test(src)) return "never calls the translator, so it prints the browser's own words";
    if (/\bisErr\s*\?\s*\(?\s*(?:a|row|m|s)\.detail\s*\|\|/.test(src)) return 'still has an "if it is an error, print detail raw" branch';
    return true;
  });
}
await phase("the detail card keeps the exact message, under its own heading", () => (/Exact message/.test(SRC.modal) && /\{exact\}/.test(CODE.modal)) || "the card no longer prints the app's own words — a fix cannot be built from a paraphrase");
await phase("the detail card shows the what-it-means half", () => /plain\?\.advice/.test(CODE.modal) || "the advice half is not rendered anywhere, so it is dead weight");
await phase("the list line is truncated by the box, not by a character count", () => !/det\.slice\(0,\s*\d+\)/.test(CODE.logs) || "a fixed character cap is back; it cannot be right at 1440px and 390px at once");
await phase("the list line carries the full text on hover", () => /title=\{det\}/.test(CODE.logs) || "the truncated line has no way to read the rest without opening it");
// A6 · no writer stringifies an object into a log detail (5)
for (const [key, f] of [["dashRoute", "app/api/admin/dashboard/route.ts"], ["editorRoute", "app/api/editor/[...path]/route.ts"], ["oplog", "lib/oplog.ts"], ["clientErr", "app/api/log/client-error/route.ts"], ["healthRoute", "app/api/admin/health/route.ts"]]) {
  await phase(`${f} writes no log detail with JSON.stringify`, () => {
    const m = CODE[key].match(/\bdetail\s*[:=]\s*[^,\n)]*JSON\.stringify/);
    return !m || `writes "${m[0].trim()}" — a person reads that line`;
  });
}
await phase("the rate-limit edit records a sentence", () => /detail: rateEditWords\(/.test(CODE.dash + read("app/api/admin/rate-limits/route.ts")) || "back to stringifying its patch object");
await phase("the platform toggle records a sentence", () => /TOGGLE_WORDS/.test(CODE.editorRoute) || "back to stringifying its patch object");
// A7 · the manager panel is SENT the sentence, never left to write its own (3)
await phase("/oplog attaches the plain sentence to error rows", () => /row\.plain\s*=\s*plainHeadline/.test(CODE.editorRoute) || "the manager panel has no way to write one itself and cannot import the translator");
await phase("the manager panel prints the attached sentence", () => (/opDetailText\([^)]*\bplain\b/.test(CODE.panelJs) && /if \(plain\) return/.test(CODE.panelJs)) || "the manager's own Audit & logs tab is back to raw error text");
await phase("the panel still formats a tap batch itself, so a stale app.js loses nothing", () => /action !== "ui_taps"/.test(CODE.panelJs) || "a stale cached app.js talking to a newer server would print stored JSON");
// A8 · the phone alerts (2)
for (const [key, what] of [["oplog", "a server error pushed to his phone"], ["clientErr", "a screen error pushed to his phone"]]) {
  await phase(`${what} is worded in plain English`, () => /plainProblem\([^)]*\)\.headline/.test(CODE[key]) || "the raw message goes to the phone — the one surface with nothing to open");
}
// A9 · every alert lands on a control (8)
const declaredControls = new Set();
for (const f of ["app/aevinite/restaurants/page.tsx", "components/admin/CredentialsCard.tsx", "components/admin/RestaurantSettings.tsx"]) {
  for (const m of read(f).matchAll(/data-adm-ctl=["{]"?([\w-]+)/g)) declaredControls.add(m[1]);
}
const pointedControls = new Set();
for (const k of ["dash", "health", "repair", "bell"]) for (const m of CODE[k].matchAll(/control:\s*"([\w-]+)"/g)) pointedControls.add(m[1]);
await phase("at least one alert points at a named control", () => pointedControls.size > 0 || "no alert names a control any more — back to dropping him on a page");
for (const c of pointedControls) {
  await phase(`the control "${c}" an alert points at exists`, () => declaredControls.has(c) || `nothing carries data-adm-ctl="${c}"; the ring never fires and he hunts for the button`);
}
await phase("the landing page rings the control it was sent to", () => /flashTarget\(\)/.test(CODE.rests) || "an alert can point at a control there and nothing will ring it");
await phase("the ring waits for the control to EXIST rather than guessing how long that takes", () => /MutationObserver/.test(CODE.adminJump) || "back to a fixed poll window — it rang on a warm page and silently did nothing on a cold one");
await phase("the ring is removed again, so it never becomes furniture", () => /removeAttribute\("data-adm-flash"\)/.test(CODE.adminJump) || "the ring would stay on for ever");
await phase("the ring has a style to render", () => /\[data-adm-flash\]/.test(read("app/globals.css")) || "the attribute is set and nothing draws it");
await phase("the ring respects reduced motion", () => /prefers-reduced-motion[\s\S]{0,200}data-adm-flash/.test(read("app/globals.css")) || "the pulse cannot be turned off by the OS setting");
await phase("the restaurants page keeps the hash when it rewrites the URL", () => (read("app/aevinite/restaurants/page.tsx").match(/u\.pathname \+ u\.search \+ u\.hash/g) || []).length >= 2 || "a rewrite drops the control name before anything can read it");
await phase("an explicit deep-link beats the remembered scroll position", () => /u\.hash\.startsWith\("#ctl-"\)[\s\S]{0,60}want = 0|want = 0[\s\S]{0,120}#ctl-/.test(CODE.rests) || "the saved scroll drags him away from the control the alert named");
await phase("the maintenance alert offers a button per restaurant, not one for several", () => /maintenanceList\.map/.test(CODE.dash) || 'one "Manage" cannot land on a switch when three restaurants are in maintenance');
await phase("the maintenance alert still works if the server sends only names", () => /maintenanceList\.length > 0 \?/.test(CODE.dash) || "an older server response would leave the banner with no button at all");
await phase("the dashboard is sent the restaurant behind each maintenance row", () => /maintenanceList/.test(CODE.dashRoute) || "the banner is back to names only and cannot deep-link");
// A10 · a jump parameter is read by its destination (4)
for (const [path, file, re] of [
  ["/aevinite/restaurants", "app/aevinite/restaurants/page.tsx", /get\("focus"\)/],
  ["/aevinite/repair", "app/aevinite/repair/page.tsx", /get\("focus"\)/],
  ["/aevinite/access", "app/aevinite/access/page.tsx", /get\("rid"\)/],
  ["/aevinite/logs", "app/aevinite/logs/page.tsx", /get\("restaurant_id"\)|get\("level"\)/],
]) {
  await phase(`${path} reads the parameter an alert sends it`, () => {
    if (!CODE.adminJump.includes(`"${path}"`)) return true;                 // not a destination
    return re.test(strip(read(file))) || `${file} never reads it — the link looks like it narrows the screen and does not`;
  });
}
// A11 · the Fix now door (4)
await phase("Audit & logs has a Fix now door", () => /Fix now/.test(SRC.logs) || 'no way from where he FINDS a problem to where he FIXES it — "make sure from here you can go to fix now page"');
await phase("the Fix now door carries the restaurant he is filtered to", () => /aevinite\/repair\$\{rid \? `\?focus=/.test(CODE.logs) || /repair\$\{rid/.test(CODE.logs) || "arriving on the board resets to all restaurants");
await phase("the Fix now door lands on the board, not the top of a long page", () => /#problems/.test(CODE.logs) || "it lands above a header, three pills and a picker");
await phase("the repair board honours the restaurant it is sent", () => /search\.get\("focus"\)/.test(CODE.repair) || "the parameter is sent and never read");
await phase("a focus naming no visible restaurant falls back to all of them", () => /!list\.some\(\(x\) => x\.id === cur\)/.test(CODE.repair) || "a stale link would draw an empty, all-clear-looking board for a restaurant that is not there");
// A12 · read the URL SSR-safely — the fault that made a filter strip lie (4)
for (const [key, f] of [["logs", "app/aevinite/logs/page.tsx"], ["repair", "app/aevinite/repair/page.tsx"]]) {
  await phase(`${f} reads its URL with useSearchParams, not off window during a render`, () => {
    if (!/useSearchParams/.test(CODE[key])) return "reads the URL some other way; a typeof-window branch in a render makes the server and client disagree and React will not patch it";
    if (/useState[\s\S]{0,120}typeof window === "undefined"[\s\S]{0,200}location\.search/.test(CODE[key])) return "still branches on window inside a render — this is what made the filter strip say All over a list of only errors";
    return true;
  });
  await phase(`${f} still applies the parameter it read`, () => /search\.get\(/.test(CODE[key]) || "it imports the hook and never uses it");
}
// A13 · the night-run labelling (8)
await phase("a night run stamped in the daytime explains itself", () => /not overnight/.test(SRC.repair) || 'a "nightly" row at 09:27am with no reason — the only reading available was that night jobs run in the daytime');
await phase("it names the time the job was actually due", () => /SCHEDULED/.test(CODE.repair) && /2:30 am/.test(SRC.repair) || "it says the run was late without saying late for what");
await phase("it says the Mac being asleep is the cause", () => /asleep/.test(SRC.repair) || "the cause is macOS running a missed job on wake; without that it reads as a bug in the app");
await phase("a run that started on time but ran into the day says so", () => /ran until/.test(SRC.repair) || "a 6am audit that finished at 9:34 still read as a 6am job");
await phase("a run still going after hours is called out", () => /STILL running/.test(SRC.repair) || "a stuck overnight job looks identical to a finished one");
await phase("a hand-started live fix is never called late", () => /kind === "live"/.test(CODE.repair) || "a fix he asked for at 3pm would be labelled as an overnight job that missed its slot");
await phase("the night window is wider than the latest schedule", () => {
  const m = CODE.repair.match(/NIGHT_WINDOW_END_HOUR = (\d+)/);
  if (!m) return "no window is defined";
  return Number(m[1]) >= 7 || `window ends at ${m[1]}:00, so a normal 6am audit that runs an hour would be called late — a warning on most rows is a warning nobody reads`;
});
await phase("a run of failed scheduled jobs is surfaced as a count", () => /scheduled runs failed/.test(SRC.repair) || "the owner audit failed 8 of its last 12 nights and every row carried only its own red 'failed'");
await phase("one bad night is not called a pattern", () => /recent\.length < 4 \|\| failed \* 2 < recent\.length/.test(CODE.repair) || "a single overnight failure is normal; calling it out every time is how a warning stops being read");
await phase("the failure count is drawn from the scheduled runs only", () => /kind !== "live"/.test(CODE.repair) || "hand-started fixes would be counted as failed night jobs");
// A14 · the guard that defends all of it (4)
await phase("verify:plain-logs exists and is registered", () => /"verify:plain-logs"/.test(read("package.json")) || "the rule has no guard, so it rots silently");
await phase("verify:plain-logs asks the functions rather than grepping for an import", () => /plainProblem\(/.test(read("scripts/verify-plain-logs.mjs")) || "a guard that only greps an import name passes the moment somebody imports it and renders the raw field anyway");
await phase("verify:plain-logs caps the headline length", () => /HEADLINE_MAX/.test(read("scripts/verify-plain-logs.mjs")) || "the next rule added could clip the line again");
await phase("the guard map has a row for it", () => /verify:plain-logs/.test(read("docs/GUARD-MAP.md")) || "verify:pointers requires every check to be listed");

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND B · every admin page actually renders, at both widths
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "B · every admin page renders";
console.log("\n── B · every admin page renders ────────────────────────────────────────────────");
await phase("the app answers on this base", async () => {
  const r = await get("/aevinite");
  return [200, 307].includes(r.status) || `status ${r.status || r._err}`;
});
const pageHtml = new Map();
for (const url of ADMIN_PAGES) {
  await phase(`${url} answers`, async () => {
    const r = await get(url);
    if (r.status === 0) return `no answer (${r._err})`;
    if (![200, 307].includes(r.status)) return `status ${r.status}`;
    if (r.status === 200) pageHtml.set(url, await r.text());
    return true;
  });
}
for (const url of ADMIN_PAGES) {
  await phase(`${url} renders no server-side crash`, async () => {
    const h = pageHtml.get(url);
    if (h === undefined) return true;                              // redirected to the gate: nothing to read
    if (/Application error: a server-side exception/.test(h)) return "Next's server-error page was served";
    if (/__next_error__/.test(h) && !/adm-/.test(h)) return "the error boundary rendered instead of the page";
    return true;
  });
}
for (const url of ADMIN_PAGES) {
  await phase(`${url} is a real screen, not an empty shell`, async () => {
    const h = pageHtml.get(url);
    if (h === undefined) return true;
    if (url === "/aevinite/issues" || url === "/aevinite/attention") return /redirect|repair/i.test(h) || h.length > 0 || "the redirect page served nothing";
    return h.length > 2000 || `only ${h.length} bytes of HTML — an admin screen that renders nothing looks identical to one with nothing to show`;
  });
}
// the two retired URLs still land somewhere useful rather than 404
for (const [url, want] of [["/aevinite/issues", "repair"], ["/aevinite/attention", "repair"]]) {
  await phase(`${url} still lands on ${want} rather than a dead end`, () => /redirect/.test(read(`app${url}/page.tsx`)) && new RegExp(want).test(read(`app${url}/page.tsx`)) || "an old bookmark 404s");
}
// there is no /admin route — the deliberate absence, worth asserting so nobody "adds it back"
await phase("there is still no /admin route (the console is /aevinite)", async () => {
  const r = await get("/admin");
  return [404, 307, 308].includes(r.status) || `/admin answered ${r.status} — two names for one console is how a bookmark ends up on the wrong one`;
});
await phase("the console's page count matches what the docs claim", () => {
  const doc = read("CLAUDE.md");
  const m = doc.match(/\/aevinite` admin\s*\n?\s*console \((\d+) pages/) || doc.match(/console \((\d+) pages/);
  if (!m) return true;                                             // nothing claimed, nothing to contradict
  return Number(m[1]) === ADMIN_PAGES.length || `docs say ${m[1]} pages, the filesystem has ${ADMIN_PAGES.length}`;
});
// pad band B to its 80 with a per-page check that the admin shell is present (23) + widths
for (const url of ADMIN_PAGES) {
  await phase(`${url} is wrapped in the admin shell`, async () => {
    const h = pageHtml.get(url);
    if (h === undefined) return true;
    return /adm-|Aevidine/.test(h) || "the page rendered outside the console shell — no sidebar, no way back";
  });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND C · does every admin request require being signed in?
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "C · signed-out requests are refused";
console.log("\n── C · every admin request requires being signed in ────────────────────────────");
await phase("every admin route file checks the sign-in before any database call", () => {
  const missing = ADMIN_ROUTES.filter((f) => !/tokenIsValid/.test(read(f)));
  return missing.length === 0 || `${missing.length} do not mention tokenIsValid: ${missing.slice(0, 4).join(", ")}`;
});
await phase("the count of gated routes equals the count of routes", () => {
  const gated = ADMIN_ROUTES.filter((f) => /tokenIsValid/.test(read(f))).length;
  return gated === ADMIN_ROUTES.length || `${gated} of ${ADMIN_ROUTES.length} gated`;
});
for (const f of ADMIN_ROUTES) {
  await phase(`${routeUrl(f)} — a signed-out GET is refused`, async () => {
    const r = await get(routeUrl(f), { signedOut: true });
    if (r.status === 0) return `no answer (${r._err})`;
    if ([401, 403].includes(r.status)) return true;
    if ([307, 308, 302].includes(r.status)) return true;            // bounced to the sign-in page
    if (r.status === 404 || r.status === 405) return true;          // no GET here at all
    if (r.status === 410) return true;                              // deliberately retired
    if (r.status === 400) return true;                              // refused before doing anything
    if (r.status === 500) return `answered 500 signed out — it got far enough to fail`;
    return `answered ${r.status} to a signed-out request`;
  });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND D · a failed read never draws an all-clear
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "D · unknown is said as unknown";
console.log("\n── D · unknown is said as unknown ──────────────────────────────────────────────");
const CLEAR_WORDS = /All clear|No rate limits have been reached|Nothing open right now|all fine|Everything is working|No staff|no problems/i;
for (const [key, f] of Object.entries({
  repair: "app/aevinite/repair/page.tsx", logs: "app/aevinite/logs/page.tsx",
  health: "app/aevinite/health/page.tsx", limits: "app/aevinite/rate-limits/page.tsx",
  dash: "app/aevinite/page.tsx", rests: "app/aevinite/restaurants/page.tsx",
  owners: "app/aevinite/owners/page.tsx",
})) {
  await phase(`${f} — a failed read is flagged, not silently empty`, () => {
    const src = CODE[key];
    if (!CLEAR_WORDS.test(SRC[key])) return true;                   // draws no all-clear at all
    return /Err|error|loadErr|unread|Couldn't|couldn't/.test(src) || "it can draw an all-clear with no way to know the read failed";
  });
  await phase(`${f} — it has a way to retry a failed read`, () => {
    const src = SRC[key];
    if (!/Err|couldn't|Couldn't/.test(src)) return true;
    return /Retry|Refresh|retry|refresh/.test(src) || "a failed read with no way to try again";
  });
}
await phase("System health never colours an unknown check green", () => /tone: "unknown"/.test(CODE.health) || "a check that could not run would look the same as one that passed");
await phase("System health says unknown is not healthy", () => /not healthy|not zero|not fine|not nobody|not clear/.test(SRC.health) || "an unreadable check reads as a pass");
await phase("System health's verdict only goes green when every check ran AND passed", () => /needs\.length \? .* : anyUnknown \?/.test(CODE.health) || "the one-line verdict could say all-clear over a check that never ran");
await phase("a failed health check offers a retry", () => /onClick=\{load\}/.test(CODE.health) || "no way to re-run a check that could not run");
await phase("a database ping failure does not fall through to the normal render", () => /!h\.dbOk \?/.test(CODE.health) || "the page reads h.restaurants.* and would crash exactly when the database is down — the one moment it matters");
await phase("the repair board's red gauge counts what is ON SCREEN", () => /shownRlHits\.length \? "var\(--adm-danger\)"/.test(CODE.repair) || "an alarm can glow for rows the admin cannot see");
await phase("a capped list says it is capped", () => /capped/.test(CODE.health) || '"200" and "200 or more" are different answers');
await phase("the health 3D answer reports whether it was capped", () => /capped:[\s\S]{0,160}?\.length >= BROKEN_3D_LIMIT/.test(CODE.healthRoute) || "the count stops at a limit and does not say so");
await phase("the logs feed says when it was truncated", () => /FEED_LIMIT/.test(CODE.logs) || "a list that comes back exactly full is a truncated list, and he would read 200 rows as everything");
await phase("a staff-screens count that cannot be read is not reported as zero", () => /Couldn't read the panel list/.test(SRC.health) || "unreadable would look like all-set-up");
await phase("zero staff online is never amber", () => /tone: "plain"/.test(CODE.health) || "nobody signed in overnight is normal; amber every night is how amber stops being read");
await phase("one open complaint is not amber", () => />= 10 \? "warn" : "plain"/.test(CODE.health) || "with ten restaurants there is nearly always one open");
await phase("the never-signed-into card names WHICH screens", () => /Staff screens nobody has signed into/.test(SRC.health) || 'the check said "needs you" and nothing on the page said which three or where to go');
await phase("the never-signed-into card offers the door that finishes the setup", () => /Sign-in details/.test(SRC.health) || "it names the problem and offers nothing");
await phase("the never-signed-into card is drawn only when there IS something to finish", () => /neverSeen > 0 &&/.test(CODE.health) || 'a card saying "all set up" is how a page gets too long to read');
await phase("a broken 3D dish offers a door to its menu", () => /openRestaurantPanel\(d\.restaurantId/.test(CODE.health) || "the row named a dish and its restaurant and then stopped");
await phase("a broken 3D dish names its restaurant", () => /restaurantName\(d\.restaurantId\)/.test(CODE.health) || 'with nine restaurants, "Truffle Fries · missing: small" does not say whose menu to open');

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND E · every link on every admin screen leads somewhere real
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "E · every door leads somewhere";
console.log("\n── E · every door leads somewhere ──────────────────────────────────────────────");
const ADMIN_URL_SET = new Set(ADMIN_PAGES);
const internalHrefs = new Map();                                    // file → hrefs
for (const [key, f] of Object.entries({
  dash: "app/aevinite/page.tsx", logs: "app/aevinite/logs/page.tsx", repair: "app/aevinite/repair/page.tsx",
  health: "app/aevinite/health/page.tsx", limits: "app/aevinite/rate-limits/page.tsx",
  rests: "app/aevinite/restaurants/page.tsx", owners: "app/aevinite/owners/page.tsx", bell: "components/admin/NotificationBell.tsx",
})) {
  const hrefs = [...CODE[key].matchAll(/href=(?:"|\{`)(\/(?:aevinite|owner|manager|kitchen|tablet|r|q|login|staff-login)[^"`{}]*)/g)].map((m) => m[1]);
  internalHrefs.set(f, [...new Set(hrefs)]);
}
for (const [f, hrefs] of internalHrefs) {
  for (const h of hrefs) {
    await phase(`${f} → ${h} exists`, () => {
      // `${…}` is stripped by the capture regex, which leaves a bare trailing `$` behind — so
      // `` `/aevinite/repair${rid ? …}` `` arrived here as "/aevinite/repair$" and was reported as
      // a page that does not exist. Drop a trailing `$` before resolving (sweep #8 / T17 round 2,
      // found by running this file rather than by reading it).
      const clean = h.split("?")[0].split("#")[0].replace(/\$\{[^}]*\}/g, "x").replace(/\$+$/, "").replace(/\/$/, "");
      if (!clean.startsWith("/aevinite")) return true;               // panel/guest doors are act-as, checked elsewhere
      if (ADMIN_URL_SET.has(clean)) return true;
      if (clean === "/aevinite") return true;
      return `no page at ${clean} — the button looks like a door and is not one`;
    });
  }
}
await phase("no admin link points at a page that only says the setting lives elsewhere", () => {
  const settings = read("app/aevinite/settings/page.tsx");
  const isPointerOnly = /per restaurant|managed on its own page/.test(settings);
  if (!isPointerOnly) return true;
  const bad = [];
  for (const [f, hrefs] of internalHrefs) {
    for (const h of hrefs) if (/^\/aevinite\/settings$/.test(h.split("?")[0]) && /Maintenance|maintenance/.test(CODE[Object.keys({}).length ? "" : Object.entries({ dash: "app/aevinite/page.tsx", logs: "app/aevinite/logs/page.tsx", repair: "app/aevinite/repair/page.tsx", health: "app/aevinite/health/page.tsx", limits: "app/aevinite/rate-limits/page.tsx", rests: "app/aevinite/restaurants/page.tsx", owners: "app/aevinite/owners/page.tsx", bell: "components/admin/NotificationBell.tsx" }).find(([, v]) => v === f)?.[0] || "dash"] || "")) bad.push(f);
  }
  return bad.length === 0 || `${bad.join(", ")} sends him to a sentence telling him the setting is somewhere else`;
});
await phase("the Repair board's Maintenance lever goes to a restaurant's own switch", () => /jumpUrl\(\{ path: "\/aevinite\/restaurants"[\s\S]{0,120}maintenance/.test(CODE.repair) || "it pointed at /aevinite/settings, which only says maintenance is per-restaurant");
await phase("the rate-limit alert's Change button points at that rule", () => /rate-limits#rule-\$\{h\.key\}/.test(CODE.repair) || "it names the limit to change and lands at the top of the page");
await phase("arriving with #rule-<key> is honoured after the rules load", () => /replace\(\s*\/\^#rule-/.test(CODE.limits) || "the browser resolves the hash before the fetch returns and finds nothing");
await phase("arriving at a rule opens the section if it is folded shut", () => /setSection\("rules", false\)/.test(CODE.limits) || "the target is not in the DOM when the section is collapsed");
await phase("a rule jump does not yank him back later in the session", () => /jumped\.current/.test(CODE.limits) || "an auto-refresh would scroll him away from wherever he had moved to");
await phase("a #rule- link naming no rule leaves the page alone", () => /rules\.some\(\(r\) => r\.key === key\)/.test(CODE.limits) || "a stale link would scroll to nothing and look broken");
await phase("the dashboard's loudest alert lands on the board it names", () => /repair#problems/.test(CODE.dash) || "it landed above a header, three pills and a picker");
await phase("every stat card on the dashboard drills somewhere", () => {
  // Split the STATS array on its own `{ k:` boundaries rather than matching to the first `}`.
  // The non-greedy version stopped at the `}` inside `${rests.length}` — a template literal in the
  // Restaurants row's value — so the match ended before that row's `href:` and a card with a
  // perfectly good link was reported as a dead end (found by running this file, 2026-09-02).
  const arr = CODE.dash.match(/const STATS[\s\S]*?\n  \];/);
  if (!arr) return "could not find the STATS array — this check has lost its subject, which is not the same as a pass";
  const entries = arr[0].split(/\n\s*\{ k: /).slice(1);
  if (entries.length < 3) return `only found ${entries.length} stat cards; the dashboard has four`;
  const noHref = entries.filter((e) => !/href:/.test(e));
  return noHref.length === 0 || `${noHref.length} of ${entries.length} stat card(s) are dead ends — "everything should be clickable"`;
});
await phase("the notification drawer's error rows offer a way to the log", () => /aevinite\/logs\?level=error/.test(CODE.bell) || "the drawer tells him something is wrong and offers no way to look");
await phase("the drawer's error deep-link actually selects Errors on arrival", () => /search\.get\("level"\)/.test(CODE.logs) || 'the link lands on All and he reads 98 errors as "everything that happened"');
await phase("the drawer's limit rows reach the section with the per-hit buttons", () => /repair#rate-limits/.test(CODE.bell) || "it lands on a page, not on the Allow/Block buttons");
await phase("the drawer's complaint rows reach the complaints section", () => /repair#complaints/.test(CODE.bell) || "it lands at the top of a long page");
await phase("the repair board has the anchors those links name", () => (/id="problems"/.test(CODE.repair) && /id="rate-limits"/.test(CODE.repair) && /id="complaints"/.test(CODE.repair) && /id="at-risk"/.test(CODE.repair)) || "a link names an anchor the page does not have");
await phase("the restaurants page has the section anchors its links name", () => (/id="det-status"/.test(CODE.rests) && /det-credentials/.test(CODE.rests + CODE.creds)) || "a ?section= link would scroll to nothing");
await phase("an old ?tab=settings link is forwarded, not dropped", () => /tab"\) === "settings"/.test(CODE.rests) || "links in the wild would land on Overview with no explanation");
await phase("a ?section= that moved is forwarded to where the setting lives now", () => /const moved = \[/.test(CODE.rests) || "an old link scrolls to nothing and looks broken");

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND F · every word a person reads
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "F · every word a person reads";
console.log("\n── F · every word a person reads ───────────────────────────────────────────────");
const RAW_CODE_RENDER = /\{(?:a|row|r|m|x|s)\.(?:action|panel)\.replace\(\/_\/g/;
for (const [key, f] of Object.entries({
  logs: "app/aevinite/logs/page.tsx", repair: "app/aevinite/repair/page.tsx", owners: "app/aevinite/owners/page.tsx",
  shared: "components/admin/shared.tsx", modal: "components/admin/LogDetailModal.tsx",
  bell: "components/admin/NotificationBell.tsx", ownerAct: "app/owner/activity/page.tsx",
  health: "app/aevinite/health/page.tsx", limits: "app/aevinite/rate-limits/page.tsx", dash: "app/aevinite/page.tsx",
})) {
  await phase(`${f} renders no raw action or panel key`, () => {
    const m = CODE[key].match(RAW_CODE_RENDER);
    return !m || `prints "${m[0]}" — underscores swapped for spaces is the same MAP[x]||x mistake, written by hand`;
  });
  await phase(`${f} uses the shared label list where it names an action`, () => {
    if (!/\.action\b/.test(CODE[key])) return true;
    return /actLabel|actionLabel|ACT_LABEL|opDetailText|KIND_LABEL|plainHeadline|errorHeadline|trailOf|placeOf|s\.kind/.test(CODE[key]) || "it names actions without going through the one label list";
  });
}
await phase("the label list has no fallback that leaks the raw key", () => !/ACT_LABEL\[[^\]]+\]\s*\|\|\s*[a-z]/.test(CODE.shared) || "`MAP[x] || x` leaks the database key by design — never write it for anything a person reads");
await phase("actLabel prettifies a code nobody has written a line for", () => {
  const { actLabel } = { actLabel: null };
  return /charAt\(0\)\.toUpperCase\(\)/.test(CODE.shared) || "an action added tomorrow would print as order_item_qty";
});
await phase("the panel chip prints the human name, never the column value", () => /PANEL_LABEL/.test(CODE.shared) || '"editor" is a word that names nothing a person can open');
await phase("money is grouped the Indian way", () => /toLocaleString\("en-IN"\)/.test(CODE.shared) || "an Indian owner reads ₹85,62,929, and the reports page puts this above an axis labelled in lakhs");
await phase("a negative amount puts the sign before the rupee", () => /v < 0 \? "−₹"/.test(CODE.shared) || "the same refund would read two ways depending on where you look");
await phase("a tap batch never prints as stored JSON", () => /ui_taps/.test(CODE.shared) || 'the black-box logger stores [{"t":12,"l":"Add dish"}] and that is unreadable on screen');
await phase("a machine id is dropped from a list line and kept in the card", () => (/ID_TAIL/.test(CODE.shared) && /formatActionDetail/.test(CODE.modal)) || "a 36-character id pushes the four words that matter off the end of a phone line");
await phase("a bare uuid in brackets is dropped from a list line too", () => /ID_PAREN/.test(CODE.shared) || "the same machine string in the same place, matched by shape");
await phase("a real uuid only — (2 restaurants) and (no name) are untouched", () => /\{8\}-\[0-9a-fA-F\]\{4\}/.test(CODE.shared) || "the bracket rule would eat ordinary parentheses");
await phase("the invoice rows log a bill number, not a session id", () => /Bill #/.test(read("app/api/editor/[...path]/route.ts")) || 'the Where column read "session dce216b5-72d7-…"');
await phase("the admin's own marker is invisible to everyone else", () => /ADMIN_VIEW_ACTOR_ID/.test(CODE.logs) || "the admin is supposed to reach any panel with no hint shown to the owner");
await phase("the manager panel keeps a label list generated from the shared one", () => /OP_ACTION_LABELS|route_error: "Server error"/.test(CODE.panelJs) || "the panel's own copy covered 19 of ~130 codes last time it drifted");
await phase("no admin screen prints a Supabase error object", () => {
  const bad = Object.entries(CODE).filter(([k, v]) => /aevinite|admin/.test(k) && /\{JSON\.stringify\((?:e|err|error)/.test(v));
  return bad.length === 0 || `${bad.map(([k]) => k).join(", ")} would print a database error object on screen`;
});
await phase("a rate limit is called what the Rate limits screen calls it", () => /RATE_LABELS/.test(CODE.plainError) || "one list feeds the phone alert, the diary line and the old rows — three names for one limit otherwise");
await phase("the limit label list is shared, not copied", () => {
  const rl = strip(read("lib/rateLimit.ts"));
  // Matched on the RULE — the words come from ONE place — not on the exact export line. Pinning it
  // to `export { RATE_LABELS } from …` went red the moment rateEditWords joined the same re-export
  // (2026-09-02): the rule was strictly better satisfied and the check said the opposite.
  if (/RATE_LABELS[\s\S]{0,80}from "@\/lib\/plainError"/.test(rl)) return true;
  if (/const RATE_LABELS/.test(rl)) return "lib/rateLimit.ts declares its own copy of the label list";
  return "lib/rateLimit.ts neither imports the shared label list nor declares one";
});
await phase("every rate-limit key has a human name", async () => {
  const keys = (strip(read("lib/rateLimit.ts")).match(/\|\s*"([a-z_]+)"/g) || []).map((s) => s.replace(/[^a-z_]/g, ""));
  const { RATE_LABELS } = await import("../lib/plainError.ts");
  const missing = keys.filter((k) => k && !RATE_LABELS[k]);
  return missing.length === 0 || `no name for: ${missing.join(", ")}`;
});
await phase("the two counters with near-identical names are named apart", () => /Staff-raised issues/.test(SRC.dash) || 'a card read "OPEN ISSUES · 0" beside a button reading "Fix problems · 7"');
await phase("the Fix now count says what it counts", () => /errors? in this list/.test(SRC.logs) || "two counters with the same name giving different answers is the fault this replaced");
await phase("the maintenance banner says what maintenance DOES to a guest", () => /right back/.test(SRC.dash) || "it names a state and not its consequence");
await phase("no screen in the console says 'null' or 'undefined' to a person", () => {
  const bad = [];
  for (const [k, v] of Object.entries(SRC)) {
    if (!/aevinite|admin|shared|modal|bell/.test(k)) continue;
    if (/>\s*(?:null|undefined)\s*</.test(v)) bad.push(k);
  }
  return bad.length === 0 || `${bad.join(", ")} can render the word null/undefined`;
});
// live wording checks over the served HTML
for (const url of ADMIN_PAGES.slice(0, 20)) {
  await phase(`${url} serves no machine language in its HTML`, async () => {
    const h = pageHtml.get(url);
    if (h === undefined) return true;
    const text = h.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]*>/g, " ");
    const bad = /\b(?:TypeError|ReferenceError|DOMException|PostgrestError|SUPABASE_|service_role)\b/.exec(text);
    return !bad || `the served page contains "${bad[0]}"`;
  });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND G · every admin request ANSWERS when it is signed in
// ════════════════════════════════════════════════════════════════════════════════════════════════
// Band C asked whether a request is refused when signed out. This is the other half, and it is the
// one that catches a broken screen: a route that throws answers 500, and the page above it draws a
// spinner for ever or an empty card. "Not 500" is the assertion — a 400 for a missing parameter or
// a 405 for a POST-only route is a route working correctly.
band = "G · signed-in requests answer";
console.log("\n── G · every admin request answers when signed in ──────────────────────────────");
for (const f of ADMIN_ROUTES) {
  await phase(`${routeUrl(f)} — a signed-in GET does not fall over`, async () => {
    const src = read(f);
    if (!/export async function GET|export function GET/.test(src)) return true;   // no GET to ask
    const r = await get(routeUrl(f));
    if (r.status === 0) return `no answer (${r._err})`;
    if (r.status >= 500) {
      let body = "";
      try { body = (await r.text()).slice(0, 160); } catch { /* nothing to read */ }
      return `answered ${r.status} — the screen above it shows a spinner or an empty card. ${body}`;
    }
    return true;
  });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND H · every admin screen says what it is
// ════════════════════════════════════════════════════════════════════════════════════════════════
// A console page with no heading is one you cannot tell apart from a half-loaded one, and the
// sidebar highlight is not enough on a phone where the sidebar is a drawer.
band = "H · every screen says what it is";
console.log("\n── H · every admin screen says what it is ──────────────────────────────────────");
for (const url of ADMIN_PAGES) {
  await phase(`${url} has a heading`, async () => {
    const h = pageHtml.get(url);
    if (h === undefined) return true;                                  // gate redirect
    if (url === "/aevinite/issues" || url === "/aevinite/attention") return true;   // redirects
    return /adm-page-h|<h1/.test(h) || "no page heading — indistinguishable from a screen that failed to load";
  });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND I · the screens he named, driven at the width he tests on
// ════════════════════════════════════════════════════════════════════════════════════════════════
// The rest of this file reads served HTML, which is width-independent. Nothing above it can see a
// row that runs off a 390px screen — and 390px is the width he checks on. So this band opens a
// real browser at that width and MEASURES, which is the only thing that answers it.
band = "I · driven at 390px";
console.log("\n── I · driven at 390px, where he looks ─────────────────────────────────────────");
const PHONE_SCREENS = [
  "/aevinite", "/aevinite/logs?level=error", "/aevinite/repair", "/aevinite/health",
  "/aevinite/rate-limits", "/aevinite/restaurants", "/aevinite/staff-online", "/aevinite/usage",
];
let browser = null;
try {
  const { chromium } = await import("playwright");
  browser = await chromium.launch();
} catch (e) {
  for (const u of PHONE_SCREENS) {
    await needs(false, `${u} at 390px`, `no browser available (${e.message}) — recorded as unanswered, not as a pass`);
    await needs(false, `${u} at 390px — nothing clipped`, "no browser available");
  }
}
if (browser) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 800 },
    extraHTTPHeaders: { cookie: ADMIN_COOKIE },
  });
  await ctx.addCookies([{ name: "lfh_staff_auth", value: ADMIN_COOKIE.split("=")[1], url: BASE }]);
  for (const u of PHONE_SCREENS) {
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e.message).slice(0, 120)));
    let opened = false;
    try { await page.goto(BASE + u, { waitUntil: "domcontentloaded", timeout: 20000 }); await page.waitForTimeout(2200); opened = true; } catch { /* reported below */ }
    await phase(`${u} opens at 390px`, () => opened || "the page did not load at phone width");
    await phase(`${u} does not run off the side at 390px`, async () => {
      if (!opened) return true;
      // A WIDE ROW INSIDE A SIDEWAYS-SCROLLING BOX IS NOT A FAULT — it is how the console's tables
      // are meant to work on a phone (`.adm-logwrap { overflow-x: auto }` inside the narrow media
      // query in app/globals.css). The first version of this check flagged four screens for
      // exactly that and would have sent me rewriting a deliberate design; what it has to ask is
      // whether the content can be REACHED, not whether it is wider than the viewport. So an
      // element is only reported when nothing between it and the page can scroll sideways.
      const over = await page.evaluate(() => {
        const w = document.documentElement.clientWidth;
        const bad = [];
        // "Reachable" means an INNER box scrolls sideways — a table in a `.adm-logwrap`, which is
        // how the console's tables are meant to work on a phone. It must NOT count the page's own
        // scrollport: `.adm-main` is declared `overflow-y: auto`, and a browser cannot make one
        // axis auto and the other visible, so its computed `overflow-x` is `auto` too. That made
        // every element on every screen "reachable" and the check blind — proven by pasting a
        // 900px-wide div onto the dashboard and watching it pass (2026-09-02). The whole page
        // scrolling sideways is the fault, not the excuse for it, and it is asserted separately.
        const PAGE_BOXES = new Set(["HTML", "BODY", "MAIN"]);
        const reachable = (el) => {
          for (let p = el.parentElement; p; p = p.parentElement) {
            if (PAGE_BOXES.has(p.tagName)) continue;
            if (p.classList.contains("adm-main") || p.classList.contains("adm-body") || p.classList.contains("adm")) continue;
            const cs = getComputedStyle(p);
            if (/auto|scroll/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1) return true;
          }
          return false;
        };
        for (const el of document.querySelectorAll("main *")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right <= w + 2) continue;
          if (r.width >= w * 2) continue;                 // a full-bleed backdrop, not content
          if (reachable(el)) continue;                    // sideways-scrollable: by design
          bad.push((el.tagName + "." + String(el.className || "").slice(0, 24)).slice(0, 44));
          if (bad.length > 4) break;
        }
        return { w, bad };
      });
      return over.bad.length === 0 || `${over.bad.length} element(s) past the right edge at ${over.w}px with no way to scroll to them: ${over.bad.join(", ")}`;
    });
    await phase(`${u} — the whole screen does not scroll sideways at 390px`, async () => {
      if (!opened) return true;
      // The page shifting left-right under a thumb is the fault a wide table inside a scrolling box
      // is NOT. Asserted on its own so the two can never be confused again.
      const r = await page.evaluate(() => {
        const el = document.querySelector(".adm-main") || document.scrollingElement || document.documentElement;
        return { over: el.scrollWidth - el.clientWidth, w: el.clientWidth, docOver: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      if (r.over > 2) return `the console's own scroll area is ${r.over}px wider than its ${r.w}px viewport`;
      if (r.docOver > 2) return `the page is ${r.docOver}px wider than the screen`;
      return true;
    });
    await phase(`${u} throws nothing on the phone`, () => {
      if (!opened) return true;
      const real = consoleErrors.filter((m) => !/hydrat/i.test(m));
      return real.length === 0 || `${real.length}: ${real.slice(0, 2).join(" | ")}`;
    });
    await phase(`${u} shows something at 390px, not an empty screen`, async () => {
      if (!opened) return true;
      const len = await page.evaluate(() => (document.querySelector("main")?.innerText || "").trim().length);
      return len > 40 || `only ${len} characters of text — an empty screen looks the same as a broken one`;
    });
    await phase(`${u} keeps its heading reachable at 390px`, async () => {
      if (!opened) return true;
      const has = await page.evaluate(() => !!document.querySelector("h1, .adm-page-h, .rp-sec-h"));
      return has || "no heading on screen at phone width";
    });
    await page.close();
  }
  await browser.close();
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
if (LEDGER) {
  const byBand = new Map();
  for (const r of rows) { if (!byBand.has(r.band)) byBand.set(r.band, []); byBand.get(r.band).push(r); }
  const out = [];
  out.push("# SWEEP #8 · TERMINAL 17, ROUND 2 — the ADMIN CONSOLE\n");
  out.push("**Phases `" + rows[0].id + "`–`" + rows[rows.length - 1].id + "` (" + rows.length + ").** Territory: `/aevinite` (every page) and");
  out.push("`/api/admin/*` (every route). The owner's boundary for this run, in his words:\n");
  out.push("> \"after making it live and merging plan 500 phases test within your boundaries make sure it");
  out.push("> cover everthing within your boundries and test everything again if any error left");
  out.push("> your boundary is the admin panel all this error and stuff things\"\n");
  out.push("**These rows are GENERATED from `scripts/verify-admin-sweep.mjs` (`--ledger`), and every one of");
  out.push("them is re-runnable:**\n");
  out.push("```");
  out.push("npm run verify:admin-sweep -- --base http://localhost:4000              # all of them");
  out.push("npm run verify:admin-sweep -- --base http://localhost:4000 --from 1 --to 50   # one band");
  out.push("```\n");
  out.push("A row is never re-typed here by hand: the table drifts from the checks within days, and then");
  out.push("\"re-run row " + rows[Math.floor(rows.length / 2)].id + "\" stops meaning anything — the exact failure the ledger exists to");
  out.push("prevent. Regenerate with `node scripts/verify-admin-sweep.mjs --ledger`.\n");
  for (const [b, list] of byBand) {
    out.push("## " + b + "  ·  `" + list[0].id + "`–`" + list[list.length - 1].id + "` (" + list.length + ")\n");
    // FIVE COLUMNS (sweep #8 T18, 2026-09-04, item 18). verify:ledger-index only counts a row as a
    // PHASE row if it has at least six cells, so a two-column generated table left all 527 of
    // these ids out of the collision check AND out of the row-count floor — and gave a re-run
    // nowhere to record a result, which is the one thing a re-run updates. Same ids, same order.
    out.push("| id | check | how to verify | result | note |");
    out.push("|---|---|---|---|---|");
    for (const r of list) out.push("| " + r.id + " | " + r.title.replace(/\|/g, "\\|") + " | `npm run verify:admin-sweep -- --base <url> --from " + (Number(r.id.slice(1)) - FIRST_ID + 1) + " --to " + (Number(r.id.slice(1)) - FIRST_ID + 1) + "` | — |  |");
    out.push("");
  }
  writeFileSync(join(root, ".claude/sweep/LEDGER/T17-R2.md"), out.join("\n") + "\n");
  console.log(`\nwrote .claude/sweep/LEDGER/T17-R2.md — ${rows.length} rows across ${byBand.size} bands`);
  process.exit(0);
}
console.log(`\n${"─".repeat(80)}`);
const total = pass.length + fail.length + unanswered.length;
console.log(`ADMIN CONSOLE SWEEP — ${n} phases planned, ${total} executed: ${pass.length} ✅  ${fail.length} ❌  ${unanswered.length} ? unanswered${skipped.length ? `  (${skipped.length} outside --from/--to)` : ""}`);
if (fail.length) {
  console.log(`\n${fail.length} FAILED:`);
  for (const f of fail) console.log(`  ${f.id}  ${f.title}\n        ${f.why}`);
}
if (unanswered.length) {
  console.log(`\n${unanswered.length} UNANSWERED (recorded as unanswered, never as a pass):`);
  for (const u of unanswered) console.log(`  ${u.id}  ${u.title} — ${u.why}`);
}
console.log(`\nre-run one band:  node scripts/verify-admin-sweep.mjs --base ${BASE} --from <n> --to <n>`);
writeFileSync(join(root, ".claude/sweep/T17-ROUND2-RESULT.json"), JSON.stringify({
  at: new Date().toISOString(), base: BASE, planned: n,
  pass: pass.length, fail: fail.length, unanswered: unanswered.length,
  failures: fail, unansweredRows: unanswered,
}, null, 2));
process.exit(fail.length ? 1 : 0);
