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
import { repoRootFrom } from "./sweep/repoRoot.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

// The repo to scan: the first argument that really IS one, else the repo this file lives in.
// It used to be plain `process.argv[2]`, so `-- --base http://localhost:4228` — which every
// sweep lane passes to every guard — made this scan a folder called "--base" and exit 1.
// (T28, sweep #7, 2026-08-29; the same fault as verify:test-safety's, in eight more guards.)
const ROOT = repoRootFrom(import.meta.url);
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
    /function splitTo\(n\)/, /Math\.floor\(\(due \/ n\) \* 100 \+ 1e-6\) \/ 100/],

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

// ── THREE THINGS HE FOUND ON THE SCREEN, 2026-08-29 ──────────────────────────────────────────
// Sent with two screenshots of the manager's split sheet. None of them was caught by anything here,
// because every rule above is about the MONEY and these three are about the SCREEN LYING to the
// person using it — which is the same kind of wrong.
{
  // 1 · "Whenever I do from two part two, add another part. It should switch from 2 to 3. There are
  //     3 % now, so it is not doing that." The count chips were set inside splitTo() only, so they
  //     followed the CHIP you tapped and not the number of parts. His screenshot: three rows filled
  //     in, "2" still highlighted. A number that contradicts what is under it is worse than none.
  want(/function syncSplitCount\(\)/.test(MGR) && /classList\.toggle\("sel", Number\(b\.dataset\.n\) === legs\.length\)/.test(MGR),
    "manager: the 'how many are paying' count is worked out from the NUMBER OF PARTS, not from the last chip tapped");
  want(/syncSplitCount\(\);\s*\/\/ the chips follow the rows/.test(MGR),
    "manager: …and it is re-run by renderSplit(), so every way of adding or removing a part inherits it");
  // the tablet already did this — both places it changes legs also set n. Asserted so it stays true.
  want(/legs\.splice\(i, 1\); n = legs\.length;/.test(TAB) && /n = legs\.length;[\s\S]{0,120}?render\(\);/.test(TAB),
    "tablet: its own part count follows the rows on both add and remove (it already did — kept true)");

  // 2 · The amount box refused paise. His screenshot carries the browser's own words: "Please enter
  //     a valid value. The two nearest valid values are 9 and 10." on 9.9. step="1" on a money box
  //     that THIS SCREEN fills with 153.29 — it was refusing the numbers it had just written.
  for (const [who, src, cls] of [["manager", MGR, "psr-amt"], ["tablet", TAB, "sb-amt"]]) {
    want(new RegExp(`step="0\\.01"[^>]*class="[^"]*${cls}`).test(src) || new RegExp(`class="[^"]*${cls}[^"]*"[\\s\\S]{0,120}?step="0\\.01"`).test(src)
      || new RegExp(`step="0\\.01"[\\s\\S]{0,120}?${cls}`).test(src),
      `${who}: a split amount box accepts PAISE — an even split of ₹459.90 three ways is 153.29/153.29/153.32, and the box must not refuse what the screen itself wrote`);
    want(!new RegExp(`step="1"[\\s\\S]{0,120}?${cls}`).test(src),
      `${who}: …and it is not back to whole rupees`);
  }

  // 3 · "you have asked for a mobile number and that already, then why are you asking right now
  //     again? … If it is asked, it should be autofill because I have already filled it previously."
  for (const [who, src] of [["manager", MGR], ["tablet", TAB]]) {
    want(/knownCust:/.test(src) && /sess\.cust_phone/.test(src),
      `${who}: the pay sheet is TOLD who this table's customer already is, read from the session the same way the bill sheet reads it`);
    want(/opts\.knownCust && opts\.knownCust\.phone \?/.test(src),
      `${who}: …and when there is one, it shows it as a fact instead of asking for it a second time`);
    want(/pay-cust-change/.test(src),
      `${who}: …with one way to change it`);
    want(/pay-cust-phone[^>]*value="\$\{esc\(k\.phone \|\| ""\)\}"|value="\$\{esc\(k\.phone \|\| ""\)\}"/.test(src),
      `${who}: …and Change opens PRE-FILLED, never an empty box that invites a different number onto one bill`);
  }
}

// And the thing the merge was FOR: the tablet must not grow a second split screen again.
want(!/function openSplitPay\b/.test(TAB) && (TAB.match(/pay-split-nrow/g) || []).length === 0,
  "tablet: there is ONE split screen, not a copy inside the pay sheet as well (owner, 2026-08-28)");


