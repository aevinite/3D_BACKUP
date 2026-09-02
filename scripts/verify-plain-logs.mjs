#!/usr/bin/env node
// verify-plain-logs.mjs — a log a person reads is written in a person's words, and an alert lands
// on the control that ends the problem.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
//
// Owner, 2026-09-02, looking at admin → Audit & logs → Errors and at the Dashboard's Latest
// activity:
//
//   "why the logs are in the code supabase language it should be in the human language — make sure
//    every possible log and stuff in human language so I can understand easily"
//   "there is one red thing showing menu is in maintenance — if I click manage it should take me to
//    the toggle where I can turn on menu, it takes to the restaurant. Make sure you do it for all
//    alert and notification and everything."
//
// Two rules came out of that, and both are the kind that rot silently — a new screen renders
// `row.detail` because that is the obvious thing to type, and a new banner links to a page because
// a page is easier to name than a button. Neither breaks a test, neither shows up in a diff review,
// and both are only visible to the one person who cannot fix them.
//
// This is the third guard in the same family, and it is built the way the other two learned to be:
//
//   • lib/errorSignature.ts's header — two copies of a judgement drift, so there is one copy.
//   • components/admin/shared.tsx → ACT_LABEL — the panel's own label map covered 19 of ~130
//     action codes, so `npm run verify:audit` EXTRACTS the codes rather than trusting a list.
//
// So this guard does not check that the functions exist. It ASKS THEM, with the real strings that
// were in the database on the day the owner complained, and it checks the render sites by reading
// what they actually pass. A guard that only greps for an import name passes the moment somebody
// imports it and renders the raw field anyway.
//
// Run: node scripts/verify-plain-logs.mjs   (or npm run verify:plain-logs)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };

const fails = [];
const oks = [];
const ok = (m) => oks.push(m);
const fail = (m) => fails.push(m);

// Comments describe the rule; they are not the rule. Strip them before grepping, or a sentence in a
// header ("this used to render a.detail raw") reads as a violation — and worse, a real violation
// sitting inside a commented-out block reads as a pass.
//
// LINE COMMENTS FIRST, THEN BLOCK COMMENTS. A `/*` that appears inside a `//` line (a URL, a regex,
// a sentence about globbing) opens a block comment that swallows everything to the next `*/` —
// which silently hid 190 lines from two shipped guards. Doing line comments first removes the
// stray opener along with its line.
const strip = (src) =>
  src
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");

// ── 1 · THE TRANSLATOR ACTUALLY TRANSLATES THE REAL ROWS ────────────────────────────────────────
//
// Every string here was READ OUT OF THE DEV DATABASE on 2026-09-02 (the 60 newest level:'error'
// rows plus a 3,000-row sweep over every distinct action). They are not invented examples, and
// that matters: a translation rule written from imagination matches nothing and looks like
// coverage. If one of these ever stops translating, the screen the owner complained about has
// gone back to printing the browser's own words.
const REAL_ERROR_ROWS = [
  "Failed to load chunk /_next/static/chunks/1g1jwpgiikpwc.js from module 64893 @ /manager/no-such-page [Safari · Mac]",
  "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node. @ /r/aangan-garden-restaurant/menu [Safari · Mac]",
  "GET summary — TimeoutError: The operation was aborted due to timeout",
  "Invalid count value: -1 @ /owner/issues [Safari · Mac]",
  'Couldn\'t look up restaurant "french-house": TypeError: fetch failed @ /r/french-house/menu #2220843683 [Safari · Mac]',
  "mode is not defined @ app.js@e5b15272:13942 <- app.js@e5b15272:2676 [Safari · Mac]",
  "Cannot read properties of undefined (reading 'length') @ /aevinite/revenue [Safari · Mac]",
  "Cannot read properties of undefined (reading 'tone') @ /aevinite/bill-audit [Safari · Mac]",
  "Cannot convert undefined or null to object @ /aevinite/revenue [Safari · Mac]",
];

// The two shapes that were STORED as JSON before the writers learned to write sentences. History
// is never rewritten in this app, so these rows are in the table for good and the DISPLAY has to
// keep understanding them.
const REAL_LEGACY_JSON = [
  ["rate_limit_edit", 'rate limit "guest_order" updated: {"enabled":true,"updated_at":"2026-09-02T09:03:46.697Z","updated_by":"admin"}'],
  ["rate_limit_edit", 'rate limit "admin_login" updated: {"max_count":5,"window_seconds":600,"updated_at":"x","updated_by":"admin"}'],
  ["platform_toggle", '{"platform_in_bills":true}'],
  ["platform_toggle", '{"kitchen_can_accept_platform":false}'],
];

