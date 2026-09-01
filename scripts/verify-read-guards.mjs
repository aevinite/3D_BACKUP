#!/usr/bin/env node
// verify-read-guards.mjs — the three rules the T9 fix pass (2026-08-12) put in, turned into tests so
// they cannot quietly come back.
//
// WHY THIS EXISTS. Ten findings in one sweep were the same missing line — `x.data || []` with no
// `.error` check — and each had been fixed by hand before, in a different file. Hand-fixing does not
// hold: the next route starts from zero. So the rules are checked here.
//
//   1. A LOG-VISIBILITY SWITCH MUST FAIL CLOSED. Nothing outside lib/logVisibility.ts may filter
//      activity rows by reading `owner_entitlements` itself.
//   2. THE INVENTORY MONTH HAS ONE DEFINITION. Neither inventory screen may build its own window.
//   3. THE ROUTES THIS PASS FIXED MUST KEEP THEIR GUARD. A named list, so a later "simplification"
//      that strips the ReadSet out gets caught.
//
// Static + instant. Run: node scripts/verify-read-guards.mjs   (or npm run verify:read-guards)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readRaw = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };

// Declared before read(), because read()'s own sanity check reports through it.
const fails = [];
const oks = [];
const ok = (m) => oks.push(m);
const fail = (m) => fails.push(m);

/**
 * Source with COMMENTS REMOVED.
 *
 * This matters more than it looks. Every fix in this codebase leaves a comment explaining the bug it
 * replaced — which means the old, wrong code is quoted verbatim, in prose, a few lines above the
 * right code. A guard that greps the raw file therefore fires on the very comment that documents the
 * fix. (Both of this file's rules did exactly that on their first run.) So: strip comments, then
 * grep. The prose is for humans; the check is about what actually executes.
 *
 * ── LINE COMMENTS COME OFF FIRST, AND THIS FILE HAD IT BACKWARDS (T20 sweep #7, 2026-08-27) ───────
 * These files describe themselves in prose, and that prose says things like
 * "same cookie as every other /api/admin/* route" — a LINE comment containing `/*`. Strip BLOCK
 * comments first and that `/*` opens one, which then runs to the next real `*\/` further down and
 * silently swallows every line in between.
 *
 * Measured on this branch: `app/api/admin/restaurants/credentials/route.ts` came out of the old
 * stripper at 1,830 characters instead of 6,888 — SEVENTY-THREE PER CENT of the file gone, including
 * every read rule 8 below is about. So a check written against that file could only ever pass, which
 * is worse than not having it: a dead check looks exactly like a satisfied one.
 *
 * verify-admin-api-a.mjs hit this on the SAME FILE and wrote the reason into its own header; this
 * copy of the helper was never corrected. Order fixed, and the sanity check below proves nothing was
 * eaten rather than trusting the order to stay right.
 */
const read = (p) => {
  const raw = readRaw(p);
  const out = raw
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/gm, "$1")   // line comments FIRST (see the note above)
    .replace(/\/\*[\s\S]*?\*\//g, "");           // …then block comments
  return out;
};

// ── 0 · THE STRIPPER ITSELF, CHECKED AGAINST A FIXTURE (T20 sweep #7, 2026-08-27) ────────────────
// A ratio ("did this file lose too much?") cannot do this job: these files really are three-quarters
// prose, so a comment-heavy file and an eaten one look the same. What CAN do it is a fixture — one
// file known to carry the hazard, and one line of real code near the bottom of it that only survives
// when line comments come off first.
//
// `app/api/admin/restaurants/credentials/route.ts` is that file. Its header says "same cookie as every
// other /api/admin/* route" — a line comment containing `/*` — and under the old block-comments-first
// order that `/*` ran to the next real `*\/` and took 73% of the file with it (6,888 chars → 1,830),
// including `linkQ.error`, which rule 8 below is entirely about. Every check on that file could only
// ever pass.
//
// So: read it through the real helper and assert a late line of its code is still there. If the order
// regresses, THIS goes red and names why, instead of eight checks quietly agreeing with themselves.
{
  const FIXTURE = "app/api/admin/restaurants/credentials/route.ts";
  const src = read(FIXTURE);
  if (!readRaw(FIXTURE)) ok(`${FIXTURE} is gone — the stripper fixture needs a new file with "/*" in a line comment`);
  else if (/linkQ\.error/.test(src) && /genPassword/.test(src)) {
    ok("the comment stripper reaches the END of a file whose header quotes a \"/api/admin/*\" path");
  } else {
    fail(`the comment stripper is eating ${FIXTURE} again — a "/*" inside a line comment opens a block comment when blocks are stripped FIRST, so every rule below that reads this file silently passes. Strip LINE comments first.`);
  }
}

