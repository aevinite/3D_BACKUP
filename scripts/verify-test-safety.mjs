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

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
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

// ── report ──────────────────────────────────────────────────────────────────────────────────
if (!HOOK) for (const c of checks) console.log(`${c.ok ? "  ok  " : " FAIL "} ${c.name}`);
if (fails.length) {
  console.error(`\n${fails.length} of ${checks.length} test-safety checks FAILED:\n\n  - ${fails.join("\n\n  - ")}\n`);
  console.error("An alert the owner can't trust is worse than no alert. Our tests must never raise one.");
  process.exit(HOOK ? 2 : 1);
}
if (!HOOK) console.log(`\nAll ${checks.length} checks passed — our own tests can't set off the owner's alerts.`);
