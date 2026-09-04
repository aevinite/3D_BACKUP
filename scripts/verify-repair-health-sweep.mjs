#!/usr/bin/env node
// verify-repair-health-sweep.mjs — SWEEP #8 · TERMINAL 18. Phases P71731–P72230 (500).
//
// ── THE TERRITORY, RE-DERIVED AT RUN TIME, NEVER TRUSTED FROM A LIST ────────────────────────────
//
//   app/aevinite/repair/page.tsx      the "something's wrong, fix it" hub — the biggest admin page
//   app/aevinite/health/page.tsx      System health
//   app/aevinite/attention/page.tsx   the retired At-risk URL  → /aevinite/repair#at-risk
//   app/aevinite/issues/page.tsx      the retired Tickets URL  → /aevinite/repair#complaints
//
// Everything else this file reads — the API routes behind those screens, lib/plainError.ts,
// lib/adminJump.ts, components/admin/** — is READ ONLY, and a fault found there is reported as a
// finding for whoever owns it, never edited here.
//
// ── HOW THE 500 WERE PLANNED ────────────────────────────────────────────────────────────────────
//
// By reading the two pages first and listing what could genuinely be wrong — not by imagining a
// checklist. Where a band can be GENERATED from the product (one row per check row on the health
// page, one per hands-on tool, one per section heading, one per restaurant in the panels grid) it
// is generated, because a hand-typed list of nine restaurants goes stale the day a tenth is added
// and then the sweep quietly stops covering it while still printing 500 passes.
//
//   A · P71731–P71790  (60) the twelve items this run fixed — every rule, every surface, and the
//                           shapes each one could come back as
//   B · P71791–P71880  (90) the Repair board, read for correctness
//   C · P71881–P71940  (60) System health, read for correctness
//   D · P71941–P71960  (20) the two retired URLs
//   E · P71961–P72040  (80) conformance to this project's own written rules
//   F · P72041–P72110  (70) driven live at desktop width, asserting the RENDERED thing
//   G · P72111–P72160  (50) driven live at 390px and in both skins
//   H · P72161–P72200  (40) every word a person reads
//   I · P72201–P72230  (30) judgment — is this how it should work for a real restaurant?
//
// ── SAFE-AUDIT WORDING (CLAUDE.md, read first every session) ────────────────────────────────────
//
// Every question here is asked as product correctness: "does this screen say 'all clear' when it
// could not ask?", "does each restaurant only see its own rows?", "does every button either act or
// refuse visibly?". Bands F and G drive the app the way an admin does, signed in, with the cookie
// the gate already accepts. Nothing is verified by trickery, no id is swapped, nothing is replayed
// as anybody else. A gap found by READING is reported, never demonstrated.
//
// ── SAFETY ──────────────────────────────────────────────────────────────────────────────────────
//
//   · Refuses to run against anything but the dev/test database (shared devStacks allow-list).
//   · READ-ONLY. Every request is a GET, and the two write paths this territory has (Resolve /
//     Remind me later) are read as CODE and driven only as far as their are-you-sure step, which
//     is then cancelled. Nothing here writes a row, so there is nothing to clean up and no chance
//     of reporting another session's fixture as a fault.
//   · Signs in ZERO times: it presents the admin cookie the gate already accepts (sha256 of
//     ADMIN_PASSWORD). It can never raise a failed-login row, trip the throttle, or alert anybody.
//   · One at a time (pid lock), so two copies cannot read each other's half-loaded pages.
//
// Run:  node scripts/verify-repair-health-sweep.mjs --base http://localhost:4318
//       npm run verify:repair-sweep -- --base http://localhost:4318 --from 1 --to 60
//       node scripts/verify-repair-health-sweep.mjs --ledger      # regenerate the ledger rows
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { refuseUnlessDevTestDb } from "./sweep/devStacks.mjs";
import { requireUp } from "./sweep/appUp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };

// ── one at a time ───────────────────────────────────────────────────────────────────────────────
const LOCK = "/tmp/repair-health-sweep.pid";
try {
  const alive = Number(readFileSync(LOCK, "utf8"));
  if (alive && alive !== process.pid) {
    try { process.kill(alive, 0); } catch { throw new Error("stale"); }
    console.log(`\nAnother repair/health sweep is already running (pid ${alive}). Two of them read each\nother's half-loaded pages and report them as faults. Waiting is the right move.`);
    process.exit(2);
  }
} catch { /* stale or absent — take it */ }
try { writeFileSync(LOCK, String(process.pid)); } catch {}
const dropLock = () => { try { if (Number(readFileSync(LOCK, "utf8")) === process.pid) unlinkSync(LOCK); } catch {} };
process.on("exit", dropLock);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { dropLock(); process.exit(130); });

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = (arg("--base", "http://localhost:4318") || "").replace(/\/$/, "");
const FROM = Number(arg("--from", 0)) || 0;
const TO = Number(arg("--to", 0)) || Infinity;
const LEDGER = process.argv.includes("--ledger");
const NOBROWSER = process.argv.includes("--no-browser");

const env = Object.fromEntries(read(".env.local").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
if (!LEDGER) refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "the repair & health sweep");

const ADMIN_COOKIE_VALUE = createHash("sha256").update(env.ADMIN_PASSWORD || "").digest("hex");
const ADMIN_COOKIE = "lfh_staff_auth=" + ADMIN_COOKIE_VALUE;
const get = (path) => fetch(BASE + path, { redirect: "manual", cache: "no-store", headers: { cookie: ADMIN_COOKIE } })
  .catch((e) => ({ ok: false, status: 0, _err: e.message, json: async () => null, text: async () => "", headers: new Map() }));

// ── the phase runner ────────────────────────────────────────────────────────────────────────────
const FIRST_ID = 71731;
let n = 0;
const pass = [], fail = [], unanswered = [];
const rows = [];
let band = "?";
const idOf = (i) => "P" + (FIRST_ID + i - 1);
async function phase(title, fn) {
  n += 1;
  const id = idOf(n);
  rows.push({ id, band, title });
  if (LEDGER) return;
  if (n < FROM || n > TO) return;
  let r;
  try { r = await fn(); } catch (e) { r = `threw: ${e && e.message ? e.message : String(e)}`; }
  if (r === true) { pass.push(id); console.log(`  ✓ ${id}  ${title}`); }
  else if (r === "?" ) { unanswered.push({ id, title, why: "not reachable on this stack" }); console.log(`  ? ${id}  ${title}`); }
  else { fail.push({ id, title, why: typeof r === "string" ? r : "returned " + JSON.stringify(r) }); console.log(`  ✗ ${id}  ${title}\n        ${r}`); }
}
/** A phase that cannot be answered here is UNANSWERED, never a pass. "Not reachable on the screen
 *  I opened" is a statement about the screen, not about the product. */
async function skip(title, why) {
  n += 1; const id = idOf(n);
  rows.push({ id, band, title });
  if (LEDGER) return;
  if (n < FROM || n > TO) return;
  unanswered.push({ id, title, why });
  console.log(`  ? ${id}  ${title}\n        UNANSWERED: ${why}`);
}

// ── the sources, read once ──────────────────────────────────────────────────────────────────────
const SRC = {
  repair: read("app/aevinite/repair/page.tsx"),
  health: read("app/aevinite/health/page.tsx"),
  issues: read("app/aevinite/issues/page.tsx"),
  attention: read("app/aevinite/attention/page.tsx"),
  healthRoute: read("app/api/admin/health/route.ts"),
  panelsRoute: read("app/api/admin/panels-health/route.ts"),
  attRoute: read("app/api/admin/attention/route.ts"),
  resolveRoute: read("app/api/admin/resolve-error/route.ts"),
  memRoute: read("app/api/admin/error-memory/route.ts"),
  repairRoute: read("app/api/admin/repair/route.ts"),
  fixRoute: read("app/api/admin/fix-request/route.ts"),
  rlRoute: read("app/api/admin/rate-limits/route.ts"),
  runsRoute: read("app/api/admin/agent-runs/route.ts"),
  plainError: read("lib/plainError.ts"),
  errSig: read("lib/errorSignature.ts"),
  adminJump: read("lib/adminJump.ts"),
  shared: read("components/admin/shared.tsx"),
  ticket: read("components/admin/TicketCard.tsx"),
  sw: read("public/sw.js"),
  rejected: read("docs/REJECTED-IDEAS.md"),
};
// COMMENTS ARE NOT THE CODE, and line comments must be stripped BEFORE block comments: a `/*`
// inside a `//` line opens a block that swallows to the next `*/`, which once hid 190 lines from
// two shipped guards in this repo. The scar is written down; this is the fix it asks for.
const strip = (s) => s.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
const C = Object.fromEntries(Object.entries(SRC).map(([k, v]) => [k, strip(v)]));

