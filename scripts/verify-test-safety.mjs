// Guards the rule "our own testing must never set off the app's own alerts".
//
// WHY THIS EXISTS. The "limit reached" alerts go to the owner's PHONE and exist for real trouble
// in a real restaurant. Our tooling kept firing them at him about himself:
//   • 2026-07-29 — sweep scripts called loginAs() once per browser context, so one run burned the
//     5-per-5-minutes staff-login limit and pinged him.
//   • 2026-07-30 — a check POSTed to /api/staff-login as JSON. That route reads FORM data, so the
//     password arrived EMPTY: three "checks" were three WRONG-PASSWORD attempts and raised an
//     admin_login limit event about his own admin panel.
// Noise is how a real alert gets ignored, so tripping a limit in our own tests is a BUG IN THE
// TEST. These checks make each of those specific mistakes fail loudly instead of reaching him.
//
//   node scripts/verify-test-safety.mjs        # check
//   node scripts/verify-test-safety.mjs --hook # PostToolUse mode (silent unless broken)
//
// Add a check here whenever a new way to trip a limit appears.
import fs from "node:fs";
import path from "node:path";

const HOOK = process.argv.includes("--hook");
const TEST_FILE = /[/\\](scripts|tests)[/\\].*\.mjs$/;

let ROOT = process.argv[2] && process.argv[2] !== "--hook" ? process.argv[2] : process.cwd();
if (HOOK) {
  let raw = ""; try { raw = fs.readFileSync(0, "utf8"); } catch { process.exit(0); }
  let payload = {}; try { payload = JSON.parse(raw || "{}"); } catch { process.exit(0); }
  const f = payload?.tool_input?.file_path || payload?.tool_response?.filePath || "";
  if (!TEST_FILE.test(f)) process.exit(0);
  const cut = f.replace(/\\/g, "/").search(/\/(scripts|tests)\//);
  ROOT = cut > 0 ? f.slice(0, cut) : ROOT;
}

const files = [];
for (const dir of ["scripts", "scripts/sweep", "tests"]) {
  const d = path.join(ROOT, dir);
  if (!fs.existsSync(d)) continue;
  for (const n of fs.readdirSync(d)) if (n.endsWith(".mjs") && n !== "verify-test-safety.mjs") files.push(path.join(dir, n));
}
if (!files.length) { if (HOOK) process.exit(0); console.error("no test scripts found under " + ROOT); process.exit(1); }

// A missing file must not crash the guard. In hook mode a stack trace IS the refusal message,
// and "ENOENT: scripts/sweep/login.mjs" tells a person nothing about the edit they just made.
// An absent file reads as empty, so the check that wanted it fails with its own wording instead.
const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8"); } catch { return ""; } };
const fails = [];
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok }); if (!ok) fails.push(`${name}\n    ${detail}`); };

// ── 1. Never POST to the admin login as JSON — it silently sends an EMPTY password ──────────
{
  const bad = [];
  for (const f of files) {
    const s = read(f);
    // a staff-login POST whose nearby options mention json rather than form
    const re = /post\([^)]*staff-login[^)]*\)/gis;
    for (const m of s.match(re) || []) {
      if (/content-type"?\s*:\s*"application\/json|data:\s*\{|body:\s*JSON\.stringify/i.test(m) && !/form\s*:/i.test(m)) bad.push(`${f}: ${m.replace(/\s+/g, " ").slice(0, 90)}`);
    }
    if (/fetch\([^)]*staff-login[\s\S]{0,220}?JSON\.stringify/i.test(s) && !/form/i.test(s.slice(s.search(/staff-login/i), s.search(/staff-login/i) + 260))) {
      bad.push(`${f}: fetch(staff-login) with a JSON body`);
    }
  }
  check(
    "no script posts to /api/staff-login as JSON (it reads FORM data — JSON = empty password = a wrong-password row)",
    bad.length === 0,
    bad.join("\n    ") + "\n    Use adminHeaders() from scripts/sweep/login.mjs — it presents the gate cookie and makes NO login request at all.",
  );
}

