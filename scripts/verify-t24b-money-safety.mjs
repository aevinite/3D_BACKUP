// verify-t24b-money-safety.mjs — sweep #7 / terminal 24's OWN 500 checks, P26601–P27100.
//
// The companion to scripts/verify-t24-money-rules.mjs, which holds sweep #6's 500
// (P11501–P12000). That one is re-run first and unchanged; this one covers the ground it does
// not, which turned out to be three things:
//
//   1. A PART OF A SPLIT MAY BE A TAB. `session_payments.khata_customer_id` / `settle_group`
//      landed in supabase/migrations/364_a_split_part_can_be_pay_later.sql — a MIGRATION FILE,
//      renumbered 352 → 364 — and the 2026-08-21 ledger has not one row about it. Pay-later is the
//      one part of a split that is NOT money, so every rule about it is a rule about a debt.
//   2. THE PRESENCE BEAT NOW ALSO REPORTS WHICH OFFLINE LAYER A DEVICE RUNS
//      (supabase/migrations/366_a_device_reports_which_offline_layer_it_is_running.sql). That is a
//      new branch inside requireRole — the hottest gate in the product — and nothing executed it.
//   3. THE MONEY RULES HAD ONLY EVER BEEN CHECKED ON HAND-PICKED EXAMPLES. A worked example proves
//      the case somebody thought of. These run the REAL exported functions over tens of thousands
//      of randomly generated bills and assert the IDENTITIES that must hold on every one of them —
//      subtotal = base + untaxed, due = subtotal − discount + tax, a discount never above its own
//      base, never a NaN anywhere. A NaN total prints as a blank line on a bill.
//
// IT RUNS THE REAL FUNCTIONS, NOT A COPY — same `@/` resolver, same reason: a guard that
// re-implements the rule it checks proves nothing about the rule that ships.
//
//   node scripts/verify-t24b-money-safety.mjs           # everything below; no database, no network
//   node scripts/verify-t24b-money-safety.mjs --ids     # …printing each check's permanent id
//
// DETERMINISTIC. The random bills come from a fixed seed, so a failure here is reproducible and a
// green run means the same thing tomorrow. Change the seed only to widen the search deliberately.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };
const SHOW_IDS = process.argv.includes("--ids");

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith("@/")) {
      let p = join(root, spec.slice(2));
      if (!existsSync(p)) for (const ext of [".ts", ".tsx", ".js", ".mjs"]) if (existsSync(p + ext)) { p += ext; break; }
      return next(pathToFileURL(p).href, ctx);
    }
    return next(spec, ctx);
  },
});

// ── the ledger ids are handed out in order, so the script and .claude/sweep/LEDGER/T24.md agree ──
let nextId = 26601;
let pass = 0;
const fails = [];
const head = (t) => console.log(`\n── ${t} ──`);
function check(msg, cond, got) {
  const id = `P${nextId++}`;
  const tag = SHOW_IDS ? `${id} ` : "";
  if (cond) { pass++; console.log(`  ✓ ${tag}${msg}`); }
  else { fails.push(`${id} ${msg}`); console.log(`  ✗ ${tag}${msg}${got === undefined ? "" : `  → got ${JSON.stringify(got).slice(0, 300)}`}`); }
}

const tax = await import("@/lib/tax.ts");
const tf = await import("@/lib/taxFiling.ts");
const cc = await import("@/lib/clashCompare.ts");
const ir = await import("@/lib/idempotencyRule.ts");
const ps = await import("@/lib/paySplit.ts");
const { PAYMENT_METHODS } = await import("@/lib/payments.ts");

const srcPaySplit = read("lib/paySplit.ts");
const srcUserAuth = read("lib/userAuth.ts");
const srcRateLimit = read("lib/rateLimit.ts");
const srcIdem = read("lib/idempotency.ts");
const srcClash = read("lib/clash.ts");
const srcTax = read("lib/tax.ts");
const srcSw = read("public/sw.js");
const srcTablet = read("app/api/tablet/[...path]/route.ts");
const srcEditor = read("app/api/editor/[...path]/route.ts");
const srcHealth = read("app/api/admin/health/route.ts");
const docCompliance = read("docs/COMPLIANCE-GUARDRAILS.md");
const docPlaybook = read("docs/SAAS-EFFICIENCY-PLAYBOOK.md");

// A deterministic pseudo-random source. Seeded, so a failure is reproducible.
let seed = 20260827;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const reseed = (n) => { seed = n; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const r2 = (n) => Math.round(n * 100) / 100;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
head("A · P26601–P26690 — one part of a split may be a TAB, and a tab is not money");
// A pay-later part is the only slice of a settle that was NOT collected. Every rule below exists so
// a debt cannot land against nobody, against two people, or be counted as cash in the drawer.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const { badSplitShape, PAY_LATER, SPLIT_METHODS } = ps;
const okPart = (amount = 100, method = "Cash") => ({ amount, method });
const tab = (extra = {}) => ({ amount: 100, method: PAY_LATER, khataName: "Ravi", ...extra });

check("'Pay later' is the word a part carries", PAY_LATER === "Pay later", PAY_LATER);
check("a WHOLE bill still cannot be settled with the method 'Pay later'", !PAYMENT_METHODS.includes(PAY_LATER));
check("…because the whole-bill Pay Later button is a different act with its own permission",
  /Deliberately NOT added to PAYMENT_METHODS/.test(srcPaySplit));
check("a split part may use any whole-bill method", PAYMENT_METHODS.every((m) => SPLIT_METHODS.includes(m)));
check("…and exactly one more: the tab", SPLIT_METHODS.length === PAYMENT_METHODS.length + 1, SPLIT_METHODS);
check("SPLIT_METHODS is derived from PAYMENT_METHODS, so a new way to pay reaches both",
  /SPLIT_METHODS[^=]*=\s*\[\.\.\.PAYMENT_METHODS,\s*PAY_LATER\]/.test(srcPaySplit));

check("a tab naming an existing person by id is accepted",
  badSplitShape([okPart(), { amount: 100, method: PAY_LATER, khataCustomerId: "abc" }]) === null);
check("a tab naming a NEW person by name is accepted", badSplitShape([okPart(), tab()]) === null);
check("a tab naming nobody is REFUSED", badSplitShape([okPart(), { amount: 100, method: PAY_LATER }]) !== null);
check("…and the refusal says what to do about it, not just 'invalid'",
  /pick who owes it/.test(String(badSplitShape([okPart(), { amount: 100, method: PAY_LATER }]))));
check("a tab whose person is a blank name is refused", badSplitShape([okPart(), tab({ khataName: "   " })]) !== null);
check("a tab whose person id is blank is refused", badSplitShape([okPart(), { amount: 1, method: PAY_LATER, khataCustomerId: "  " }]) !== null);
check("a tab whose person id is whitespace but has a NAME is accepted",
  badSplitShape([okPart(), { amount: 1, method: PAY_LATER, khataCustomerId: " ", khataName: "Ravi" }]) === null);
check("TWO tabs on one bill are refused", badSplitShape([tab(), tab({ khataName: "Sita" })]) !== null);
check("…and the refusal explains why, in a waiter's words",
  /Only one part can be pay-later/.test(String(badSplitShape([tab(), tab({ khataName: "Sita" })]))));
check("three tabs are refused too", badSplitShape([tab(), tab(), tab()]) !== null);
check("one tab plus ten real parts is accepted (12 is the ceiling)",
  badSplitShape([tab(), ...Array.from({ length: 11 }, () => okPart())]) === null);
check("one tab plus twelve real parts is refused (13 parts)",
  badSplitShape([tab(), ...Array.from({ length: 12 }, () => okPart())]) !== null);
check("a bill can never be ENTIRELY a tab — a split needs two parts and only one may be one",
  badSplitShape([tab()]) !== null && badSplitShape([tab(), tab()]) !== null);
check("…and that reasoning is written down beside the rule, not just in a sweep note",
  /which also means a split can never be ENTIRELY a tab/.test(srcPaySplit));
check("a tab of zero is refused like any other zero part", badSplitShape([okPart(), tab({ amount: 0 })]) !== null);
check("a negative tab is refused", badSplitShape([okPart(), tab({ amount: -50 })]) !== null);
check("a tab with a NaN amount is refused", badSplitShape([okPart(), tab({ amount: "abc" })]) !== null);
check("a tab with an over-long note is refused", badSplitShape([okPart(), tab({ note: "x".repeat(201) })]) !== null);
check("a 200-character note is still fine on a tab", badSplitShape([okPart(), tab({ note: "x".repeat(200) })]) === null);
check("the method is matched EXACTLY — 'pay later' in lower case is not a tab",
  badSplitShape([okPart(), { amount: 1, method: "pay later" }]) !== null);
check("…nor is 'Pay Later' with a capital L", badSplitShape([okPart(), { amount: 1, method: "Pay Later" }]) !== null);
check("…nor 'Pay later ' with a trailing space", badSplitShape([okPart(), { amount: 1, method: "Pay later " }]) !== null);
check("a khata name on a CASH part is ignored, not an error",
  badSplitShape([okPart(), { amount: 1, method: "Cash", khataName: "Ravi" }]) === null);
check("a khata id on a UPI part is ignored, not an error",
  badSplitShape([okPart(), { amount: 1, method: "UPI", khataCustomerId: "abc" }]) === null);
check("the tab test reads the method through String(), so a null method cannot pass as one",
  badSplitShape([okPart(), { amount: 1, method: null }]) !== null);
check("a part that is not an object at all is refused", badSplitShape([okPart(), null]) !== null);
check("a part that is a string is refused", badSplitShape([okPart(), "Cash"]) !== null);
check("a part that is a number is refused", badSplitShape([okPart(), 100]) !== null);
check("badSplitShape never throws on rubbish", (() => {
  const junk = [null, undefined, 0, "", "x", {}, [1, 2], [{}, {}], [[], []], [{ amount: {} }, { amount: [] }]];
  for (const j of junk) { try { badSplitShape(j); } catch { return false; } } return true;
})());

// ── the parked path, read out of the function that ships ───────────────────────────────────────
check("a tab resolves WHO owes it before any money row is written",
  srcPaySplit.indexOf("khata_customers") < srcPaySplit.indexOf('sb.from("session_payments").insert'));
check("an unknown person id is refused with 404, not silently turned into a new person",
  /That person isn't in this restaurant's pay-later book/.test(srcPaySplit));
check("…and that lookup is scoped to this restaurant's book",
  /from\("khata_customers"\)[\s\S]{0,160}?\.eq\("restaurant_id", rid\)/.test(srcPaySplit));
check("a phone that already exists reuses that person rather than making a second row for one human",
  /\.eq\("phone", phone\)/.test(srcPaySplit));
check("…and that reuse is scoped to this restaurant too",
  /from\("khata_customers"\)[\s\S]{0,200}?\.eq\("restaurant_id", rid\)[\s\S]{0,80}?\.eq\("phone", phone\)/.test(srcPaySplit));
check("a new person is created with the restaurant on the row",
  /insert\(\{\s*restaurant_id: rid, name, phone\s*\}\)/.test(srcPaySplit));
check("a name is capped at 80 characters before it is stored", /khataName \|\| ""\)\.trim\(\)\.slice\(0, 80\)/.test(srcPaySplit));
check("a phone is capped at 20 characters before it is stored", /khataPhone \|\| ""\)\.trim\(\)\.slice\(0, 20\)/.test(srcPaySplit));
check("a blank phone is stored as nothing, never as an empty string that looks like a number",
  /\.slice\(0, 20\) \|\| null/.test(srcPaySplit));