// Words that mean the sentence is still the machine's. Checked against the PLAIN half only — the
// exact text is meant to survive untouched in the detail card, so this never looks at that.
const MACHINE_WORDS = [
  /TypeError|ReferenceError|DOMException|TimeoutError/,
  /\bundefined\b|\bnull\b/,
  /_next|\.js:\d|removeChild|insertBefore/,
  /[{}]|"[a-z_]+":/,
  /\bupdated_at\b|\bupdated_by\b|\bmax_count\b|\bwindow_seconds\b|\brestaurant_id\b/,
];

async function checkTranslator() {
  // Imported, not grepped: the point is what these functions ANSWER.
  let plainError;
  try {
    plainError = await import("../lib/plainError.ts");
  } catch (e) {
    fail(`lib/plainError.ts would not load (${e.message}). Every error line in the console reads through it.`);
    return;
  }
  const { plainProblem, plainHeadline, screenName } = plainError;

  for (const rowText of REAL_ERROR_ROWS) {
    const p = plainProblem(rowText);
    const short = rowText.slice(0, 52) + "…";
    if (!p.translated) {
      fail(`no plain words for a REAL error row — "${short}". It will print the browser's own sentence on the admin's Errors list.`);
      continue;
    }
    const offending = MACHINE_WORDS.find((re) => re.test(p.headline));
    if (offending) {
      fail(`the plain sentence for "${short}" still contains machine language (matched ${offending}). Headline was: "${p.headline}"`);
      continue;
    }
    if (p.technical !== rowText) {
      fail(`the exact text was altered for "${short}". The detail card, Send to Claude and the ×N grouping all read it — it must survive character for character.`);
      continue;
    }
    ok(`real error row reads as English — "${short}"`);
  }

  // A message nobody has written a rule for must be QUOTED, not silently dressed up as translated.
  // Otherwise the honest fallback becomes a lie the moment somebody "tidies" it.
  const unknown = plainProblem("zz totally unmapped message @ /aevinite/health [Safari · Mac]");
  if (unknown.translated) fail("an unmapped message reported itself as translated — the fallback must say plainly that these are the app's own words.");
  else if (!unknown.headline.includes("zz totally unmapped message")) fail("an unmapped message was not quoted in full. Nothing may be hidden — a message we have no words for still has to be readable.");
  else ok("an unmapped message is quoted in full and flagged as untranslated");

  // No address may print as a raw path: that is the same "code language" complaint in another form.
  for (const [path, expect] of [["/aevinite/revenue", "Revenue"], ["/owner/issues", "Feedback"], ["/kitchen", "Kitchen"], ["/r/french-house/menu", "French House"]]) {
    const named = screenName(path);
    if (!named || named === path) fail(`the address ${path} printed as a raw path instead of a screen name.`);
    else if (!named.includes(expect)) fail(`the address ${path} was named "${named}" — expected it to mention "${expect}".`);
    else ok(`${path} reads as "${named}"`);
  }

  // plainHeadline is what the list rows call; prove it is one line, since the row is 34px of one.
  const oneLine = plainHeadline(REAL_ERROR_ROWS[0]);
  if (/\n/.test(oneLine)) fail("plainHeadline returned more than one line — the log list row is a single line and will clip it.");
  else ok("plainHeadline returns a single line");

  // ── AND IT HAS TO FIT ────────────────────────────────────────────────────────────────────────
  // The first version of this file wrote the whole explanation into the headline, and the row is
  // ONE LINE. Seen in the browser on 2026-09-02 it rendered as
  //
  //     Screen error · Part of the app didn't finish downloading, so the screen cou…
  //
  // — the two things worth reading, WHERE it happened and on which browser, cut off the end. A
  // longer sentence in a one-line box is less readable than a short one, not more. So the
  // "why / what to do" half moved to `advice`, which only the opened card shows, and the headline
  // is capped here so the next rule anybody adds cannot quietly bring the clipping back.
  //
  // 100 characters is measured, not guessed: the row also carries "Screen error · ", the screen
  // name and the browser tag, and at ~1360px of usable row that whole line fits at about 150.
  const HEADLINE_MAX = 100;
  for (const rowText of REAL_ERROR_ROWS) {
    const p = plainProblem(rowText);
    if (!p.translated) continue;                       // already reported above
    if (p.headline.length > HEADLINE_MAX) {
      fail(`the plain sentence for "${rowText.slice(0, 40)}…" is ${p.headline.length} characters. The log row is one line and will clip it, hiding the screen name and the browser. Move the extra into the rule's \`then\` (it shows in the opened card). Max ${HEADLINE_MAX}.`);
    } else ok(`headline fits the one-line row (${p.headline.length} chars)`);
  }

  // ── the legacy stored-JSON rows ────────────────────────────────────────────────────────────────
  // Asked of legacyJsonDetail directly. It is the function components/admin/shared.tsx's
  // detailForList delegates to, and it lives in lib/plainError.ts precisely so this guard can run
  // it: shared.tsx is a .tsx and Node cannot strip JSX. The delegation itself is checked by the
  // render-site rule below (shared.tsx must reach the translator), so both halves are covered.
  const { legacyJsonDetail } = plainError;
  if (typeof legacyJsonDetail !== "function") {
    fail("lib/plainError.ts no longer exports legacyJsonDetail — the rows already stored as JSON go back to printing raw on the Dashboard.");
    return;
  }
  for (const [action, detail] of REAL_LEGACY_JSON) {
    const said = legacyJsonDetail(action, detail);
    // AN EMPTY ANSWER IS A FAILURE, NOT A PASS. Found by sabotage-testing this guard: deleting the
    // rate_limit_edit branch made legacyJsonDetail return "", and a "" trivially satisfied both the
    // "not verbatim" and the "no machine words" checks below — so the guard stayed green while the
    // Dashboard went back to printing raw JSON. Empty means the caller falls through to the raw
    // string, which is exactly the state this rule exists to prevent.
    if (!said) {
      fail(`legacyJsonDetail gave no words for a ${action} row, so the caller falls through to the raw text — "${detail.slice(0, 60)}…". This is the line he screenshotted on the Dashboard.`);
      continue;
    }
    if (said === detail) {
      fail(`the stored-JSON row for ${action} was printed verbatim — "${detail.slice(0, 60)}…". This is the line he screenshotted on the Dashboard.`);
      continue;
    }
    const offending = MACHINE_WORDS.find((re) => re.test(said));
    if (offending) fail(`the ${action} line still contains machine language (matched ${offending}): "${said}"`);
    else ok(`legacy ${action} row reads as English — "${said}"`);
  }
}

