// verify:split-payment — the guard for "split payment is mark-paid, and one part may be a tab".
//
// WHERE THIS BITES: manager panel and waiter tablet → a table → Mark paid → **Split payment**;
// and afterwards owner → Pay Later (and the manager's khata book), which has to owe the REMAINDER
// of a split bill rather than the whole of it.
//
// WHY IT EXISTS (owner, 2026-08-21). Split payment already existed but was two taps deep under
// "Other" and opened with empty boxes, so nobody used it. It now fills the amounts in evenly as a
// starting point, keeps every box editable, and lets each part pick its own way to pay — including
// Pay later, which puts that slice on a person's tab (migration 352). The rules below are the ones
// that make that safe, and every one of them is a number or a sentence a person could be wronged by:
//
//   · the parts must add up to the bill the SERVER recomputed — never the browser's figure,
//   · one rounding feeds the check AND the stored row, so what was agreed is what is recorded,
//   · a tab has to be owed by a named person, and only one part per bill may be a tab,
//   · a bill with a tab is NOT stamped paid — money that never arrived is never claimed,
//   · …but the table still closes, exactly like Mark paid,
//   · the book owes bill − what was collected alongside the tab, and nothing else,
//   · collecting the tab later re-labels that part with the way the money actually arrived.
//
// STATIC: it reads files and runs the real exported rule. No browser, no database, nothing to clean
// up.   node scripts/verify-split-payment.mjs

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const ROOT = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return ""; } };
// `@/x` → <ROOT>/x, so the real lib/paySplit.ts can be imported and CALLED. A guard that
// re-implements the rule it checks proves nothing about the rule that ships.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith("@/")) {
      let p = join(ROOT, spec.slice(2));
      if (!existsSync(p)) for (const e of [".ts", ".tsx", ".js", ".mjs"]) if (existsSync(p + e)) { p += e; break; }
      return next(pathToFileURL(p).href, ctx);
    }
    return next(spec, ctx);
  },
});

let failed = 0;
const ok = (m) => console.log("  ✓ " + m);
const bad = (m, got) => { console.log("  ✗ " + m + (got === undefined ? "" : `  → ${JSON.stringify(got)}`)); failed++; };
const want = (c, m, got) => (c ? ok(m) : bad(m, got));
const head = (t) => console.log("\n" + t);

const PS = read("lib/paySplit.ts");
const ED = read("app/api/editor/[...path]/route.ts");
const TB = read("app/api/tablet/[...path]/route.ts");
const MGR = read("public/panels/editor/app.js");
const TAB = read("public/panels/tablet/app.js");
const MIG = read("supabase/migrations/364_a_split_part_can_be_pay_later.sql");   // renumbered 352→364, a duplicate number
const ps = await import("@/lib/paySplit.ts");

console.log("\nSplit payment: is it still mark-paid, with one part allowed to be a tab?");

// ── 1 · the rule, executed ─────────────────────────────────────────────────────────────────
head("1. the rules the server enforces (the real exported function, not a copy)");
want(ps.PAY_LATER === "Pay later", "the tab method has one spelling, exported from one place", ps.PAY_LATER);
want(ps.SPLIT_METHODS.includes("Pay later") && ps.SPLIT_METHODS.length === 5,
  "a split part may be UPI, Cash, Card, Other or Pay later", ps.SPLIT_METHODS);
{
  const m = read("lib/payments.ts");
  want(!/Pay later/.test(m),
    "…and 'Pay later' is NOT a whole-bill payment method — that would record money nobody collected");
}
const shape = (parts) => ps.badSplitShape(parts);
want(/needs a person/i.test(String(shape([{ amount: 10, method: "Cash" }, { amount: 10, method: "Pay later" }]))),
  "a tab with nobody to owe it is refused — that is the one way a debt disappears");
want(shape([{ amount: 10, method: "Cash" }, { amount: 10, method: "Pay later", khataName: "R" }]) === null,
  "a tab WITH a person is accepted");
