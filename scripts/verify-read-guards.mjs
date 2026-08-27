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
