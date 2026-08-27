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

// EVERY DEPTH, not three hand-listed folders (sweep #7 / T28, 2026-08-27). This used to read
// ["scripts", "scripts/sweep", "tests"] only, so four sub-folders that grew afterwards were never
// looked at — scripts/sweep/t3/ (four scripts that place real orders), scripts/live-fix-watcher/,
// scripts/panel-stubs/ and scripts/launchagents/. The whole point of this file is "a test write
// must name its restaurant", and the writes it could not see were exactly the ones nobody reviews.
const files = [];
(function walk(rel) {
  const d = path.join(ROOT, rel);
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); continue; }
    if (e.name.endsWith(".mjs") && e.name !== "verify-test-safety.mjs") files.push(p);
  }
})("scripts");
for (const n of fs.existsSync(path.join(ROOT, "tests")) ? fs.readdirSync(path.join(ROOT, "tests")) : []) {
  if (n.endsWith(".mjs")) files.push(`tests/${n}`);
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
  // BY DESIGN these DO name the live stack — and since 2026-08-19 the four AV-live OPERATIONAL scripts
  // live here too, because "AV live is identical to backup" cannot be true while the live repo carries
  // four files backup has never had. They are release tooling, not tests: each refuses unless the
  // credentials it finds are AV live's, and none of them runs as part of any test. compare-schemas.mjs
  // is the read-only shape comparison that answers "are the two databases the same".
  // BY DESIGN these DO name the live stack: two compare the two databases, one resolves a live fix
  // request, one checks live grants — and release-avlive.mjs IS the release (owner, 2026-08-18:
  // "make avlive fully where the backup is"). The release script is not a test and never runs as
  // part of one: it demands his authorising words, refuses unless the live folder is clean, and its
  // real run is still blocked by his own AV-live deny rules, which it says out loud rather than
  // walking around. This guard's job is to stop a TEST touching paying clients; a release must.
  const BY_DESIGN = /verify-db-parity\.mjs|verify-avlive-offline-complete\.mjs|resolve-fix-request\.mjs|verify-db-grants\.mjs|release-avlive\.mjs|apply-migration-avlive\.mjs|apply-migration-prod\.mjs|copy-demo-to-prod\.mjs|reset-prod-owner-pw\.mjs|compare-schemas\.mjs/;
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

// ── 8. A TEST WRITE NAMES ITS RESTAURANT — BOTH WAYS ────────────────────────────────────────
// THE SINGLE BIGGEST FAULT CLASS IN THIS FOLDER (sweep #6 / T28, 2026-08-22). This app went from one
// restaurant to a shared pool, and the guards did not come with it. Two shapes, both measured:
//
//   · AN INSERT THAT OMITS restaurant_id IS REFUSED (23502), and nothing read the error, so the script
//     crashed one line later on a null and every check after it simply never ran. FIVE guards were
//     dead this way for weeks: verify-session-ux (11 checks), verify-edge-cases (14), verify-realtime
//     (2 of 5), verify-tablet-parity (all 5), and verify-cancelled-tile-parity — whose dish rows were
//     refused so quietly that its main check printed a ✓ over ZERO dishes.
//
//   · AN UPDATE OR DELETE FILTERED ON table_number ALONE REACHES EVERY RESTAURANT ON THE STACK.
//     Table 9, 11 and 21 exist in all of them. `PATCH sessions?table_number=eq.11 {status:closed}`
//     from verify-edge-cases' teardown measurably closed AND soft-deleted a table-11 session belonging
//     to a DIFFERENT restaurant during this sweep. On a live one that ends the party's meal: the close
//     trigger (mig 232) cancels and archives every unpaid live order on the session, silently.
//
// The check reads the ARGUMENT of the write, not "the lines nearby". Nearby was tried first and it let
// both shapes through, because a neighbouring `.eq("restaurant_id", RID)` on an unrelated statement
// satisfied it — a check that can be satisfied by the wrong line is not a check.
{
  const TENANT = "sessions|session_members|orders|order_items|requests|blocklist|customers|staff_actions|table_merges|feedback|reviews|calls|menu_items|categories|settings";
  // From an opening bracket, the text up to its match. Quotes and template literals are skipped so a
  // ")" inside a string cannot end the argument early.
  const argOf = (src, open) => {
    let d = 0, i = open, q = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (q) { if (c === "\\") i++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === "`") { q = c; continue; }
      if (c === "(" || c === "[" || c === "{") d++;
      else if (c === ")" || c === "]" || c === "}") { d--; if (d === 0) return src.slice(open, i + 1); }
    }
    return src.slice(open, Math.min(src.length, open + 800));
  };
  const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;
  const bad = [];
  for (const f of files) {
    // Comment TEXT is blanked but the characters are kept, so every line number this reports is the
    // real one — and a file that explains this very rule in prose cannot fail its own check.
    const src = read(f)
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .replace(/^[ \t]*\/\/.*$/gm, (m) => " ".repeat(m.length));

    // (a) .from("<tenant>") … .insert(/.upsert( — the chain is often broken across lines for width, so
    // allow anything but a semicolon between the two.
    for (const m of src.matchAll(new RegExp(`\\.from\\(\\s*["'\`](${TENANT})["'\`]\\s*\\)[^;]{0,200}?\\.(insert|upsert)\\(`, "g"))) {
      const open = m.index + m[0].length - 1;
      let arg = argOf(src, open);
      // A seeder hands the insert a VARIABLE built by a .map() further up. Follow the name back.
      const bare = arg.match(/^\(\s*([A-Za-z_$][\w$]*)\s*[,)]/);
      if (bare && !/restaurant_id/.test(arg)) {
        const def = src.match(new RegExp(`\\b(?:const|let|var)\\s+${bare[1]}\\s*=`));
        if (def) arg += " " + argOf(src, src.indexOf("(", def.index) >= 0 ? def.index : def.index) + src.slice(def.index, def.index + 900);
      }
      if (!/restaurant_id/.test(arg)) {
        bad.push(`${f}:${lineOf(src, m.index)} — ${m[2]}s into ${m[1]} without restaurant_id (a NOT NULL column: the write is REFUSED, and the refusal is easy to miss)`);
      }
    }

    // (b) a REST path on a tenant table filtered by table_number. The scope may be spelled out or
    // interpolated, so look for restaurant_id anywhere inside the SAME quoted path.
    for (const m of src.matchAll(new RegExp(`["'\`](${TENANT})\\?([^"'\`]*table_number=eq\\.[^"'\`]*)["'\`]`, "g"))) {
      const path = m[2];
      const isWrite = /\b(patch|delete|put|post)\b/i.test(src.slice(Math.max(0, m.index - 90), m.index));
      if (!isWrite) continue;                                    // a scoped READ is a different rule
      if (/restaurant_id/.test(path) || /\$\{\s*scope\s*\}/.test(path)) continue;
      bad.push(`${f}:${lineOf(src, m.index)} — writes to ${m[1]} filtered on table_number ALONE — that table number exists in EVERY restaurant on the stack`);
    }

    // (c) the supabase-js equivalent: .update(…)/.delete() keyed on table_number, whose chain never
    // names restaurant_id. The chain ends at the semicolon, so nothing outside it can satisfy this.
    for (const m of src.matchAll(new RegExp(`\\.from\\(\\s*["'\`](${TENANT})["'\`]\\s*\\)[^;]{0,400}?;`, "g"))) {
      const chain = m[0];
      if (!/\.(update|delete)\(/.test(chain)) continue;
      if (!/\.eq\(\s*["'`]table_number["'`]/.test(chain)) continue;
      if (/restaurant_id/.test(chain)) continue;
      bad.push(`${f}:${lineOf(src, m.index)} — an update/delete on ${m[1]} keyed on table_number with no restaurant_id — it reaches every restaurant`);
    }
  }
  check(
    "every test write that names a tenant table also names its restaurant (an insert that omits it is REFUSED; an update that omits it reaches EVERY restaurant)",
    bad.length === 0,
    bad.join("\n    ") + "\n    Add restaurant_id to the row, and .eq(\"restaurant_id\", RID) / &restaurant_id=eq.<rid> to the filter.\n    Read the .error too: an unread refusal is how a guard goes green over zero rows.",
  );
}

// ── 9. `npm run dev` MUST HONOUR A PORT, OR A PARALLEL LANE TAKES HIS WINDOW ──────────────
// Port 4000 is where the owner verifies — CLAUDE.md says so in as many words ("Verify where the
// owner looks: localhost:4000"). Every parallel terminal is handed its OWN port and told never to
// use 4000. But the script was `next dev -p 4000` with the port hard-coded, so `PORT=4128 npm run
// dev` silently served on 4000 anyway. It happened during the sweep of 2026-08-22: a lane took his
// window, and it was only noticed because the lane checked which port it had actually got. The next
// time might not be noticed for an hour, and he would be looking at another branch's build while
// being told his change was live.
{
  const pkg = read("package.json");
  let dev = "";
  try { dev = (JSON.parse(pkg || "{}").scripts || {}).dev || ""; } catch { /* the JSON check owns that */ }
  check(
    "`npm run dev` honours a PORT override, so a parallel lane cannot take port 4000 (the owner's window)",
    !dev || /\$\{?PORT/.test(dev),
    `package.json "dev" is ${JSON.stringify(dev)} — a hard-coded port means every lane lands on the same one.\n    Use: next dev -p \${PORT:-4000}`,
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