want(shape([{ amount: 10, method: "Cash" }, { amount: 10, method: "Pay later", khataCustomerId: "abc" }]) === null,
  "…and an existing person's id is accepted too");
want(/Only one part can be pay-later/.test(String(shape([
  { amount: 10, method: "Pay later", khataName: "A" }, { amount: 10, method: "Pay later", khataName: "B" },
  { amount: 10, method: "Cash" }]))),
  "two tabs on one bill are refused out loud (the book names one person per bill)");
want(shape([{ amount: 10, method: "Pay later", khataName: "A" }, { amount: 10, method: "Pay later", khataName: "A" }]) !== null,
  "a split that is ENTIRELY tabs is refused — the whole bill on a tab is the Pay Later button");
// COMMENTS STRIPPED: the file EXPLAINS why the whole-bill case cannot arise, and a guard that
// matches its own explanation is a guard that accuses the prose instead of the code.
want(!/return "That is the whole bill on a tab/.test(PS.replace(/^\s*\/\/.*$/gm, "")),
  "…and that is enforced by the one-tab rule, not by a second unreachable branch returning the same thing");
want(/invalid payment method/.test(String(shape([{ amount: 10, method: "Crypto" }, { amount: 10, method: "Cash" }]))),
  "an unknown method is still refused");
want(shape([{ amount: 10, method: "Cash" }]) !== null, "one part is still not a split");

