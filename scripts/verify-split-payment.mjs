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
const MIG = read("supabase/migrations/352_a_split_part_can_be_pay_later.sql");
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

// ── 6 · the screen, on both panels ─────────────────────────────────────────────────────────
head("6. the screen says the same thing on both panels");
for (const [who, src] of [["manager", MGR], ["tablet", TAB]]) {
  want(/data-special="split"/.test(src),
    `${who}: Split payment is its own button on the grid, not two taps deep under "Other"`);
  want(/function splitTo\(n\)/.test(src) && /Math\.floor\(\(due \/ n\) \* 100\) \/ 100/.test(src),
    `${who}: tapping "how many" fills the amounts in evenly`);
  want(/i === n - 1 \? Math\.round\(\(due - each \* \(n - 1\)\) \* 100\) \/ 100/.test(src),
    `${who}: …with the last part absorbing the odd paise, so they add up exactly`);
  want(/\.psr-amt"\)\.oninput = \(e\) => \{ legs\[i\]\.amount = e\.target\.value; refreshSplitSum\(\); \}/.test(src),
    `${who}: every amount stays editable, and typing does not re-render the row it is in`);
  want(/const SPLIT_WAYS = \["UPI", "Cash", "Card", "Other", PAY_LATER\]/.test(src),
    `${who}: every row can pick any of the five ways to pay`);
  want(/psr-who/.test(src) && /Who owes this\?/.test(src),
    `${who}: a Pay later row asks WHO owes it`);
  want(/if \(legs\[i\]\.method !== PAY_LATER\) legs\[i\]\.khata = null;/.test(src),
    `${who}: changing a row off Pay later drops the person, so a stale tab cannot be sent`);
  want(/Only one part can be pay-later/.test(src) && /Who owes this\?” on the pay-later part/.test(src),
    `${who}: the tab rules are said in words before the server has to refuse them`);
  want(/khataCustomerId: l\.khata\.customer_id \|\| null, khataName: l\.khata\.name \|\| null/.test(src),
    `${who}: the person travels with the part`);
  want(/const inrExact = /.test(src) && /add up to \$\{inrExact\(due\)\}/.test(src),
    `${who}: the figure the waiter must MATCH prints its paise (₹1,018.50, not ₹1,019)`);
  want(/openKhataPerson(Picker|Sheet)\(Number\(legs\[i\]\.amount\) \|\| 0, opts\.table\)/.test(src),
    `${who}: it reuses the existing person picker rather than growing a second one`);
  want(/resolve\(\{ customer_id: pickedId, name:/.test(src),
    `${who}: …and that picker returns the name, so the row can print who owes it`);
}

console.log(failed
  ? `\n✗ ${failed} check(s) failed — split payment does not hold its rules\n`
  : "\n✓ split payment is still mark-paid, and a tab is still a tab\n");
process.exit(failed ? 1 : 0);