// ── 2 · NOBODY STRINGIFIES AN OBJECT INTO A LOG DETAIL ──────────────────────────────────────────
//
// This is the WRITE side of the same fault, and it is the one that put raw JSON on the Dashboard.
// Two call sites did it; both now write sentences. A third would land silently, because it looks
// like ordinary logging at the diff.
function checkNoStringifiedDetails() {
  const files = ["app/api/admin/rate-limits/route.ts", "app/api/editor/[...path]/route.ts"];
  // Search every route file, not only the two that were guilty — the rule is about the shape.
  const all = [
    ...files,
    "lib/oplog.ts",
    "app/api/log/client-error/route.ts",
    "app/api/kitchen/[...path]/route.ts",
    "app/api/tablet/[...path]/route.ts",
  ];
  let found = 0;
  for (const f of all) {
    const src = strip(read(f));
    if (!src) continue;
    // `detail:` (or `detail =`) whose value reaches a JSON.stringify before the line ends.
    const re = /\bdetail\s*[:=]\s*[^,\n)]*JSON\.stringify/g;
    for (const m of src.matchAll(re)) {
      found++;
      fail(`${f} writes a log detail with JSON.stringify — "${m[0].trim()}". A person reads this line; write the sentence at the call site (see lib/rateLimit.ts → rateEditWords).`);
    }
  }
  if (found === 0) ok("no log detail is built by stringifying an object");
}