// ── 2. The shared loginAs must cache, so N contexts ≠ N logins ───────────────────────────────
{
  const s = read("scripts/sweep/login.mjs");
  check(
    "loginAs() caches its session (one login per role per run, not one per browser context)",
    /sessionCache/.test(s) && /addCookies\(cached/.test(s),
    "scripts/sweep/login.mjs must reuse a cached session. Without it, a sweep that opens several\n    contexts burns the 5-per-5-minutes staff-login limit and alerts the owner about himself.",
  );
  check(
    "a zero-request admin auth helper exists (adminCookie/adminHeaders)",
    /export function adminCookie/.test(s) && /export function adminHeaders/.test(s),
    "scripts/sweep/login.mjs must export adminCookie()/adminHeaders() so admin checks never POST a password.",
  );
}

// ── 3. A script that DELIBERATELY trips a limit must clean up after itself ───────────────────
// The one legitimate case is testing the wall itself (verify-staff-accounts proves the lockout).
// It has to delete the rate_limit rows + reset the throttle it created, or those events sit in
// the owner's Problems list looking like a real restaurant in trouble.
{
  for (const f of files) {
    const s = read(f);
    const deliberate = /password:\s*"(?:nope|totally-wrong|wrong)/i.test(s) || /for \(let i = 0; i < \d+; i\+\+\) await api\("\/api\/panel-login/.test(s);
    if (!deliberate) continue;
    const cleans = /rate_limit_events/.test(s) && /login_throttle|fail_count/.test(s);
    check(
      `${f} tests a lockout on purpose, so it clears the limit rows it created`,
      cleans,
      `${f} sends wrong passwords deliberately but never clears rate_limit_events / login_throttle.\n    Those rows surface in the admin Problems list and can alert the owner. Clean up in the same run.`,
    );
  }
}

// ── 4. No login inside a loop or a per-request helper ────────────────────────────────────────
{
  const bad = [];
  for (const f of files) {
    const s = read(f).split("\n");
    for (let i = 0; i < s.length; i++) {
      if (!/loginAs\(|panel-login/.test(s[i])) continue;
      // A login is "in a loop" only when the loop is on THIS line or opens the line directly
      // above (a wider look-back flagged the assertion that follows a lockout loop — the check
      // has to be precise or it cries wolf and gets ignored, which defeats the point).
      const here = s[i];
      const above = (s[i - 1] || "").trim();
      const inLoop = /\b(for|while)\s*\([^)]*\)\s*(\{|await|[a-z])/.test(here)
        || (/\b(for|while)\s*\(.*\)\s*\{\s*$/.test(above));
      if (inLoop && !/nope|wrong|totally-wrong/i.test(here)) bad.push(`${f}:${i + 1} — ${here.trim().slice(0, 80)}`);
    }
  }
  check(
    "no script logs in from inside a loop",
    bad.length === 0,
    bad.join("\n    ") + "\n    Sign in ONCE and reuse the context/cookies for the rest of the run.",
  );
}

// ── 5. THE OTHER FIVE LIMITED ACTIONS ────────────────────────────────────────────────────────
// Until 2026-08-04 this file only ever looked at LOGIN, while CLAUDE.md names six limited
// actions and the database defines seven rules (mig 205: staff_login, admin_login,
// manager_pin, guest_order, waiter_call, join_session, otp_request). A script that loops guest
// orders or manager PINs would have passed every check here and still pinged the owner's phone
// about his own restaurant. Repeating a limited action in a loop is the shape that does it.
{
  // the endpoint each limited action is reached through
  const LIMITED = [
    { rule: "guest_order",  re: /\/api\/guest\/place-order|lfh_place_order/ },
    { rule: "manager_pin",  re: /managerPin|manager-pin|\/pin\b/ },
    { rule: "waiter_call",  re: /\/calls?\b.*(POST|post)|lfh_call_waiter|chef-call/ },
    { rule: "join_session", re: /join-table|join_session|lfh_join/ },
    { rule: "otp_request",  re: /otp|verification_codes|lfh_request_code/ },
  ];
  const bad = [];
  for (const f of files) {
    const lines = read(f).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const here = lines[i];
      const above = (lines[i - 1] || "").trim();
      const inLoop = /\b(for|while)\s*\([^)]*\)\s*(\{|await|[a-z])/.test(here)
        || (/\b(for|while)\s*\(.*\)\s*\{\s*$/.test(above))
        || /Array\.from\([^)]*\)\.map\(|Promise\.all\(\s*\[?[^)]*map\(/.test(here);
      if (!inLoop) continue;
      for (const { rule, re } of LIMITED) {
        if (re.test(here)) bad.push(`${f}:${i + 1} — repeats a "${rule}" action in a loop\n      ${here.trim().slice(0, 90)}`);
      }
    }
  }
  check(
    'no script repeats a LIMITED action (guest order, manager PIN, waiter call, join-table, OTP) in a loop',
    bad.length === 0,
    bad.join("\n    ") + "\n    Those five have rate_limit_rules of their own (mig 205) and tripping one pings the owner's\n    PHONE about a real restaurant. Do it once, or use the staff path which has no rule.",
  );
}

// ── 6. NOTHING MAY WIDEN, DISABLE OR HIDE A LIMIT ────────────────────────────────────────────
// Owner's rule, verbatim: "Never widen or switch off a limit rule to make a test pass, and
// never add code that suppresses, filters or hides a limit event or its alert." A test that
// moves the wall instead of respecting it is worse than a failing test, because the wall is
// what protects a real restaurant.
{
  const bad = [];
  for (const f of files) {
    const src = read(f);
    if (/rate_limit_rules[\s\S]{0,200}?\.(update|upsert|insert|delete)\(/.test(src)
        || /(update|delete)\s+(from\s+)?rate_limit_rules/i.test(src)) {
      bad.push(`${f} — changes rate_limit_rules`);
    }
    if (/rate_limit_events[\s\S]{0,120}?\.delete\(/.test(src) && !/clean|cleanup|sweep|restore|its own/i.test(src)) {
      bad.push(`${f} — deletes rate_limit_events without saying it is cleaning up after itself`);
    }
  }
  check(
    "no script widens or switches off a rate-limit rule to get through",
    bad.length === 0,
    bad.join("\n    ") + "\n    If a limit is genuinely too tight for real service, change the NUMBER in /aevinite → rate\n    limits and say so. Never move it from a test.",
  );
}

// ── 7. NO SCRIPT MAY POINT AT THE LIVE CLIENT STACK ──────────────────────────────────────────
// "All building & testing happens HERE, against the dev DB, with dev keys. Never point a dev
// server, script, seed, or migration at AV LIVE's URL/keys 'just to check'." Two leftover
// scratch scripts at the repo root were signing in to the live client site with a password in
// plain text when the 2026-08-04 sweep found them, and nothing objected.
{
  const LIVE = [
    { what: "the live client site", re: /aevinite\.shop|3d-menu-av\.vercel\.app/ },
    { what: "the live client database", re: /kclqkmdxnwlhtyrducku/ },
    { what: "the live client keys file", re: /\.env\.AV\.live/ },
    { what: "the live client folder", re: /LIVE_PROJECTS\/3D_Menu_Av/ },
  ];
  // Two exemptions, both decided by what the CODE does rather than by a filename list:
  //  1. A script that REFUSES to run anywhere but the backup database. Naming the live ref in
  //     order to refuse it is the good pattern (db-maintain.mjs, reset-demo-history.mjs) — the
  //     first version of this check punished exactly the scripts doing it right.
  //  2. The two scripts whose whole job IS the live stack, both read-only: the schema diff
  //     between the two databases, and the proof that a release landed completely.
  //  3. resolve-fix-request.mjs --stack av: the owner's own Fix-NOW loop ("that same session
  //     should also make it live and click resolve on the website itself", 2026-07-28). It is
  //     the ONE script that WRITES to the live stack, deliberately, and it is listed here by
  //     name so that fact stays visible instead of being lost in a wildcard.
  //  4. verify-db-grants.mjs --av: same category as the schema diff — an OPT-IN flag, catalog
  //     SELECTs only, no login and no write, and it prints one line and carries on if the keys
  //     aren't readable. Grants are the one thing that drifted silently on both databases at
  //     once (mig 267 found 17), so being able to ask the live stack the same question is the
  //     point of the guard. Read-only still has to be announced in chat by the person running it.
  // BY DESIGN these DO name the live stack: two compare the two databases, one resolves a live fix
  // request, one checks live grants — and release-avlive.mjs IS the release (owner, 2026-08-18:
  // "make avlive fully where the backup is"). The release script is not a test and never runs as
  // part of one: it demands his authorising words, refuses unless the live folder is clean, and its
  // real run is still blocked by his own AV-live deny rules, which it says out loud rather than
  // walking around. This guard's job is to stop a TEST touching paying clients; a release must.
  const BY_DESIGN = /verify-db-parity\.mjs|verify-avlive-offline-complete\.mjs|resolve-fix-request\.mjs|verify-db-grants\.mjs|release-avlive\.mjs/;
  // "This file already refuses to run anywhere but a dev database" — in either of the two ways a
  // script can say it.
  //
  // THE SECOND WAY IS THE POINT (T10 sweep, 2026-08-12). This used to accept only the FIRST: the
  // file must contain the literal backup-1 project id. That quietly required every write-capable
  // script to keep its own copy of one hard-coded id — which is exactly the drift
  // scripts/sweep/devStacks.mjs was written to end, and why eight scripts refused to run on
  // BACKUP-2, the failover stack the owner uses when backup-1 hits its deploy cap. Moving those
  // eight onto the shared allow-list made THIS check fail them, because the id they were exempted
  // by had (correctly) gone.
  //
  // A file that calls refuseUnlessDevTestDb() is guarded by construction, against BOTH dev stacks
  // and never against the client one — which is strictly stronger than the literal it replaced.
  const refusesNonBackup = (src) =>
    (/wnsfcizclkbobwzcxqsf/.test(src) && /(Refusing|refuse|process\.exit\(1\)|throw new Error)/.test(src)) ||
    (/refuseUnlessDevTestDb\s*\(/.test(src) && /devStacks\.mjs/.test(src));
  const bad = [];
  for (const f of files) {
    if (BY_DESIGN.test(f)) continue;
    const src = read(f);
    if (refusesNonBackup(src)) continue;
    for (const { what, re } of LIVE) if (re.test(src)) bad.push(`${f} — names ${what}`);
  }
  check(
    "no script points at the live client stack",
    bad.length === 0,
    bad.join("\n    ") + "\n    Test against the backup stack. A read of the live stack has to be announced in chat, which a\n    script cannot do — and a LOGIN there counts against a limit that alerts the owner.",
  );
}

// ── report ──────────────────────────────────────────────────────────────────────────────────
if (!HOOK) for (const c of checks) console.log(`${c.ok ? "  ok  " : " FAIL "} ${c.name}`);
if (fails.length) {
  console.error(`\n${fails.length} of ${checks.length} test-safety checks FAILED:\n\n  - ${fails.join("\n\n  - ")}\n`);
  console.error("An alert the owner can't trust is worse than no alert. Our tests must never raise one.");
  process.exit(HOOK ? 2 : 1);
}
if (!HOOK) console.log(`\nAll ${checks.length} checks passed — our own tests can't set off the owner's alerts.`);