check("a failure creating the person answers 500 — it never carries on and books a debt against nobody",
  /if \(made\.error\) return \{ ok: false, message: made\.error\.message, status: 500 \}/.test(srcPaySplit));

check("every part of ONE tap shares a settle group", /const group = crypto\.randomUUID\(\)/.test(srcPaySplit));
check("…and that group is written on every leg, not only the tab", /settle_group: group,/.test(srcPaySplit));
check("only the TAB leg carries the person who owes it",
  /khata_customer_id: isPayLater\(s\) \? customer!\.id : null/.test(srcPaySplit));
check("the group exists so an earlier settle on the same bill is not subtracted from this debt",
  /without it an earlier settle on the same session would/.test(srcPaySplit));
{
  // Read the TRUE arm of `laterPart ? … : …` on its own. A window measured in characters would run
  // straight into the else-arm's `payment_status: "paid"` and prove the opposite of what it says.
  const armStart = srcPaySplit.indexOf("const upd = laterPart");
  const arm = srcPaySplit.slice(armStart, srcPaySplit.indexOf("    : await sb.from(\"orders\")", armStart));
  check("a parked bill is NOT stamped paid — the money was not collected",
    arm.includes("khata_at: stamp") && !arm.includes("payment_status") && !arm.includes("paid_at"), arm.slice(0, 300));
}
check("a parked bill goes into the book with khata_at and the person", /khata_at: stamp, khata_customer_id: customer!\.id/.test(srcPaySplit));
check("a parked bill is taken off the live floor", /khata_at: stamp[\s\S]{0,120}?archived: true, archived_at: stamp/.test(srcPaySplit));
check("the parked update is scoped by restaurant as well as by the order ids",
  (srcPaySplit.match(/\.in\("id", ids\)\.eq\("restaurant_id", rid\)/g) || []).length >= 2);
check("a bill with no tab is stamped paid with the method 'Split'", /payment_method: "Split"/.test(srcPaySplit));
check("the caller — not this function — closes the session, where the reason and the log already live",
  /The CALLER closes the session/.test(srcPaySplit));