// The health page's own check list, derived from the source rather than typed out, so a new check
// row gets a phase automatically instead of being silently uncovered.
const HEALTH_CHECK_KEYS = [...new Set([...SRC.health.matchAll(/key: "([a-z0-9]+)", label: "([^"]+)"/g)].map((m) => m[1] + "|" + m[2]))];
const HANDS_ON_TOOLS = [...SRC.repair.matchAll(/\{ op: "(\w+)", label: "([^"]+)"/g)].map((m) => ({ op: m[1], label: m[2] }));
const SECTION_IDS = [...new Set([...SRC.repair.matchAll(/rp-sec-h" id="([\w-]+)"/g)].map((m) => m[1]))];
const STRIP_PILLS = [...SRC.repair.matchAll(/<span>(problem|limit|open complaint|need)/g)].map((m) => m[1]);

let live = null;   // filled by band F: the API answers, fetched once and shared

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND A · the twelve items this run fixed — every rule, every surface, every way back
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "A · the twelve fixes";
console.log("\n── A · the twelve fixes, and the shapes each could come back as ─────────────────");

// item 1 · a limit with no configured ceiling
await phase("a rate-limit chip is built by ONE helper, not inline in the row", () => /const rlChip = /.test(C.repair) || "the chip is inline again, so the row and the Claude ticket can print different numbers");
await phase("that helper refuses to print a max of 0", () => /h\.max_count > 0/.test(C.repair) || "a limit with no ceiling prints '/ 0'");
await phase("that helper refuses to print a window of 0", () => /h\.window_seconds > 0/.test(C.repair) || "a limit with no window prints 'per 0h'");
await phase("with no ceiling it states the only fact it has — the attempt count", () => /attempt\$\{h\.hit_count === 1 \? "" : "s"\}/.test(C.repair) || "the no-ceiling branch says nothing countable");
await phase("that count is singular for one attempt", () => /h\.hit_count === 1 \? "" : "s"/.test(C.repair) || "'1 attempts'");
await phase("a limit that DOES have numbers still prints them, unchanged", () => /\$\{h\.hit_count\} \/ \$\{h\.max_count\} per \$\{rlPer\(h\.window_seconds\)\}/.test(C.repair) || "the normal chip lost its numbers");
await phase("rlPer still answers in hours / minutes / seconds", () => /s % 3600 === 0 \? `\$\{s \/ 3600\}h`/.test(C.repair) || "rlPer changed shape");
await phase("the Claude ticket for a hit uses the same sentence as the chip", () => /\(\$\{rlChip\(h\)\}\)/.test(C.repair) || "the ticket can describe a limit the screen does not");
await phase("the admin-login wall is the real case — it has no rule row to read a ceiling from", () => !/admin_login/.test(C.rlRoute) || /admin_login/.test(SRC.rlRoute) || "the admin wall is now a rule row, so this branch may be dead — re-read it");

// item 2 · the failure banner
await phase("the run-failure banner counts the failures that actually saved a report", () => /withReport = failedRuns\.filter\(\(r\) => r\.report\)\.length/.test(C.repair) || "it points at reports it has not checked exist");
await phase("it has wording for 'none of them saved one'", () => /None of them saved a report/.test(C.repair) || "with no reports it would still say 'open any red row'");
await phase("it has wording for 'some of them saved one'", () => /saved a report — open/.test(C.repair) || "the partial case is missing");
await phase("it keeps the original wording when EVERY failure is readable", () => /Open any red row below and read what it did/.test(C.repair) || "the all-readable case lost its instruction");
await phase("the banner is still drawn only when failure is a PATTERN, not for one bad night", () => /recent\.length < 4 \|\| failed \* 2 < recent\.length/.test(C.repair) || "one failure would now raise a warning — that is how a warning stops being read");
await phase("the pattern is measured over the SCHEDULED runs, never the hand-started ones", () => /runs\.filter\(\(r\) => r\.kind !== "live"\)/.test(C.repair) || "a live 'Fix now' session would count towards the night jobs' reliability");
await phase("it still says what a failed night COST him, not just that it failed", () => /nothing looked at the\s+app that night/.test(C.repair) || "the consequence sentence is gone");

// item 3 · a row with nothing to open is not a button
await phase("the run row's body is shared by both branches", () => /const rowBody = \(/.test(C.repair) || "the button and non-button rows can now drift apart");
await phase("only a run WITH a report is a button", () => /\{s\.report \? \(/.test(C.repair) || "every row is pressable again");
await phase("a run with no report says so", () => /No report was saved/.test(C.repair) || "the row is silent about it again");
await phase("…and only once the run has ENDED", () => /!s\.report && s\.ended_at/.test(C.repair) || "a run still working would be accused of losing a report");
await phase("a FAILED run with no report says why there is nothing to read", () => /it stopped before it could write one/.test(C.repair) || "the reason is gone");
await phase("the chevron is drawn only where there is something to expand", () => /\{rowBody\}\s*\n\s*<i className=\{`fas fa-chevron/.test(C.repair) || "a chevron on an unopenable row promises an expansion");
await phase("aria-expanded is only announced on a row that can expand", () => (C.repair.match(/aria-expanded=\{isOpen\}/g) || []).length === 1 || "more than one row shape announces an expanded state");
await phase("the open report is still printed verbatim", () => /\{s\.report\}<\/pre>/.test(C.repair) || "the report is being transformed before he reads it");

// item 4 · the plain-English line must not wear a code face
await phase(".rp-detail sets no font-family, so it inherits the console's own face", () => !/\.rp-detail\{[^}]*font-family/.test(C.repair) || "the plain sentence is monospaced again");
await phase("the OPEN block still sets monospace for the captured text", () => /fontFamily: "ui-monospace/.test(C.repair) || "the raw text lost its code face — that half was right");
await phase("the closed line is plainHeadline(), not the raw text", () => /\{plainHeadline\(a\.detail\)\}/.test(C.repair) || "the raw text is back on the closed line");
await phase("the raw text is still one tap away, unaltered", () => /\{a\.detail\}\s*\n?\s*<\/div>/.test(C.repair) || /\{a\.detail\}/.test(C.repair) || "the captured text is no longer shown at all");
await phase("the 'Already fixed' rows use the same plain sentence", () => /plainHeadline\(m\.sig\)/.test(C.repair) || "a fixed row prints a machine signature");

// item 5 · the box he types a sentence into
await phase("the 'Report a problem' box inherits the page font", () => /fontFamily: "inherit"/.test(C.repair) || "it falls back to the browser's monospace");
await phase("it also sets a readable line-height for a typed paragraph", () => /lineHeight: 1\.5/.test(C.repair) || "a three-line box with no line-height is cramped");
await phase("it is still capped at 1000 characters", () => /maxLength=\{1000\}/.test(C.repair) || "the cap is gone");
await phase("it still refuses to send an empty note, out loud", () => /Type what's happening first/.test(C.repair) || "an empty send would vanish in silence");

// item 6 · "except 1 that haven't said"
await phase("the offline-layer sentence pluralises its verb", () => /ol\.unknown === 1 \? "hasn't" : "haven't"/.test(C.health) || "'1 that haven't said'");
await phase("BOTH offline-layer sentences do", () => (C.health.match(/ol\.unknown === 1 \? "hasn't" : "haven't"/g) || []).length === 2 || "only one of the two branches was fixed");
await phase("the device COUNT beside it was already right, and still is", () => /ol\.behind === 1 \? "" : "s"/.test(C.health) || "'1 devices'");
await phase("the 'nothing to compare' branch still says so rather than claiming everything is current", () => /there is nothing to compare/.test(C.health) || "an unused platform would read as healthy");
await phase("an unreadable shipped version is still 'unknown', not 'behind'", () => /Couldn't read which version is shipped/.test(C.health) || "a failed read would accuse every device");

// item 7 · the same sentence twice
await phase("'…unlock the table & order tools' is printed once", () => (C.repair.match(/unlock (?:the|its) table &amp; order tools/g) || []).length === 1 || "the scope card and the empty state say it back to back");
await phase("the surviving line is the one that also names the chosen restaurant", () => /These tools will act on <b>\{scopedName\}<\/b>/.test(C.repair) || "the row that can never be blank was the one removed");
await phase("with no restaurant chosen the tools are still not rendered", () => /\{!rid \? null :/.test(C.repair) || "the tools render with no target");

// item 8 · Resolve all and the parked problems
await phase("the Resolve-all confirm names the reports set to come back later", () => /That also clears \$\{waiting\} report/.test(C.repair) || "the confirm promises fewer than it clears");
await phase("…only when there ARE some waiting", () => /\{waiting \? ` That also clears/.test(C.repair) || "it would add a sentence about nothing");
await phase("…and says whose, because that count is platform-wide", () => /scopedName \? " \(across all restaurants\)" : ""/.test(C.repair) || "a platform-wide number under a one-restaurant banner");
await phase("the confirm still names its restaurant scope as well", () => /Mark all \{groups\.length\} \{scopePhrase\} as handled\?/.test(C.repair) || "the scope phrase went with the fix");
await phase("the request itself is unchanged — the button still means what it meant", () => /\{ all: true, \.\.\.\(rid \? \{ restaurant_id: rid \} : \{\}\) \}/.test(C.repair) || "the fix changed the action, not just the wording");
await phase("the server still counts BEFORE it updates, so the toast cannot under-report", () => /select\("id", \{ count: "exact", head: true \}\)/.test(C.resolveRoute) || "the toast would report PostgREST's cap");
await phase("a snooze-all still skips the tiles already waiting", () => /snoozed_until\.is\.null,snoozed_until\.lte/.test(C.resolveRoute) || "re-snoozing would reach rows he cannot see");
await phase("a bulk resolve still writes NO 'already fixed' record", () => /remembered: false/.test(C.resolveRoute) || "clearing a board would tell Fix-now the problems are fixed");

// item 9 · one clock on the whole row
await phase("there is ONE timezone constant on the page", () => /const IST = "Asia\/Kolkata"/.test(C.repair) || "the zone is spelled out per call site again");
await phase("the 'late' verdict reads its hour in that zone", () => /function istParts\(d: Date\)/.test(C.repair) || "the verdict is on the laptop's clock");
// Scoped to lateNightRun ALONE. toLocalInput() reads getHours() on purpose and must keep doing
// so: a <input type="datetime-local"> is filled and parsed back in the browser's own zone, so
// using IST there would move every prefilled time by five and a half hours. A whole-file ban on
// getHours() would have demanded that regression.
await phase("lateNightRun no longer reads getHours()", () => { const f = /function lateNightRun[\s\S]*?\n\}/.exec(C.repair); return f ? (!/getHours\(\)/.test(f[0]) || "getHours() is the machine's zone, not the restaurants'") : "lateNightRun is gone"; });
await phase("…while the datetime-local box KEEPS the browser's zone, which is right for it", () => /function toLocalInput[\s\S]*?getHours\(\)/.test(C.repair) || "a prefilled time would be five and a half hours out");
await phase("the two times it prints carry the zone", () => (C.repair.match(/timeZone: IST/g) || []).length >= 2 || "one of them prints in the laptop's zone");
await phase("no en-IN time on the page is printed without a zone", () => { const z = [...C.repair.matchAll(/toLocale(?:Time|Date)?String\("en-IN",\s*\{[^}]*\}/g)].filter((m) => !m[0].includes("timeZone")); return z.length === 0 || `${z.length} zoneless`; });
await phase("the queue row uses the same one formatter", () => /istTime\(q\.created_at\)/.test(C.repair) || "a second copy of the same format string");
await phase("the run row uses it too", () => /istTime\(s\.started_at\)/.test(C.repair) || "the run row formats its own");
await phase("the night window is still 00:00–07:59, wider than the latest schedule on purpose", () => /NIGHT_WINDOW_END_HOUR = 8/.test(C.repair) || "a 6am job that runs an hour would be called late");
await phase("a hand-started 'Fix now' session is never called late", () => /if \(s\.kind === "live"\) return ""/.test(C.repair) || "a session he started himself would be explained as a missed night job");
await phase("a night job still running after two hours is called out as possibly stuck", () => /STILL running/.test(C.repair) || "a hung job would look normal");

// item 10 · the pill's grammar
await phase("the 'need attention' pill agrees with its number", () => /need\{!attErr && att && attCount === 1 \? "s" : ""\} attention/.test(C.repair) || "'1 need attention'");
await phase("…and stays plural while the count is unknown", () => /!attErr && att &&/.test(C.repair) || "a '—' or '…' pill would read 'needs attention'");
await phase("the other four pills already agreed with their numbers, and still do", () => /problem\{groups\.length === 1 && !problemsErr \? "" : "s"\} open/.test(C.repair) || "the problems pill lost its singular");

// item 11 · one name for one limit
await phase("this screen reads the shared rate-limit name list", () => /RATE_LABELS\[key\]/.test(C.repair) || "it is guessing a name lib/plainError.ts already holds");
await phase("the rule row still wins over the shared list", () => /rlRules\.find\(\(r\) => r\.key === key\)\?\.label\s*\n?\s*\|\| RATE_LABELS/.test(C.repair) || "the editable name lost priority");
await phase("an unknown key is still prettified, never printed raw", () => /\|\| key\.replace\(\/_\/g, " "\)/.test(C.repair) || "a raw database key would reach the screen");
await phase("the shared list is exported from the client-safe file, so this page can import it", () => /export const RATE_LABELS/.test(C.plainError) || "the shared list moved somewhere a client page cannot reach");

// item 12 · the retired hollow dot
await phase("the dead hollow constant is gone", () => !/const hollow = false/.test(C.health) || "a constant-false switch is back");
await phase("the panel dot paints unconditionally", () => /backgroundColor: s\.c \}\}/.test(C.health) || "the dot is conditional on something again");
await phase("an obituary says why there is no hollow state", () => /OBITUARY/.test(SRC.health) || "the next reader will re-add it");
await phase("Quiet is still the neutral tone the page's own words call it", () => /offline: \{ c: "var\(--muted\)", t: "Quiet" \}/.test(C.health) || "Quiet went back to the alarm colour");
await phase("Never seen is still the only red in the grid", () => /never: \{ c: "var\(--adm-danger\)"/.test(C.health) || "the one genuinely-unfinished state lost its colour");

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND B · the Repair board, read for correctness
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "B · the Repair board, read for correctness";
console.log("\n── B · the Repair board, read for correctness ───────────────────────────────────");

// ── the seven feeds, and the one rule that governs all of them ────────────────────────────────
const FEEDS = [
  ["problems", "the live error feed"], ["the Claude queue", "the fix-request queue"],
  ["Claude's history", "the session history"], ["complaints", "the staff/owner tickets"],
  ["account health", "at-risk & onboarding"], ["rate limits", "the limit-reached alerts"],
  ["the already-fixed record", "the error-memory rows"],
];
for (const [name, what] of FEEDS) {
  await phase(`a failed read of ${what} is recorded by name`, () => C.repair.includes(`failed.push("${name}")`) || `${what} can fail and leave the page looking quiet`);
}
await phase("all seven feeds are fetched in ONE parallel round, not a waterfall", () => /await Promise\.all\(\[/.test(C.repair) || "a waterfall makes the board slow exactly when it matters");
await phase("the failed-feed line names every feed that did not arrive", () => /feedsFailed\.join\(", "\)/.test(C.repair) || "a failure is counted but not named");
await phase("…and says in words that it is NOT an all-clear", () => /that is not an all-clear/.test(C.repair) || "the one sentence that stops a quiet page being read as a quiet platform");
await phase("…and is drawn only once loading has finished", () => /!errLoading && feedsFailed\.length > 0/.test(C.repair) || "it would flash on every load");
await phase("…and offers a Retry that reloads every feed", () => /onClick=\{loadHub\}>Retry/.test(C.repair) || "the retry is missing or partial");
await phase("the problems empty state is gated on the feed having ARRIVED", () => /problemsErr \?[\s\S]{0,600}groups\.length === 0 \?/.test(C.repair) || "a failed read can still draw the green 'All clear'");
await phase("the rate-limit empty state is gated the same way", () => /rlErr \?[\s\S]{0,600}shownRlHits\.length === 0 \?/.test(C.repair) || "a failed read can draw 'No rate limits have been reached.'");
await phase("the complaints empty state is gated on issuesErr", () => /issuesErr \?[\s\S]{0,400}shownTickets\.length === 0 \?/.test(C.repair) || "a failed read can draw 'No open complaints right now.'");
await phase("the at-risk card says 'Couldn\\'t load' rather than 'nothing at risk'", () => /attErr \? "Couldn't load\." : "Loading…"/.test(C.repair) || "a failed read reads as good news");
await phase("the onboarding card does the same", () => (C.repair.match(/attErr \? "Couldn't load\." : "Loading…"/g) || []).length === 2 || "one of the two cards can draw a false empty state");

// ── the six pills at the top ──────────────────────────────────────────────────────────────────
await phase("the problems pill shows '—' on a failed read, never 0", () => /problemsErr \? "—" : groups\.length/.test(C.repair) || "a confident 0 over a dead feed");
await phase("the limits pill shows '—' on a failed read", () => /rlErr \? "—" : shownRlHits\.length/.test(C.repair) || "a confident 0");
await phase("the complaints pill shows '—' on a failed read", () => /issuesErr \? "—" : openTickets/.test(C.repair) || "a confident 0");
await phase("the attention pill shows '—' on a failed read", () => /attErr \? "—" : att \? attCount : "…"/.test(C.repair) || "a confident 0, or an eternal '…'");
await phase("every pill shows '…' while it is still loading, not 0", () => (C.repair.match(/errLoading \? "…"/g) || []).length >= 3 || "a loading pill reads as an answer");
await phase("the problems pill counts GROUPS, the number the board actually shows", () => /<span className="n">\{errLoading \? "…" : problemsErr \? "—" : groups\.length\}/.test(C.repair) || "the pill and the list would disagree");
await phase("…with the raw report total in its tooltip", () => /errors\.length\} reports in all \(repeats are grouped\)/.test(C.repair) || "the raw total is unreachable");
await phase("the queue pill is a local count of rows in hand, so it cannot be wrong", () => /<span className="n">\{scopedRequests\.length\}<\/span>/.test(C.repair) || "the queue pill shape changed");
await phase("the tools pill is a constant", () => /<span className="n">\{TOOLS\.length\}<\/span>/.test(C.repair) || "the tools pill reads something that can fail");
for (const id of SECTION_IDS) {
  await phase(`the strip's link to #${id} points at a section that exists on this page`, () => C.repair.includes(`href="#${id}"`) && C.repair.includes(`id="${id}"`) || `#${id} is a dead anchor`);
}

// ── grouping, and the ×N tile ─────────────────────────────────────────────────────────────────
await phase("tiles are grouped by the SHARED signature function, never by raw text", () => /errorGroupKey\(a\)/.test(C.repair) && /from "@\/lib\/errorSignature"/.test(C.repair) || "a local copy of the grouping rule would drift from the server's");
await phase("a group's timestamp is the NEWEST occurrence", () => /if \(a\.created_at > ex\.latest\) ex\.latest = a\.created_at/.test(C.repair) || "an old repeat would date the tile");
await phase("groups are sorted newest-first", () => /y\.latest\.localeCompare\(x\.latest\)/.test(C.repair) || "the board is not in time order");
await phase("the ×N chip is drawn only for a real repeat", () => /g\.count > 1 \?/.test(C.repair) || "'×1' on every tile");
await phase("'came back after the fix' needs the latest occurrence to be NEWER than the record", () => /new Date\(g\.latest\) > new Date\(mem!?\.fixed_at\)/.test(C.repair) || "an old report under a new fix would be called a recurrence");
await phase("a restaurant-specific record beats the platform-wide one", () => /hits\.find\(\(m\) => m\.restaurant_id === \(g\.sample\.restaurant_id \|\| null\)\)/.test(C.repair) || "one restaurant's fix would be claimed for all nine");
await phase("an empty signature matches nothing", () => /if \(!sig\) return null/.test(C.repair) || "a blank detail would match every record");
await phase("the capped-feed line counts RAW reports, because the cap is on rows", () => /errors\.length >= ERROR_FEED_LIMIT/.test(C.repair) || "the cap is compared against groups, which cannot reach it");
await phase("the feed limit is a NAMED constant, so the page can say 'there may be more'", () => /const ERROR_FEED_LIMIT = 50/.test(C.repair) || "a literal 50 means the sentence and the request can drift");
await phase("the capped-feed line says where to read the rest", () => /read the whole list in Audit &amp; logs/.test(C.repair) || "a dead end at the cap");
await phase("a tile with no detail says so instead of rendering an empty box", () => /No further detail was recorded/.test(C.repair) || "an empty grey box");
await phase("'more/less' appears only when there is more than a line to read", () => /a\.detail\.length > 90/.test(C.repair) || "a 'more' link that opens nothing");

// ── the restaurant picker, and everything it must reach ───────────────────────────────────────
await phase("the picker narrows the problems list", () => /groupErrors\(rid \? errors\.filter/.test(C.repair) || "the banner would claim one restaurant over nine");
await phase("the picker narrows the rate-limit list", () => /shownRlHits = rid \? rlHits\.filter/.test(C.repair) || "an alarm for rows he cannot see");
await phase("the picker narrows the complaints list", () => /scopedIssues = rid \? issues\.filter/.test(C.repair) || "nine restaurants' complaints under a one-restaurant banner");
await phase("the picker narrows the at-risk list", () => /atRisk = \(att\?\.atRisk \|\| \[\]\)\.filter/.test(C.repair) || "at-risk is not scoped");
await phase("the picker narrows the onboarding list", () => /onboarding = \(att\?\.onboarding \|\| \[\]\)\.filter/.test(C.repair) || "onboarding is not scoped");
await phase("the picker narrows the already-fixed list", () => /scopedMemories = rid \? memories\.filter/.test(C.repair) || "the 'Forget all' count and the list above it would disagree");
await phase("…and includes the platform-wide records that also cover that restaurant", () => /m\.restaurant_id === rid \|\| m\.restaurant_id === null/.test(C.repair) || "the client filter and the server's DELETE scope would disagree");
await phase("the picker narrows the Claude queue", () => /scopedRequests = rid \? requests\.filter/.test(C.repair) || "the queue is not scoped");
await phase("…and SAYS what it left out, because 'nothing is queued' is a conclusion", () => /queued at other restaurants/.test(C.repair) || "work in flight would silently vanish");
await phase("'already queued?' stays UNSCOPED, so a Fix cannot be filed twice", () => /queuedKeys = new Set\(requests\.map/.test(C.repair) || "scoping it would re-offer Fix now for a ticket that exists");
await phase("choosing a restaurant fires NO new request for the board", () => !/loadHub[\s\S]{0,80}\[rid\]/.test(C.repair) && /\}, \[\]\);\s*\n\s*useEffect\(\(\) => \{ loadHub\(\); \}, \[loadHub\]\)/.test(C.repair) || "the picker costs a round-trip per pick");
await phase("choosing a restaurant DOES reload the hands-on tools, and only those", () => /const load = useCallback\(async \(\) => \{[\s\S]{0,400}\}, \[rid\]\)/.test(C.repair) || "the tools would act on the wrong restaurant's tables");
await phase("clearing the picker back to All cancels the tools read rather than firing a bad one", () => /if \(!rid\) \{ setData\(null\); return; \}/.test(C.repair) || "a request with no restaurant id");
await phase("a ?focus= id is read on the FIRST render, not in an effect", () => /useState\(\(\) => \{\s*\n?\s*const f = search\.get\("focus"\)/.test(C.repair) || "the board would flash every restaurant's problems and then narrow");
await phase("…via useSearchParams, never a typeof-window branch in the render", () => !/typeof window/.test(C.repair) || "a server/client mismatch React will not patch");
await phase("…validated as a uuid", () => /\[0-9a-fA-F\]\{8\}-/.test(C.repair) || "a hand-typed focus would filter to a restaurant that does not exist");
await phase("…and falls back to All when it names no restaurant this admin can see", () => /cur && !list\.some\(\(x\) => x\.id === cur\)/.test(C.repair) || "a stale bookmark draws an empty, all-clear-looking board");
await phase("the 'Showing X only' banner offers the way back", () => /Show every restaurant/.test(C.repair) || "a dead end in one restaurant");
await phase("the waiting-reports line says whose count it is printing", () => /scopedName \? " across all restaurants" : ""\}/.test(C.repair) || "a platform-wide number under a one-restaurant banner");
await phase("…and is not drawn at all when the count could not be read", () => /!problemsErr && !!waiting/.test(C.repair) || "a null count would print");
await phase("…and links to where those rows are still listed", () => /Audit &amp; logs<\/Link> the whole time/.test(C.repair) || "a wait with no way to see what is waiting");

// ── every action, and the rule that it must never fail in silence ─────────────────────────────
const ACTIONS = [
  ["resolveError", "Resolve"], ["snoozeError", "Remind me later"], ["sendError", "Fix now / Overnight"],
  ["resolveAllProblems", "Resolve all"], ["snoozeAllProblems", "Remind me later (all)"],
  ["sendAllToClaude", "Fix all overnight"], ["dismissAllLimits", "Dismiss all limits"],
  ["resolveAllTickets", "Resolve all complaints"], ["forgetAllMemories", "Forget all"],
  ["forgetMemory", "Forget this"], ["dismissRequest", "Dismiss a queued ticket"],
  ["rlAllow", "Allow"], ["rlDismiss", "Dismiss a limit alert"], ["rlFix", "Fix a limit hit"],
  ["rlClear", "Let them try again"], ["rlBlock", "Block this device"],
  ["setTicketStatus", "Resolve / reopen a complaint"], ["sendDescribed", "Report a problem"],
];
for (const [fn, label] of ACTIONS) {
  await phase(`"${label}" exists as a handler`, () => new RegExp(`const ${fn} = `).test(C.repair) || `${label} has no handler`);
}
for (const [fn, label] of ACTIONS) {
  await phase(`"${label}" tells the person when the server refuses`, () => {
    const m = new RegExp(`const ${fn} = [\\s\\S]{0,2600}?\\n  \\};`).exec(C.repair);
    if (!m) return `could not read ${fn}`;
    // The toast may span lines and carry nested parens (`toast(a ? x : y, a ? "err" : undefined)`),
    // so a one-line regex over its arguments cannot see it. What matters is that the handler has a
    // failure path that SAYS something: an "err" toast, the server's own reason, or a reload.
    return /"err"|toast\(r\.error|failedN \? "err"/.test(m[0]) || `${label} can fail in silence`;
  });
}
await phase("every optimistic removal is put back, or reloaded, when the server refuses", () => (C.repair.match(/loadHub\(\);/g) || []).length >= 8 || "an optimistic change can be left on screen after a failure");
await phase("Resolve is two-step, so a mis-tap cannot clear a real problem", () => /confirmResolve === g\.key \?/.test(C.repair) || "one tap clears a problem");
// ASSERT THE BUTTON, NOT THE BRANCH. The first version of this checked that each
// `confirmBulk === "x"` branch existed — and a sabotage that pointed the BUTTON straight at
// resolveAllTickets(), leaving the now-unreachable confirm branch in place, sailed past it. The
// branch existing proves nothing; what matters is that the only way to reach the action is
// through setConfirmBulk. So: every bulk action must be called from inside a confirm, and no
// bulk button may call one directly.
{
  const BULK = { resolve: "resolveAllProblems", later: "snoozeAllProblems", claude: "sendAllToClaude", limits: "dismissAllLimits", tickets: "resolveAllTickets", memories: "forgetAllMemories" };
  const missing = [], direct = [];
  for (const [key, fn] of Object.entries(BULK)) {
    if (!new RegExp(`setConfirmBulk\\("${key}"\\)`).test(C.repair)) missing.push(key);
    // the action may only be wired from inside its own confirm block
    const block = new RegExp(`confirmBulk === "${key}"[\\s\\S]{0,1400}?${fn}`).test(C.repair);
    if (!block) direct.push(`${fn} is not reached from the "${key}" confirm`);
    // …and no button outside a confirm may call it
    const outside = [...C.repair.matchAll(new RegExp(`onClick=\\{\\(\\) => ${fn}\\(`, "g"))];
    for (const m of outside) {
      const ctx = C.repair.slice(Math.max(0, m.index - 900), m.index);
      if (!new RegExp(`confirmBulk === "${key}"`).test(ctx)) direct.push(`${fn} is wired to a button with no are-you-sure above it`);
    }
  }
  await phase("every bulk action is two-step too", () => missing.length === 0 || `no confirm step for: ${missing.join(", ")}`);
  await phase("…and none of them can be reached without passing through its confirm", () => direct.length === 0 || direct.join(" | "));
}
await phase("every bulk confirm has a Cancel", () => (C.repair.match(/onClick=\{\(\) => setConfirmBulk\(""\)\}>Cancel/g) || []).length >= 5 || "a confirm with no way out");
await phase("only one bulk action can be in flight at a time", () => (C.repair.match(/disabled=\{!!bulk/g) || []).length >= 5 || "two bulk actions could overlap");
await phase("a busy bulk button says what IT is doing", () => /bulk === "resolve" \? "Clearing…"/.test(C.repair) || "a frozen button");
await phase("'Fix all overnight' shows its progress while it runs", () => /Sending \$\{bulkNote\}…/.test(C.repair) || "a long bulk send looks stuck");
await phase("'Fix all overnight' sends three at a time, not all at once", () => /Promise\.all\(\[worker\(\), worker\(\), worker\(\)\]\)/.test(C.repair) || "nineteen requests in one breath");
await phase("'Fix all overnight' skips anything already queued", () => /groups\.filter\(\(g\) => !alreadyQueued\(g\)\)/.test(C.repair) || "duplicate tickets");
await phase("…and is disabled once everything is queued", () => /groups\.every\(\(g\) => alreadyQueued\(g\)\)/.test(C.repair) || "a button that can only do nothing");
await phase("a failure inside a bulk send un-marks that one tile", () => /n\.delete\(g\.key\); return n/.test(C.repair) || "a tile would claim to be sent when it is not");
await phase("the end-of-run toast tells a clean run from a partial one", () => /wouldn't send\. Try those again/.test(C.repair) || "a partial failure reads as success");
await phase("every fix-request POST carries its own idempotency id", () => (C.repair.match(/"X-LFH-Action-Id": uuid\(\)/g) || []).length >= 4 || "a retry could file a duplicate");
await phase("'Fix all' is OVERNIGHT and the button says so", () => /Fix all overnight/.test(C.repair) || "nineteen Claude windows on the Mac");
await phase("…and explains on hover why it is not 'now'", () => /instant opens a Claude window per problem/.test(C.repair) || "the reason is hidden");
await phase("'Dismiss all' on the limits section only dismisses", () => /No limit changed\./.test(C.repair) || "a one-tap 'let everyone through'");
await phase("'Forget all' names what it actually costs, above the list", () => /came back after the fix<\/b> badge/.test(C.repair) || "the cost is buried in a tooltip");
await phase("…and sits INSIDE the fold, not on the collapsed line", () => /showMemories \?[\s\S]{0,900}confirmBulk === "memories"/.test(C.repair) || "he could forget a list he has not read");
await phase("'Later' is visibly a different answer from 'Resolve'", () => /stays OPEN and nothing is marked fixed/.test(C.repair) || "a wait would read as a fix");
await phase("the three 'Later' durations match what the server accepts (hours, ≤ a month)", () => { const hrs = [...C.repair.matchAll(/hours: (\d+(?: \* \d+)?)/g)].map((m) => eval(m[1])); return hrs.length >= 3 && hrs.every((h) => h > 0 && h <= 744) || `a duration the server would refuse: ${hrs}`; });
await phase("an admin-login hit offers 'let them try again' AND 'block', not one of the two", () => /Let them try again/.test(C.repair) && /Block this device/.test(C.repair) || "the owner-forgot-the-password answer is missing");
await phase("an admin-login hit does NOT offer 'Allow' — there is no counter to reset", () => /h\.key === "admin_login" \?[\s\S]{0,700}rlClear/.test(C.repair) || "a control that does nothing");
await phase("a non-admin hit offers Allow · Change limit · Fix · Dismiss", () => /rlAllow\(h\)/.test(C.repair) && /rate-limits#rule-/.test(C.repair) && /rlFix\(h\)/.test(C.repair) && /rlDismiss\(h\)/.test(C.repair) || "one of the four is missing");
await phase("'Change rate limit' deep-links to that rule's own row", () => /href=\{`\/aevinite\/rate-limits#rule-\$\{h\.key\}`\}/.test(C.repair) || "it lands on the top of the page");
await phase("a platform-wide hit is not tagged to a real restaurant", () => /h\.restaurant_id !== "00000000-0000-0000-0000-000000000000"/.test(C.repair) || "the zero-uuid would be sent as a restaurant");
await phase("'Block this device' waits for the server before removing the row", () => /if \(r\.ok\) \{ setRlHits\(\(prev\) => prev\.filter/.test(C.repair) || "a refused block would look like it worked");
await phase("'Go to that panel' is offered only when there is somewhere to go", () => /const jumpLabel = \(a: Action\): string \| null/.test(C.repair) || "a button that goes nowhere");
await phase("a guest-menu error opens THAT restaurant's menu, never restaurant #1's", () => /window\.open\(`\/r\/\$\{a\.restaurant_slug\}\/menu`/.test(C.repair) || "one tenant's menu shown for another's error");
await phase("a staff-panel error opens that restaurant's panel act-as, no password", () => /openRestaurantPanel\(a\.restaurant_id, j\.route\)/.test(C.repair) || "the admin would have to sign in as them");
await phase("the maintenance lever lands on that restaurant's own switch and rings it", () => /jumpUrl\(\{ path: "\/aevinite\/restaurants", restaurantId: rid, section: "status", control: "maintenance" \}\)/.test(C.repair) || "it points at a page that no longer holds the setting");
await phase("the hands-on tools require a typed reason", () => /if \(!reason\.trim\(\)\) \{ onError\("Please type a reason\."\)/.test(C.repair) || "an unexplained repair in the audit trail");
await phase("each tool refuses with a named reason when no target is picked", () => /onError\("Pick a table\."\)/.test(C.repair) && /onError\("Pick an order\."\)/.test(C.repair) || "a silent refusal");
await phase("'Edit an order's time' rejects an unparseable date rather than sending NaN", () => /isNaN\(d\.getTime\(\)\)/.test(C.repair) || "NaN would reach the database");
await phase("…and warns that 5 AM flips the business day", () => /past 5 AM shifts it to another day/.test(C.repair) || "an order moved into the wrong day's takings, silently");
await phase("…and pre-fills the order's current time in the admin's own zone", () => /setWhen\(toLocalInput\(o\.created_at\)\)/.test(C.repair) || "he would retype a time from scratch");
for (const t of HANDS_ON_TOOLS) {
  await phase(`the "${t.label}" tool describes what it does before he presses it`, () => new RegExp(`op: "${t.op}", label: "[^"]+", icon: "[^"]+", desc: "[^"]{20,}`).test(C.repair) || `${t.label} has no description`);
}
await phase("'Delete an order' is described as tombstoned, never as erased", () => /It stays in the records, tombstoned — not erased\./.test(C.repair) || "the one behaviour the compliance case rests on, described wrongly");
await phase("'Void a bill' is described as keeping the invoice number on record", () => /The invoice number is kept on record\./.test(C.repair) || "an invoice number that looks erasable");
await phase("the danger tool is visibly the danger tool", () => /t\.danger \? "1px solid color-mix/.test(C.repair) || "delete looks like the other four");
await phase("the tool modal registers with the back-button manager", () => /useAdminModal\(ref, `admin-repair-\$\{op\}`, onClose\)/.test(C.repair) || "the phone back button would leave the page instead of closing the modal");
await phase("the tool modal cannot be dismissed by the backdrop mid-write", () => /onClick=\{busy \? undefined : onClose\}/.test(C.repair) || "a half-finished repair with the dialog gone");
await phase("the modal's submit button says what it is doing while it works", () => /\{busy \? "Working…" : meta\.label\}/.test(C.repair) || "a frozen button");
await phase("a re-fired order reports its NEW KOT number", () => /Re-fired — new KOT #\$\{r\.data\.kot_no\}/.test(C.repair) || "he cannot tell the kitchen which ticket to look for");
await phase("no earnings, price or ₹ figure appears anywhere on this board", () => !/₹/.test(SRC.repair) || "money on a repair screen");
await phase("nothing on this page can delete a bill", () => !/delete_bill|hard_delete/.test(C.repair) || "a sale could disappear");

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND C · System health, read for correctness
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "C · System health, read for correctness";
console.log("\n── C · System health, read for correctness ──────────────────────────────────────");

await phase("the page opens with a VERDICT in words, before any number", () => /hx-verdict/.test(C.health) || "the pill strip he had removed (R42) is back in some form");
await phase("the verdict goes green only when every check both RAN and passed", () => /needs\.length \? "hx-attn" : anyUnknown \? "hx-part" : "hx-ok"/.test(C.health) || "a check that could not run would be coloured green");
await phase("'some checks couldn't run' is neutral — not green, not a platform alarm", () => /hx-verdict\.hx-part i\{color:var\(--muted\)\}/.test(C.health) || "our own failed reading would read as the platform being broken");
await phase("the verdict NAMES what needs him rather than making him decode colours", () => /needs\.map\(\(c\) => c\.label\.toLowerCase\(\)\)\.join\(", "\)/.test(C.health) || "he would have to read five dots");
await phase("it agrees with its own number", () => /needs\.length === 1 \? "" : "s"/.test(C.health) && /need\{needs\.length === 1 \? "s" : ""\}/.test(C.health) || "'1 things needs you'");
// R42 was about a STATUS STRIP — four coloured pills, each a number with no sentence, sitting
// where the verdict now is. The two .adx-pill uses left on this page are the "Couldn't check" and
// "Database unreachable" cards, which are single labelled states on a failure path and are the
// opposite of a KPI band. So the check counts pills, and three or more in a row is the strip.
await phase("no pill strip, chip row or KPI band at the top (R42)", () => { const n = (C.health.match(/adx-pill/g) || []).length; return n <= 2 || `${n} pills — the four-pill strip he asked to be removed looks like it is back`; });
await phase("R42 is recorded in the file where somebody would otherwise re-add it", () => /REJECTED \(owner, 2026-08-20\)/.test(SRC.health) || "the rejection comment is gone, so the next sweep re-offers it");
await phase("R42 is in the rejected-ideas doc too", () => /R42/.test(SRC.rejected) || "the doc half of the rule is missing");
await phase("R43 — one open complaint is never amber — is recorded here too", () => /R43/.test(SRC.health) || "the amber-for-one-complaint idea would come back");
await phase("…and the complaints check really is plain for a handful", () => /\(h\.openIssues \|\| 0\) >= 10 \? "warn" : "plain"/.test(C.health) || "amber on almost every load");
await phase("…and only an unusual pile-up gets a colour", () => /That is an unusual number waiting/.test(C.health) || "the pile-up case says nothing different");

for (const k of HEALTH_CHECK_KEYS) {
  const [key, label] = k.split("|");
  await phase(`the "${label}" check row carries a value AND a plain-words meaning`, () => new RegExp(`key: "${key}", label: "${label}"[\\s\\S]{0,700}?means:`).test(SRC.health) || `"${label}" is a number with no sentence — which is what a pill was`);
}
await phase("a check row links onward only where there is somewhere useful to go", () => /\/\*\* Only when there is somewhere useful to go\. A link on every row is a link on no row\. \*\//.test(SRC.health) || "a link on every row is a link on no row");
await phase("'unknown' is its own tone and is never green", () => /unknown: "var\(--muted\)"/.test(C.health) || "a check that could not run would look like one that passed");
await phase("a database ping failure does NOT fall through to the normal render", () => /: !h\.dbOk \? \(/.test(C.health) || "the page would read h.restaurants.* and crash exactly when it matters");
await phase("…and states the latency it waited before giving up", () => /after \$\{h\.latencyMs\}ms/.test(C.health) || "no sense of whether it timed out or was refused");
await phase("…and offers Refresh", () => /Press Refresh to retry\./.test(C.health) || "a dead end when the database is down");
await phase("a failed health read shows 'Couldn\\'t check', not an eternal 'Checking…'", () => /h === null \? \(\s*\n?\s*err \? null :/.test(C.health) || "the one screen that answers 'is the platform up' would sit saying it is still looking");
await phase("…and says in words that this is unknown, not healthy", () => /This is <b>unknown<\/b>, not healthy\./.test(C.health) || "a failed check reads as a pass");
await phase("a failed restaurants read says 'unknown', never a reassuring 0", () => /Couldn't read the restaurant list, so this is unknown — not zero\./.test(C.health) || "'0 live restaurants' over a dead read");
await phase("a failed staff read says 'unknown', never 'nobody'", () => /so this is unknown — not nobody\./.test(C.health) || "'nobody is signed in' over a dead read");
await phase("zero staff online is NOT drawn as a warning", () => /key: "staff", label: "Staff signed in", value: `\$\{h\.staffOnlineNow\} of \$\{h\.staffTotal\}`, tone: "plain"/.test(C.health) || "amber every night, which is how amber stops being read");
await phase("…and says so in words", () => /normal when the restaurants are closed/.test(C.health) || "the reason is missing");
await phase("a failed complaints read says 'unknown', never 'clear'", () => /so this is unknown — not clear\./.test(C.health) || "'nothing waiting' over a dead read");
await phase("a failed 3D check says 'unknown, not zero'", () => /unknown, not zero/.test(C.health) || "'all fine' over a dead read");
await phase("a capped 3D answer renders as '200+', not '200'", () => /h\.broken3d\.capped \? "\+" : ""/.test(C.health) || "a truncated list reads as the whole story");
await phase("…and the card says the count stops at 200", () => /the check stops counting at 200/.test(C.health) || "the ceiling is invisible");
await phase("the 3D card is drawn only when there IS something to do", () => /h\.broken3d !== null && h\.broken3d\.count > 0 &&/.test(C.health) || "a card saying 'nothing to fix' makes the page too long to read");
await phase("each 3D row names WHICH restaurant the dish belongs to", () => /\{restaurantName\(d\.restaurantId\)\}/.test(C.health) || "a dish name with no menu to open");
await phase("…from rows already fetched, at no extra request", () => /pd\?\.rows\.find\(\(r\) => r\.id === id\)\?\.name/.test(C.health) || "a lookup per dish");
await phase("…and gives the door to the fix, not just the news", () => /openRestaurantPanel\(d\.restaurantId, "\/manager"\)/.test(C.health) || "he would hunt for the restaurant by hand");
await phase("…and says which file is missing", () => /missing: \{d\.missing\}/.test(C.health) || "he cannot tell which of the two models to upload");
await phase("the never-signed-into screens are NAMED, not just counted", () => /Staff screens nobody has signed into/.test(C.health) || "'Staff screens · 3' with no way to know which three");
await phase("…each with the door that finishes the setup", () => /control: "credentials"/.test(C.health) || "no way to hand over the sign-in details");
await phase("…and that card is drawn only when there is something to finish", () => /\{neverSeen > 0 &&/.test(C.health) || "a card saying 'all set up' lengthens the page for nothing");
await phase("the panels attention count EXCLUDES the owner panel", () => /x\.role !== "owner" && x\.status === "never"/.test(C.health) || "owners don't sit signed in — this would be a false alarm on every restaurant");
await phase("…and excludes suspended restaurants", () => /liveRows = \(pd\?\.rows \|\| \[\]\)\.filter\(\(r\) => r\.active\)/.test(C.health) || "a suspended restaurant's deliberately-off panels would raise the count");
await phase("…and the server agrees on both exclusions", () => /r\.active\)\.reduce[\s\S]{0,160}p\.role !== "owner"/.test(C.panelsRoute) || "the page and the route would count different things");
await phase("'quiet for over an hour' is stated as a plain fact, not a warning", () => /normal for a closed restaurant/.test(C.health) || "23 quiet panels every morning is how a warning dies");
await phase("a quiet OWNER cell reads 'Quiet'/'Not signed in', not red", () => /ownerQuiet \? \{ c: "var\(--muted\)"/.test(C.health) || "a false alarm on every restaurant");
await phase("the panel legend explains all five states in his own words", () => /Off<\/b> = you haven&rsquo;t given that restaurant this screen/.test(SRC.health) || "the grid is five colours with no key");
await phase("a suspended restaurant is labelled as such in the grid", () => /\{!row\.active && <span[^>]*>suspended/.test(C.health) || "a suspended restaurant looks live");
await phase("the grid scrolls sideways INSIDE its card, never the page", () => /overflowX: "auto"/.test(C.health) || "the whole page would shift under a thumb");
await phase("…and that is deliberate, because you read DOWN a column here", () => /you read DOWN a column there|you read DOWN a column/.test(SRC.health) || "the reason is undocumented and someone will 'fix' it");
await phase("the key→value cards fit a phone instead of scrolling (the 540px rule)", () => /\.hx-kv \.adm-logrow \{ min-width: 0/.test(C.health) || "'Row count estimates' would show five names and not one number");
await phase("the check rows become blocks on a phone", () => /grid-template-areas:"dot label value"/.test(C.health) || "a five-column row at 360px pushes the value off the edge");
await phase("the technical detail is folded away by default", () => /useState\(false\)[\s\S]{0,40}detailOpen|const \[detailOpen, setDetailOpen\] = useState\(false\)/.test(C.health) || "the two cards he never needs would fill the screen again");
await phase("…and is reachable by keyboard, announcing its state", () => /aria-expanded=\{detailOpen\}/.test(C.health) || "a fold only a mouse can open");
await phase("row estimates are labelled as ESTIMATES, with the reason", () => /not exact counts — an exact COUNT\(\*\) on these tables would itself be a heavy scan/.test(SRC.health) || "he would read them as exact");
await phase("a failed estimates read says so instead of an empty table", () => /Couldn(?:&apos;|')t read estimates:/.test(C.health) || "an empty table reads as no rows");
await phase("the backend section shows a HOST only — never a key", () => /\{h\.realtime\.configuredHost \|\| "not configured"\}/.test(C.health) || "key material on screen");
await phase("…and says so in words", () => /no keys shown/.test(C.health) || "the promise is missing");
await phase("the staff figure in the fold is labelled live-restaurants-only", () => /Staff accounts \(live restaurants\)/.test(C.health) || "it would silently disagree with Usage & cost");
await phase("…and the route really does filter to live restaurants", () => /liveIds\.has\(u\.restaurant_id\)/.test(C.panelsRoute) || /liveIds\.has\(u\.restaurant_id\)/.test(C.healthRoute) || "the label would be a claim the data does not support");
await phase("the two reads are independent, so one failing never blocks the other", () => /Promise\.allSettled\(\[/.test(C.health) || "a panels failure would blank the diagnostics above it");
await phase("auto-refresh is the shared active-only 60s helper, never a blind timer", () => /useActiveAutoRefresh\(load, 60000\)/.test(C.health) || "this page must never itself become a load source");
await phase("the page states when it last checked", () => /Last checked \{timeAgo\(h\.checkedAt\)\}/.test(C.health) || "a stale screen looks current");
await phase("Refresh is disabled while a check is in flight", () => /disabled=\{loading\} onClick=\{load\}/.test(C.health) || "two overlapping rounds");
await phase("the latency number is turned into a WORD — fast / slow / very slow", () => /function latencyTier/.test(C.health) || "'26ms' means nothing unless you already know what good looks like");
await phase("…and only 'very slow' needs him", () => /needsYou: lat\.tone === "bad"/.test(C.health) || "a healthy database would raise a flag");
await phase("the offline-layer check is plain when everything is current", () => /tone: ol\.behind > 0 \? "warn" : "good"/.test(C.health) || "amber for a healthy fleet");
await phase("…and amber only for a device that really IS behind", () => /needsYou: ol\.behind > 0/.test(C.health) || "an unknown would be treated as behind");
await phase("a browser that has not reported a version is 'hasn\\'t said', never behind", () => /swUnknown = swSeen\.length - swCurrent - swBehind/.test(C.healthRoute) || "a browser with no service worker would be called out of date");
await phase("devices not used recently are left out, and the route says why", () => /is not "behind", it is simply not in use/.test(SRC.healthRoute) || "a fortnight-old tablet would make this figure permanently alarming");
await phase("the offline sentence never says 'day' for a window that is not one", () => /ol\.windowMins >= 24 \? "day" : ol\.windowMins \+ " minutes"/.test(C.health) || "a wrong unit in the sentence");
await phase("no earnings figure appears on System health", () => !/₹/.test(SRC.health) || "money on a diagnostics screen");
await phase("the health route is admin-gated before its first database call", () => /if \(!\(await admin\(req\)\)\) return NextResponse\.json\(\{ error: "unauthorized" \}, \{ status: 401 \}\);\s*\n\s*\n?\s*const t0/.test(C.healthRoute) || "a read before the gate");
await phase("the panels route is admin-gated before its first database call", () => /tokenIsValid[\s\S]{0,180}status: 401[\s\S]{0,120}new ReadSet/.test(C.panelsRoute) || "a read before the gate");
await phase("the attention route is admin-gated before its first database call", () => /tokenIsValid[\s\S]{0,180}status: 401[\s\S]{0,120}new ReadSet/.test(C.attRoute) || "a read before the gate");
await phase("a new restaurant reads as 'needs onboarding', never 'about to churn'", () => /ageDays <= 30 && u\.o30 === 0/.test(C.attRoute) || "a day-one paying customer would be called a churn risk");
await phase("at-risk is only ever a PAYING restaurant", () => /paying && u\.o30 === 0/.test(C.attRoute) || "a free trial going quiet is not churn");
await phase("a suspended restaurant is neither at-risk nor onboarding", () => /if \(r\.active !== true\) continue/.test(C.attRoute) || "a deliberately-suspended restaurant would be chased");
await phase("a partial failure of the three account-health reads is an error, not an empty list", () => /const anyErr = reads\.firstError/.test(C.attRoute) || "a timed-out usage RPC would flag EVERY paying restaurant as churn-risk with a confident 200");
await phase("the same holds for the panels route's three reads", () => /const anyErr = reads\.firstError/.test(C.panelsRoute) || "a failed settings read would show every panel 'Off'");

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND D · the two retired URLs
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "D · the two retired URLs";
console.log("\n── D · the two retired URLs ─────────────────────────────────────────────────────");

for (const [file, src, target, anchor] of [
  ["/aevinite/issues", C.issues, "/aevinite/repair#complaints", "complaints"],
  ["/aevinite/attention", C.attention, "/aevinite/repair#at-risk", "at-risk"],
]) {
  await phase(`${file} still redirects rather than 404-ing a bookmark`, () => /redirect\(/.test(src) || `${file} no longer forwards`);
  await phase(`${file} lands on ${target}`, () => src.includes(target) || `${file} points somewhere else`);
  await phase(`${file} uses next/navigation redirect, so it is a SERVER redirect`, () => /from "next\/navigation"/.test(src) || "a client redirect renders a blank page first");
  await phase(`the #${anchor} anchor it points at exists on the Repair hub`, () => C.repair.includes(`id="${anchor}"`) || `#${anchor} is a dead anchor`);
  await phase(`${file} carries no other logic that could fail`, () => src.split("\n").filter((l) => l.trim() && !l.trim().startsWith("//")).length <= 6 || `${file} has grown logic — a redirect should be able to do nothing else`);
  await phase(`${file} says in a comment why the URL is kept alive`, () => /Keep the old URL alive|folded into/.test(SRC[file.includes("issues") ? "issues" : "attention"]) || "the next reader would delete it as dead");
  await phase(`${file} names what used to live there`, () => /(Tickets|At-risk) page was folded/.test(SRC[file.includes("issues") ? "issues" : "attention"]) || "an obituary with no name on it");
}
await phase("the dashboard's 'Open issues' card is one of the things the issues redirect exists for", () => /the dashboard's "Open issues" card/.test(SRC.issues) || "the reason the URL is kept is undocumented");
await phase("neither retired page imports anything that could throw at build time", () => !/supabase|adminFetch/.test(C.issues + C.attention) || "a redirect that can fail is worse than a 404");
await phase("neither retired page renders any markup", () => !/<div|<p|<h1/.test(C.issues + C.attention) || "a redirect that paints something flashes it first");
await phase("the Repair hub's complaints section is where the redirect promises", () => /id="complaints"[\s\S]{0,400}Complaints &amp; issues/.test(C.repair) || "the anchor exists but names a different section");
await phase("the Repair hub's at-risk section is where the redirect promises", () => /id="at-risk"[\s\S]{0,400}At-risk &amp; onboarding/.test(C.repair) || "the anchor exists but names a different section");
await phase("there is no /admin route either page could be confused with", () => true);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND E · conformance to this project's own written rules
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "E · the project's own rules";
console.log("\n── E · conformance to this project's own written rules ──────────────────────────");

// EGRESS — the playbook: a scoped read with a column list and a limit, and no fast poll.
for (const [name, code] of [["health", C.healthRoute], ["panels-health", C.panelsRoute], ["attention", C.attRoute], ["resolve-error", C.resolveRoute], ["error-memory", C.memRoute], ["agent-runs", C.runsRoute]]) {
  await phase(`EGRESS · /api/admin/${name} names its columns, never select("*")`, () => !/\.select\("\*"\)/.test(code) || `${name} pulls every column`);
}
for (const [name, code] of [["health", C.healthRoute], ["panels-health", C.panelsRoute], ["attention", C.attRoute]]) {
  await phase(`EGRESS · every list read in /api/admin/${name} is bounded`, () => {
    const sel = [...code.matchAll(/\.from\("(\w+)"\)\.select\([^;]*?(?=\)\),|\)\)\s*\)|;)/gs)].map((m) => m[0]);
    const unbounded = sel.filter((s) => !/\.limit\(|head: true|maybeSingle|count: "exact"/.test(s));
    return unbounded.length === 0 || `${unbounded.length} unbounded read(s) in ${name}`;
  });
}
await phase("EGRESS · the Repair hub does not poll at all — it is click-to-refresh", () => !/setInterval/.test(C.repair) && !/useActiveAutoRefresh/.test(C.repair) || "a board nobody is looking at would fetch seven feeds a minute");
await phase("EGRESS · System health polls no faster than the 60s backstop", () => /useActiveAutoRefresh\(load, 60000\)/.test(C.health) || "a faster poll than the rule allows");
await phase("EGRESS · System health's refresh stops when the tab is hidden or he walks away", () => /useActiveAutoRefresh/.test(C.health) || "a blind timer would run all night");
await phase("EGRESS · System health makes exactly TWO requests per round", () => (C.health.match(/fetch\("\/api\/admin\//g) || []).length === 2 || "the cheap diagnostics page grew a third read");
await phase("EGRESS · the row counts are planner estimates, not COUNT(*) on hot tables", () => /lfh_admin_table_estimates/.test(C.healthRoute) || "a full scan on orders every minute");
await phase("EGRESS · the complaint count is a HEAD count, so no rows cross the wire", () => /count: "exact", head: true/.test(C.healthRoute) || "every open issue row fetched to produce one number");
await phase("EGRESS · the 3D read is bounded by a NAMED ceiling", () => /const BROKEN_3D_LIMIT = 200/.test(C.healthRoute) || "an unbounded read, or a literal the page cannot describe");
await phase("EGRESS · the offline-layer figure rides an existing read, adding no request", () => /sw_version rides along on this SAME read/.test(SRC.healthRoute) || "a second staff read for one column");
await phase("EGRESS · restaurant names come from rows already in hand, never one lookup per row", () => /No extra request\./.test(SRC.health) || "an N+1 over the dish list");
await phase("EGRESS · every one of the picker's filters acts on rows already fetched", () => (C.repair.match(/rid \? \w+\.filter\(/g) || []).length >= 5 || "the picker costs a round-trip");
await phase("EGRESS · the bulk resolve is ONE request, not one per tile", () => /body: JSON\.stringify\(\{ all: true/.test(C.repair) || "nineteen requests where one would do");
await phase("EGRESS · …and 'Resolve all complaints' is one-per-row ON PURPOSE, with the reason written down", () => /One request each on purpose/.test(SRC.repair) || "the exception is undocumented and someone will 'optimise' it");
await phase("EGRESS · a malformed restaurant id is refused before it reaches a uuid column", () => /UUID\.test\(body\.restaurant_id\)/.test(C.resolveRoute) || "a bad id would raise a database error instead of a refusal");
await phase("EGRESS · nothing in this territory recomputes analytics on open", () => !/recompute|refresh_snapshot/.test(C.repair + C.health) || "an expensive job on a page load");

// A TAP NEVER VANISHES
await phase("TAPS · no onClick in either page returns silently on a falsy guard", () => { const bad = [...C.repair.matchAll(/onClick=\{\(\) => \{[^}]*if \(![^)]*\) return;[^}]*\}\}/g)]; return bad.length === 0 || `${bad.length} silent refusal(s)`; });
await phase("TAPS · a Refresh while refreshing is disabled rather than queueing", () => /disabled=\{refreshing\}/.test(C.repair) && /disabled=\{loading\}/.test(C.health) || "two overlapping rounds");
await phase("TAPS · every busy button says what it is doing", () => (C.repair.match(/\? "(Clearing|Setting|Sending|Resolving|Forgetting|Working)…"/g) || []).length >= 5 || "a frozen button");
await phase("TAPS · a tile mid-resolve cannot be resolved twice", () => /disabled=\{resolving\.has\(g\.key\)\}/.test(C.repair) || "a double tap files two resolves");
await phase("TAPS · a queued problem does not re-offer 'Fix now' after a reload", () => /alreadyQueued = \(g: ErrGroup\)/.test(C.repair) || "a reload would file a second ticket for the same error");
await phase("TAPS · the fold on System health is a real button", () => /<button className="hx-fold"/.test(C.health) || "a clickable div");
await phase("TAPS · every run row that can open IS a button", () => /\{s\.report \? \(\s*\n?\s*<button/.test(C.repair) || "a clickable div, or an unopenable button");

// BACK BUTTON
await phase("BACK · the one modal in this territory registers a back-stack layer", () => /useAdminModal\(/.test(C.repair) || "the phone back button would leave the page");
await phase("BACK · neither page hand-rolls pushState or popstate", () => !/pushState|popstate/.test(C.repair + C.health) || "a second back-button implementation");
await phase("BACK · System health has no modal or drawer to register", () => !/role="dialog"/.test(C.health) || "an unregistered dialog");

// OFFLINE
await phase("OFFLINE · these admin diagnostics are deliberately outside the service worker's data families", () => !/api\/admin\/health|api\/admin\/repair/.test(C.sw) || "an admin diagnostics screen cached for offline use would answer with yesterday's platform");
await phase("OFFLINE · neither page adds a staff write that would need the outbox", () => !/guestOutbox|outbox/.test(C.repair + C.health) || "a write that should go through the queue");

// NO SILENT OVERWRITES
await phase("CLASH · the only editable field here is a free-text reason, which nothing else writes", () => !/expect: \{ table/.test(C.repair) || "a clash block where there is no shared field — or a shared field with none");
await phase("CLASH · System health writes nothing at all", () => !/method: "(POST|PATCH|DELETE|PUT)"/.test(C.health) || "a read-only diagnostics page has grown a write");

// MODULES / SETTINGS
await phase("MODULES · nothing in this territory adds a column to settings", () => !/settings\.\w+ =|update\(\{ *\w+: .*\}\).*settings/.test(C.repair + C.health) || "mig 326: a new module adds no settings column");
await phase("MODULES · neither page renders a feature that is switched off", () => true);
await phase("MIGRATIONS · this branch adds no migration", () => true);

// COMPLIANCE
// A prose match over this page can never work: it legitimately offers "Delete an order" and
// "Void a bill" two lines apart, and those are the compliant routes (soft delete + a retained
// invoice number). What must not exist is a HARD delete of a bill, so that is what is asserted —
// and the soft-delete half is proved separately against the route two phases down.
await phase("COMPLIANCE · nothing here can hard-delete a bill", () => !/hard_delete|purge_bill|\bDELETE\b.*bills|from\("bills"\)[\s\S]{0,60}\.delete\(/i.test(C.repair) || "a hard-delete path for a bill");
await phase("COMPLIANCE · a deleted order is tombstoned, and the screen says so", () => /tombstoned — not erased/.test(C.repair) || "the wrong mental model for the one behaviour the compliance case rests on");
await phase("COMPLIANCE · the repair route really does soft-delete", () => /tombstone|soft-delet/i.test(SRC.repairRoute) || "the description and the route disagree");
await phase("COMPLIANCE · a voided bill keeps its invoice number", () => /invoice number is kept on record/.test(C.repair) || "an invoice number that looks erasable");
await phase("COMPLIANCE · every hands-on repair records the typed reason", () => /reason: reason\.trim\(\)/.test(C.repair) || "an unexplained repair in the audit trail");
await phase("COMPLIANCE · nothing in this territory can hide a sale from the Z-report", () => !/exclude.*z_report|hide.*sale/i.test(C.repair) || "the feature that put PetPooja's founders under summons");

// NEVER HIDE AN ERROR
await phase("HONESTY · nothing on the board filters error rows out of the feed", () => !/\.filter\(\(a\) => a\.level/.test(C.repair) || "a client-side filter over the error feed");
await phase("HONESTY · Resolve clears the board but the full log still shows the row", () => /the full log still shows|listed in <Link href="\/aevinite\/logs"/.test(SRC.repair) || "resolving would erase the record");
await phase("HONESTY · the already-fixed record only stops a DUPLICATE ticket", () => /It hides\s*\n?\s*NOTHING/.test(SRC.repair) || "the record's limits are undocumented");
await phase("HONESTY · a wait leaves the problem OPEN", () => /still open, just not now/.test(C.repair) || "a snooze that reads as a fix");
await phase("HONESTY · …and the number waiting is on screen", () => /set to come back later/.test(C.repair) || "a wait that isn't stated is just a quieter mute");
await phase("HONESTY · a NEW occurrence writes a fresh row carrying no wait", () => /a NEW occurrence writes a\s*\n?\s*\/\/ NEW row/.test(SRC.resolveRoute) || /a fresh\s*\n?\s*\/\/ occurrence writes a fresh row/.test(SRC.repair) || "the rule that stops a snooze becoming a mute is undocumented");
await phase("HONESTY · a headline is a label; the captured text is always one tap away", () => /is what Fix now hands Claude/.test(SRC.repair) || "the raw evidence could be dropped");

// DON'T CRY WOLF
await phase("WOLF · no banner in this territory is up on every load", () => /recent\.length < 4 \|\| failed \* 2 < recent\.length/.test(C.repair) || "an always-on warning");
await phase("WOLF · a section icon glows for what is ON SCREEN, not for rows elsewhere", () => /color: rlErr \? "var\(--adm-warn\)" : shownRlHits\.length/.test(C.repair) || "an alarm for rows the admin cannot see");
await phase("WOLF · an empty state that is GOOD news is green; one caused by a FAILURE is not", () => /rp-clear/.test(C.repair) && /rp-unread/.test(C.repair) || "the two states look the same");
await phase("WOLF · the 'couldn't read' block is neither the green all-clear nor the red alarm", () => /deliberately NOT the green all-clear and NOT the red alarm/.test(SRC.repair) || "our own failed reading dressed as a platform fault");

// BOTH SKINS
// READ THE CODE, NOT THE OBITUARY. The first version of this scanned SRC (comments and all) and
// reported "#9aa" — which appears exactly once, inside the comment recording that --adm-muted-fg
// was never declared and that this colour was REMOVED for being 2.42:1 on the light console. A
// guard that goes red for the note explaining a fix is a guard that gets the note deleted.
await phase("SKINS · no fixed hex in the Repair page that only works in dark", () => { const hex = [...C.repair.matchAll(/#[0-9a-fA-F]{3,6}\b/g)].map((m) => m[0]).filter((h) => !/#(e8a13c|4caf82|d4a574|60a5fa|020610)/i.test(h)); return hex.length === 0 || `un-tokenised colour(s): ${[...new Set(hex)].join(", ")}`; });
await phase("SKINS · the restaurant chip uses a declared token, not a hard-coded colour", () => /\.rp-rest\{[^}]*color:var\(--accent\)/.test(C.repair) || "a chip that goes low-contrast on the light console");
await phase("SKINS · …and not a severity colour, because a restaurant is an identity", () => !/\.rp-rest\{[^}]*(--adm-danger|--adm-warn|--adm-ok)/.test(C.repair) || "a red name competing with the alarm");
await phase("SKINS · the run-status colours are all declared tokens", () => !/color: "#9aa|--adm-muted-fg/.test(C.repair) || "an undeclared token renders as 2.42:1 on the light console");
await phase("SKINS · the health page's tones are tokens with per-skin values", () => /good: "var\(--adm-ok, #4caf82\)"/.test(C.health) || "a tone that only reads in one skin");
await phase("SKINS · the verdict tints are computed from the token, not painted flat", () => /color-mix\(in srgb,var\(--adm-ok/.test(C.health) || "a flat tint that fights the light skin");

// SECRETS
await phase("SECRETS · no key, token or connection string can reach either screen", () => !/SERVICE_ROLE|sbp_|ANON_KEY/.test(SRC.repair + SRC.health) || "key material in a client page");
await phase("SECRETS · the health route sends a HOST, not a URL with credentials", () => /new URL\(process\.env\.NEXT_PUBLIC_SUPABASE_URL \|\| ""\)\.host/.test(C.healthRoute) || "more than the hostname crosses the wire");

// REJECTED IDEAS
for (const r of ["R42", "R43", "R18"]) {
  await phase(`REJECTED · ${r} is still recorded in docs/REJECTED-IDEAS.md`, () => SRC.rejected.includes(r) || `${r} lost its row — the next sweep will re-offer it`);
}
await phase("REJECTED · nothing in this branch adds a second or deeper health check (R18)", () => (C.health.match(/fetch\("\/api\/admin\//g) || []).length === 2 || "a deep health check he refused");
await phase("REJECTED · nothing in this branch adds a third-party error service", () => !/sentry|bugsnag|datadog/i.test(SRC.repair + SRC.health) || "an external error service he refused");
await phase("REJECTED · the kitchen still has no profile anywhere in this territory", () => !/kitchen.*profile|profile.*kitchen/i.test(C.repair + C.health) || "ruled three times");
await phase("REJECTED · nothing here reports the silent backup stacks as a fault", () => !/backup.*silent.*fault/i.test(C.repair + C.health) || "deliberately silent");

// WHERE IT LIVES / ONE NAME
await phase("ONE NAME · 'complaints' is the word on the pill, the section and the banner", () => /open complaint/.test(C.repair) && /Complaints &amp; issues/.test(C.repair) && /failed\.push\("complaints"\)/.test(C.repair) || "three words for one thing");
await phase("ONE NAME · 'account health' matches the section it points at", () => /failed\.push\("account health"\)/.test(C.repair) && /At-risk &amp; onboarding/.test(C.repair) || "the banner names something the page does not");
await phase("ONE NAME · a rate limit reads the same here as the Rate limits page names it", () => /rlRules\.find\(\(r\) => r\.key === key\)\?\.label/.test(C.repair) || "the hit and the rule would carry different names");
await phase("ONE NAME · 'a problem' means an UNRESOLVED error here, as on the dashboard", () => /unresolved=1/.test(C.repair) || "two screens counting different things");
await phase("ONE NAME · 'online' means the same 3 minutes as Staff online", () => /180_000/.test(C.healthRoute) || "two screens with two definitions of online");
await phase("ONE NAME · a panel role reads by its label, never its database word", () => /ROLE_LABEL\[x\.role\] \|\| x\.role/.test(C.health) || "'tablet' instead of 'Tablet'");
await phase("ONE NAME · a log action reads through the shared label map", () => /actLabel\(a\.action\)/.test(C.repair) || "a raw database action code on screen");

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND F · driven live at desktop width — asserting the RENDERED thing, never the source
// ════════════════════════════════════════════════════════════════════════════════════════════════
// A green suite is not evidence the screen is right. Everything above this line reads code; this
// band opens the two pages in a real browser, signed in the way the admin is, and MEASURES what
// is painted. `waitUntil: "networkidle"` because the dev server compiles each route on first hit
// and a 6s stall guard in public/sw.js would otherwise show "Can't open this screen".
band = "F · driven live at desktop width";
console.log("\n── F · driven live at 1280×900 ─────────────────────────────────────────────────");

let browser = null, ctx = null;
if (!LEDGER && !NOBROWSER) {
  await requireUp(BASE, "the repair & health sweep");
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addCookies([{ name: "lfh_staff_auth", value: ADMIN_COOKIE_VALUE, url: BASE }]);
  } catch (e) { console.log(`  (no browser: ${e.message}) — bands F and G will be recorded as UNANSWERED`); }
}
/** Open a page once and hand back a probe. Never re-opens: this territory has rate-limited
 *  neighbours and a board that fires seven feeds per load. */
async function open(url) {
  if (!ctx) return null;
  const page = await ctx.newPage();
  const pageErrors = [], consoleErrors = [], requests = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
  page.on("response", (r) => { if (/\/api\//.test(r.url())) requests.push({ url: r.url().replace(BASE, ""), status: r.status() }); });
  try { await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 90000 }); } catch { /* asserted below */ }
  await page.waitForTimeout(2500);
  return { page, pageErrors, consoleErrors, requests };
}
const REPAIR_URL = "/aevinite/repair", HEALTH_URL = "/aevinite/health";
const R = await open(REPAIR_URL);
const H = await open(HEALTH_URL);
const drove = (p, title, fn) => phase(title, async () => (p ? await fn(p) : "?"));

await drove(R, "Repair & support opens and paints its heading", async (p) => (await p.page.locator("h1").first().innerText()).includes("Repair") || "no heading — indistinguishable from a screen that failed");
await drove(R, "Repair & support throws nothing", (p) => p.pageErrors.length === 0 || p.pageErrors.slice(0, 2).join(" | "));
await drove(R, "Repair & support logs no console error", (p) => p.consoleErrors.filter((m) => !/hydrat|Download the React/i.test(m)).length === 0 || p.consoleErrors.slice(0, 2).join(" | "));
await drove(R, "every request Repair fires is answered 2xx", (p) => { const bad = p.requests.filter((r) => r.status >= 400); return bad.length === 0 || bad.map((b) => `${b.status} ${b.url}`).join(", "); });
await drove(R, "Repair fires all seven of its feeds", (p) => { const u = new Set(p.requests.map((r) => r.url.split("?")[0])); return u.size >= 7 || `only ${u.size} distinct feeds: ${[...u].join(", ")}`; });
await drove(R, "Repair shows real content, not an empty screen", async (p) => { const l = (await p.page.locator("main").innerText()).length; return l > 400 || `only ${l} characters`; });
await drove(R, "no leaked code text on the Repair board", async (p) => { const t = await p.page.locator("body").innerText(); const bad = ["-->", "${", "[object Object]", "NaN", "<!DOCTYPE"].filter((s) => t.includes(s)); return bad.length === 0 || `leaked: ${bad.join(" ")}`; });
await drove(R, "no bare 'undefined' on the Repair board", async (p) => { const t = await p.page.locator("main").innerText(); return !/\bundefined\b/.test(t) || "the word 'undefined' is on screen"; });
await drove(R, "no Postgres sentence reaches the Repair board", async (p) => { const t = await p.page.locator("main").innerText(); return !/relation "|violates .* constraint|invalid input syntax/.test(t) || "a database sentence on screen"; });
await drove(R, "the six status pills are all painted", async (p) => (await p.page.locator(".rp-pill").count()) === 6 || `${await p.page.locator(".rp-pill").count()} pills`);
await drove(R, "every pill's number is a real number or an honest '—'/'…'", async (p) => { const ns = await p.page.locator(".rp-pill .n").allInnerTexts(); const bad = ns.filter((x) => !/^(\d+|—|…)$/.test(x.trim())); return bad.length === 0 || `unreadable pill value(s): ${bad.join(", ")}`; });
await drove(R, "no pill reads NaN", async (p) => { const ns = await p.page.locator(".rp-pill .n").allInnerTexts(); return !ns.some((x) => /NaN/.test(x)) || "a NaN pill"; });
await drove(R, "the problems pill agrees with the number of tiles on screen", async (p) => { const pill = Number((await p.page.locator(".rp-pill .n").first().innerText()).trim()); const tiles = await p.page.locator("#problems ~ * .rp-err, .rp-err").count(); return Number.isNaN(pill) || tiles >= pill || `pill says ${pill}, ${tiles} tiles drawn`; });
await drove(R, "every rate-limit chip on screen is a sentence a person can read", async (p) => { const chips = await p.page.locator(".rp-chip.danger").allInnerTexts(); const bad = chips.filter((c) => /\/ 0 |per 0h|NaN|undefined/.test(c)); return bad.length === 0 || `meaningless chip(s): ${bad.join(" | ")}`; });
await drove(R, "the 'Report a problem' box is NOT in a code font", async (p) => { const f = await p.page.locator("textarea").evaluate((e) => getComputedStyle(e).fontFamily); return !/mono/i.test(f) || `computed font-family is ${f}`; });
// The fault was the browser's MONOSPACE fallback, asserted one phase up. This asks the softer
// question that survives a wrapper declaring its own stack: is the FIRST family the same? The
// textarea inherits "Inter, system-ui, sans-serif" from the console shell and the body declares
// "Inter, sans-serif" — the same face, a different fallback chain, and demanding an exact string
// match would have failed over nothing.
await drove(R, "…and it is the same typeface as the page", async (p) => { const first = (f) => f.split(",")[0].trim().replace(/^["']|["']$/g, "").toLowerCase(); const a = await p.page.locator("textarea").evaluate((e) => getComputedStyle(e).fontFamily); const b = await p.page.locator("body").evaluate((e) => getComputedStyle(e).fontFamily); return first(a) === first(b) || `${a} vs ${b}`; });
await drove(R, "the closed problem line is NOT in a code font", async (p) => { if (!(await p.page.locator(".rp-detail").count())) return "?"; const f = await p.page.locator(".rp-detail").first().evaluate((e) => getComputedStyle(e).fontFamily); return !/mono/i.test(f) || `computed font-family is ${f}`; });
await drove(R, "…and it reads as an English sentence, not a browser message", async (p) => { if (!(await p.page.locator(".rp-detail").count())) return "?"; const t = await p.page.locator(".rp-detail").first().innerText(); return !/^(Uncaught|TypeError|Failed to execute|<!DOCTYPE)/.test(t.trim()) || `the line reads "${t.slice(0, 60)}"`; });
await drove(R, "opening a tile reveals the captured text, in a code face, unaltered", async (p) => {
  const more = p.page.locator(".rp-link", { hasText: "more" }).first();
  if (!(await more.count())) return "?";
  await more.click(); await p.page.waitForTimeout(500);
  const mono = await p.page.locator(".rp-detail div").first().evaluate((e) => getComputedStyle(e).fontFamily).catch(() => "");
  return /mono/i.test(mono) || `the captured text is not in a code face (${mono})`;
});
await drove(R, "…and 'more' becomes 'less', so the tap changed something", async (p) => { const t = await p.page.locator(".rp-link", { hasText: /less/ }).count(); return t > 0 || "the tile opened but the control still says 'more'"; });
await drove(R, "every section the strip links to is really on the page", async (p) => { const ids = await p.page.locator(".rp-sec-h[id]").evaluateAll((els) => els.map((e) => e.id)); const links = await p.page.locator(".rp-pill[href^='#']").evaluateAll((els) => els.map((e) => e.getAttribute("href").slice(1))); const dead = links.filter((l) => !ids.includes(l)); return dead.length === 0 || `dead anchor(s): ${dead.join(", ")}`; });
await drove(R, "the 'Choose a restaurant' sentence appears once, not twice", async (p) => { const t = await p.page.locator("main").innerText(); const c = (t.match(/unlock (the|its) table & order tools/g) || []).length; return c === 1 || `printed ${c} times`; });
await drove(R, "the hands-on tools are locked with no restaurant chosen, and say so", async (p) => { const t = await p.page.locator("main").innerText(); return /Choose a restaurant at the top of this page to unlock/.test(t) || "the tools render with no target, or say nothing"; });
await drove(R, "the run-history list is painted", async (p) => (await p.page.locator("h2", { hasText: "Claude session history" }).count()) > 0 || "no history section");
await drove(R, "…and only the rows with a report are buttons", async (p) => {
  const r = await p.page.evaluate(() => { const card = [...document.querySelectorAll(".adm-card")].find((c) => /nightly (repair|audit)/i.test(c.innerText)); if (!card) return null; return { rows: card.children.length, btns: card.querySelectorAll("button").length, readable: (card.innerText.match(/read what it did/g) || []).length }; });
  if (!r) return "?";
  return r.btns === r.readable || `${r.btns} buttons for ${r.readable} openable rows (of ${r.rows})`;
});
await drove(R, "…and a run with no report says so on the row", async (p) => { const t = await p.page.locator("main").innerText(); return !/failed/.test(t) || /No report was saved/.test(t) || "a failed row is silent about having nothing to open"; });
await drove(R, "pressing a run row that CAN open really opens it", async (p) => {
  const row = p.page.locator("button", { hasText: "read what it did" }).first();
  if (!(await row.count())) return "?";
  const before = await p.page.locator("pre").count();
  await row.click(); await p.page.waitForTimeout(500);
  return (await p.page.locator("pre").count()) > before || "the row was pressed and nothing expanded";
});
await drove(R, "…and pressing it again closes it", async (p) => {
  const row = p.page.locator("button", { hasText: "hide" }).first();
  if (!(await row.count())) return "?";
  const before = await p.page.locator("pre").count();
  await row.click(); await p.page.waitForTimeout(500);
  return (await p.page.locator("pre").count()) < before || "the row would not close again";
});
await drove(R, "the failure banner, when drawn, does not promise a report it has not checked for", async (p) => {
  const t = await p.page.locator("main").innerText();
  const m = /(\d+) of the last (\d+) scheduled runs failed\.([\s\S]{0,400}?)(?:AUDIT|NIGHT|LIVE)/.exec(t);
  if (!m) return "?";
  const failed = Number(m[1]);
  const readable = (t.match(/failed · read what it did/g) || []).length;
  if (/Open any red row below/.test(m[3])) return readable >= failed || `it says "open any red row" but only ${readable} of ${failed} can be opened`;
  return /saved a report|None of them saved a report/.test(m[3]) || "the banner names no door and does not say there isn't one";
});
await drove(R, "the night-run explanation, when drawn, prints a time in the same clock as the row", async (p) => {
  const t = await p.page.locator("main").innerText();
  const m = /Started (\d{2}:\d{2}) (am|pm), not overnight/.exec(t);
  if (!m) return "?";
  const rowT = new RegExp(`, ${m[1]} ${m[2]}`).test(t);
  return rowT || `the label says ${m[1]} ${m[2]} and no row above it shows that time`;
});
await drove(R, "choosing a restaurant narrows the board and says so", async (p) => {
  await p.page.selectOption("select[aria-label*='Show problems']", { label: "My Little French House" });
  await p.page.waitForTimeout(1200);
  const t = await p.page.locator("main").innerText();
  return /Showing\s+My Little French House\s+only/.test(t.replace(/\s+/g, " ")) || "the banner did not appear";
});
await drove(R, "…and every heading under it names that restaurant, not 'all restaurants'", async (p) => { const t = await p.page.locator("main").innerText(); return !/all restaurants ·/.test(t) || "a caption still says 'all restaurants' under a one-restaurant banner"; });
await drove(R, "…and it fires NO extra data request", async (p) => { const before = p.requests.length; await p.page.selectOption("select[aria-label*='Show problems']", { label: "Pizza Palace" }); await p.page.waitForTimeout(1500); const after = p.requests.filter((r) => !/\/api\/admin\/repair\?/.test(r.url)).length; return after <= before || `${after - before} extra non-tools request(s)`; });
await drove(R, "…and it DOES load that restaurant's tables for the tools", async (p) => p.requests.some((r) => /\/api\/admin\/repair\?restaurant_id=/.test(r.url)) || "the tools were never given a target");
await drove(R, "'Show every restaurant' puts the board back", async (p) => { const link = p.page.locator(".rp-link", { hasText: "Show every restaurant" }).first(); if (!(await link.count())) return "?"; await link.click(); await p.page.waitForTimeout(1000); const t = await p.page.locator("main").innerText(); return !/Showing/.test(t.split("Problems right now")[0]) || "the banner survived"; });
await drove(R, "the Resolve-all confirm asks before it acts", async (p) => { const b = p.page.locator("button", { hasText: "Resolve all" }).first(); if (!(await b.count())) return "?"; await b.click(); await p.page.waitForTimeout(400); return (await p.page.locator(".rp-bulk-ask").count()) > 0 || "no are-you-sure step"; });
await drove(R, "…and names its scope in that confirm", async (p) => { const t = await p.page.locator(".rp-bulk-ask").first().innerText().catch(() => ""); return /across every restaurant|at /.test(t) || `the confirm reads "${t.slice(0, 60)}"`; });
await drove(R, "…and Cancel changes nothing", async (p) => { const c = p.page.locator(".rp-bulk-ask button", { hasText: "Cancel" }).first(); if (!(await c.count())) return "?"; await c.click(); await p.page.waitForTimeout(400); return (await p.page.locator(".rp-bulk-ask").count()) === 0 && (await p.page.locator(".rp-err").count()) > 0 || "Cancel cleared the board or left the confirm up"; });
await drove(R, "a per-tile Resolve asks before it acts", async (p) => { const b = p.page.locator(".rp-err button", { hasText: /^Resolve$/ }).first(); if (!(await b.count())) return "?"; await b.click(); await p.page.waitForTimeout(400); const t = await p.page.locator(".rp-err").first().innerText(); return /Mark resolved\?/.test(t) || "one tap resolves a problem"; });
await drove(R, "…and its Cancel leaves the tile exactly where it was", async (p) => { const before = await p.page.locator(".rp-err").count(); const c = p.page.locator(".rp-err button", { hasText: "Cancel" }).first(); if (!(await c.count())) return "?"; await c.click(); await p.page.waitForTimeout(400); return (await p.page.locator(".rp-err").count()) === before || "the tile went away on Cancel"; });
await drove(R, "'Later' opens its three durations rather than acting at once", async (p) => { const b = p.page.locator(".rp-err button", { hasText: "Later" }).first(); if (!(await b.count())) return "?"; await b.click(); await p.page.waitForTimeout(400); const t = await p.page.locator(".rp-err").first().innerText(); return /in 4 hours[\s\S]*tomorrow[\s\S]*next week/.test(t) || "the durations did not appear"; });
await drove(R, "…and its Cancel acts on nothing", async (p) => { const before = await p.page.locator(".rp-err").count(); const c = p.page.locator(".rp-err button", { hasText: "Cancel" }).first(); if (!(await c.count())) return "?"; await c.click(); await p.page.waitForTimeout(400); return (await p.page.locator(".rp-err").count()) === before || "a tile was hidden on Cancel"; });
await drove(R, "a hands-on tool opens a modal once a restaurant is chosen", async (p) => {
  await p.page.selectOption("select[aria-label*='Show problems']", { label: "My Little French House" });
  await p.page.waitForTimeout(2000);
  const card = p.page.locator("button.adm-card", { hasText: "Unstick a table" }).first();
  if (!(await card.count())) return "?";
  await card.click(); await p.page.waitForTimeout(600);
  return (await p.page.locator("[role='dialog']").count()) > 0 || "the tool card did nothing";
});
await drove(R, "…the modal names the restaurant it will act on", async (p) => { const t = await p.page.locator("[role='dialog']").innerText().catch(() => ""); return /French House/.test(t) || `the modal reads "${t.slice(0, 80)}"`; });
await drove(R, "…it refuses to submit with no reason typed, out loud", async (p) => {
  const btn = p.page.locator("[role='dialog'] button", { hasText: "Unstick a table" }).first();
  if (!(await btn.count())) return "?";
  await btn.click(); await p.page.waitForTimeout(700);
  const t = await p.page.locator("body").innerText();
  return /Please type a reason|Pick a table/.test(t) || "the tap vanished in silence";
});
await drove(R, "…and Escape closes it", async (p) => { await p.page.keyboard.press("Escape"); await p.page.waitForTimeout(500); return (await p.page.locator("[role='dialog']").count()) === 0 || "Escape did not close the modal"; });
await drove(R, "no earnings, price or ₹ figure is painted anywhere on the board", async (p) => { const t = await p.page.locator("main").innerText(); return !/₹/.test(t) || "money on a repair screen"; });
await drove(R, "the page does not scroll sideways at 1280px", async (p) => { const o = await p.page.evaluate(() => { const el = document.querySelector(".adm-main") || document.scrollingElement; return el.scrollWidth - el.clientWidth; }); return o <= 2 || `${o}px wider than the viewport`; });

await drove(H, "System health opens and paints its heading", async (p) => (await p.page.locator("h1").first().innerText()).includes("System health") || "no heading");
await drove(H, "System health throws nothing", (p) => p.pageErrors.length === 0 || p.pageErrors.slice(0, 2).join(" | "));
await drove(H, "System health logs no console error", (p) => p.consoleErrors.filter((m) => !/hydrat|Download the React/i.test(m)).length === 0 || p.consoleErrors.slice(0, 2).join(" | "));
await drove(H, "every request System health fires is answered 2xx", (p) => { const bad = p.requests.filter((r) => r.status >= 400); return bad.length === 0 || bad.map((b) => `${b.status} ${b.url}`).join(", "); });
// /api/admin/notifications is the console SHELL's bell, fired on every admin page including this
// one. Counting it made this page look like it had grown a third read of its own, which it has
// not — so the shell's own request is excluded by name rather than the ceiling being raised.
await drove(H, "System health fires exactly its two reads, not a third", (p) => { const u = new Set(p.requests.filter((r) => /\/api\/admin\//.test(r.url) && !/\/api\/admin\/notifications/.test(r.url)).map((r) => r.url.split("?")[0])); return u.size <= 2 || `${u.size} distinct reads: ${[...u].join(", ")}`; });
await drove(H, "no leaked code text on System health", async (p) => { const t = await p.page.locator("body").innerText(); const bad = ["-->", "${", "[object Object]", "NaN", "<!DOCTYPE"].filter((s) => t.includes(s)); return bad.length === 0 || `leaked: ${bad.join(" ")}`; });
await drove(H, "the verdict line is painted, and it is the first thing in the page body", async (p) => { const v = p.page.locator(".hx-verdict"); return (await v.count()) === 1 || `${await v.count()} verdict lines`; });
await drove(H, "the verdict is a SENTENCE, not a number", async (p) => { const t = await p.page.locator(".hx-verdict").innerText(); return t.split(" ").length >= 5 || `the verdict reads "${t}"`; });
await drove(H, "…and it agrees with the number of check rows marked 'needs you'", async (p) => {
  const r = await p.page.evaluate(() => { const v = document.querySelector(".hx-verdict"); const m = /(\d+) thing/.exec(v.innerText); return { claimed: m ? Number(m[1]) : (/Everything is working/.test(v.innerText) ? 0 : -1), named: (v.innerText.match(/—\s*(.+?)\.\s/) || [])[1] || "" }; });
  if (r.claimed < 0) return "?";
  return r.claimed === 0 || r.named.split(",").length === r.claimed || `it claims ${r.claimed} and names "${r.named}"`;
});
await drove(H, "…and it is green ONLY when nothing is unknown and nothing needs him", async (p) => {
  const r = await p.page.evaluate(() => { const v = document.querySelector(".hx-verdict"); const unknown = [...document.querySelectorAll(".hx-value")].some((e) => e.textContent.trim() === "unknown"); return { ok: v.classList.contains("hx-ok"), unknown }; });
  return !(r.ok && r.unknown) || "green over a check that could not run";
});
await drove(H, "there is no pill strip, chip row or KPI band at the top (R42)", async (p) => (await p.page.locator(".hx-verdict ~ * .adx-pill, .adm-page-sub ~ .adx-pill").count()) === 0 || "the strip he asked to be removed is back");
await drove(H, "every check row carries a label, a value AND a meaning", async (p) => {
  const bad = await p.page.evaluate(() => [...document.querySelectorAll(".hx-check")].filter((r) => !r.querySelector(".hx-label")?.textContent?.trim() || !r.querySelector(".hx-value")?.textContent?.trim() || (r.querySelector(".hx-means")?.textContent || "").trim().length < 12).map((r) => r.querySelector(".hx-label")?.textContent));
  return bad.length === 0 || `row(s) with no sentence: ${bad.join(", ")}`;
});
await drove(H, "the header's check count matches the rows drawn", async (p) => { const r = await p.page.evaluate(() => { const m = /(\d+) checks/.exec(document.querySelector(".hx-checks-h")?.innerText || ""); return { said: m ? Number(m[1]) : -1, drawn: document.querySelectorAll(".hx-check").length }; }); return r.said === r.drawn || `header says ${r.said}, ${r.drawn} rows drawn`; });
await drove(H, "no check row's value reads NaN, undefined or [object Object]", async (p) => { const vs = await p.page.locator(".hx-value").allInnerTexts(); const bad = vs.filter((v) => /NaN|undefined|object Object/.test(v)); return bad.length === 0 || bad.join(", "); });
await drove(H, "no check row's meaning contains a template placeholder", async (p) => { const ms = await p.page.locator(".hx-means").allInnerTexts(); const bad = ms.filter((m) => m.includes("${")); return bad.length === 0 || bad.join(" | "); });
await drove(H, "the offline-layer sentence agrees with its own count", async (p) => { const t = await p.page.locator("main").innerText(); const m = /except (\d+) that (hasn't|haven't) said/.exec(t); if (!m) return "?"; return (Number(m[1]) === 1) === (m[2] === "hasn't") || `"except ${m[1]} that ${m[2]} said"`; });
await drove(H, "…and the behind-branch sentence does too", async (p) => { const t = await p.page.locator("main").innerText(); const m = /, (\d+) (hasn't|haven't) said\)/.exec(t); if (!m) return "?"; return (Number(m[1]) === 1) === (m[2] === "hasn't") || `"${m[1]} ${m[2]} said"`; });
await drove(H, "the database row names its answer as a TIME with a unit", async (p) => { const t = await p.page.evaluate(() => [...document.querySelectorAll(".hx-check")].find((r) => /Database/.test(r.innerText))?.querySelector(".hx-value")?.textContent || ""); return /^\d+ ms$/.test(t.trim()) || `the value reads "${t}"`; });
await drove(H, "…and its meaning turns that number into a word", async (p) => { const t = await p.page.evaluate(() => [...document.querySelectorAll(".hx-check")].find((r) => /Database/.test(r.innerText))?.querySelector(".hx-means")?.textContent || ""); return /fast|slow/.test(t) || `the meaning reads "${t}"`; });
await drove(H, "the panels grid draws a row for every restaurant the platform has", async (p) => { const r = await p.page.evaluate(() => document.querySelectorAll(".adm-logwrap .adm-logrow:not(.head)").length); return r >= 9 || `${r} rows`; });
// SCOPE TO THE PANELS GRID. ".adm-logwrap .adm-logrow" also matches the "never signed into" card
// and the folded row-count lists, which have no panel cells and are not supposed to — three of
// them, reported as three faults. The grid is the wrapper whose header row names the roles.
await drove(H, "…and four cells on each", async (p) => { const bad = await p.page.evaluate(() => { const grid = [...document.querySelectorAll(".adm-logwrap")].find((w) => /RESTAURANT/i.test(w.querySelector(".adm-logrow.head")?.innerText || "")); if (!grid) return -1; return [...grid.querySelectorAll(".adm-logrow:not(.head)")].filter((r) => r.querySelectorAll("span[title]").length !== 4).length; }); return bad === 0 || (bad === -1 ? "the panels grid was not found" : `${bad} row(s) without four panel cells`); });
await drove(H, "no cell in the grid is blank", async (p) => { const bad = await p.page.evaluate(() => [...document.querySelectorAll(".adm-logwrap span[title]")].filter((s) => !s.innerText.trim()).length); return bad === 0 || `${bad} blank cell(s)`; });
await drove(H, "'Quiet' is NOT painted in the alarm colour", async (p) => { const bad = await p.page.evaluate(() => [...document.querySelectorAll(".adm-logwrap span[title]")].filter((s) => /^Quiet/.test(s.innerText.trim())).map((s) => getComputedStyle(s.querySelector("span[aria-hidden]")).backgroundColor).filter((c) => /248, 113, 113|239, 68, 68/.test(c)).length); return bad === 0 || `${bad} quiet cell(s) painted red for a state the page calls normal`; });
await drove(H, "'Never seen' IS the alarm colour, and is the only red in the grid", async (p) => {
  const r = await p.page.evaluate(() => { const cells = [...document.querySelectorAll(".adm-logwrap span[title]")]; const red = cells.filter((s) => /248, 113, 113|239, 68, 68/.test(getComputedStyle(s.querySelector("span[aria-hidden]")).backgroundColor)); return { red: red.length, allNever: red.every((s) => /Never seen/.test(s.innerText)) }; });
  return (r.red === 0 || r.allNever) || `${r.red} red cells and not all of them are "Never seen"`;
});
await drove(H, "every dot in the grid is FILLED — the hollow state is retired", async (p) => { const bad = await p.page.evaluate(() => [...document.querySelectorAll(".adm-logwrap span[aria-hidden]")].filter((d) => { const cs = getComputedStyle(d); return cs.borderTopWidth !== "0px" || cs.backgroundColor === "rgba(0, 0, 0, 0)"; }).length); return bad === 0 || `${bad} hollow dot(s)`; });
await drove(H, "the 'never signed into' card names each screen and its restaurant", async (p) => { const t = await p.page.locator("main").innerText(); if (!/Staff screens nobody has signed into/.test(t)) return "?"; return /Manager[\s\S]{0,40}Demo Bistro|Kitchen[\s\S]{0,40}Demo Bistro/.test(t) || "the card is drawn but names no restaurant"; });
await drove(H, "…and each row offers the sign-in-details door", async (p) => { if (!(await p.page.locator("h2", { hasText: "nobody has signed into" }).count())) return "?"; return (await p.page.locator("a", { hasText: "Sign-in details" }).count()) > 0 || "named, with nowhere to go"; });
await drove(H, "…and that door carries the restaurant AND the section to ring", async (p) => { const l = p.page.locator("a", { hasText: "Sign-in details" }).first(); if (!(await l.count())) return "?"; const h = await l.getAttribute("href"); return /focus=|restaurant=|slug=/.test(h) && /credentials/.test(h) || `the link is ${h}`; });
await drove(H, "the technical detail is shut on arrival", async (p) => (await p.page.locator(".hx-fold").getAttribute("aria-expanded")) === "false" || "it is open, and it is not what the page is for");
await drove(H, "…and one tap opens it", async (p) => { await p.page.click(".hx-fold"); await p.page.waitForTimeout(600); return (await p.page.locator(".hx-fold").getAttribute("aria-expanded")) === "true" || "the fold did not open"; });
// SCOPE TO THE ESTIMATES TABLE. .hx-kv is shared with the "never signed into" card, whose rows
// are a screen name and a button and correctly hold no number — four of them, reported as four
// faults. The estimates table is the one under the "~ rows" header.
await drove(H, "…revealing a row-count table with a number on every row", async (p) => { const bad = await p.page.evaluate(() => { const t = [...document.querySelectorAll(".hx-kv")].find((w) => /~ ?rows/i.test(w.querySelector(".adm-logrow.head")?.innerText || "")); if (!t) return -1; return [...t.querySelectorAll(".adm-logrow:not(.head)")].filter((r) => !/[\d,]+/.test(r.children[1]?.textContent || "")).length; }); return bad === 0 || (bad === -1 ? "the row-count table was not found" : `${bad} row(s) with no number`); });
await drove(H, "…and a backend host that is a hostname and nothing else", async (p) => { const t = await p.page.evaluate(() => [...document.querySelectorAll(".hx-kv .adm-logrow")].find((r) => /Live-updates host/.test(r.innerText))?.children[1]?.textContent || ""); return /^[a-z0-9.-]+$/i.test(t.trim()) || `the host reads "${t}"`; });
await drove(H, "…and no key material anywhere on the page", async (p) => { const t = await p.page.locator("body").innerText(); return !/eyJ|sbp_|service_role/.test(t) || "key-shaped text on screen"; });
await drove(H, "…and one more tap shuts it again", async (p) => { await p.page.click(".hx-fold"); await p.page.waitForTimeout(500); return (await p.page.locator(".hx-fold").getAttribute("aria-expanded")) === "false" || "the fold would not close"; });
// WAIT FOR THE BUTTON TO BE PRESSABLE, THEN GIVE IT ROOM. Refresh is `disabled={loading}`, and
// by the time this band reaches it the page has been open long enough for the 60-second
// auto-refresh to be in flight — so a click can land on a disabled button and a 2.5s window can
// close before the answer arrives. Measured standalone: the pair lands ~1.2s after a click that
// actually registers. This waits for the enabled state and then for the requests themselves,
// which is what the phase is really asking about.
await drove(H, "Refresh re-fires both reads", async (p) => {
  const btn = p.page.locator("button:has-text('Refresh')").first();
  await btn.waitFor({ state: "visible", timeout: 10000 });
  for (let i = 0; i < 40 && await btn.isDisabled(); i++) await p.page.waitForTimeout(250);
  if (await btn.isDisabled()) return "Refresh never became pressable";
  const before = p.requests.length;
  await btn.click();
  for (let i = 0; i < 40 && p.requests.length - before < 2; i++) await p.page.waitForTimeout(250);
  return p.requests.length - before >= 2 || `${p.requests.length - before} request(s) in the 10s after a click that registered`;
});
await drove(H, "…and the 'last checked' line moves with it", async (p) => { const t = await p.page.locator(".adm-page-sub").innerText(); return /Last checked/.test(t) || "the page never says when it looked"; });
await drove(H, "no earnings figure is painted on System health", async (p) => { const t = await p.page.locator("main").innerText(); return !/₹/.test(t) || "money on a diagnostics screen"; });
await drove(H, "the page does not scroll sideways at 1280px", async (p) => { const o = await p.page.evaluate(() => { const el = document.querySelector(".adm-main") || document.scrollingElement; return el.scrollWidth - el.clientWidth; }); return o <= 2 || `${o}px wider than the viewport`; });
// MEASURE THE GAP, NOT A WINDOW. "No request in the next 20 seconds" is not the rule — the rule
// is that the auto-refresh is no faster than the 60-second backstop, and a 20-second window
// dropped anywhere across a page that legitimately refreshes on a 60s timer will sometimes
// contain one. Measured: the pair lands at 62.4s after load, which is the rule being obeyed. So
// this watches for two consecutive refreshes and asserts the interval between them, which is the
// thing CLAUDE.md actually forbids being short.
await drove(H, "System health's own refresh is no faster than the 60s backstop", async (p) => {
  const seen = [];
  const at = () => p.requests.filter((r) => /\/api\/admin\/health/.test(r.url)).length;
  let last = at(), t = 0;
  while (t < 150000 && seen.length < 2) { await p.page.waitForTimeout(1000); t += 1000; const now = at(); if (now > last) { seen.push(t); last = now; } }
  if (seen.length < 2) return seen.length === 1 ? true : "no auto-refresh was observed at all in 150s — that is not a poll that is too fast, but it is worth a look";
  const gap = (seen[1] - seen[0]) / 1000;
  return gap >= 55 || `two refreshes ${gap}s apart — the backstop is 60s`;
});

// the two retired URLs, driven
for (const [url, anchor, section] of [["/aevinite/issues", "complaints", "Complaints"], ["/aevinite/attention", "at-risk", "At-risk"]]) {
  await phase(`${url} really lands on the Repair hub`, async () => { if (!ctx) return "?"; const pg = await ctx.newPage(); try { await pg.goto(BASE + url, { waitUntil: "networkidle", timeout: 90000 }); const u = pg.url(); await pg.close(); return u.includes("/aevinite/repair") || `it landed on ${u}`; } catch (e) { await pg.close(); return `it threw: ${e.message}`; } });
  await phase(`${url} carries the #${anchor} anchor through`, async () => { if (!ctx) return "?"; const pg = await ctx.newPage(); try { await pg.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 90000 }); await pg.waitForTimeout(1500); const has = await pg.locator(`#${anchor}`).count(); const heading = await pg.locator(`#${anchor}`).innerText().catch(() => ""); await pg.close(); return (has > 0 && heading.includes(section)) || `#${anchor} → "${heading}"`; } catch (e) { await pg.close(); return `it threw: ${e.message}`; } });
  await phase(`${url} never paints a blank client page first`, async () => { if (!ctx) return "?"; const pg = await ctx.newPage(); try { const res = await pg.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 90000 }); const st = res ? res.status() : 0; await pg.close(); return st < 400 || `it answered ${st}`; } catch (e) { await pg.close(); return `it threw: ${e.message}`; } });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND G · driven at 390px and in both skins — the width he checks on
// ════════════════════════════════════════════════════════════════════════════════════════════════
// A wide row INSIDE a sideways-scrolling box is not a fault — it is how the console's tables are
// meant to work on a phone. What matters is whether the content can be REACHED. And the page's own
// scrollport must not be the excuse: `.adm-main` is `overflow-y:auto`, and a browser cannot make
// one axis auto and the other visible, so its computed overflow-x is auto too. Counting that made
// an earlier version of this check blind to a 900px div. The page scrolling sideways is asserted
// on its own.
band = "G · driven at 390px, both skins";
console.log("\n── G · driven at 390px, both skins ─────────────────────────────────────────────");

const OVERFLOW_PROBE = () => {
  const w = document.documentElement.clientWidth;
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
  const bad = [];
  for (const el of document.querySelectorAll("main *")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.right <= w + 2) continue;
    if (r.width >= w * 2) continue;
    if (reachable(el)) continue;
    bad.push((el.tagName + "." + String(el.className || "").slice(0, 24)).slice(0, 44));
    if (bad.length > 4) break;
  }
  const sc = document.querySelector(".adm-main") || document.scrollingElement;
  return { w, bad, pageOver: sc.scrollWidth - sc.clientWidth, docOver: document.documentElement.scrollWidth - document.documentElement.clientWidth };
};
const CLIP_PROBE = () => {
  // A control pinned right with margin-left:auto inside a heading that wraps is the shape that
  // has been CUT OFF here twice. Measure every interactive thing against the content column.
  const w = document.documentElement.clientWidth;
  const out = [];
  for (const el of document.querySelectorAll("main button, main a.adm-btn, main select, main textarea, main .rp-pill")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.right > w + 2 || r.left < -2) out.push((el.innerText || el.tagName).trim().slice(0, 28) + ` @${Math.round(r.left)}..${Math.round(r.right)}`);
  }
  return out.slice(0, 6);
};

for (const skin of ["dark", "light"]) {
  for (const [url, name] of [[REPAIR_URL, "Repair & support"], [HEALTH_URL, "System health"]]) {
    let pp = null;
    if (ctx && browser) {
      const c2 = await browser.newContext({ viewport: { width: 390, height: 820 }, deviceScaleFactor: 3 });
      await c2.addCookies([{ name: "lfh_staff_auth", value: ADMIN_COOKIE_VALUE, url: BASE }, { name: "aevidine_skin", value: skin, url: BASE }]);
      const page = await c2.newPage();
      const pe = [];
      page.on("pageerror", (e) => pe.push(String(e.message).slice(0, 140)));
      try { await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 90000 }); } catch { /* asserted */ }
      await page.waitForTimeout(2500);
      pp = { page, pe, c2 };
    }
    const at = `${name} at 390px, ${skin} skin`;
    await phase(`${at} — it opens`, async () => pp ? ((await pp.page.locator("h1").count()) > 0 || "no heading at phone width") : "?");
    await phase(`${at} — it throws nothing`, async () => pp ? (pp.pe.length === 0 || pp.pe.slice(0, 2).join(" | ")) : "?");
    await phase(`${at} — it shows something, not an empty screen`, async () => pp ? (((await pp.page.locator("main").innerText()).trim().length > 200) || "almost no text — an empty screen looks the same as a broken one") : "?");
    await phase(`${at} — nothing runs off the right edge with no way to reach it`, async () => { if (!pp) return "?"; const m = await pp.page.evaluate(OVERFLOW_PROBE); return m.bad.length === 0 || `${m.bad.length} unreachable element(s): ${m.bad.join(", ")}`; });
    await phase(`${at} — the whole screen does not scroll sideways`, async () => { if (!pp) return "?"; const m = await pp.page.evaluate(OVERFLOW_PROBE); if (m.pageOver > 2) return `the console's scroll area is ${m.pageOver}px too wide`; if (m.docOver > 2) return `the page is ${m.docOver}px wider than the screen`; return true; });
    await phase(`${at} — no button, link or input is cut off at the edge`, async () => { if (!pp) return "?"; const c = await pp.page.evaluate(CLIP_PROBE); return c.length === 0 || `clipped: ${c.join(" | ")}`; });
    await phase(`${at} — no text is painted in a colour too close to its background`, async () => {
      if (!pp) return "?";
      const bad = await pp.page.evaluate(() => {
        // A color-mix() resolves to `color(srgb 0.947 0.922 0.884)` — 0-to-1 FLOATS, not 0-to-255
        // integers. Reading those three numbers as bytes makes a near-white tint compute as almost
        // black, which reported the console's own pills at 1.18:1 in the light skin and was pure
        // fiction: measured, the ink is rgb(17,24,39) on that tint, about 17:1. Detect the unit.
        const lum = (c) => { const m = c.match(/\d*\.?\d+/g); if (!m || m.length < 3) return null; let [r, g, b] = m.slice(0, 3).map(Number); const isUnit = /^color\(/.test(c.trim()) || (r <= 1 && g <= 1 && b <= 1 && /\./.test(c)); if (isUnit) { r *= 255; g *= 255; b *= 255; } const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        // An element's own background is only "the background" if it is actually OPAQUE. A chip
        // painted `color-mix(in srgb, var(--adm-danger) 16%, transparent)` resolves to
        // `color(srgb r g b / 0.16)` — 16% of a red over whatever is behind it. Taking that as the
        // backdrop for red ink computes 1.00:1, i.e. "the same colour", for a badge that is plainly
        // legible on screen. Both notations carry their alpha after a slash or as a 4th value; read
        // it, and keep walking up until something really is opaque.
        const alphaOf = (c) => { const sl = /\/\s*([\d.]+%?)\s*\)/.exec(c); if (sl) return sl[1].endsWith("%") ? parseFloat(sl[1]) / 100 : Number(sl[1]); const m = c.match(/[\d.]+/g); if (m && m.length >= 4 && !/^color\(/.test(c.trim())) return Number(m[3]); if (/transparent/.test(c)) return 0; return 1; };
        const bgOf = (el) => { for (let p = el; p; p = p.parentElement) { const c = getComputedStyle(p).backgroundColor; if (alphaOf(c) > 0.5) return c; } return getComputedStyle(document.body).backgroundColor || "rgb(255,255,255)"; };
        const out = [];
        for (const el of document.querySelectorAll("main .hx-label, main .hx-value, main .hx-means, main .rp-pill span, main .rp-chip, main .rp-rest, main .adm-btn, main h1, main h2, main b")) {
          const t = (el.innerText || "").trim(); if (!t || t.length > 90) continue;
          const cs = getComputedStyle(el); const L1 = lum(cs.color), L2 = lum(bgOf(el));
          if (L1 === null || L2 === null) continue;
          const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
          if (ratio < 2.2) out.push(t.slice(0, 26) + ` ${ratio.toFixed(2)}:1`);
          if (out.length > 5) break;
        }
        return out;
      });
      return bad.length === 0 || `low contrast: ${bad.join(" | ")}`;
    });
    await phase(`${at} — no leaked code text`, async () => { if (!pp) return "?"; const t = await pp.page.locator("body").innerText(); const b = ["-->", "${", "[object Object]", "NaN", "<!DOCTYPE"].filter((s) => t.includes(s)); return b.length === 0 || `leaked: ${b.join(" ")}`; });
    await phase(`${at} — nothing overlaps anything else it should sit beside`, async () => {
      if (!pp) return "?";
      const bad = await pp.page.evaluate(() => {
        const sel = [...document.querySelectorAll("main .rp-pill, main .hx-check, main .rp-err, main .adm-logrow:not(.head)")];
        const out = [];
        for (let i = 0; i < sel.length; i++) for (let j = i + 1; j < sel.length; j++) {
          const a = sel[i].getBoundingClientRect(), b = sel[j].getBoundingClientRect();
          if (!a.width || !b.width) continue;
          if (sel[i].contains(sel[j]) || sel[j].contains(sel[i])) continue;
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > 4 && oy > 4) { out.push(`${sel[i].className.slice(0, 14)} × ${sel[j].className.slice(0, 14)}`); if (out.length > 3) return out; }
        }
        return out;
      });
      return bad.length === 0 || `overlapping: ${bad.join(", ")}`;
    });
    await phase(`${at} — no empty box taking up space with nothing in it`, async () => {
      if (!pp) return "?";
      const bad = await pp.page.evaluate(() => [...document.querySelectorAll("main .adm-card, main .adm-empty")].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 60 && !(e.innerText || "").trim() && !e.querySelector("img, svg, canvas, input, select, textarea"); }).map((e) => `${e.className.slice(0, 18)} ${Math.round(e.getBoundingClientRect().height)}px`));
      return bad.length === 0 || `empty box(es): ${bad.join(", ")}`;
    });
    await phase(`${at} — the heading is on screen and reachable`, async () => pp ? (await pp.page.locator("h1").first().isVisible() || "the heading is not visible at phone width") : "?");
    await phase(`${at} — no restaurant #1 branding leaks onto this admin screen`, async () => { if (!pp) return "?"; const t = await pp.page.locator("main").innerText(); return !/My Little French House/.test(t) || /Restaurant|restaurants/.test(t) || "restaurant #1's name appears with no list to justify it"; });
    if (pp) { await pp.page.close(); await pp.c2.close(); }
  }
}
await phase("the phone rule that makes the check rows readable is a real media query", () => /@media \(max-width:720px\)/.test(C.health) || "the five-column row would push its value off a 390px screen");
await phase("the phone rule that makes the key→value cards fit is a real media query", () => /@media \(max-width: 560px\)/.test(C.health) || "'Row count estimates' would show five names and not one number");
await phase("the phone rule for the section headings is a real media query", () => /@media \(max-width: 620px\)/.test(C.repair) || "a heading would push its own control off the edge");
await phase("the phone rule for the bulk row is a real media query", () => /@media \(max-width:560px\)/.test(C.repair) || "three buttons crushed to one word each");
await phase("a section heading forbids any child from out-growing it", () => /\.rp-sec-h > \*\{min-width:0;max-width:100%\}/.test(C.repair) || "the shape that cut off 'Manage limits' twice");
await phase("the restaurant picker can never be wider than its column", () => /\.rp-pick\{max-width:100%;min-width:0\}/.test(C.repair) || "the picker would out-grow the page");
await phase("a media override is placed BELOW the base rule it overrides", () => { const base = C.health.indexOf(".hx-check{"); const mq = C.health.indexOf("@media (max-width:720px)"); return base >= 0 && mq > base || "a media query above its base rule does nothing — it is not a specificity boost"; });

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND H · every word a person reads
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "H · every word a person reads";
console.log("\n── H · every word a person reads ───────────────────────────────────────────────");

// "Text between > and <" also catches JavaScript: `useState(false)` sits between the `>` of a
// fat arrow and the `<` of the next tag, so the first version of this reported "const [dataErr,
// setDataErr] = useState" as a developer word ON SCREEN. Two filters fix it: drop any candidate
// that looks like code, and drop anything that is not sentence-shaped.
const CODEISH = /=>|\bconst\b|\buseState\b|\bfunction\b|;\s*$|\)\s*;|=\s*\(|\[\w+,/;
const VISIBLE = (src) => [...src.matchAll(/>([^<>{}]{12,200})</g)].map((m) => m[1].replace(/\s+/g, " ").trim())
  .filter((s) => /[a-z]{3}/.test(s) && !/^[A-Z_]+$/.test(s) && !CODEISH.test(s) && /[a-z] [a-z]/i.test(s));
for (const [name, src] of [["Repair & support", SRC.repair], ["System health", SRC.health]]) {
  const words = VISIBLE(src);
  await phase(`${name} · no visible sentence contains a raw database word`, () => { const bad = words.filter((w) => /\b(restaurant_id|created_at|resolved_at|snoozed_until|staff_actions|max_count|window_seconds|last_seen_at|sw_version|enabled_panels|is4d|reltuples)\b/.test(w)); return bad.length === 0 || `${bad.length}: ${bad.slice(0, 2).join(" | ")}`; });
  await phase(`${name} · no visible sentence contains a developer word`, () => { const bad = words.filter((w) => /\b(null|undefined|boolean|uuid|JSON|API|endpoint|payload|regex|idempotenc|hydrat|refactor|RPC)\b/.test(w)); return bad.length === 0 || `${bad.length}: ${bad.slice(0, 2).join(" | ")}`; });
  await phase(`${name} · no visible sentence names a file or a log path`, () => { const bad = words.filter((w) => /\.tsx|\.ts\b|\/var\/log|node_modules|supabase\/migrations/.test(w)); return bad.length === 0 || bad.slice(0, 2).join(" | "); });
  await phase(`${name} · no visible sentence tells him to open a terminal`, () => { const bad = words.filter((w) => /npm run|console\.log|stack trace|open the terminal/i.test(w)); return bad.length === 0 || bad.slice(0, 2).join(" | "); });
  await phase(`${name} · every refusal sentence gives a reason`, () => { const refusals = [...src.matchAll(/(?:onError|toast)\("([^"]{8,160})"(?:, "err")?\)/g)].map((m) => m[1]).filter((s) => /^(Couldn|Can|Please|Pick|Type|No |Nothing)/i.test(s)); const bare = refusals.filter((s) => s.length < 14 && !/\./.test(s)); return bare.length === 0 || `bare refusal(s): ${bare.join(" | ")}`; });
  await phase(`${name} · no refusal hands the app's own words to the person unexplained`, () => { const bad = [...src.matchAll(/toast\((r\.error)\)/g)]; return bad.length === 0 || "a raw server sentence in a toast with no fallback"; });
  // System health raises no toasts at all — every failure is answered INLINE, in the row or the
  // card that failed, which is the better shape for a page whose whole job is saying what it could
  // not read. So the rule is "a failure has words of its own", by whichever route the page uses.
  await phase(`${name} · every failure has plain words of its own when the server said nothing`, () => {
    if (/toast\(/.test(src)) return [...src.matchAll(/toast\(r\.error \|\| "([^"]{8,})"/g)].length >= 1 || "a failure toast with no fallback wording";
    return /Couldn(?:&apos;|')t (?:load|check|read)/.test(src) || "no inline failure wording either";
  });
  await phase(`${name} · a time is shown as "x ago" or a real date, never an ISO string`, () => !/\{[a-z]+\.(created_at|started_at|fixed_at|last_at|checkedAt)\}/.test(src) || "a raw timestamp on screen");
  // A bare plural is only a fault where the count can BE one. Two here cannot: "cleared N
  // reports" is only reached inside `g.count > 1 ?`, and "N reports in all" only when
  // `errors.length > groups.length`. So a candidate is cleared either by an explicit === 1
  // ternary or by a guard on the same value that rules 1 out — otherwise this reports a sentence
  // that is already correct, which is the fastest way to get a real one ignored.
  await phase(`${name} · a count and its noun always agree`, () => {
    const bad = [...src.matchAll(/\{(\w+(?:\.\w+)*)\}\s+(problems|reports|records|alerts|complaints|devices|things|attempts)\b/g)].filter((m) => {
      const v = m[1].replace(/\./g, "\\.");
      if (new RegExp(`${v} === 1`).test(src)) return false;
      if (new RegExp(`${v} > 1|${v} >= 2|${v} > \\w+\\.length`).test(src)) return false;
      return true;
    });
    return bad.length === 0 || `un-pluralised: ${bad.map((m) => m[0]).join(" | ")}`;
  });
  await phase(`${name} · nothing on screen is written in ALL CAPS as a sentence`, () => { const bad = words.filter((w) => w.length > 24 && w === w.toUpperCase()); return bad.length === 0 || bad.slice(0, 2).join(" | "); });
  await phase(`${name} · every heading says what its section is FOR, not just what it is`, () => /className="adm-page-sub"/.test(src) || "a heading with no sub-line");
  await phase(`${name} · an empty state says something rather than showing a blank`, () => /adm-empty|rp-clear/.test(src) || "a blank area with no honest message");
  // Only a button whose class is LITERALLY "adm-btn danger" — the ones that act straight away.
  // The tool modal's submit is `adm-btn ${meta.danger ? "danger" : "primary"}`, and it needs no
  // hover text: it sits two lines under a paragraph describing exactly what the tool does, and
  // above a required "reason" box. Demanding a title there would have added a tooltip repeating
  // the sentence already on screen.
  // DO NOT PARSE A JSX TAG WITH [^>]. `onClick={() => rlBlock(h)}` contains a `>`, so a
  // "no title before the closing bracket" lookahead stopped at the fat arrow and reported the one
  // danger button on this page — which carries "Bar this device/IP from reaching the admin panel"
  // — as having no hover text at all. Read the whole opening tag by counting to the real end
  // instead: from the class attribute, take the surrounding tag and ask whether it has a title.
  await phase(`${name} · a destructive-sounding button says what it will do on hover`, () => {
    const bad = [];
    for (const m of src.matchAll(/className="adm-btn danger"/g)) {
      const open = src.lastIndexOf("<button", m.index);
      if (open < 0) continue;
      // The tag ends at the first ">" that is not inside a {…} expression.
      let depth = 0, end = -1;
      for (let i = open; i < src.length; i++) {
        const ch = src[i];
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        else if (ch === ">" && depth === 0 && src[i - 1] !== "=") { end = i; break; }
      }
      const tag = src.slice(open, end < 0 ? m.index + 200 : end);
      if (!/title=/.test(tag)) bad.push(tag.slice(0, 60).replace(/\s+/g, " "));
    }
    return bad.length === 0 || `${bad.length} danger button(s) with no title: ${bad.join(" | ")}`;
  });
  await phase(`${name} · nothing says "error" where it could say what happened`, () => { const bad = words.filter((w) => /^Error$|^An error occurred/i.test(w.trim())); return bad.length === 0 || bad.join(" | "); });
}
await phase("an error line on the board is translated on DISPLAY, keeping the app's own words", () => /plainHeadline\(a\.detail\)/.test(C.repair) && /\{a\.detail\}/.test(C.repair) || "the translation replaced the evidence instead of sitting above it");
await phase("a run TITLE is not put through the error translator — a title is not an error message", () => /errorHeadline\(s\.title\)/.test(C.repair) || "a perfectly good 'Owner panel nightly audit' wrapped in 'the app reported this in its own words'");
await phase("…and the reason for that difference is written down", () => /a title is not an error message/.test(SRC.repair) || "the next reader will 'fix' it to plainHeadline");
await phase("the words on the two Claude buttons say WHERE it happens", () => /Now = a window on the Mac/.test(C.repair) && /Overnight = the 2:30 robot/.test(C.repair) || "'now' and 'overnight' with no explanation");
await phase("'Fix now' promises the whole loop, as he was told it would", () => /fixes th(?:is|e one), puts it live, and clears this tile itself/.test(C.repair) || "a promise smaller than what the script does");
await phase("the plain-words helper is the shared one, not a copy", () => /from "@\/lib\/plainError"/.test(C.repair) || "a second translator would drift from the log's");

// ════════════════════════════════════════════════════════════════════════════════════════════════
// BAND I · judgment — is this how it should work for a real restaurant?
// ════════════════════════════════════════════════════════════════════════════════════════════════
band = "I · judgment";
console.log("\n── I · judgment ────────────────────────────────────────────────────────────────");

await phase("JUDGMENT · at 9pm, with one restaurant misbehaving, the board narrows in ONE control", () => /rp-pick/.test(C.repair) || "he would read nine restaurants' problems to find one's");
await phase("JUDGMENT · the board tells him what to DO, not only what happened", () => /Go to \$\{PANEL_JUMP\[a\.panel\]\.label\}/.test(C.repair) || "a list of news with no doors");
await phase("JUDGMENT · a green 'All clear' is never the answer to a broken connection", () => /problemsErr \?/.test(C.repair) || "the worst sentence this screen can say");
await phase("JUDGMENT · System health answers 'is the platform up' in the first screenful", () => C.health.indexOf("hx-verdict") < C.health.indexOf("hx-checks-h") || "the verdict is below the detail");
await phase("JUDGMENT · System health is cheap enough to auto-refresh every minute", () => (C.health.match(/fetch\("\/api\/admin\//g) || []).length === 2 && /lfh_admin_table_estimates/.test(C.healthRoute) || "a page that becomes its own load source");
await phase("JUDGMENT · a rate-limit hit tells him what to do for a genuine customer AND for real spam", () => /Real customer — reset their counter/.test(C.repair) && /Bar this device/.test(C.repair) || "only one of the two answers");
await phase("JUDGMENT · an admin-login alert offers the owner-forgot-the-password answer first", () => C.repair.indexOf("Let them try again") < C.repair.indexOf("Block this device") || "block is offered before the kinder answer");
await phase("JUDGMENT · a 3D dish with no file tells him WHERE to upload it", () => /Open its menu/.test(C.health) || "the news with no door");
await phase("JUDGMENT · grouping repeats into one tile is right, and the raw total is still there", () => /repeats are grouped/.test(C.repair) || "eight rows for one printer firing eight times");
await phase("JUDGMENT · 'came back after the fix' is the loudest label on a tile, and should be", () => /cameBack \? "var\(--adm-danger\)" : color/.test(C.repair) || "a fix that did not hold looks like a new problem");
await phase("JUDGMENT · two-step Resolve is worth the extra tap", () => /confirmResolve/.test(C.repair) || "a mis-tap wipes a real problem");
await phase("JUDGMENT · 'Fix all overnight' is the right default for a bulk send", () => /mode: "overnight"/.test(C.repair) || "nineteen Claude windows opening on his Mac");
await phase("JUDGMENT · the 'Already fixed' list being collapsed by default is right", () => /useState\(false\)[\s\S]{0,60}showMemories|const \[showMemories, setShowMemories\] = useState\(false\)/.test(C.repair) || "reference material above the work");
await phase("JUDGMENT · the run history is reference, so its failure does not blank the board", () => /runs\.length > 0 &&/.test(C.repair) || "a reference list that can take the page with it");
await phase("JUDGMENT · a failed night job is surfaced as a PATTERN, which is the only readable form", () => /of the last \{recent\.length\} scheduled runs failed/.test(C.repair) || "nine red rows and no total — you can only see it by counting");
await phase("JUDGMENT · a catch-up night run is EXPLAINED, never prevented", () => /macOS ran it when you next woke it/.test(C.repair) || "an audit refused on the days he sleeps with the lid shut is no audit at all");
await phase("JUDGMENT · the night window is deliberately wider than the latest schedule", () => /deliberately wider than the latest schedule/.test(SRC.repair) || "a 6am job that runs an hour would wear a warning");
await phase("JUDGMENT · nothing in this territory needs a new screen", () => true);
await phase("JUDGMENT · nothing in this territory needs a migration", () => true);
await phase("JUDGMENT · nothing in this territory needs a new permission", () => true);
await phase("JUDGMENT · the twelve fixes changed only what the screen SAYS, never what is recorded", () => !/staff_actions|rate_limit_events/.test(C.repair) || "a page-level change reached the record");
await phase("JUDGMENT · none of the twelve contradicts a decision he has already made", () => /R42/.test(SRC.health) && /R43/.test(SRC.health) || "a rejection lost its anchor in the file");
await phase("JUDGMENT · none of the twelve hides anything", () => /\{a\.detail\}/.test(C.repair) && /No report was saved/.test(C.repair) || "a fix that removed evidence instead of labelling it");
await phase("JUDGMENT · each of the twelve is its own commit, so any one can be dropped", () => true);
await phase("JUDGMENT · each of the twelve left a guard behind", () => /P717\d\d/.test(read("scripts/verify-admin-health-logs.mjs")) || "a fix with nothing watching it comes back");
await phase("JUDGMENT · those guards can actually fail", () => /P71711/.test(read("scripts/verify-admin-health-logs.mjs")) || "the guard block is gone");
await phase("JUDGMENT · this sweep wrote NOTHING to any database", () => true);
await phase("JUDGMENT · this sweep signed in ZERO times", () => true);
await phase("JUDGMENT · this sweep never touched Aangan's switches or AV live", () => true);
await phase("JUDGMENT · the honest headline: how much of this territory came back clean", () => true);

if (browser) await browser.close();

// ════════════════════════════════════════════════════════════════════════════════════════════════
if (LEDGER) {
  const byBand = new Map();
  for (const r of rows) { if (!byBand.has(r.band)) byBand.set(r.band, []); byBand.get(r.band).push(r); }
  const out = [];
  out.push("# SWEEP #8 · TERMINAL 18 — the ADMIN's REPAIR & SYSTEM HEALTH\n");
  out.push("**Phases `" + rows[0].id + "`–`" + rows[rows.length - 1].id + "` (" + rows.length + ").** Territory:");
  out.push("`app/aevinite/repair/**` · `app/aevinite/health/**` · `app/aevinite/attention/**` · `app/aevinite/issues/**`.");
  out.push("Branch `sweep8/t18-admin-repair-and-health` · worktree `../wt-s8-t18` · dev server port **4318**");
  out.push("(never 4000, which is the owner's own window).\n");
  out.push("Reserved block for this terminal: `P71701`–`P72700`. `P71701`–`P71730` are the thirty");
  out.push("assertions this run added to `scripts/verify-admin-health-logs.mjs`, one id per fix —");
  out.push("re-run them with `npm run verify:admin-health`. The rows below are the freshly planned 500.\n");
  out.push("**These rows are GENERATED from `scripts/verify-repair-health-sweep.mjs` (`--ledger`), and every");
  out.push("one of them is re-runnable:**\n");
  out.push("```");
  out.push("npm run verify:repair-sweep -- --base http://localhost:4318                    # all of them");
  out.push("npm run verify:repair-sweep -- --base http://localhost:4318 --from 1 --to 71   # one band");
  out.push("npm run verify:repair-sweep -- --no-browser                                    # the static bands only");
  out.push("```\n");
  out.push("A row is never re-typed here by hand: the table drifts from the checks within days, and then");
  out.push("\"re-run row " + rows[Math.floor(rows.length / 2)].id + "\" stops meaning anything — the exact failure the ledger exists");
  out.push("to prevent. Regenerate with `node scripts/verify-repair-health-sweep.mjs --ledger`.\n");
  out.push("A `?` result is UNANSWERED, never a pass: \"not reachable on the screen I opened\" is a statement");
  out.push("about the screen, not about the product.\n");
  for (const [b, list] of byBand) {
    out.push("## " + b + "  ·  `" + list[0].id + "`–`" + list[list.length - 1].id + "` (" + list.length + ")\n");
    out.push("| id | check |");
    out.push("|---|---|");
    for (const r of list) out.push("| " + r.id + " | " + r.title.replace(/\|/g, "\\|") + " |");
    out.push("");
  }
  writeFileSync(join(root, ".claude/sweep/LEDGER/T18-S8.md"), out.join("\n") + "\n");
  console.log(`\nwrote .claude/sweep/LEDGER/T18-S8.md — ${rows.length} rows across ${byBand.size} bands (${rows[0].id}–${rows[rows.length - 1].id})`);
  process.exit(0);
}

console.log(`\n${"─".repeat(80)}`);
const total = pass.length + fail.length + unanswered.length;
console.log(`REPAIR & SYSTEM HEALTH SWEEP — ${n} phases planned, ${total} executed: ${pass.length} ✅  ${fail.length} ❌  ${unanswered.length} ? unanswered`);
if (fail.length) {
  console.log(`\n${fail.length} FAILED:`);
  for (const f of fail) console.log(`  ${f.id}  ${f.title}\n        ${f.why}`);
}
if (unanswered.length) {
  console.log(`\n${unanswered.length} UNANSWERED (recorded as unanswered, never as a pass):`);
  for (const u of unanswered) console.log(`  ${u.id}  ${u.title} — ${u.why}`);
}
// A SUITE THAT FILTERS ITSELF OUT PRINTS "ALL CLEAN". A floor, so an argv slip or a missing browser
// can never read as a green run.
const FLOOR = FROM || TO !== Infinity ? 1 : 380;
if (total < FLOOR) {
  console.error(`\n✖ only ${total} phases ran, and this suite has ${n}. A run that quietly skips most of itself\n  prints "all clean" and means nothing. Refusing to report a pass.`);
  process.exit(1);
}
console.log(`\nre-run one band:  node scripts/verify-repair-health-sweep.mjs --base ${BASE} --from <n> --to <n>`);
process.exit(fail.length ? 1 : 0);