// ── 2 · the money rules in the shared write path ───────────────────────────────────────────
head("2. the money rules in lib/paySplit.ts");
want(/const parts = splits\.map\(\(s\) => \(\{ \.\.\.s, amount: r2\(Number\(s\.amount\)\) \}\)\)/.test(PS)
  && /const sum = r2\(parts\.reduce/.test(PS),
  "each part is rounded ONCE, and the ±2p gate checks the rounded parts, so what was agreed is what is recorded");
want(/Math\.abs\(sum - due\) > 0\.02/.test(PS) && /const due = r2\(sub - disc \+ tax\)/.test(PS),
  "the parts are measured against the SERVER's recomputed due, never the browser's number");
want(/const group = crypto\.randomUUID\(\);/.test(PS) && /settle_group: group/.test(PS),
  "every part of one tap shares a settle group, so the book subtracts only what arrived WITH the tab");
want(/khata_customer_id: isPayLater\(s\) \? customer!\.id : null/.test(PS),
  "only the tab part carries a person; the collected parts carry none");
want(/const upd = laterPart\s*\n\s*\? await sb\.from\("orders"\)\s*\n\s*\.update\(\{ khata_at: stamp/.test(PS),
  "a tab PARKS the bill (khata markers + archived) instead of stamping it paid");
want(/payment_status: "paid", paid_at: stamp, payment_method: "Split"/.test(PS),
  "…and with no tab it still stamps the bill paid, exactly as before");
want(!/payment_status: "paid"[\s\S]{0,200}khata_at: stamp/.test(PS),
  "a bill is never both paid AND on a tab — money that never arrived is never claimed");
want(/if \(upd\.error\) \{[\s\S]{0,900}?reversed_at: stamp/.test(PS),
  "a failed stamp REVERSES the parts it just recorded, so the trail never claims a settle that did not happen");
want(!/session_payments"\)\s*\n?\s*\.delete\(/.test(PS),
  "…by stamping them (mig 285), never by deleting a money record");
want(/a phone that already exists reuses that person|\.eq\("phone", phone\)/.test(PS),
  "a phone that already exists reuses that person rather than making a second row for one human");

// ── 3 · the gates, which live in the routes ────────────────────────────────────────────────
head("3. a tab still needs the pay-later permission, on both panels");
want(/String\(s\?\.method\) === PAY_LATER\)\) \{[\s\S]{0,300}?khataLadder\(rid\)[\s\S]{0,200}?managerCan\(g, rid, "khata"\)/.test(ED),
  "manager: a pay-later part needs the khata module AND the khata power, on top of mark_paid");
want((TB.match(/khataLadder\(rid\)\)\.effective[\s\S]{0,200}?tabletPerm\("tablet_khata"/g) || []).length >= 3,
  "tablet: both split doors gate a pay-later part the same way the Pay Later button does");
want(/if \(rSp\.parked && rSp\.sessionId\) \{[\s\S]{0,300}?closeSession\(/.test(ED)
  && (TB.match(/if \(rSp\.parked && rSp\.sessionId\) \{/g) || []).length >= 2,
  "a parked split closes the table on BOTH panels — split payment is mark-paid, the table frees");
want(/khata_park"/.test(ED) && /khata_park"/.test(TB),
  "…and the tab is recorded as a pay-later event too, so it reads in the book's own history");

// ── 4 · collecting the tab later ───────────────────────────────────────────────────────────
head("4. collecting the tab tells the truth afterwards");
want(/A TAB TAKEN AS PART OF A SPLIT IS NOW REAL MONEY/.test(ED)
  && /\.update\(\{ settled_at: nowIso\(\), method, note:/.test(ED),
  "collecting stamps the tab part settled and re-labels it with the way the money actually arrived");
want(/\.not\("khata_customer_id", "is", null\)\.is\("settled_at", null\)\.is\("reversed_at", null\)/.test(ED),
  "…and touches only the parts that are genuinely still owed");

// ── 5 · the migration ──────────────────────────────────────────────────────────────────────
head("5. migration 352");
want(/ADD COLUMN IF NOT EXISTS khata_customer_id uuid REFERENCES khata_customers\(id\)/.test(MIG)
  && /ADD COLUMN IF NOT EXISTS settled_at/.test(MIG) && /ADD COLUMN IF NOT EXISTS settle_group/.test(MIG),
  "it adds the three columns, all nullable, so no existing row changes meaning");
want(/GREATEST\(round\(sum\(oo\.due\), 2\) - COALESCE\(max\(sc\.collected\), 0\), 0\)/.test(MIG),
  "a bill's debt is what is left after what was collected on it, and never negative");
want(/AND sp\.settle_group IS NOT NULL[\s\S]{0,400}?owed\.khata_customer_id IS NOT NULL/.test(MIG),
  "only a settle group that STILL owes something is subtracted — an earlier settle on the same session is not");
want(!/delete from (orders|session_payments|sessions)\b/i.test(MIG.replace(/^\s*--.*$/gm, "")),
  "it deletes nothing");
want(/REVOKE ALL ON FUNCTION lfh_khata_outstanding\(uuid\[\], integer\)/.test(MIG)
  && /GRANT EXECUTE ON FUNCTION lfh_khata_outstanding\(uuid\[\], integer\) TO service_role/.test(MIG),
  "the re-issued functions keep their staff-only grants (new functions are PUBLIC by default)");
want(/pg_get_functiondef/.test(MIG),
  "…and it says the bodies were captured from the LIVE database, not copied from an older migration");

// ── 6 · the screen, on BOTH panels — the same RULES, not the same source ─────────────────────
//
// THIS SECTION USED TO RUN ONE SET OF LITERAL PATTERNS OVER BOTH FILES, AND THAT WAS WRONG BY
// 2026-08-28 (rewritten by T28, sweep #7, 2026-08-29 — it was red on clean main with 14 failures,
// every one of them about the tablet).
//
// The patterns described the MANAGER's implementation character for character — `function splitTo(n)`,
// `.psr-amt`, `SPLIT_WAYS`, `pay-split-byorder`. The tablet had a near-copy of that panel, so the
// same patterns happened to fit both. Then the owner said, on 2026-08-28:
//
//     "you can only split with the kot option or small written if you want split on billing at
//      bottom and both have same interface as the kot one"
//
// …and the tablet's duplicate panel was deleted. It now has ONE split screen, renderSplitBill(),
// reached from 🧾 KOT ▾ and from a small line at the bottom of the pay sheet. The file says why in
// its own words: "Keeping a second copy of a money screen is how the two drifted apart in the first
// place."
//
// So all fourteen failures were this guard defending a design he had just replaced — the same shape
// as verify:purge defending the 90-day wait he deleted. Nothing was wrong with the tablet. And the
// new screen is in places BETTER than the rules asked for: it divides by dish as well as by ticket,
// it takes each ticket's figure from billdoc.js (the same assembler the printed bill uses) rather
// than working it out again, it offers Pay later only when the restaurant has it AND the waiter may
// use it, and it DISABLES "By kitchen ticket" with a reason on a one-ticket bill instead of hiding
// the button.
//
// The rules themselves have not changed, so they are still all checked — asked of whichever screen
// each panel actually ships. A guard that names one panel's variables can only ever be right about
// one panel.
head("6. the screen holds the same rules on both panels");

// Each rule: [what a person would be wronged by, manager pattern, tablet pattern].
const RULES = [
  ["splitting is ONE tap from the pay sheet, not two deep under \"Other\"",
    /data-special="split"/,
    // the tablet reaches the same screen two ways, and both are one tap: the small line at the
    // bottom of the pay sheet, and 🧾 KOT ▾ (the owner named both on 2026-08-28)
    (t) => /pay-split-open/.test(t) && /kotop === "split"/.test(t) && /renderSplitBill\(/.test(t)],

  ["choosing how many parts fills the amounts in EVENLY",
    /function splitTo\(n\)/, /Math\.floor\(\(due \/ n\) \* 100\) \/ 100/],

  ["…with the last part absorbing the odd paise, so they add up exactly",
    /i === n - 1 \? Math\.round\(\(due - each \* \(n - 1\)\) \* 100\) \/ 100/,
    /out\[n - 1\] = round2\(due - each \* \(n - 1\)\)/],

  ["every amount stays editable, and typing does not re-render the row it is in",
    /\.psr-amt"\)\.oninput = \(e\) => \{ legs\[i\]\.amount = e\.target\.value; refreshSplitSum\(\); \}/,
    /\.sb-amt"\)\.oninput = \(e\) => \{ legs\[i\]\.amount = e\.target\.value; refreshSum\(\); \}/],

  ["every row can pick how that part is paid, Pay later included",
    /const SPLIT_WAYS = \["UPI", "Cash", "Card", "Other", PAY_LATER\]/,
    // BETTER on the tablet, and deliberately: Pay later is offered only when the restaurant has the
    // feature and this waiter may use it, because otherwise the server refuses a part the screen
    // offered — "a button that exists only to fail", in the file's own words.
    /const WAYS = \["UPI", "Cash", "Card", "Other"\]\.concat\(tabletKhataOn\(\) && tshow\("tablet_khata"\) \? \[PAY_LATER\] : \[\]\)/],

  ["a Pay later row asks WHO owes it",
    (t) => /psr-who/.test(t) && /Who owes this\?/.test(t),
    (t) => /sb-who-btn/.test(t) && /Who owes this\?/.test(t)],

  ["changing a row off Pay later drops the person, so a stale tab cannot be sent",
    /if \(legs\[i\]\.method !== PAY_LATER\) legs\[i\]\.khata = null;/,
    /if \(legs\[i\]\.method !== PAY_LATER\) legs\[i\]\.khata = null;/],

  ["the tab rules are said in words before the server has to refuse them",
    (t) => /Only one part can be pay-later/.test(t) && /Who owes this\?” on the pay-later part/.test(t),
    (t) => /Only one part can be pay-later/.test(t) && /Who owes this\?” on the pay-later part/.test(t)],

  ["the person travels with the part",
    /khataCustomerId: l\.khata\.customer_id \|\| null, khataName: l\.khata\.name \|\| null/,
    /khataCustomerId: l\.khata\.customer_id \|\| null, khataName: l\.khata\.name \|\| null/],

  ["the figure the waiter must MATCH prints its paise (₹1,018.50, not ₹1,019)",
    (t) => /const inrExact = /.test(t) && /add up to \$\{inrExact\(due\)\}/.test(t),
    (t) => /inrExact\(/.test(t) && /add up to \$\{inrExact\(due\)\}/.test(t)],

  ["it reuses the existing person picker rather than growing a second one",
    /openKhataPerson(Picker|Sheet)\(Number\(legs\[i\]\.amount\) \|\| 0, opts\.table\)/,
    /openKhataPersonSheet\(Number\(legs\[i\]\.amount\) \|\| 0, t\)/],

  ["the split can also be filled in BY KITCHEN TICKET — one part per ticket",
    /function splitByOrder\(\)/,
    (t) => /data-mode="ticket"/.test(t) && /const ticketAmounts = \(\)/.test(t)],

  ["…and a ONE-ticket bill is told why it cannot be divided that way, rather than being offered it",
    (t) => /pay-split-byorder/.test(t) && /length > 1 \?/.test(t),
    // the tablet leaves the tab visible and DISABLED with the reason on it, which is the better half
    // of this rule: a button that vanishes teaches nobody anything.
    (t) => /sb-tab-off/.test(t) && /This bill is one kitchen ticket — there is nothing to divide by/.test(t)],

  ["the last ticket absorbs the remainder, because a bill's tax rounds once and a ticket's rounds per ticket",
    /const last = Math\.round\(\(due - head\.reduce\(\(a, x\) => a \+ x, 0\)\) \* 100\) \/ 100;/,
    /return head\.concat\(\[round2\(due - head\.reduce\(\(a, x\) => a \+ x, 0\)\)\]\);/],

  ["a bill cannot be split into more parts than the server will take, and it says so",
    /os\.length > 12/,
    (t) => /const MAX_PARTS = 12;/.test(t) && /A bill can be split into at most \$\{MAX_PARTS\} parts\./.test(t)],

  ["each part is labelled with the ticket it is for",
    /label: o\.kot_no \? `KOT #\$\{o\.kot_no\}`/,
    /label: o\.kot_no != null \? `KOT #\$\{o\.kot_no\}`/],

  ["…and the row prints that label",
    /l\.label \? `<div/,
    /l\.label \? esc\(l\.label\) : `Person \$\{i \+ 1\}`/],

  ["the tickets it divides are the PAYABLE ones — nothing un-accepted, nothing already paid",
    /orders: os\.filter\(\(o\) => o\.status !== "received"\)/,
    // the tablet's one screen reads them itself instead of being handed them, which is one source
    // rather than two — the whole reason the duplicate panel was removed.
    /partyOrders\(t\)\.filter\(\(o\) => o\.payment_status !== "paid" && o\.status !== "cancelled" && o\.status !== "received"\)/],
];

const holds = (pat, src) => (typeof pat === "function" ? pat(src) : pat.test(src));
for (const [rule, mgrPat, tabPat] of RULES) {
  want(holds(mgrPat, MGR), `manager: ${rule}`);
  want(holds(tabPat, TAB), `tablet: ${rule}`);
}

// And the thing the merge was FOR: the tablet must not grow a second split screen again.
want(!/function openSplitPay\b/.test(TAB) && (TAB.match(/pay-split-nrow/g) || []).length === 0,
  "tablet: there is ONE split screen, not a copy inside the pay sheet as well (owner, 2026-08-28)");

console.log(failed
  ? `\n✗ ${failed} check(s) failed — split payment does not hold its rules\n`
  : "\n✓ split payment is still mark-paid, and a tab is still a tab\n");
process.exit(failed ? 1 : 0);