check("the result says whether the bill was parked", /parked: !!laterPart/.test(srcPaySplit));
check("…and who owes it", /customer,\s*owed, collected,/.test(srcPaySplit));
check("owed is the tab's own amount, never the whole bill", /const owed = laterPart \? laterPart\.amount : 0/.test(srcPaySplit));
check("collected is everything EXCEPT the tab", /const collected = r2\(sum - owed\)/.test(srcPaySplit));
check("owed + collected is exactly the parts' sum, so nothing is double-counted or lost", (() => {
  for (let i = 0; i < 400; i++) {
    const owed = r2(rnd() * 5000), rest = r2(rnd() * 5000);
    if (Math.abs(r2(owed + rest) - r2(r2(owed + rest) - owed + owed)) > 0.005) return false;
  }
  return true;
})());
check("the settle note names the tab's owner so the Activity log reads as English",
  /\$\{customer\.name\}'s tab/.test(srcPaySplit));
check("the settle note is capped before it is stored on the order", /note\.slice\(0, 200\)/.test(srcPaySplit));

// ── both doors gate a tab the same way ─────────────────────────────────────────────────────────
for (const [panel, src] of [["waiter tablet", srcTablet], ["manager panel", srcEditor]]) {
  check(`${panel}: a pay-later part needs the khata module switched on for the restaurant`,
    /khataLadder\(rid\)\)\.effective/.test(src));
  check(`${panel}: …and the person's own khata power on top of mark-paid`,
    /tablet_khata|managerCan\(g, rid, "khata"\)/.test(src));
  check(`${panel}: the refusal names the module rather than saying 'not allowed'`,
    /Pay later \(khata\) isn't enabled for this restaurant/.test(src));
  check(`${panel}: a parked split closes the table the same way the whole-bill Pay Later button does`,
    /rSp\.parked && rSp\.sessionId[\s\S]{0,260}?closeSession\(/.test(src));
  check(`${panel}: a parked split writes its own khata_park line, not only a bill_split line`,
    /"khata_park"[\s\S]{0,200}?of a split/.test(src));
  check(`${panel}: that line says what was owed AND what was collected`,
    /rSp\.owed\.toFixed\(0\)[\s\S]{0,120}?rSp\.collected\.toFixed\(0\)/.test(src));
  check(`${panel}: the reply tells the screen it was parked, so the panel can say so`,
    /parked: rSp\.parked, owed: rSp\.owed, collected: rSp\.collected/.test(src));
  check(`${panel}: the split arithmetic is not re-implemented here`,
    !/session_payments"\)\s*\n?\s*\.insert/.test(src) || /settleBillInParts/.test(src));
}
check("the tablet's OLDER pay-with-splits door applies the same pay-later gate as the dedicated one",
  (srcTablet.match(/Pay later \(khata\) isn't enabled for this restaurant/g) || []).length >= 2);
check("…and that it is deliberate is written down beside it",
  /this older\s*\n?\s*\/\/ door must not be the loose one/.test(srcTablet));
check("splitting is gated by the SAME permission as a plain settle in the manager panel",
  /managerCan\(g, rid, "mark_paid"\)/.test(srcEditor));
check("…and in the tablet", /tabletPerm\("tablet_mark_paid"/.test(srcTablet));
{
  // Read the pay-split handler ALONE. Comparing positions across the whole 6,000-line file would
  // find whichever gate happens to appear first anywhere, which proves nothing about this handler.
  const region = srcEditor.slice(srcEditor.indexOf('c === "pay-split"'), srcEditor.indexOf("settleBillInParts(sb"));
  check("the manager panel asks for mark-paid BEFORE it asks for khata, so a tab is never the looser door",
    region.includes('managerCan(g, rid, "mark_paid")')
    && region.indexOf('managerCan(g, rid, "mark_paid")') < region.indexOf('managerCan(g, rid, "khata")'),
    region.length);
}

// ── a tab is a DEBT, so it must never be counted as money taken ────────────────────────────────
check("the pay-later leg is excluded from 'money in' at the database, not only on a screen",
  /khata_customer_id IS NULL/.test(read("supabase/migrations/364_a_split_part_can_be_pay_later.sql")));
check("the migration file that carries this feature exists under the number the code names",
  existsSync(join(root, "supabase/migrations/364_a_split_part_can_be_pay_later.sql")));
check("lib/paySplit.ts no longer POINTS a reader at migration 352, which is about something else",
  // The one surviving mention is the historical note recording the 352 → 364 renumber, and it says
  // so in the same sentence. A bare "(mig 352)" pointer is what must never come back.
  !/\(mig 352\)|see mig 352 —/.test(srcPaySplit));
check("…and it names the file in full at least once, as a migration file",
  /supabase\/migrations\/364_a_split_part_can_be_pay_later\.sql/.test(srcPaySplit));
check("the debt is indexed so the khata book never scans the payments table",
  /ON session_payments \(restaurant_id, khata_customer_id\)/.test(read("supabase/migrations/364_a_split_part_can_be_pay_later.sql")));
check("a reversed leg drops out of the outstanding index, so undoing a settle clears the debt",
  /reversed_at IS NULL/.test(read("supabase/migrations/364_a_split_part_can_be_pay_later.sql")));
check("reverseSplitLegs stamps a tab leg exactly as it stamps a cash leg — one behaviour, one helper",
  !/khata/.test(srcPaySplit.slice(srcPaySplit.indexOf("export async function reverseSplitLegs"))));
check("undoing a settle is scoped to the session AND the restaurant",
  /\.eq\("session_id", sessionId\)\.eq\("restaurant_id", rid\)/.test(srcPaySplit));
check("undoing a settle leaves legs from an EARLIER settle standing", /\.gte\("created_at", since\)/.test(srcPaySplit));
check("nothing in this file ever deletes a payment row", !/from\("session_payments"\)[\s\S]{0,80}?\.delete\(/.test(srcPaySplit));
check("nothing in this file ever deletes an order row", !/from\("orders"\)[\s\S]{0,80}?\.delete\(/.test(srcPaySplit));
check("…which is the compliance promise: a sale can be cancelled, never made to disappear",
  /Splitting cannot lower, hide or erase a sale/.test(srcPaySplit));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
head("B · the presence beat also reports which offline layer a device is running (mig 366)");
// A new branch inside requireRole, which is the hottest gate in the product: every panel API call
// goes through it. The rules are all about it staying free — no extra request, no extra write on a
// normal call — and about never writing a header through unchecked.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const swVersionLiteral = (srcSw.match(/^const VERSION = "([^"]+)"/m) || [])[1] || "";
check("the service worker declares a version", !!swVersionLiteral, swVersionLiteral);
check("…in the shape the server validates ('v' + up to four digits)", /^v\d{1,4}$/.test(swVersionLiteral), swVersionLiteral);
check("the server's shape test is exactly that, so a real version can never be rejected",
  /\/\^v\\d\{1,4\}\$\//.test(srcUserAuth));
check("the header is validated before it is written, never passed straight through",
  /const swVersion = rawSw && \/\^v\\d\{1,4\}\$\/\.test\(rawSw\) \? rawSw : null/.test(srcUserAuth));
check("…and the reason is written down: a header is whatever arrives",
  /a header is whatever arrives, so it is never written through unchecked/.test(srcUserAuth));
check("a device that reports nothing is recorded as nothing, not as a blank string",
  /req\.headers\?\.get\("x-lfh-sw"\) \?\? null/.test(srcUserAuth));
check("the header name the worker sends and the one the server reads are the same",
  /h\.set\("X-LFH-SW", VERSION\)/.test(srcSw) && /get\("x-lfh-sw"\)/.test(srcUserAuth));
check("`headers` is OPTIONAL on requireRole, so an internal caller with a stub still works",
  /headers\?: \{ get\(name: string\): string \| null \}/.test(srcUserAuth));
check("…and why it is optional is written down rather than looking like an oversight",
  /`headers` is OPTIONAL on purpose/.test(srcUserAuth));
check("the version rides on reads the worker was making anyway — no request is added for it",
  /NO extra\s*\n?\/\/ request, NO extra egress/.test(srcSw));
check("…and it is stamped by the worker itself, so it cannot report a version it is not running",
  /it cannot lie — the header comes from the worker that is actually\s*\n?\/\/ running/.test(srcSw));
check("the stamp is put on a COPY of the request, because fetch headers cannot be changed",
  /A new Request is built\s*\n?\/\/ rather than mutating \(fetch headers are immutable\)/.test(srcSw));
check("if stamping fails at all, the ORIGINAL request goes out — reporting a version never costs a read",
  /\} catch \{ return req; \}/.test(srcSw));
check("credentials survive the copy, or the read would go out signed out", /credentials: req\.credentials/.test(srcSw));
check("mode and redirect survive the copy too", /mode: req\.mode,[\s\S]{0,80}?redirect: req\.redirect/.test(srcSw));
check("the cache KEY is unchanged by the header, so nothing is stored twice",
  /The cache KEY stays `req\.url`/.test(srcSw));
check("the stamp goes only on the data reads the worker already handles, not on navigations",
  /networkFirst\(withVersion\(req\), DATA/.test(srcSw));
check("…and it is applied in exactly one place (the declaration is not a call site)",
  (srcSw.match(/(?<!function )withVersion\(req\)/g) || []).length === 1);

check("an unchanged version writes NOTHING inside the throttle window",
  /const swChanged = swVersion !== null && swVersion !== storedSw/.test(srcUserAuth));
check("a CHANGED version is written straight away, even inside the window",
  /if \(stale \|\| swChanged\)/.test(srcUserAuth));
check("…and the reason is written down: a device that just updated must stop reading as behind",
  /A device that has just UPDATED should stop reading as behind straight away/.test(srcUserAuth));
check("the patch carries only the fields that actually moved",
  /if \(stale\) patch\.last_seen_at[\s\S]{0,120}?if \(swChanged\) patch\.sw_version/.test(srcUserAuth));
check("the write is still fire-and-forget — it never blocks the request",
  /update\(patch\)\.eq\("id", u\.id\)\.then\(\(\) => \{\}, \(\) => \{\}\)/.test(srcUserAuth));
check("the presence throttle is still 45 seconds, so the beat did not get more expensive",
  /> 45_000/.test(srcUserAuth));
check("the stored version is read off the row the gate already fetched — no extra query",
  /const storedSw = \(u as \{ sw_version\?: string \| null \}\)\.sw_version \?\? null/.test(srcUserAuth));
check("…which works because the cookie lookup selects the whole row",
  /from\("staff_users"\)\.select\("\*"\)\.eq\("id", id\)/.test(srcUserAuth));
check("the column exists in a migration file, not only in the TypeScript",
  /add column if not exists sw_version text/i.test(read("supabase/migrations/366_a_device_reports_which_offline_layer_it_is_running.sql")));
check("the admin health page reads that column on a query it was already making",
  /select\("id, last_seen_at, restaurant_id, sw_version"\)/.test(srcHealth));
check("…and counts only people seen RECENTLY, so an unused device is not called 'behind'",
  /now - new Date\(u\.last_seen_at\)\.getTime\(\) < SW_WINDOW_MS/.test(srcHealth));
check("a device that has never reported is 'hasn't told us', never 'behind'",
  /NULL is its own answer/.test(srcHealth) && /swUnknown = swSeen\.length - swCurrent - swBehind/.test(srcHealth));
check("…and the reason is written down: reporting it as behind would invent a fault",
  /Reporting it as\s*\n?\s*\/\/ behind would invent a fault/.test(srcHealth));
check("'current' is measured against the version this deployment actually ships",
  /const shippedSw = shippedSwVersion\(\)/.test(srcHealth));
check("with no shipped version known, nothing is called current or behind",
  /shippedSw \? swSeen\.filter/.test(srcHealth) && /swBehind = shippedSw \?/.test(srcHealth));

// The gate's ORDER is what a device-version beat must not have disturbed.
const gate = srcUserAuth.slice(srcUserAuth.indexOf("export async function requireRole"));
check("the per-tab admin pin is still checked before anything else", gate.indexOf('searchParams?.get("rid")') < gate.indexOf("userFromCookie"));
check("the staff cookie is still checked BEFORE the admin fallback",
  gate.indexOf("userFromCookie") < gate.lastIndexOf("tokenIsValid"));
check("the panel entitlement is still re-checked on every request", /isPanelEnabledCached\(u\.role, u\.restaurant_id\)/.test(gate));
check("the recycle-bin check is still there", /isRestaurantDeleted\(u\.restaurant_id\)/.test(gate));
check("owners are still exempt from the panel map and get their own check", /ownerPanelEnabled\(u\.id\)/.test(gate));
check("a database blip is still a 503, never a sign-out", /AuthDbError\) return \{ ok: false, transient: true \}/.test(gate));
check("the beat happens only AFTER the entitlement checks pass, so a blocked panel writes nothing",
  gate.indexOf("isPanelEnabledCached") < gate.indexOf("x-lfh-sw"));
check("…and only for a real staff user — an admin-only session has no row to beat on",
  gate.indexOf("x-lfh-sw") < gate.lastIndexOf("admin super"));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
head("C · the money identities hold on THIRTY THOUSAND random bills, not on chosen examples");
// Sweep #6 checked splitBill on worked examples. A worked example proves the case somebody thought
// of. These generate bills — random prices with 0, 1 and 2 decimals, random quantities, every mix
// of GST-on-top / GST-inside / no-GST lines, sealed MRP items, and a random discount that is often
// far too big — and assert the identities that must hold on EVERY one. A break here is a bill that
// does not add up, which is the fault this whole area exists to prevent.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const PROFILES = [
  ["a flat 5% restaurant", { tax_rate: 0.05 }],
  ["an 18% banquet rate", { tax_rate: 0.18 }],
  ["a 12.5% rate with an odd half percent", { tax_rate: 0.125 }],
  ["CGST 2.5 + SGST 2.5 as named parts", { tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }] }],
  ["CGST 9 + SGST 9 as named parts", { tax_components: [{ label: "CGST", rate: 9 }, { label: "SGST", rate: 9 }] }],
  ["a composition-scheme restaurant, which charges no GST at all", { price_tax_mode: "composition", tax_rate: 0.18 }],
  ["a restaurant that has configured nothing, so it falls back to 5%", {}],
];
const CASES = 3000;
function bills(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = 1 + Math.floor(rnd() * 8);
    const lines = [];
    for (let j = 0; j < k; j++) lines.push({
      price: pick(["", "₹", "Rs "]) + (rnd() * 2000).toFixed(pick([0, 1, 2])),
      qty: 1 + Math.floor(rnd() * 5),
      tax_mode: pick(["excl", "incl", "exempt"]),
      is_mrp: rnd() < 0.15,
    });
    out.push({ lines, discount: rnd() < 0.25 ? rnd() * 6000 : rnd() * 800 });
  }
  return out;
}
const IDENTITIES = [
  ["no figure on the bill is ever NaN or infinite — a NaN total prints as a blank line",
    (s) => Object.values(s).every((v) => typeof v !== "number" || Number.isFinite(v))],
  ["the subtotal is exactly the taxed part plus the untaxed part",
    (s) => Math.abs(s.subtotal - r2(s.taxableBase + s.nontaxAmount)) <= 0.005],
  ["the discount actually applied is never above the most that is allowed",
    (s) => s.discount <= s.discountBase + 0.005],
  ["…and never below zero, however the caller asked", (s) => s.discount >= 0],
  ["the most a discount may be is never negative", (s) => s.discountBase >= 0],
  ["the total is never negative", (s) => s.total >= -0.005],
  ["the tax is never negative", (s) => s.tax >= -0.005],
  ["the tax is exactly the taxable amount at the restaurant's rate, rounded once",
    (s) => Math.abs(s.tax - r2(s.taxable * s.rate)) <= 0.005],
  ["the ONE formula every panel relies on holds: subtotal − discount + tax = total",
    (s) => Math.abs(s.total - r2(s.subtotal - s.discount + s.tax)) <= 0.005],
  ["at a taxed restaurant the discount comes off BEFORE the tax is worked out",
    (s) => s.rate <= 0 || Math.abs(s.taxable - r2(s.taxableBase - s.discount)) <= 0.005],
  // MEASURED, NOT ASSUMED. `mrpAmount` accumulates the GROSS line amount while a GST-inside line
  // contributes only its NET to the taxable base, so on an all-MRP bill of GST-inside lines the MRP
  // figure CAN exceed the subtotal (found here on 2026-08-27, 30,000 random bills). It is not a
  // fault today and the identity is stated where it is actually load-bearing: the figure is only
  // ever used in arithmetic at a ZERO rate, and at a zero rate a GST-inside line divides by 1, so
  // gross and net are the same number. Two independent locks stop the other case existing at all —
  // a GST-inside MRP line needs `mrp_tax_treatment = 'inclusive'`, and a restaurant that is not on
  // the composition scheme can never have a zero rate (NULLIF(tax_rate, 0) falls back to 5%), while
  // a composition restaurant forces every line to exempt. Both are asserted just below.
  ["a sealed MRP item never counts for more than the whole bill WHERE THAT FIGURE IS USED (a zero rate)",
    (s) => s.rate > 0 || s.mrpAmount <= s.subtotal + 0.005],
  ["a composition-scheme restaurant charges exactly zero tax", (s, raw) => raw.price_tax_mode !== "composition" || (s.rate === 0 && s.tax === 0)],
  ["asking for the maximum discount gives back exactly the maximum discount",
    (s, raw, ln) => tax.maxDiscount(ln, raw) === s.discountBase],
];
for (const [pname, raw] of PROFILES) {
  for (const [iname, holds] of IDENTITIES) {
    reseed(20260827);                       // every identity sees the SAME 3,000 bills
    let firstBreak = null;
    for (const { lines, discount } of bills(CASES)) {
      const s = tax.splitBill(lines, raw, discount);
      if (!holds(s, raw, lines)) { firstBreak = { lines, discount, s }; break; }
    }
    check(`${pname}: ${iname}`, !firstBreak, firstBreak);
  }
}

// The two locks the MRP identity above rests on. If either ever moves, the gross-vs-net difference
// stops being unreachable and the figure has to be reconciled — so they are checked, not trusted.
check("a restaurant that is NOT on the composition scheme can never reach a rate of zero", (() => {
  const tries = [{}, { tax_rate: 0 }, { tax_rate: null }, { tax_rate: "" }, { tax_rate: "0" },
    { tax_components: [] }, { tax_components: [{ label: "", rate: 5 }] },
    { tax_components: [{ label: "x", rate: 0 }] }, { tax_components: "nonsense" },
    { tax_components: [{ label: "x", rate: -9 }] }, { price_tax_mode: "excl", tax_rate: 0 },
    { price_tax_mode: "incl", tax_components: [] }];
  return tries.every((t) => tax.effectiveTaxRate(t) > 0);
})());
check("…and a composition restaurant forces EVERY line to exempt, whatever the dish says", (() => {
  const raw = { price_tax_mode: "composition", item_tax_modes_allowed: true, mrp_tax_treatment: "inclusive" };
  return ["default", "excl", "incl", "mrp", "none", "rubbish", null, undefined]
    .every((m) => tax.resolveTaxMode(m, raw) === "exempt");
})());
check("so a GST-inside MRP line and a zero rate cannot happen together on one bill", (() => {
  const raw = { item_tax_modes_allowed: true, mrp_tax_treatment: "inclusive", tax_rate: 0.05 };
  return tax.resolveTaxMode("mrp", raw) === "incl" && tax.effectiveTaxRate(raw) > 0;
})());
check("an MRP dish with the OTHER treatment is exempt, and then its gross IS its net", (() => {
  const raw = { item_tax_modes_allowed: true, mrp_tax_treatment: "none", tax_rate: 0.05 };
  return tax.resolveTaxMode("mrp", raw) === "exempt";
})());

// ═══════════════════════════════════════════════════════════════════════════════════════════════
head("D · a GST return reconciles in both directions, on twenty thousand random periods");
// The Tax/GST report once printed two different CGST figures for one month because two places
// rounded differently. The fix was having ONE rule; these are the properties that rule has to keep,
// checked over random data rather than the month somebody happened to look at.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const LINESETS = [
  ["CGST + SGST at 2.5 each", [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }]],
  ["CGST + SGST at 9 each", [{ label: "CGST", rate: 9 }, { label: "SGST", rate: 9 }]],
  ["IGST alone at 18", [{ label: "IGST", rate: 18 }]],
  ["three lines including a cess", [{ label: "CGST", rate: 9 }, { label: "SGST", rate: 9 }, { label: "Cess", rate: 1 }]],
  ["two lines of UNEQUAL size", [{ label: "CGST", rate: 6 }, { label: "SGST", rate: 12 }]],
];
for (const [lname, lines] of LINESETS) {
  reseed(777);
  let breakA = null, breakB = null, breakC = null, breakD = null;
  for (let i = 0; i < 4000 && !(breakA && breakB && breakC && breakD); i++) {
    const target = Math.round(rnd() * 500000) / 100 * (rnd() < 0.04 ? -1 : 1);
    const parts = tf.splitTax(lines.map((l) => l.rate), target);
    const sum = parts.reduce((a, x) => a + x, 0);
    if (!breakA && Math.abs(sum - r2(target)) > 0.005) breakA = { target, parts, sum };
    if (!breakB && parts.some((p) => !Number.isFinite(p))) breakB = { target, parts };
    if (!breakC && parts.length !== lines.length) breakC = { target, parts };
    if (!breakD && target >= 0 && parts.some((p) => p < -0.005)) breakD = { target, parts };
  }
  check(`${lname}: the tax lines always add back to the tax total exactly`, !breakA, breakA);
  check(`${lname}: no tax line is ever NaN`, !breakB, breakB);
  check(`${lname}: there is one figure per tax line, always`, !breakC, breakC);
  check(`${lname}: a positive tax total never produces a negative line`, !breakD, breakD);
  reseed(778);
  let e = null, f = null, g = null;
  for (let i = 0; i < 3000 && !(e && f && g); i++) {
    const nr = 1 + Math.floor(rnd() * 40);
    const rows = Array.from({ length: nr }, () => ({ t: Math.round(rnd() * 80000) / 100 }));
    const built = tf.buildFiling(rows, lines, (r) => r.t);
    if (!e && built.rows.reduce((a, r) => a + r.tax, 0) !== built.total) e = { nr, total: built.total };
    if (!f) for (const r of built.rows) if (Math.abs(r.parts.reduce((a, x) => a + x, 0) - r.tax) > 0.005) { f = r; break; }
    if (!g && Math.abs(built.columnTotals.reduce((a, x) => a + x, 0) - built.total) > 0.02) g = { nr, cols: built.columnTotals, total: built.total };
  }
  check(`${lname}: every day's figure adds up to the month's headline figure`, !e, e);
  check(`${lname}: every day's tax lines add up to that day's tax`, !f, f);
  check(`${lname}: every column adds up to the grand total`, !g, g);
}
reseed(999);
{
  let a = null, b = null, c = null, d = null, e = null;
  for (let i = 0; i < 20000 && !(a && b && c && d && e); i++) {
    const n = 1 + Math.floor(rnd() * 40);
    const weights = Array.from({ length: n }, () => (rnd() < 0.25 ? 0 : rnd() * 10000));
    const total = Math.round(rnd() * 2000000) * (rnd() < 0.05 ? -1 : 1);
    const out = tf.allocateWhole(total, weights);
    if (!a && out.reduce((x, y) => x + y, 0) !== Math.round(total)) a = { total, n, sum: out.reduce((x, y) => x + y, 0) };
    if (!b && out.some((x) => !Number.isInteger(x))) b = { total, out };
    if (!c && out.length !== n) c = { n, len: out.length };
    if (!d && total >= 0 && out.some((x) => x < 0)) d = { total, out };
    if (!e && weights.every((w) => w === 0) && out.slice(1).some((x) => x !== 0)) e = { total, out };
  }
  check("spreading a month's rupees across its days always adds back to the month", !a, a);
  check("…in whole rupees, never a fraction of one", !b, b);
  check("…with one figure per day, always", !c, c);
  check("…and a positive month never produces a negative day", !d, d);
  check("…and a month with nothing to weigh by puts the whole figure on the first day rather than losing it", !e, e);
}
check("no weight means no rows back, not a crash", tf.allocateWhole(1000, []).length === 0);
check("no tax lines means no figures back, not a crash", tf.splitTax([], 500).length === 0);
check("tax lines that are all zero still add back to the total (the divide-by-zero guard)",
  Math.abs(tf.splitTax([0, 0], 100).reduce((a, x) => a + x, 0) - 100) <= 0.005);
check("one tax line takes the whole total", tf.splitTax([18], 123.45)[0] === 123.45);
check("a zero total splits into zeros, never NaN", tf.splitTax([9, 9], 0).every((x) => x === 0));
check("the taxable value of a period is recovered from the tax, so MRP lines cannot inflate it",
  tf.taxableValue({ tax: 50, subtotal: 2000, discount: 0 }, 5) === 1000);
check("…and it is capped at what was actually sold, so a rounding wobble cannot exceed it",
  tf.taxableValue({ tax: 500, subtotal: 900, discount: 100 }, 5) === 800);
check("with no rate configured the whole of net sales is returned, to be labelled honestly",
  tf.taxableValue({ tax: 50, subtotal: 2000, discount: 500 }, null) === 1500);
check("net sales is subtotal minus discount, to the paise",
  tf.netSalesOf({ subtotal: 1000.005, discount: 0.5 }) === 999.51 || tf.netSalesOf({ subtotal: 1000, discount: 0.5 }) === 999.5);
check("rounding dust is NOT dressed up as real exempt supply — the fault that printed '₹111 exempt'",
  tf.exemptIsMaterial({ tax: 398074, subtotal: 7961596, discount: 0, paidOrders: 4000 }, 5) === false);
check("…while a genuine exempt portion IS reported",
  tf.exemptIsMaterial({ tax: 50000, subtotal: 2000000, discount: 0, paidOrders: 100 }, 5) === true);
check("the tolerance scales with the number of bills, because the drift is per bill",
  tf.exemptTolerance(1000) === 500 && tf.exemptTolerance(0) === 100);
check("with no rate at all, nothing is called exempt", tf.exemptIsMaterial({ tax: 0, subtotal: 100, discount: 0, paidOrders: 1 }, null) === false);
check("when nothing is materially exempt, the printed taxable value is the whole of net sales",
  tf.taxableFor({ tax: 50, subtotal: 2000, discount: 0 }, 5, false) === 2000);
check("…and when something is, it is recovered from the tax instead",
  tf.taxableFor({ tax: 50, subtotal: 2000, discount: 0 }, 5, true) === 1000);
check("none of the filing helpers throws on rubbish", (() => {
  const junk = [null, undefined, NaN, Infinity, -Infinity, "abc", {}, []];
  for (const j of junk) {
    try {
      tf.splitTax([j], j); tf.allocateWhole(j, [j]);
      tf.taxableValue({ tax: j, subtotal: j, discount: j }, j);
      tf.netSalesOf({ subtotal: j, discount: j });
      tf.exemptTolerance(j);
      tf.exemptIsMaterial({ tax: j, subtotal: j, discount: j, paidOrders: j }, j);
      tf.buildFiling([{}], [{ label: "x", rate: j }], () => j);
    } catch { return false; }
  }
  return true;
})());
check("…and none of them returns a NaN for rubbish either", (() => {
  const out = [...tf.splitTax([NaN], NaN), ...tf.allocateWhole(NaN, [NaN]),
    tf.netSalesOf({ subtotal: "x", discount: "y" }), tf.exemptTolerance("x")];
  return out.every((v) => Number.isFinite(v));
})());

// ═══════════════════════════════════════════════════════════════════════════════════════════════
head("E · 'is this still the value your screen was editing from?' — the comparison, exhaustively");
// The comparator decides whether one person's save quietly wipes another's. It is the whole of
// "first save wins, the loser gets told", so it is checked over every pairing of a value table
// rather than on the shapes somebody remembered.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const VALUES = [
  ["nothing at all", null], ["undefined", undefined], ["an empty string", ""], ["a space", " "],
  ["a word with spaces round it", " mild "], ["the same word", "mild"], ["a different word", "hot"],
  ["the number zero", 0], ["the string zero", "0"], ["the number one", 1], ["the string one", "1"],
  ["true", true], ["false", false], ["the word on", "on"], ["the word off", "off"], ["the word pin", "pin"],
  ["an empty list", []], ["a one-item list", ["nuts"]], ["the same list", ["nuts"]],
  ["a two-item list", ["nuts", "dairy"]], ["that list the other way round", ["dairy", "nuts"]],
  ["that list in capitals", ["NUTS", "DAIRY"]], ["an empty object", {}], ["an object", { a: 1 }],
  ["the same object with its keys the other way round", { b: 2, a: 1 }], ["an object with two keys", { a: 1, b: 2 }],
  ["a nested object", { a: { b: [1, 2] } }], ["the same nested object", { a: { b: [1, 2] } }],
];
{
  let asym = null, irref = null, threw = null;
  for (const [an, a] of VALUES) {
    try { if (cc.sameValue(a, a) !== true) irref ||= an; } catch { threw ||= an; }
    for (const [bn, b] of VALUES) {
      try {
        if (cc.sameValue(a, b) !== cc.sameValue(b, a)) asym ||= `${an} vs ${bn}`;
      } catch { threw ||= `${an} vs ${bn}`; }
    }
  }
  check("a value always equals itself, whatever shape it is", !irref, irref);
  check("the comparison reads the same in either direction", !asym, asym);
  check("it never throws, on any pairing", !threw, threw);
}
check("a value that has never been set and an empty object are the same thing, so a blank column cannot invent a clash",
  cc.sameValue(null, {}) === true && cc.sameValue(undefined, {}) === true);
check("spaces round a typed word are not a change", cc.sameValue(" mild ", "mild") === true);
check("a list's ORDER is not a change — an allergen list is a set", cc.sameValue(["nuts", "dairy"], ["dairy", "nuts"]) === true);
check("a list's CAPITALS are not a change", cc.sameValue(["NUTS"], ["nuts"]) === true);
check("a list gaining an item IS a change", cc.sameValue(["nuts"], ["nuts", "dairy"]) === false);
check("an object's key order is not a change", cc.sameValue({ a: 1, b: 2 }, { b: 2, a: 1 }) === true);
check("an object's CONTENT changing is a change", cc.sameValue({ a: 1 }, { a: 2 }) === false);
check("a nested list inside an object is compared, not stringified to '[object Object]'",
  cc.sameValue({ a: { b: [1, 2] } }, { a: { b: [1, 3] } }) === false);
check("two DIFFERENT objects no longer compare equal, which is the bug that made every jsonb column unprotectable",
  cc.sameValue({ table1: "Patio" }, { table1: "Terrace" }) === false);
check("renaming ONE table inside the whole table-names object is caught",
  cc.sameValue({ "1": "Patio", "2": "Bar" }, { "1": "Patio", "2": "Snug" }) === false);
check("…while re-sending the SAME table names is not a clash",
  cc.sameValue({ "1": "Patio", "2": "Bar" }, { "2": "Bar", "1": "Patio" }) === true);
check("a number and its string spelling are the same value, because a form sends strings",
  cc.sameValue(1, "1") === true && cc.sameValue(0, "0") === true);
check("a cycle can never hang a write", (() => { const c = {}; c.self = c; try { cc.stableJson(c); return true; } catch { return false; } })());
check("…and a deep value stops descending rather than recursing forever", cc.stableJson({ a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } }).includes("…"));
check("a very deep value therefore compares EQUAL, which fails OPEN — the same direction as every other decision here",
  cc.sameValue({ a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } }, { a: { b: { c: { d: { e: { f: { g: { h: 2 } } } } } } } }) === true);