// ── 1. the log-visibility switch fails CLOSED ────────────────────────────────────────────────────
const VIS = read("lib/logVisibility.ts");
if (!VIS) fail("lib/logVisibility.ts is gone — the log switches would be back to failing open");
else {
  if (/ok:\s*false/.test(VIS) && /ok:\s*true/.test(VIS)) ok("loadLogVisibility returns a loaded-or-not union (no permissive fallback)");
  else fail("loadLogVisibility no longer distinguishes 'loaded' from 'could not load' — that IS finding F23");
  // canSee must return false for a restaurant it has no entitlements for.
  const canSee = VIS.slice(VIS.indexOf("canSee("));
  if (/if\s*\(!ents\)\s*return false/.test(canSee)) ok("canSee() hides a row it cannot check");
  else fail("canSee() no longer returns false for an unknown restaurant — a switched-off log kind would show");
  if (/if\s*\(!restaurantId\)\s*return false/.test(canSee)) ok("canSee() hides a row with no restaurant");
  else fail("canSee() no longer refuses a row with no restaurant_id");
}

// Nobody else may do this filtering by hand.
for (const p of ["app/api/owner/oplog/route.ts", "app/api/owner/staff/route.ts"]) {
  const src = read(p);
  if (!src) { fail(`${p} is missing`); continue; }
  // The old shape: reading owner_entitlements AND filtering activity rows in the same file.
  const readsEnts = /owner_entitlements/.test(src);
  const filtersActivity = /logKindKey|logKindOf\s*\(/.test(src) && /\.filter\(/.test(src);
  if (readsEnts && filtersActivity) {
    fail(`${p} filters activity rows off owner_entitlements by hand again — use loadLogVisibility() (finding F23)`);
  } else ok(`${p} does not hand-roll the log-visibility filter`);
  if (/loadLogVisibility/.test(src)) ok(`${p} goes through lib/logVisibility`);
  else fail(`${p} no longer calls loadLogVisibility — its activity rows are ungated`);
}

// ── 2. one definition of the inventory month ─────────────────────────────────────────────────────
const WIN = read("lib/inventoryWindow.ts");
if (!WIN) fail("lib/inventoryWindow.ts is gone — the two inventory screens can drift again (F27)");
else ok("lib/inventoryWindow.ts is the shared month definition");

const invPage = read("app/api/owner/inventory/route.ts");
if (/inventoryMonthWindow\s*\(/.test(invPage)) ok("the Inventory page takes its month from the shared definition");
else fail("app/api/owner/inventory builds its own month again — that is finding F27");
// The page must ask the SAME function as the report.
if (/lfh_inv_report_summary/.test(invPage)) ok("the Inventory page and the Inventory report call the same summary function");
else fail("the Inventory page is back on a different summary function from the report (F27)");
if (/lfh_inv_stock_summary/.test(invPage)) fail("the Inventory page is calling lfh_inv_stock_summary again — it counts waste from a different source than the report (F27)");

// ── 3. the routes this pass fixed keep their guard ───────────────────────────────────────────────
// file → what must still be true, in plain words for whoever trips this.
const GUARDED = [
  ["app/api/owner/inventory/route.ts", "the seven stock reads are checked (F1)"],
  ["app/api/owner/reports/route.ts", "the staff-pay / performance / inventory fan-outs are checked (F3, F4, F5)"],
  ["app/api/owner/staff/route.ts", "the person + pay-history reads are checked (F6, F7)"],
  ["app/api/owner/customers/route.ts", "the guest tiles are counted, not defaulted to 0 (F13)"],
  ["app/api/owner/audit/route.ts", "opening one removal tells a blip from 'not found' (F8)"],
];
for (const [p, why] of GUARDED) {
  const src = read(p);
  if (!src) { fail(`${p} is missing`); continue; }
  if (/from "@\/lib\/readGuard"/.test(src)) ok(`${p} still uses the read guard — ${why}`);
  else fail(`${p} no longer imports lib/readGuard — ${why}`);
}

// A read that was made fatal must not be softened back to a silent empty list.
const reports = read("app/api/owner/reports/route.ts");
for (const [needle, why] of [
  ['reads.rows("cash")', "Team & pay would print 'paid out ₹0' when the read failed (F3)"],
  ['reads.rows<any>("perf")', "the team leaderboard would read as 'nobody did anything' (F4)"],
  ['invReads.rows<Row>("dish")', "food cost would be computed from a zero numerator (F5)"],
]) {
  if (reports.includes(needle)) ok(`owner/reports keeps its fatal read: ${why.split(" would ")[0]}`);
  else fail(`owner/reports softened a fatal read back to a tolerant one — ${why}`);
}

// The erase must cover every table that holds a guest's name or phone.
const cust = read("app/api/owner/customers/route.ts");
// WHICH TABLES the erase covers is no longer checked here. It used to grep this route for
// `from("customer_visits").delete` and friends, which only worked while the tables were typed out
// inline — and that hand-typed list is exactly what improvement I15 removed (it had already been
// wrong once, for months). `scripts/verify-personal-data.mjs` now reads the SCHEMA and fails when a
// table with a guest phone is missing from lib/personalData.ts, which is a real check rather than a
// grep for today's spelling. What stays here is that this route still defers to that list.
if (/from "@\/lib\/personalData"/.test(cust) && /ERASABLE/.test(cust)) {
  ok("the guest erase walks the declared personal-data list (see verify:personal-data for coverage)");
} else {
  fail("the guest erase is back to naming tables by hand — that list has been wrong before (F26/I15)");
}
if (/from\("khata_customers"\)\.delete/.test(cust)) {
  fail("the guest erase tries to DELETE a khata_customers row — the orders foreign key makes that fail for any real pay-later guest; anonymise it instead");
}
if (/deletion_audit/.test(cust)) ok("the guest erase is recorded in the Removals record");
else fail("the guest erase no longer writes an audit row — an irreversible erase with no trace");

// ── 4. every logged action knows WHERE it happened (owner, 2026-08-12) ───────────────────────────
// A log row's whole value is answering "who did what, and from where". If an action code has no
// place in lib/logTrail, its trail reads "System › Other", which is exactly the uninformative row
// the owner asked to be rid of. The label map is the list of codes that reach a screen, so every one
// of them must resolve.
{
  const trail = read("lib/logTrail.ts");
  if (!trail) fail("lib/logTrail.ts is gone — log rows lose the restaurant/panel/screen path");
  else {
    const shared = read("components/admin/shared.tsx");
    // Cut the block at its OWN closing brace, not at a comment that happens to follow it. The first
    // version sliced to a doc-comment and, when that moved, ran on to the end of the file — which
    // dragged in a date formatter's keys ("weekday", "month", "hour") and reported them as
    // unplaced actions. A guard that invents failures is worse than no guard.
    const start = shared.indexOf("export const ACT_LABEL");
    const end = shared.indexOf("\n};", start);
    const block = start >= 0 && end > start ? shared.slice(start, end) : "";
    const codes = [...new Set([...block.matchAll(/(?:^|[{,]\s*)([a-z_][a-z0-9_]*)\s*:\s*"/gm)].map((m) => m[1]))];
    // Resolve the same way placeOf() does: an explicit entry, or one of the prefix rules.
    const placed = new Set([...trail.matchAll(/^\s{2}([a-z_][a-z0-9_]*):\s*\{\s*area:/gm)].map((m) => m[1]));
    const prefixes = [...trail.matchAll(/\[\/\^([^/]+)\/,\s*\{ area:/g)].map((m) => m[1]);
    const byPrefix = (c) => prefixes.some((p) => { try { return new RegExp("^" + p.replace(/\^/g, "")).test(c) || new RegExp(p).test(c); } catch { return false; } });
    const homeless = codes.filter((c) => !placed.has(c) && !byPrefix(c));
    if (!codes.length) fail("could not read ACT_LABEL — this check is not actually running");
    else if (homeless.length) fail(`${homeless.length} action code(s) have no place in lib/logTrail, so their rows read "System › Other": ${homeless.slice(0, 12).join(", ")}`);
    else ok(`all ${codes.length} action codes resolve to a restaurant › panel › area › screen trail`);
    if (/crumbs/.test(trail) && /target/.test(trail)) ok("the trail carries both the path and what it was done to");
    else fail("lib/logTrail no longer returns crumbs + target — the detail card's Where section goes blank");
  }
  const modal = read("components/admin/LogDetailModal.tsx");
  if (/trailOf/.test(modal)) ok("the log detail card shows the full path");
  else fail("LogDetailModal no longer shows the path — 'from where did this happen' is unanswered again");
}

// ── 5. A LIST THAT *IS* THE PAGE MUST NOT BE SILENTLY EMPTY (T20 sweep, 2026-08-19) ─────────────
// /api/owner/settings builds its whole answer from one restaurant list: `modIds` (the feature
// switches), `nameOf` (what each row is called) and the printing block all read it. Its `.error` was
// never inspected in the REAL OWNER's branch, so a blip returned a page with no restaurants, no
// switches and no printing rows — and nothing saying why.
//
// That is finding F16 in the branch F16 did not cover: F16 (2026-08-12) filled the list for the
// ADMIN's scope.all view and left the `else` branch — the majority case — reading as before. Both
// branches are checked here so the next fix cannot cover one and miss the other again.
{
  const set = read("app/api/owner/settings/route.ts");
  if (!set) fail("app/api/owner/settings/route.ts is missing");
  else {
    // The read that fills `restaurants` for a real owner must answer for its own failure.
    const ownerBranch = set.slice(set.indexOf("const settingsIds"), set.indexOf("const canChangePassword"));
    if (/dbFail\(|incompleteListResponse\(|return err\(/.test(ownerBranch)) {
      ok("owner/settings answers for a failed restaurant-list read instead of rendering an empty page");
    } else {
      fail("owner/settings' real-owner branch ignores its restaurant-list error again — the page silently loses every restaurant, every feature switch and every printing row (F16's other half)");
    }
    // The ADMIN branch must keep going through the paged helper (F16 itself).
    if (/scopedRestaurantIds\(scope\)/.test(set)) ok("owner/settings still pages the admin's whole-platform list (F16)");
    else fail("owner/settings no longer pages the admin's restaurant list — the tail past the row cap disappears (F16)");
    // And the module-switch chunks must keep their own answer.
    if (/if\s*\(part\.error\)\s*return dbFail\(/.test(set)) ok("owner/settings answers for a failed module-switch chunk rather than hiding a transferred switch");
    else fail("owner/settings swallows a module-switch read error — a switch the admin handed over would silently not be on the page");
  }
}

// ── 6 · IF THE HELPER REPORTS "I COULDN'T READ IT", THE ROUTE MUST PASS THAT ON (T20, 2026-08-19) ─
// lib/restaurantNames returns `partial: true` when the lookup failed, and "restaurantNames" is a
// declared PartialKey, precisely so a screen can say "couldn't read which restaurant each row belongs
// to" instead of printing a dash. That is the whole of finding F17.
//
// A caller that ignores the flag has re-created F17 in its own file: on a multi-restaurant estate
// every row's restaurant renders as "—" with nothing saying why. Five of the six callers passed it on;
// khata did not. Checked for every caller, so a sixth cannot be added without it.
{
  const CALLERS = [
    ["app/api/owner/khata/route.ts", "who owes what, across brands"],
    ["app/api/owner/oplog/route.ts", "which restaurant an action happened at"],
    ["app/api/owner/audit/route.ts", "which restaurant a removal happened at"],
    ["app/api/owner/issues/route.ts", "which restaurant a complaint came from"],
    ["app/api/owner/ratings/route.ts", "which restaurant a rating came from"],
    ["app/api/owner/customers/route.ts", "which restaurant a guest belongs to"],
  ];
  for (const [p2, what] of CALLERS) {
    const src = read(p2);
    if (!src) { fail(`${p2} is missing`); continue; }
    if (!/restaurantNames\s*\(/.test(src)) { fail(`${p2} no longer uses the shared name lookup — that is F17's local copy coming back`); continue; }
    if (/names\.partial/.test(src)) ok(`${p2} says so when it could not read ${what}`);
    else fail(`${p2} drops the name lookup's partial flag — every row would render its restaurant as "—" with nothing saying why (F17)`);
  }
}

// ── 7 · "COULDN'T READ IT" MUST NOT DECIDE A REFUSAL (T20 sweep #7, 2026-08-27) ─────────────────
// Rules 1–6 above are all about a wrong NUMBER. This one is about a wrong SENTENCE, and it cost more:
// a read whose `.error` is dropped makes its variable null, and a handler that then branches on null
// answers a confident, non-retryable refusal about the person's setup or their scope. Six of those
// were live in this territory:
//
//   · /api/owner/staff  — `payrollByRid()` came back empty on a blip, so `target()` (the front door
//     for EVERY profile and pay write) refused with "Staff profiles & pay aren't enabled for this
//     restaurant." 403. Saving a salary during a hiccup was simply lost. This is finding F7 again, on
//     the read one line below the one F7 fixed.
//   · /api/owner/staff  — the person read behind reset_password / set_active / set_role /
//     set_permissions / edit, and the one behind DELETE, both answered "That person isn't on your
//     staff." 404. F7 fixed the other two reads in the same file and missed these.
//   · /api/owner/settings PATCH — "This feature isn't enabled for that restaurant." for a switch the
//     admin genuinely handed over.
//   · /api/owner/printing — `allowed: false`, which is what a WITHHELD feature looks like, so the
//     whole card silently vanished (R36 says hide what is withheld; it says nothing about hiding what
//     we failed to read).
//   · /api/owner/issues + /api/owner/ratings — a bare `{"error":"not found"}` 404, so a resolve tap or
//     a reply note disappeared with nothing retryable.
//
// Checked by SHAPE: each refusal's own sentence must have a `transient()` / `dbFail(` / 503 answer
// somewhere between the read and it. Spelling out the sentences means a rename has to come here too,
// which is the point — these are the words a person reads.
{
  const REFUSALS = [
    ["app/api/owner/staff/route.ts", /payrollByRid/, /Promise<Record<string, boolean> \| null>/,
      "payrollByRid must be able to say 'I could not check' — an empty map reads as 'this restaurant has no payroll' and refuses a salary save"],
    ["app/api/owner/staff/route.ts", /isn't on your staff/, /rd\("account"/,
      "the account-action and delete reads must tell a blip from 'not yours' (F7's third and fourth reads)"],
    ["app/api/owner/settings/route.ts", /isn't enabled for that restaurant/, /owner\/settings\.moduleGate/,
      "the module-ladder read must answer for itself before its 403 says the feature is off"],
    ["app/api/owner/printing/route.ts", /allowed: false/, /transient: true/,
      "an unreadable printing switch must be a retryable 503, not the same answer as 'withheld'"],
    ["app/api/owner/issues/route.ts", /"not found"/, /owner\/issues\.lookup/,
      "the complaint lookup must tell a blip from a missing complaint"],
    ["app/api/owner/ratings/route.ts", /"not found"/, /owner\/ratings\.lookup/,
      "the rating lookup must tell a blip from a missing rating"],
  ];
  for (const [p3, refusal, guardShape, why] of REFUSALS) {
    const src = read(p3);
    if (!src) { fail(`${p3} is missing`); continue; }
    if (!refusal.test(src)) { ok(`${p3} no longer carries that refusal at all — nothing to guard`); continue; }
    if (guardShape.test(src)) ok(`${p3}: ${why}`);
    else fail(`${p3} decides a refusal from a read that no longer answers for itself — ${why}`);
  }
}

// ── 8 · A LIST THAT IS THE PAGE, ON THE ADMIN SIDE TOO (T20 sweep #7, 2026-08-27) ────────────────
// The same shape as rule 5, in the two admin-console answers where an unread companion list turns
// into a confident claim rather than a shorter page:
//   · /api/admin/restaurants — a failed `owners` read drew "—" in the Owner column of every
//     restaurant that HAS one, on the screen where ownership is assigned, with an empty dropdown to
//     fix it from. A failed `settings` read reported every restaurant as un-set-up.
//   · /api/admin/restaurants/credentials — a failed `restaurant_owners` read printed a
//     complete-looking handover sheet with every panel login on it and NO OWNER LOGIN. The admin
//     hands that sheet to the client.
{
  const rests = read("app/api/admin/restaurants/route.ts");
  if (/unread\.push\("owners"\)/.test(rests) && /unread\.push\("panels"\)/.test(rests)) {
    ok("admin/restaurants names an unread owners / panels list instead of drawing 'no owner'");
  } else {
    fail("admin/restaurants swallows its owners or settings read error again — the Owner column reads '—' for restaurants that have one");
  }
  if (/pageAll/.test(rests)) ok("admin/restaurants pages its one-row-per-restaurant lists past PostgREST's cap");
  else fail("admin/restaurants is back on a plain .select() for the restaurant list — the tail past the row cap disappears");

  const creds = read("app/api/admin/restaurants/credentials/route.ts");
  if (/linkQ\.error/.test(creds)) ok("the handover sheet refuses rather than printing itself without the owner's login");
  else fail("the handover sheet ignores its owner-link read again — it would print with no owner login and look complete");
}

// ── 9 · THE ONE-PRESS PASSWORD RESET STAYS REFUSED MID-SERVICE (owner, 2026-08-31 — item 28) ─────
// He asked for a single button that gives every login at a restaurant a new password, for a handover,
// and he was told the cost before it was built: a new password bumps `token_version`, which ends every
// session that person has — so all of them at once signs out the waiter's tablet and the kitchen screen
// in the same instant. Fine on a handover morning. On a Friday night it is a floor of staff staring at
// a login page with food on the pass.
//
// So the button exists AND the server refuses while any table is open. That refusal is the whole
// safety of the feature, it lives in one `if`, and it is exactly the kind of line a later
// "simplification" removes because the happy path works without it. Checked here, in four parts, so
// none of them can go quietly:
//   · the mid-service read happens at all;
//   · it refuses on a FAILED read too (guessing "nobody is sitting down" from a query that did not
//     answer is the one direction this must never guess in);
//   · the refusal is a 409 the screen can show, not a silent skip;
//   · the one-at-a-time path is untouched, because that is what still works during service.
{
  const CRED = "app/api/admin/restaurants/credentials/route.ts";
  const src = read(CRED);
  if (!src) fail(`${CRED} is missing`);
  else if (!/reset_all/.test(src)) {
    ok("the whole-restaurant password reset is not built here — nothing to guard");
  } else {
    const impl = src.slice(src.indexOf("async function resetAll"));
    if (/from\("sessions"\)[\s\S]{0,200}?\.in\(\s*"status"/.test(impl)) ok("reset_all asks whether the restaurant is mid-service before it touches a password");
    else fail("reset_all no longer checks for open tables — one press would sign out every screen at a restaurant DURING SERVICE (item 28's whole safety)");
    if (/openQ\.error[\s\S]{0,140}?return adminFail/.test(impl)) ok("reset_all refuses when it could not tell whether service is on");
    else fail("reset_all decides 'nobody is sitting down' from a read it did not check — the one direction it must never guess in");
    if (/reason:\s*"mid_service"[\s\S]{0,120}?status:\s*409/.test(impl)) ok("the mid-service refusal is a 409 with a sentence the console shows");
    else fail("the mid-service refusal no longer answers a 409 the screen can render — a refusal nobody sees is not a refusal");
    if (/vaultReady\(\)/.test(impl)) ok("reset_all refuses on a deployment with no credential key, rather than burning every password for nothing");
    else fail("reset_all no longer checks the credential vault — it would reset every password and be unable to print any of them");
    // The per-login route must survive: it is the ONLY one that works while the restaurant is serving.
    if (/const userId = String\(body\.user_id/.test(src)) ok("the one-login-at-a-time reset still exists — the only path that works mid-service");
    else fail("the single-login reset is gone; during service there would be no way to reset one password at all");
  }
}

// ── 10 · AN ANSWER ABOUT ONE RESTAURANT MUST NAME IT (T20 round 2, 2026-08-31) ───────────────────
// /api/owner/printing answers for exactly ONE restaurant. The owner's Settings page renders a LIST —
// one printing row per restaurant that has it on — and looked that single answer up ONCE, outside the
// loop, so the printer and the computer named on row 2 came from whichever restaurant the route had
// picked. Another tenant's hardware on this tenant's line: the class CLAUDE.md calls a recurring bug.
//
// Latent on the dev stack, and only by luck — exactly one restaurant has printing on, and for the
// two-restaurant diag owner it happens to be `ids[0]`. Measured, not assumed. It stops being latent
// the day a second restaurant switches printing on.
{
  const route = read("app/api/owner/printing/route.ts");
  const pg = read("app/owner/settings/page.tsx");
  if (!route || !pg) fail("owner/printing or the owner Settings page is missing");
  else {
    if (/restaurantId:\s*target/.test(route)) ok("owner/printing names the restaurant its answer is about");
    else fail("owner/printing no longer echoes `restaurantId` — the Settings page cannot tell which restaurant its printing answer belongs to, so one restaurant's printer gets named on another's row");
    if (/printing\.restaurantId\s*===\s*p\.restaurant_id/.test(pg)) ok("the Settings page applies the printing answer ONLY to the row it is about");
    else fail("the owner Settings page uses one restaurant's printing answer for every row again — another restaurant's printer and computer would appear on this restaurant's line");
  }
}

// ── 11 · A CACHED PAYLOAD'S VERSION MOVES WHEN ITS SHAPE DOES (T20 round 2, 2026-08-31) ──────────
// `cachedOwnerPayload` serves a stored snapshot as-is until its FINGERPRINT moves, and the fingerprint
// watches DATA, not the shape of the JSON. So adding a field without bumping the key's version means
// some ranges carry it (uncached) and some do not (snapshot) — a field that exists on Tuesday and not
// on Wednesday, which is worse for the screen than never having it.
//
// Both files already say this in their own comments. It was walked into anyway on 2026-08-31 while
// adding `window`: the live check found `range=today` carrying it and `range=30d`, served from a
// snapshot, not. So the pairing is checked here rather than left to whoever remembers the comment.
{
  const rep = read("app/api/owner/reports/route.ts");
  const an = read("app/api/owner/analytics/route.ts");
  // Each field is paired with the version that must be current for it. Add a row when you add a field.
  const PAIRS = [
    [rep, "app/api/owner/reports", /window:\s*\{\s*from,\s*to\s*\}/, /reports:v5:/, "`window` (the resolved from/to)"],
    [an, "app/api/owner/analytics", /window:\s*\{\s*from,\s*to\s*\}/, /analytics:v6:/, "`window` (the resolved from/to)"],
  ];
  for (const [src, name, field, version, what] of PAIRS) {
    if (!src) { fail(`${name} is missing`); continue; }
    const hasField = field.test(src);
    const hasVersion = version.test(src);
    if (hasField && hasVersion) ok(`${name} carries ${what} AND the cache version that goes with it`);
    else if (hasField && !hasVersion) fail(`${name} sends ${what} but its cache key version has moved on — a stored snapshot will serve the payload WITHOUT that field, so the screen gets it on some ranges and not others`);
    else if (!hasField) ok(`${name} no longer sends ${what} — nothing to pair`);
  }
}

// ── 12 · ONE IDEA OF WHAT MONTH IT IS, ON THE PLATFORM REVENUE PAGE (T20 round 2, 2026-08-31) ────
// /api/admin/revenue corrects its YEAR boundary to IST, with the reason on the line ("a UTC year flips
// ~5.5h late and mismatches the heading") — and left the 12-month chart's window, and the labels built
// from it, on UTC. Measured: at UTC 2026-08-31T20:00 (IST 1 Sep 01:30) the chart's newest bucket was
// 2026-08 while the IST month was 2026-09, so the CURRENT MONTH WAS MISSING from the chart for five
// and a half hours; on 1 January IST it would say the new year while charting December of the old one.
{
  const rev = read("app/api/admin/revenue/route.ts");
  if (!rev) fail("app/api/admin/revenue/route.ts is missing");
  else {
    const onNow = [...rev.matchAll(/now\.getUTC(?:Month|FullYear)\(\)/g)].length;
    if (!onNow) ok("the revenue page builds every month boundary from ONE IST clock");
    else fail(`the revenue page is back to reading ${onNow} month/year boundar${onNow === 1 ? "y" : "ies"} off the UTC clock while its year boundary is IST — for 5.5h after IST midnight on the 1st the chart loses the current month`);
    // ── THIS BRANCH WENT SILENT, IN THE GUARD WRITTEN TO CATCH SILENT DRIFT (T20 round 4, 2026-09-01) ──
    // It used to be `if (<literal 330 * 60000> && …) ok() else if (!istNow) fail()`. Another terminal
    // then did the RIGHT thing and named the constant — `new Date(now.getTime() + IST_SHIFT_MS)` — so
    // `istNow` was still there (no fail) and the literal was not (no ok). NEITHER BRANCH RAN. The check
    // stopped existing and the suite went 66 → 65 with nothing red, which is exactly the "a dead check
    // looks like a satisfied one" trap this file's own fixture rule exists for.
    //
    // Two corrections. First, match the INTENT — an IST clock is +5:30 however it is spelled — instead
    // of one spelling of it. Second, and more importantly, every path now ends in ok or fail: an
    // `if / else if` with no final `else` is the SHAPE that lets a check disappear, not a one-off typo.
    const istShift = /const istNow\s*=\s*new Date\(now\.getTime\(\)\s*\+\s*(?:330\s*\*\s*60000|IST_SHIFT_MS|5\.5\s*\*\s*3600_?000)\)/;
    if (istShift.test(rev)) ok("…and that clock is IST (+5:30), however the shift is spelled");
    else if (/istNow/.test(rev)) fail("app/api/admin/revenue has an `istNow` this guard no longer recognises as a +5:30 shift — teach it the new spelling rather than leaving the check silent");
    else fail("the revenue page no longer has a single IST clock for its month maths");
  }
}

// ── 13 · A REMOVAL THAT REMOVED NOTHING MUST NOT BE RECORDED AS ONE (T20 round 3, 2026-09-01) ────
// "Never log and report a change that didn't happen" has now been applied three times in this
// territory — the Repair Kit's cancel (item 18), the rate-limit board's Deny (item 16), and the logo
// removal (item 33). The logo one was found by RUNNING it: the exhaustive pass called DELETE on a
// restaurant that has never had a logo, and it answered ok, told the console "Logo removed", and
// wrote **"removed logo" into the activity log for a removal that did not happen**. `logo_url` was
// already null, the storage folder was empty, and the only artefact of the whole call was a false
// line in the record.
//
// The shape that makes it possible is specific and worth naming: `update({ logo_url: null })` over a
// row that is ALREADY null succeeds and changes nothing, so "did the write error?" cannot answer
// "did anything change?". The decision has to come from what was THERE.
{
  const logo = read("app/api/admin/restaurants/logo/route.ts");
  if (!logo) fail("app/api/admin/restaurants/logo/route.ts is missing");
  else {
    const del = logo.slice(logo.indexOf("export async function DELETE"));
    if (/select\("id, logo_url"\)/.test(del) || /logo_url/.test(del.split("logAction")[0])) {
      ok("the logo removal reads what was THERE before deciding whether anything was removed");
    } else {
      fail("the logo removal no longer looks at `logo_url` before claiming one was removed — setting null over null succeeds, so the write's own error cannot tell you whether anything changed");
    }
    if (/if \(!exists\.data\.logo_url\)[\s\S]{0,400}?removed: false/.test(del)) {
      ok("…and it says `removed: false` instead of claiming a removal");
    } else {
      fail("the logo removal no longer distinguishes 'there was nothing to remove' from 'I removed it'");
    }
    // The audit line must sit AFTER that branch, so a no-op cannot reach it.
    const noop = del.indexOf("removed: false");
    const logged = del.indexOf("logAction");
    if (noop > -1 && logged > noop) ok("…and the audit line is unreachable from the no-op path");
    else fail("the logo removal's audit line can be reached without anything having been removed");
  }
}

// ── 14 · A REFUSED RE-FIRE MUST NOT READ AS A SENT TICKET (T20 round 4, 2026-09-01) ──────────────
// `lfh_staff_place_order` answers `{ ok:false, reason }` — it does NOT throw — when it declines to
// place an order: a duplicate inside its 3-second per-table lock (mig 202), a sold-out dish, a dish
// off the menu, an as-per-MRP line with no price. The Repair Kit inspected only `error`, so every one
// of those came back `{ ok:true, kot_no:null }`: the console said the order was re-fired, the diary
// said "new KOT ?", and nothing reached the kitchen. During service that is a person at the pass
// waiting for food that was never fired — and the Repair Kit is used precisely when service is
// already going wrong.
//
// The editor route has handled it since 2026-08-05 with the reason on the line. This file's own
// header promises it "reuses the SAME service-role primitives the panels use … so the rules can't
// drift". The primitive was shared; the rule was not. Found by DRIVING two re-fires three seconds
// apart, which is exactly what a person does when the first appears to have done nothing.
{
  const rep = read("app/api/admin/repair/route.ts");
  if (!rep) fail("app/api/admin/repair/route.ts is missing");
  else {
    const refire = rep.slice(rep.indexOf('op === "refire_order"'), rep.indexOf('op === "unstick_table"'));
    if (/\.ok === false/.test(refire)) ok("the Repair Kit's re-fire reports a REFUSED order instead of a sent one");
    else fail("the Repair Kit's re-fire is back to inspecting only `error` — lfh_staff_place_order answers { ok:false } without throwing, so a refused re-fire would report success and no ticket would reach the kitchen");
    if (/kot_no\b[\s\S]{0,200}?return err\(/.test(refire)) ok("…and a success with no kitchen ticket is not treated as a success");
    else fail("the Repair Kit's re-fire no longer insists on a kitchen ticket — the ticket is the only proof anything was fired");
    // Every reason the RPC can give needs a sentence, or the admin gets the fallback for a knowable cause.
    for (const r of ["duplicate", "sold_out", "unknown_item", "price_required"]) {
      if (refire.includes(`"${r}"`)) ok(`…and it says what "${r}" means in words`);
      else fail(`the re-fire lost its sentence for the "${r}" refusal — the admin would get a generic message for a knowable cause`);
    }
  }
}

// ── 15 · A TABLE THAT WAS ALREADY CLOSED WAS NOT UNSTUCK BY THIS (T20 round 4, 2026-09-01) ───────
// `closeSession` never reads the session's current status — it sets `status:'closed'` over whatever
// is there, which SUCCEEDS on an already-closed session. So unsticking the same table twice answered
// ok and wrote a second `repair_unstick_table` line, recording a repair that repaired nothing.
// Fourth time this rule has been applied in this territory (items 16, 18, 33, and this).
{
  const rep = read("app/api/admin/repair/route.ts");
  if (rep) {
    const un = rep.slice(rep.indexOf('op === "unstick_table"'), rep.indexOf('op === "edit_time"'));
    if (/select\("id, table_number, status"\)/.test(un)) ok("the Repair Kit's unstick reads whether the table is already closed");
    else fail("the Repair Kit's unstick no longer reads `status` — closeSession succeeds on an already-closed session, so it would record a repair that repaired nothing");
    if (/alreadyClosed/.test(un)) ok("…and says so instead of writing a repair line");
    else fail("the Repair Kit's unstick no longer distinguishes 'already closed' from 'I unstuck it'");
    const already = un.indexOf("alreadyClosed"), logged = un.indexOf("logRepair");
    if (already > -1 && logged > already) ok("…and its diary line is unreachable from that path");
    else fail("the Repair Kit's unstick can write its diary line without having closed anything");
  }
}

// ── 16 · A SINGLE-RESTAURANT ANSWER UNDER A MULTI-RESTAURANT LIST MUST NAME ITSELF (T20 round 4) ──
// Item 30 stopped a printing ROW borrowing another restaurant's printer. The box BELOW the rows had
// the same fault one level up: the waiting count, the printer names and the computers all come from
// /api/owner/printing, which answers for exactly one restaurant, and nothing named it. Under two rows
// the owner reads "4 things are waiting to print" and cannot tell whose four.
// Found by MAKING the two-row case reachable — round 3 had recorded it as unreachable on this data.
{
  const pg = read("app/owner/settings/page.tsx");
  if (!pg) fail("app/owner/settings/page.tsx is missing");
  else if (!/Where your paper comes out right now/.test(pg)) ok("that box is gone — nothing to name");
  else {
    const box = pg.slice(pg.indexOf("Where your paper comes out right now") - 900, pg.indexOf("Where your paper comes out right now") + 900);
    if (/printing\.restaurantId/.test(box) && /data\.printing/.test(box)) ok("the printing box names the restaurant it is about when there is more than one");
    else fail("the printing box no longer names its restaurant — under a two-restaurant list it describes one of them and says which nowhere");
  }
}

// ── 17 · THIS SUITE ASSERTS ITS OWN SIZE (T20 round 4, 2026-09-01) ───────────────────────────────
// Rule 12 lost a branch to a refactor and NOTHING went red: the count slid 66 → 65 and every remaining
// check still passed. A guard that quietly shrinks is the same failure as a guard that quietly passes,
// and this file already carries two scars from that family (the comment stripper that ate 73% of a
// file, and the four days of red CI nobody was running).
//
// So the suite counts itself. The floor is deliberately a FLOOR, not an equality: adding checks is the
// normal direction and must never need a second edit. LOSING them is the thing that has to be loud.
// Raise this number when you add a rule — the failure message tells you to.
const CHECK_FLOOR = 66;
if (oks.length + fails.length < CHECK_FLOOR) {
  fail(`this suite ran ${oks.length + fails.length} checks and the floor is ${CHECK_FLOOR} — ${CHECK_FLOOR - (oks.length + fails.length)} stopped running without going red. That is how rule 12 disappeared: an if/else-if with no final else, silently satisfied by neither. Find the branch that ends in nothing, or raise CHECK_FLOOR if you deliberately removed one.`);
}

// ── report ───────────────────────────────────────────────────────────────────────────────────────
for (const m of oks) console.log(`  ok   ${m}`);
if (fails.length) {
  console.error("\nverify-read-guards FAILED:");
  for (const m of fails) console.error(`  FAIL ${m}`);
  console.error("\nThese rules exist because each one was a real bug that printed a wrong number to");
  console.error("the owner. If a change genuinely needs to break one, change THIS FILE in the same");
  console.error("commit and say why.");
  process.exit(1);
}
console.log(`\nAll ${oks.length} checks passed — no read can quietly print a zero nobody read.`);