// ── 3 · AN ERROR ROW IS NEVER RENDERED RAW ──────────────────────────────────────────────────────
//
// The exact shape that was on every one of these screens: `isErr ? (a.detail || "") : …`. It is a
// natural thing to write — errors "need" their raw text — and it is precisely the line the owner
// was reading. Each site below now branches to the translator instead; the raw text moved to the
// detail card.
function checkNoRawErrorRender() {
  const sites = [
    ["app/aevinite/logs/page.tsx", "the admin's Audit & logs list"],
    ["app/owner/activity/page.tsx", "the owner's Audit & logs list"],
    ["components/admin/LogDetailModal.tsx", "the shared log detail card"],
    ["components/admin/shared.tsx", "the Dashboard's Latest activity strip"],
    ["components/admin/NotificationBell.tsx", "the notification drawer"],
    ["app/aevinite/owners/page.tsx", "an owner's activity trail"],
    ["app/aevinite/repair/page.tsx", "the Repair board's problem rows"],
  ];
  for (const [f, what] of sites) {
    const src = strip(read(f));
    if (!src) { fail(`${f} is missing — ${what} is one of the screens this rule covers.`); continue; }
    // (a) it must reach the translator at all
    if (!/plainHeadline|plainProblem/.test(src)) {
      fail(`${f} never calls plainHeadline/plainProblem, so ${what} prints the browser's own words.`);
      continue;
    }
    // (b) and it must not ALSO have kept a raw-detail branch for error rows. Matching the shape
    //     rather than a name, because the variable is called `a`, `row` or `m` depending on file.
    const raw = /\bisErr\s*\?\s*\(?\s*(?:a|row|m|s)\.detail\s*\|\|/.test(src)
      || /\blevel\s*===\s*"error"\s*\?\s*\(?\s*(?:a|row|m|s)\.detail\b/.test(src);
    if (raw) fail(`${f} still has an "if it is an error, print detail raw" branch — that is the exact line ${what} was complained about for.`);
    else ok(`${what} reads through the translator`);
  }
}

// ── 4 · AN ALERT LANDS ON A CONTROL, NOT ON A PAGE ──────────────────────────────────────────────
//
// Checked two ways, because each half fails differently:
//   (a) a link that names a control must have a control of that name to land on, or the ring never
//       fires and the admin is left scanning the card — the failure is silent by design
//       (flashTarget stays quiet rather than warning him about our own broken link);
//   (b) a `?focus=` / `?section=` parameter must be READ by its destination. A parameter nobody
//       reads is worse than none: the link looks like it narrows the screen and doesn't, so a
//       filter he trusts was never applied. That is exactly what `?focus=` on the Repair board was
//       until it was given a reader.
function checkAlertsLandOnControls() {
  // (a) every control an alert points at exists, somewhere, as data-adm-ctl
  const CONTROL_SOURCES = [
    "app/aevinite/page.tsx",
    "app/aevinite/health/page.tsx",
    "app/aevinite/repair/page.tsx",
    "components/admin/NotificationBell.tsx",
  ];
  const CONTROL_TARGETS = [
    "app/aevinite/restaurants/page.tsx",
    "components/admin/CredentialsCard.tsx",
    "components/admin/RestaurantSettings.tsx",
  ];
  const declared = new Set();
  for (const f of CONTROL_TARGETS) {
    for (const m of read(f).matchAll(/data-adm-ctl=["{]"?([\w-]+)/g)) declared.add(m[1]);
  }
  const pointedAt = new Set();
  for (const f of CONTROL_SOURCES) {
    for (const m of strip(read(f)).matchAll(/control:\s*"([\w-]+)"/g)) pointedAt.add(m[1]);
  }
  if (pointedAt.size === 0) fail("no alert points at a named control any more. The maintenance banner used to drop the admin on the restaurants LIST; that is the state this rule exists to prevent.");
  for (const c of pointedAt) {
    if (declared.has(c)) ok(`an alert points at "${c}", and a control of that name exists`);
    else fail(`an alert points at the control "${c}" and nothing carries data-adm-ctl="${c}". The ring will never fire and the admin is left hunting the right button.`);
  }

  // (b) the parameters jumpUrl emits are read by the pages it emits them for
  const jump = read("lib/adminJump.ts");
  if (!jump) { fail("lib/adminJump.ts is missing — it is the one place an alert's link is built."); return; }
  const READERS = {
    "/aevinite/restaurants": ["app/aevinite/restaurants/page.tsx", /get\("focus"\)/],
    "/aevinite/repair": ["app/aevinite/repair/page.tsx", /get\("focus"\)/],
    "/aevinite/access": ["app/aevinite/access/page.tsx", /get\("rid"\)/],
    "/aevinite/logs": ["app/aevinite/logs/page.tsx", /get\("restaurant_id"\)|get\("focus"\)/],
  };
  for (const [path, [file, re]] of Object.entries(READERS)) {
    if (!jump.includes(`"${path}"`)) continue;         // not a destination this build sends to
    const src = strip(read(file));
    if (!src) { fail(`${path} is a jump destination and ${file} could not be read.`); continue; }
    if (re.test(src)) ok(`${path} reads the focus parameter it is sent`);
    else fail(`${path} is sent a focus parameter that ${file} never reads. The link would look like it narrows the screen and would not.`);
  }

  // The landing half has to be CALLED, or every ring is dead while every link looks right.
  const rests = strip(read("app/aevinite/restaurants/page.tsx"));
  if (/flashTarget\(\)/.test(rests)) ok("the restaurants page runs flashTarget() on arrival");
  else fail("app/aevinite/restaurants/page.tsx never calls flashTarget() — an alert can point at a control there and nothing will ring it.");

  // The cross-page rule anchor: arriving with #rule-<key> must be honoured AFTER the rules load,
  // not left to the browser (which resolves the hash before the fetch returns and finds nothing).
  //
  // Checked by SHAPE, not by the helper's name. Sabotage-testing this guard caught the first
  // version: renaming `const revealRule = useCallback` left every CALL to revealRule in place, so
  // a grep for the name still matched and the guard stayed green over broken code. What actually
  // has to be true is that the page reads the hash and acts on it in something that depends on
  // the loaded rules — the browser's own hash resolution happens before the fetch returns.
  const rl = strip(read("app/aevinite/rate-limits/page.tsx"));
  // The operative line is the one that turns an arriving hash INTO a rule key. Checking for
  // `location.hash` alone was blind (sabotage round 2): a leftover guard clause elsewhere in the
  // file mentions it, so the grep matched while the read that drives the jump was gone.
  const readsHash = /replace\(\s*\/\^#rule-/.test(rl);
  const afterRules = /\[rules,[^\]]*\]/.test(rl);        // an effect that re-runs when rules arrive
  const scrollsToRule = /getElementById\(`rule-\$\{/.test(rl);
  if (readsHash && afterRules && scrollsToRule) ok("the rate-limits page reads an arriving #rule- hash and scrolls to it once its rules have loaded");
  else fail(`app/aevinite/rate-limits/page.tsx does not honour an arriving #rule-<key> after its rules load (reads hash: ${readsHash}, runs when rules arrive: ${afterRules}, scrolls to the row: ${scrollsToRule}). The Repair board's "Change rate limit" button would land at the top of the page.`);
}

// ── 5 · THE MANAGER PANEL IS SENT THE SENTENCE, NOT LEFT TO WRITE ITS OWN ───────────────────────
//
// The panel is plain JS in public/ and cannot import the translator. The tempting fix is a JS copy,
// and a JS copy is exactly what drifted last time (19 of ~130 action codes). So the server attaches
// it and the panel prints it — and BOTH halves have to be present or the line silently goes back to
// the raw text.
function checkManagerPanel() {
  const api = strip(read("app/api/editor/[...path]/route.ts"));
  const panel = strip(read("public/panels/editor/app.js"));
  if (/row\.plain\s*=\s*plainHeadline/.test(api)) ok("the manager panel's /oplog attaches the plain sentence to error rows");
  else fail("app/api/editor/[...path]/route.ts no longer attaches `plain` to error rows — the manager panel has no way to write one itself.");
  if (/opDetailText\([^)]*\bplain\b/.test(panel) && /if \(plain\) return/.test(panel)) ok("the manager panel prints the attached sentence");
  else fail("public/panels/editor/app.js does not print the attached `plain` sentence — the manager's own Audit & logs tab is back to raw error text.");
}

// ── 6 · THE PHONE ALERT IS THE ONE WITH NOTHING TO CLICK THROUGH TO ────────────────────────────
function checkPhoneAlerts() {
  for (const [f, what] of [["lib/oplog.ts", "a server error pushed to his phone"], ["app/api/log/client-error/route.ts", "a screen error pushed to his phone"]]) {
    const src = strip(read(f));
    if (/plainProblem\([^)]*\)\.headline/.test(src)) ok(`${what} is worded in plain English`);
    else fail(`${f} pushes the raw message to the phone. ${what} is the one surface with nothing to open for the exact text.`);
  }
}

const run = async () => {
  await checkTranslator();
  checkNoStringifiedDetails();
  checkNoRawErrorRender();
  checkAlertsLandOnControls();
  checkManagerPanel();
  checkPhoneAlerts();

  const hook = process.argv.includes("--hook");
  if (fails.length === 0) {
    if (!hook) {
      for (const m of oks) console.log(`  ok   ${m}`);
      console.log(`\nverify:plain-logs — ${oks.length} checks, all pass.`);
    }
    process.exit(0);
  }
  console.error("verify:plain-logs FAILED\n");
  for (const m of fails) console.error(`  FAIL  ${m}`);
  console.error(`\n${fails.length} failed, ${oks.length} passed.`);
  console.error("\nThe rules: a log line a person reads is written in their words (the exact text lives in");
  console.error("the detail card, never instead of it), and an alert lands on the control that ends the");
  console.error("problem. Owner, 2026-09-02. Background: lib/plainError.ts and lib/adminJump.ts.");
  process.exit(hook ? 2 : 1);
};
run();