check("a deep LIST stops descending too", cc.stableJson([[[[[[[[1]]]]]]]]).includes("…"));
check("isPlainObject says yes to an object", cc.isPlainObject({}) === true);
check("…no to a list", cc.isPlainObject([]) === false);
check("…no to nothing", cc.isPlainObject(null) === false && cc.isPlainObject(undefined) === false);
check("…no to a word or a number", cc.isPlainObject("x") === false && cc.isPlainObject(1) === false);
check("stableJson gives the same string however the object was built", (() => {
  const x = {}; x.b = 2; x.a = 1; const y = {}; y.a = 1; y.b = 2;
  return cc.stableJson(x) === cc.stableJson(y);
})());
check("stableJson never returns the literal words '[object Object]'", !cc.stableJson({ a: { b: 1 } }).includes("[object Object]"));
check("the comparator has NO imports, so a guard can run the rule that actually ships",
  !/^\s*import\s/m.test(read("lib/clashCompare.ts")));

// ── the gate around the comparator ─────────────────────────────────────────────────────────────
check("only an allow-listed table may be compared at all", /const COMPARABLE_TABLES: Record<string, string> = \{/.test(srcClash));
check("a composite key may only use the columns named for that table", /const COMPOSITE_KEYS: Record<string, string\[\]> = \{/.test(srcClash));
check("every field name is checked against a strict pattern before it reaches a query",
  /\/\^\[a-z_\]\[a-z0-9_\]\*\(\\\.\[a-zA-Z0-9_-\]\+\)\?\$\//.test(srcClash));
check("at most eight fields are compared at a time", /\.slice\(0, 8\)/.test(srcClash));
check("the two tables whose own id IS the restaurant answer 'nothing to compare' for anyone else's id",
  /if \(TENANT_ROW_TABLES\.has\(table\) && id !== rid\) return null/.test(srcClash));
check("every other table's comparison is scoped to this restaurant",
  /if \(!TENANT_ROW_TABLES\.has\(table\)\) q = q\.eq\("restaurant_id", rid\)/.test(srcClash));
check("a missing row reads as 'nothing to overwrite', which is the first-person-to-count case",
  /No row: nothing to overwrite/.test(srcClash));
check("the whole check fails OPEN on any problem — a broken gate must never stop a restaurant working",
  /\} catch \{\s*\n\s*return null; \/\/ fail open/.test(srcClash));
check("a money value's refusal says it MOVED without repeating the figure",
  /const QUIET_COLUMNS = new Set\(\["discount", "price", "payment_status", "total"\]\)/.test(srcClash));
check("…because this gate runs before the per-action permission check", /BEFORE the per-action permission check/.test(srcClash));
check("an object's refusal takes the quiet form too, so nobody reads '[object Object]'",
  /const quiet = QUIET_COLUMNS\.has\(c\) \|\| isPlainObject\(current\)/.test(srcClash));
check("a switch reads 'on' / 'off' in the refusal, never 'true' / 'false'",
  /if \(typeof v === "boolean"\) return v \? "on" : "off"/.test(srcClash));
check("the third state of a money row reads as a sentence", /return "on, but asking for a manager PIN"/.test(srcClash));
check("an empty value reads as 'nothing'", /return s \? `“\$\{s\}”` : "nothing"/.test(srcClash));
check("the refusal always says what to do next, not only what went wrong",
  /todo: "Your change was NOT saved\./.test(srcClash));
check("…and it says the change was NOT saved, so nobody assumes it half-happened",
  /Your change was NOT saved/.test(srcClash));
check("a replayed change is only judged once it is genuinely old", /const REPLAY_MIN_AGE_MS = 20_000/.test(srcClash));
check("…so the live write path is untouched and costs no extra query", /It does NOT touch the ONLINE path/.test(srcClash));
check("a closed table with no timestamp is sent to a human rather than written to",
  /if \(isClosed && !closed\)/.test(srcClash));
check("a table that has a DIFFERENT party now refuses, naming what the restaurant calls that table",
  /has a different party now/.test(srcClash) && /const label = await tableLabel\(rid, t\)/.test(srcClash));
check("the table's name is read live from settings, so a rename lands everywhere with nothing to migrate",
  /Read live from settings\.table_names, never stored anywhere/.test(srcClash));
check("…and it falls back to 'Table N' on any problem", /return plain; \}/.test(srcClash));
check("that extra read happens only on the path already about to refuse somebody",
  /only on the path that is already about to refuse somebody/.test(srcClash));
check("'couldn't tell which table' is never turned into a refusal", /if \(unknown \|\| !tables\.length\) return null/.test(srcClash));
check("the refusal shape is the one the panel's outbox expects", /NextResponse\.json\(\{ error: c\.code, clash: c \}, \{ status: 409 \}\)/.test(srcClash));
check("every refusal says whether resending could ever help", /retryable: false/.test(srcClash));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
head("F · a retry never charges twice, a refusal never sticks, and a wall belongs to ONE restaurant");
// ═══════════════════════════════════════════════════════════════════════════════════════════════
{
  const { didSomething, storedIsRefusal } = ir;
  let broke = null;
  for (const st of [200, 201, 204, 299, 300, 399, 400, 401, 403, 404, 409, 422, 429, 500, 503]) {
    for (const body of [null, undefined, {}, { ok: true }, { ok: false }, { ok: false, reason: "sold_out" },
      { ok: 0 }, { ok: "false" }, { error: "x" }, [], "text", 42]) {
      const want = st < 400 && !(body && typeof body === "object" && body.ok === false);
      if (didSomething(st, body) !== want) broke ||= { st, body };
    }
  }
  check("'did this actually change anything?' answers the same way on every status and body shape", !broke, broke);
  check("an error status is never remembered, so the person can try again", didSomething(500, { ok: true }) === false);
  check("a refusal reported INSIDE a 200 is not remembered either — the diner's next tap must reach the kitchen",
    didSomething(200, { ok: false, reason: "sold_out" }) === false);
  check("…including the cruel one: over the ordering limit, wait a minute, tap again",
    didSomething(200, { ok: false, reason: "rate_limited" }) === false);
  check("a real success IS remembered, so a replay cannot place the order twice", didSomething(200, { ok: true, order_id: "x" }) === true);
  check("a success with no body is remembered too", didSomething(200, null) === true);
  check("`ok: 0` is not the same as `ok: false` — the test is strict", didSomething(200, { ok: 0 }) === true);
  check("the string 'false' is not `false` either", didSomething(200, { ok: "false" }) === true);
  check("a stored refusal is recognised so an old wrongly-remembered row heals itself", storedIsRefusal({ ok: false }) === true);
  check("…and a stored success is not disturbed", storedIsRefusal({ ok: true }) === false);
  check("nothing stored is not a refusal", storedIsRefusal(null) === false && storedIsRefusal(undefined) === false);
  check("a stored list is not a refusal", storedIsRefusal([]) === false);
  check("neither helper throws on rubbish", (() => {
    for (const j of [null, undefined, NaN, "x", 0, [], {}, () => {}]) {
      try { didSomething(j, j); storedIsRefusal(j); } catch { return false; }
    }
    return true;
  })());
  check("the rule lives in a file with NO imports, so a guard can run the rule that ships",
    !/^\s*import\s/m.test(read("lib/idempotencyRule.ts")));
}
check("a request with no action id goes straight through, unchanged", /if \(!actionId\) return fn\(req, ctx\)/.test(srcIdem));
check("the claim is taken BEFORE the handler runs", srcIdem.indexOf("await begin(actionId") < srcIdem.indexOf("await fn(req, ctx)"));
check("a duplicate is answered with the ORIGINAL result, so a client can still track an order whose first reply was lost",
  /return NextResponse\.json\(\{ ok: true, \.\.\.stored, duplicate: true \}\)/.test(srcIdem));
check("…and the stored result is read per call, never from a shared variable two requests could cross",
  /Returned per-call \(never a shared module var\)/.test(srcIdem));
check("a request still being handled is told to retry, not answered wrongly",
  /sync_in_progress", retry: true \}, \{ status: 409 \}/.test(srcIdem));
check("a crashed attempt is released after 30 seconds so nothing is wedged for ever", /const STALE_MS = 30_000/.test(srcIdem));
check("a handler that throws releases its claim before the error travels on",
  /catch \(e\) \{\s*\n\s*await finish\(actionId, false\);\s*\n\s*throw e;/.test(srcIdem));
check("a failed write releases the claim, so the next replay is a genuine retry",
  /else await sb\.from\("action_idempotency"\)\.delete\(\)\.eq\("action_id", actionId\)/.test(srcIdem));
check("the whole thing fails OPEN — a dedupe table hiccup must never break every staff write",
  (srcIdem.match(/fail open/g) || []).length >= 3);
check("the response is CLONED before its body is read, so the caller still gets a readable reply",
  /await res\.clone\(\)\.json\(\)/.test(srcIdem));
check("a non-JSON reply stores nothing rather than crashing", /catch \{ \/\* non-JSON response → store nothing \*\//.test(srcIdem));
check("the claims table is kept from growing for ever", /lfh_prune_action_idempotency/.test(srcIdem));
check("…opportunistically, so an idle stack does no work at all", /const PRUNE_ODDS = 200/.test(srcIdem));
check("…and the tidy-up is never awaited, so it can never affect a write", /maybePrune\(\); \/\/ fire-and-forget/.test(srcIdem));
check("a wrongly-remembered refusal from before the rule existed heals itself rather than replaying for ever",
  /if \(storedIsRefusal\(stored\)\)/.test(srcIdem));
check("…by reusing the row, so the healing attempt is still protected against a concurrent duplicate",
  /Reuse the row as a fresh claim \(rather than deleting it\)/.test(srcIdem));

check("a login wall is read back for ONE restaurant, so two restaurants never share one wall",
  /\.eq\("restaurant_id", rid \|\| RID0\)/.test(srcRateLimit));
check("clearing a counter after a good sign-in can be narrowed to one restaurant too",
  /export async function rateResetOnSuccess\(key: RateKey, subject: string, rid\?: string \| null\)/.test(srcRateLimit));
check("…and it only narrows when the caller actually named one, so today's callers are unchanged",
  /rid \? q\.eq\("restaurant_id", rid\) : q/.test(srcRateLimit));
check("a wall that was hit is marked handled, never deleted — the record of what happened stays",
  /status: "allowed", resolved_at:/.test(srcRateLimit) && !/rate_limit_events"\)\s*\n?\s*\.delete\(/.test(srcRateLimit));
check("the limiter fails OPEN — a glitch must never lock a real person out",
  (srcRateLimit.match(/fail-open/g) || []).length >= 2);
check("an empty subject is allowed rather than counted", /if \(!subj\) return true/.test(srcRateLimit));
check("the two 'who is this really' reads happen only when a wall was actually hit",
  /A wall was hit \(rare\) → now it's worth spending two small reads/.test(srcRateLimit));
check("…and they are scoped, column-listed and capped to one row",
  /\.select\("id, hit_count, max_count, window_seconds"\)[\s\S]{0,200}?\.limit\(1\)/.test(srcRateLimit));
check("the restaurant-name read is one row, two columns", /\.select\("name"\)\.eq\("id", rid\)\.limit\(1\)/.test(srcRateLimit));
check("the guest beacon only pings when a real recent wall exists in the database",
  /\.gte\("last_at", new Date\(Date\.now\(\) - 2 \* 60 \* 1000\)\.toISOString\(\)\)/.test(srcRateLimit));
check("…and the alert's words come from that row, so a caller cannot compose an alert",
  /the ping's content comes only\s*\n?\/\/ from that DB row/.test(srcRateLimit));
check("the staff-login wall is the ONE silent alert; every other ping is audible",
  /silent: key === "staff_login"/.test(srcRateLimit));
check("the admin-login warning does not promise a wait that is not real",
  /Nobody is locked out — this is just a heads-up/.test(srcRateLimit));
check("every rate key has a name a person would recognise",
  (() => { const labels = srcRateLimit.slice(srcRateLimit.indexOf("const RATE_LABELS"), srcRateLimit.indexOf("// How long the window"));
    const keys = (srcRateLimit.match(/\| "([a-z_]+)"/g) || []).map((m) => m.slice(3, -1));
    return keys.every((k) => labels.includes(`${k}:`)); })());
check("the alert names WHO, WHERE, how many tries and which device",
  /\["Who", who\][\s\S]{0,200}?\["Where", where\][\s\S]{0,200}?\["Tries", tries\][\s\S]{0,200}?\["Device"/.test(srcRateLimit));
check("…and it does not repeat the restaurant when the 'who' line already names it",
  /!who\.includes\(extra\.restaurant\)/.test(srcRateLimit));
check("a subject is normalised so '  Ravi ' and 'ravi' share one counter",
  /\.trim\(\)\.toLowerCase\(\)\.slice\(0, 120\)/.test(srcRateLimit));
check("every value that reaches the database is length-capped", (srcRateLimit.match(/\.slice\(0, 200\)/g) || []).length >= 4);
check("an alert can never break a login — every path is swallowed", (srcRateLimit.match(/best-effort/g) || []).length >= 3);

check("one typed name can no longer become an unbounded read", /\.limit\(MAX_LOGIN_CANDIDATES\)/.test(srcUserAuth));
check("…nor an unbounded slow-hash loop, since only the rows fetched are verified",
  /for \(const u of live\) \{\s*\n\s*if \(await verifySecret/.test(srcUserAuth));
check("…and reaching that ceiling is said out loud, because a login that quietly stopped matching is the worst way to find out",
  /matches \$\{MAX_LOGIN_CANDIDATES\}\+ accounts/.test(srcUserAuth));
check("a recycle-bin account is not a login", /\.is\("deleted_at", null\)/.test(srcUserAuth));
check("a disabled person who types the RIGHT password is told the truth",
  /This login has been disabled\. Speak to your manager or owner\./.test(srcUserAuth));
check("…and only a verified password unlocks that message, so guessing names learns nothing",
  /u\.active !== true && await verifySecret/.test(srcUserAuth));
check("a database blip during a login says 'try again', never 'wrong password'",
  /Can't reach the server — try again in a moment/.test(srcUserAuth));
check("an oversize name or password is refused BEFORE the slow hash burns any CPU",
  srcUserAuth.indexOf("MAX_USERNAME_LEN") < srcUserAuth.indexOf("verifySecret(String(password)"));
check("a lockout on any matching live row is honoured, so a colliding name cannot dodge it",
  /Honour a lockout on ANY matching live row/.test(srcUserAuth));
check("a cookie carries the role and the token version, so both can end a session",
  /hmac\(`\$\{u\.id\}:\$\{u\.role\}:\$\{u\.token_version\}:\$\{iat\}`\)/.test(srcUserAuth));
check("a cookie past seven days is refused", /if \(Date\.now\(\) - iat > TOKEN_TTL_MS\) return null/.test(srcUserAuth));
check("a missing signing key is warned about once per server start, not silently tolerated",
  /warnedNoSessionSecret/.test(srcUserAuth));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
head("G · the two documents I own still describe the product that exists");
// A rulebook that has gone stale is worse than no rulebook: somebody builds a thing twice, or
// leaves a thing unbuilt because the page says it is done. Every claim below is checked against
// the code or the migration file it names.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const migrations = (await import("node:fs")).readdirSync(join(root, "supabase/migrations"));
const hasMig = (n) => migrations.some((f) => f.startsWith(`${n}_`));

check("the rulebook no longer says rule 11 is unbuilt", !/NOT BUILT YET/.test(docCompliance));
check("…and it names the migration file that built it", /365_reopen_puts_the_table_back_not_the_bill\.sql/.test(docCompliance));
check("…as a MIGRATION FILE, in the owner's own required words", /365_reopen_puts_the_table_back_not_the_bill\.sql`[^\n]*\(a migration file\)|— a migration file —/.test(docCompliance));
check("that migration file actually exists", hasMig("365"));
check("…and it creates the function the rulebook names", /create or replace function lfh_reopen_table/.test(read("supabase/migrations/365_reopen_puts_the_table_back_not_the_bill.sql")));
check("the rulebook is honest that lfh_void_invoice was NOT loosened", /Migration 365 did NOT loosen `lfh_void_invoice`/.test(docCompliance));
check("…which matches the migration, whose own body only touches lfh_reopen_table",
  !/lfh_void_invoice/.test(read("supabase/migrations/365_reopen_puts_the_table_back_not_the_bill.sql").split("create or replace function")[1] || ""));
check("the reopen refuses when every order on the bill was cancelled", /LFH04/.test(read("supabase/migrations/365_reopen_puts_the_table_back_not_the_bill.sql")));
check("…and when another party is already on that table", /another party is sitting at that table/.test(read("supabase/migrations/365_reopen_puts_the_table_back_not_the_bill.sql")));
check("…and it is staff-only, per the mig-038 rule that a replaced function is public again by default",
  /revoke all on function lfh_reopen_table/.test(read("supabase/migrations/365_reopen_puts_the_table_back_not_the_bill.sql")));
check("the act has a home in the Activity log, so it never reads 'System › Other'",
  /table_reopened: \{ area: "Orders & bills", screen: "Reopen the table" \}/.test(read("lib/logTrail.ts")));
check("…and it is a DIFFERENT sentence from voiding a live bill's invoice",
  /invoice_void: \{ area: "Orders & bills", screen: "Reopen the bill" \}/.test(read("lib/logTrail.ts")));
check("the section's own preamble no longer says one of the four rules is still to build",
  !/the fourth is the next thing to build/.test(docCompliance));
check("§3.0 still states the rule everything hangs off: a sale can be cancelled, never made to disappear",
  /A sale can be cancelled\. A sale can never disappear/i.test(docCompliance));
check("§3.0 still says nobody at the restaurant has a button that removes a bill", /R27/.test(docCompliance));
check("the compliance doc still names the purge that ships", /admin_purge_restaurant/.test(docCompliance));
check("the purge that ships names no money table",
  ["orders", "order_items", "sessions", "payments", "session_payments", "credit_notes", "invoice_events", "deletion_audit"]
    .every((t) => !new RegExp(`delete from ${t}\\b`).test(read("supabase/migrations/369_a_purge_clears_the_pending_printer_handshakes.sql"))));
check("…and it keeps the restaurants row, marked, so the kept bills still have a parent",
  /update restaurants set purged_at = now\(\)/.test(read("supabase/migrations/369_a_purge_clears_the_pending_printer_handshakes.sql")));
check("the newest purge migration clears the pending printer handshakes",
  /delete from print_pairings\s+where restaurant_id = p_rid/.test(read("supabase/migrations/369_a_purge_clears_the_pending_printer_handshakes.sql")));
check("…and it exists as a file, not only in a commit message", hasMig("369"));
check("the efficiency playbook's 'cap the userAuth candidate loop' really is capped now",
  /MAX_LOGIN_CANDIDATES = \d+/.test(srcUserAuth));
check("the playbook still names egress, not effort, as this product's cost", /egress/i.test(docPlaybook));
check("no money path spells a tax rate out instead of asking lib/tax.ts", (() => {
  const hits = [];
  for (const [n, s] of [["paySplit", srcPaySplit], ["tax", srcTax]]) {
    const stripped = s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    if (/=\s*0\.05\b/.test(stripped) && n !== "tax") hits.push(n);
  }
  return hits.length === 0;
})());
check("the ONE fallback rate lives in exactly one place in the TypeScript",
  // Block comments stripped as well as line ones: the doc comment above the function explains the
  // rate in words and would otherwise count as a second declaration of it.
  (srcTax.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").match(/0\.05/g) || []).length === 1);
check("…and the columns needed to read a rate are a named constant, never a hand-written subset",
  /export const TAX_SETTINGS_COLUMNS = "tax_rate, tax_components, price_tax_mode"/.test(srcTax));
check("lib/paySplit.ts reads the rate through that constant", /TAX_SETTINGS_COLUMNS/.test(srcPaySplit));
check("…and takes each order's own charged rate from the same definition the printed bill uses",
  /BILLDOC\.orderTaxRate\(o, settingsRate\)/.test(srcPaySplit));
check("the split's due is recomputed on the server, never taken from the browser",
  /the browser's number is never trusted/.test(srcPaySplit));
check("the parts are rounded ONCE, and that same rounding is what gets stored",
  /One rounding, used for the\s*\n\s*\/\/ check AND for the row/.test(srcPaySplit));
check("a settle that cannot be stamped reverses its own money rows rather than claiming money nobody took",
  /THE TRAIL MUST NOT CLAIM MONEY THAT WAS NEVER TAKEN/.test(srcPaySplit));
check("…and still answers 500, so the person knows to try again", /return \{ ok: false, message: upd\.error\.message, status: 500 \}/.test(srcPaySplit));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log(
  fails.length
    ? `\n✗ FAIL — ${pass} checks passed, ${fails.length} failed:\n   ${fails.join("\n   ")}\n`
    : `\n✓ PASS — ${pass} checks passed, 0 failed   (ids P26601–P${nextId - 1})\n`,
);
process.exit(fails.length ? 1 : 0);