// ─────────────────────────────────────────────────────────────────────────────────────────────
// 7 · EVERY SHAPE A BROWSER COULD SEND, judged by the REAL rule (split-bill 500, 2026-08-29)
//
// The sections above check that the rule is WRITTEN. This one CALLS it, once per shape, so a
// rewrite of badSplitShape that still reads right but behaves differently is caught. Only the
// failures print — a wall of ninety ticks buries the one line that matters.
// ─────────────────────────────────────────────────────────────────────────────────────────────
head("7 · every shape a browser could send, judged by the real rule");
{
  let quiet = 0, loud = failed;
  const q = (c, m, got) => { if (c) quiet++; else bad(m, got); };
  const leg = (amount, method = "Cash") => ({ amount, method });
  const named = (m) => (m === ps.PAY_LATER ? { amount: 50, method: m, khataName: "Ravi" } : leg(50, m));
  const good = (a) => shape(a) === null;
  const refused = (a) => typeof shape(a) === "string";

  for (const m of ps.SPLIT_METHODS.filter((x) => x !== ps.PAY_LATER))
    q(good([leg(100, m), leg(100, m)]), `two parts both paid by ${m} are accepted`);
  for (const mix of [["Cash", "UPI"], ["UPI", "Card"], ["Card", "Other"], ["Other", ps.PAY_LATER],
                     [ps.PAY_LATER, "Cash"], ["UPI", ps.PAY_LATER], ["Cash", "Cash"], ["Card", "Card"],
                     ["Other", "UPI"], ["UPI", "UPI"]])
    q(good([named(mix[0]), named(mix[1])]), `a bill paid ${mix[0]} + ${mix[1]} is accepted`);
  for (let n = 2; n <= 12; n++) q(good(Array.from({ length: n }, () => leg(10))), `${n} parts are accepted`);
  for (const n of [13, 16, 20, 50, 400])
    q(refused(Array.from({ length: n }, () => leg(10))), `${n} parts is refused — twelve is the most a bill can be cut into`);
  for (const a of [0.01, 0.05, 0.5, 1, 9.9, 99.99, 100, 1234.56, 99999.99])
    q(good([leg(a), leg(a)]), `a part of ₹${a} is accepted`);

  // Each of these is a different way a browser, a retry or a bad connection could send nonsense.
  const REFUSE = [
    ["nothing at all", undefined], ["null", null], ["a plain number", 5], ["a word", "two"],
    ["an object, not a list", { a: 1 }], ["an empty list", []], ["one part only — that is not a split", [leg(100)]],
    ["a part with no amount", [{ method: "Cash" }, leg(100)]], ["a part with no way to pay", [{ amount: 100 }, leg(100)]],
    ["a part that is not an object", ["100", leg(100)]], ["a null part", [null, leg(100)]],
    ["an amount of zero", [leg(0), leg(100)]], ["a negative amount", [leg(-10), leg(110)]],
    ["an amount typed as a word", [leg("abc"), leg(100)]], ["an amount that is Not a Number", [leg(NaN), leg(100)]],
    ["a negatively endless amount", [leg(-Infinity), leg(100)]], ["an amount as an empty string", [leg(""), leg(100)]],
    ["an amount as an object", [leg({ v: 100 }), leg(100)]],
    ["a way to pay nobody offers", [leg(50, "Bitcoin"), leg(50)]], ["a way to pay that is empty", [leg(50, ""), leg(50)]],
    ["a way to pay that is a number", [leg(50, 7), leg(50)]], ["a way to pay that is null", [leg(50, null), leg(50)]],
    ["a way to pay in the wrong case", [leg(50, "cash"), leg(50)]],
    ["a way to pay with spaces round it", [leg(50, " Cash "), leg(50)]],
    ["a note longer than any real note", [{ amount: 50, method: "Cash", note: "x".repeat(300) }, leg(50)]],
  ];
  for (const [label, sh] of REFUSE) q(refused(sh), `refused: ${label}`);
  // A refusal nobody can read is a refusal nobody can act on.
  for (const [label, sh] of REFUSE) {
    const msg = shape(sh);
    q(typeof msg === "string" && msg.length > 8 && /[a-z] [a-z]/.test(msg),
      `…and "${label}" is refused in a sentence, not a code`, msg);
  }
  // The tab rules, called rather than read.
  q(/needs a person/.test(shape([leg(50, ps.PAY_LATER), leg(50)]) || ""),
    "a tab with nobody's name on it is refused — a debt cannot belong to no one");
  q(good([{ amount: 50, method: ps.PAY_LATER, khataName: "Ravi" }, leg(50)]), "…and the same tab WITH a name is accepted");
  q(good([{ amount: 50, method: ps.PAY_LATER, khataCustomerId: "abc" }, leg(50)]), "…or with someone already in the book");
  q(/Only one part/.test(shape([{ amount: 50, method: ps.PAY_LATER, khataName: "A" },
                                { amount: 30, method: ps.PAY_LATER, khataName: "B" }, leg(20)]) || ""),
    "only ONE part may be a tab, so a debt cannot be recorded against the wrong person");
  q(refused([leg(100, ps.PAY_LATER), leg(100, ps.PAY_LATER)]),
    "a bill cannot be ENTIRELY on a tab — that is the whole-bill Pay Later button, not a split");
  // Same question, same answer, every time: no hidden state between calls.
  for (let i = 0; i < 10; i++)
    q(shape([leg(50), leg(50)]) === shape([leg(50), leg(50)]) && shape([leg(0)]) === shape([leg(0)]),
      `the same shape judged twice gives the same answer (${i + 1})`);
  // WHAT IS DELIBERATELY *NOT* REFUSED HERE, and why that is safe. JavaScript turns `[100]` into
  // 100 and `true` into 1, and a huge or over-precise amount is a perfectly good number. None of
  // them can change what is collected: the parts still have to equal the due the SERVER worked out,
  // and that gate is two lines below badSplitShape's caller. Refusing them here would only move
  // the same "no" one layer earlier — so this records the reasoning instead of pretending.
  q(good([leg([100]), leg(100)]) && Number([100]) === 100,
    "an amount written as a one-item list becomes a definite number, and still has to match the bill");
  q(good([leg(true), leg(100)]) && Number(true) === 1, "an amount written as true becomes ₹1, and still has to match the bill");
  q(good([leg(1e15), leg(1)]), "an amount bigger than any real bill passes the shape check and is stopped by the total");
  q(good([leg(10.005), leg(10)]), "an amount finer than paise passes the shape check and is rounded before anything is written");
  q(good([leg(Infinity), leg(100)]) && /Number\.isFinite\(sum\)/.test(PS),
    "an endless amount is stopped by the TOTAL gate, not the shape gate — and that line exists");
  if (failed === loud) ok(`${quiet} shapes judged, every one as it should be`);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 8 · AN EVEN SPLIT ALWAYS ADDS BACK UP TO THE BILL (split-bill 500, 2026-08-29)
//
// The panel fills the boxes in evenly, and the server refuses parts that miss the due by more than
// two paise. So the fill formula and the gate have to agree on EVERY bill, not just round ones —
// ₹483 ÷ 7 does not divide, and neither does ₹0.05 ÷ 6.
//
// The formula is READ OUT OF THE PANEL rather than retyped here, because a guard that re-implements
// the rule it checks proves nothing about the rule that ships. If the panel's line changes, the
// first check below goes red and the property below it is re-derived from the new line.
// ─────────────────────────────────────────────────────────────────────────────────────────────
head("8 · an even split of any bill adds back up to that bill");
{
  let quiet = 0, loud = failed;
  const q = (c, m, got) => { if (c) quiet++; else bad(m, got); };
  const MGRSRC = read("public/panels/editor/app.js");
  // The nudge is part of the formula, not an optional extra — without it ₹555.55 ÷ 5 fills in as
  // 111.10 × 4 + 111.15, and one person pays the other four's rounding. See the panel's own note.
  const floorEach = /const each = Math\.floor\(\(due \/ n\) \* 100 \+ 1e-6\) \/ 100;/.test(MGRSRC);
  const lastCarries = /Math\.round\(\(due - each \* \(n - 1\)\) \* 100\) \/ 100 : each/.test(MGRSRC);
  want(floorEach, "the panel fills each part by rounding down to the paisa, with the nudge that stops a binary hair short of a paisa becoming a whole paisa short");
  want(lastCarries, "…and the LAST part carries the remainder, which is what makes the parts equal the bill exactly");
  if (floorEach && lastCarries) {
    // byte-for-byte the panel's two lines
    const evenSplit = (due, n) => {
      const each = Math.floor((due / n) * 100 + 1e-6) / 100;
      return Array.from({ length: n }, (_, i) => (i === n - 1 ? Math.round((due - each * (n - 1)) * 100) / 100 : each));
    };
    const DUES = [0.05, 1, 1.01, 2, 3, 5, 7, 9.99, 10, 10.01, 12.34, 20, 33.33, 49.5, 50, 66.67, 75, 99.99, 100,
      100.01, 101, 123.45, 150, 199.99, 200, 222.22, 250, 299.99, 300, 333.33, 350, 400, 449.5, 483, 500, 555.55,
      600, 666.66, 700, 777.77, 800, 850.5, 900, 999.99, 1000, 1001, 1234.56, 1500, 1999.99, 2000, 2500, 3333.33,
      5000, 7777.77, 9999.99, 10000, 12345.67, 20000, 50000, 99999.99, 123456.78];
    for (const due of DUES) for (let n = 2; n <= 12; n++) {
      const parts = evenSplit(due, n);
      const sum = Math.round(parts.reduce((a, x) => a + x, 0) * 100) / 100;
      // the server's own tolerance, from lib/paySplit.ts
      q(Math.abs(sum - due) <= 0.02, `₹${due} split ${n} ways adds back up to ₹${due} — the server would accept it`, sum);
      if (due >= n * 0.01) {
        q(parts.every((x) => x > 0), `₹${due} split ${n} ways gives ${n} parts, none of them zero or negative`, parts);
        q(Math.max(...parts) - Math.min(...parts) <= n * 0.01,
          `₹${due} split ${n} ways is fair — no part is more than a few paise off the others`, parts);
      }
    }
    if (failed === loud) ok(`${quiet} even splits proved — ${DUES.length} different bills, every part count from 2 to 12`);
  }
}

console.log(failed
  ? `\n✗ ${failed} check(s) failed — split payment does not hold its rules\n`
  : "\n✓ split payment is still mark-paid, and a tab is still a tab\n");
process.exit(failed ? 1 : 0);
