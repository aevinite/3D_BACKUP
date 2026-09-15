#!/usr/bin/env node
// verify-t28-picked.mjs — the four properties behind the items the owner picked on 2026-09-15
// (sweep #9, terminal 28, items 9 to 12). Static: no server, no database, no login.
//
//   npm run verify:t28-picked
//
// Four different screens, one shape of fault: **a read that failed was reported as a fact.** Each of
// these was already the rule somewhere else in the same file, which is what makes them worth pinning
// rather than trusting — the fix is obvious once you see it, and so is the regression.
//
//   item 9  · a PUBLIC crash sink trusted a restaurant id nobody checked, so a broken client could
//             file a problem under any restaurant on the platform and the admin's Repair board
//             filter would show it there.
//   item 10 · "nobody has asked to be unblocked" was said when the read that would have told us
//             failed — and the screen never rendered that answer at all.
//   item 11 · four compute-on-view change-detectors collapsed to the value they give for "nothing
//             has ever happened here" when their read failed, so a recorded salary or purchase
//             stopped invalidating the snapshot. Each one was ADDED to notice exactly that.
//   item 12 · the audit of a guest erasure named two tables out of six, by hand, beside an erase
//             that has walked a declared list since improvement I15.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };
// Comments are stripped before anything is matched — every fix in this repo carries a long comment
// quoting the code it replaced, so matching raw text makes a check pass on its own documentation.
const code = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");

let pass = 0; const fails = [];
const ok = (m) => { pass++; if (!process.env.QUIET) console.log(`  ok   ${m}`); };
const fail = (m) => { fails.push(m); console.log(`  FAIL ${m}`); };
const need = (cond, good, bad) => (cond ? ok(good) : fail(bad));

console.log("\nT28's picked items — a read that failed is never reported as a fact\n");

// ── item 9 · the public crash sink ──────────────────────────────────────────────────────────────
{
  const src = code(read("app/api/log/client-error/route.ts"));
  need(/function agreedRid\(/.test(src),
    "item 9 · the crash sink decides the restaurant through one resolver, not from the body",
    "item 9 · agreedRid() has gone — a supplied restaurant id is trusted again on a PUBLIC endpoint");
  // SCOPED TO THE FUNCTION'S OWN BODY, not the file. Written loosely first, and sabotage found it:
  // replacing the disagreement branch with `return claimed` left `return fromAddress;` present
  // elsewhere in the function (the no-claim case), so a file-wide test passed over the exact fault.
  const fn = (() => {
    const i = src.indexOf("async function agreedRid(");
    if (i < 0) return "";
    const j = src.indexOf("\nexport async function POST", i);
    return src.slice(i, j > 0 ? j : src.length);
  })();
  // Its three answers, in order: no claim → the address; the address agrees or names nobody → the
  // claim; otherwise → the ADDRESS, and the claim is dropped.
  const iNoClaim = fn.indexOf("if (!claimed) return fromAddress;");
  const iAgree = fn.search(/if \(!fromAddress \|\| fromAddress === claimed\) return claimed;/);
  const iWins = fn.lastIndexOf("return fromAddress;");
  need(iAgree > -1 && iAgree > iNoClaim && iNoClaim > -1,
    "item 9 · …a claim is kept only where the address agrees, or names nobody (every panel report)",
    "item 9 · the claim/address agreement test is gone from agreedRid — a report can name any restaurant again");
  need(iWins > iAgree && iAgree > -1,
    "item 9 · …and the ADDRESS wins a disagreement, because a page cannot be wrong about its own door",
    "item 9 · agreedRid's LAST answer is no longer the address — a claim that contradicts the page it came from is being kept");
  // And BOTH branches must use it — the tap batches were the half that escaped the first time.
  const uses = (src.match(/agreedRid\(/g) || []).length;
  need(uses >= 3, `item 9 · …on both the error row and the tap batch (${uses} uses of the resolver)`,
    `item 9 · only ${uses} use(s) of agreedRid — one of the two write branches is filing an unchecked id`);
  // It must never REFUSE: losing a crash report is worse than mislabelling one.
  need(!/agreedRid[\s\S]{0,400}status:\s*4\d\d/.test(src),
    "item 9 · …and it never refuses the report over its label — this endpoint fails soft by design",
    "item 9 · a report can now be REFUSED over its restaurant label; a fault nobody hears about is the thing this endpoint exists to prevent");
}

// ── item 10 · the blocked device ────────────────────────────────────────────────────────────────
{
  const src = code(read("app/api/blocked/route.ts"));
  need(/let pending: boolean \| null = false;/.test(src),
    "item 10 · \"is there an open request?\" can answer \"we could not look\"",
    "item 10 · `pending` is a plain boolean again, so a failed read reads as \"you haven't asked\"");
  need(/if \(q\.error\)[\s\S]{0,200}pending = null;/.test(src),
    "item 10 · …and a failed read is what sets it, not a silent false",
    "item 10 · the failed-read branch no longer sets pending to null");
  need(/pendingUnknown: true/.test(src),
    "item 10 · …and the screen is told, on the one answer where it is true",
    "item 10 · `pendingUnknown` no longer rides along, so the screen cannot tell the two apart");
  // The asymmetry this file is built on must survive: page opens on doubt, write refuses on doubt.
  const get = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function POST"));
  const post = src.slice(src.indexOf("export async function POST"));
  need(/await usedToday\(ip\)\s*:\s*0\)\s*\?\?\s*0/.test(get) && /if \(used === null\)[\s\S]{0,200}status:\s*503/.test(post),
    "item 10 · …and the old asymmetry stands: the page renders on doubt, the WRITE refuses on doubt",
    "item 10 · the page/write asymmetry has changed — a limiter whose counter breaks must still limit");

  const view = code(read("app/staff-login/BlockedView.tsx"));
  need(/status\?\.pending === true/.test(view),
    "item 10 · the card actually RENDERS that answer (it read it and drew nothing for years)",
    "item 10 · app/staff-login/BlockedView.tsx ignores `pending` again — a waiting person is offered the button twice");
  need(/already asked/i.test(view),
    "item 10 · …in words, so somebody who asked an hour ago is told so after a reload",
    "item 10 · the \"you've already asked\" line has gone from the blocked card");
  // A check that cannot fail is worse than no check (item 7 of the last branch was exactly that), so
  // this one asserts something real: the card must not print a sentence ABOUT the unknown case. It
  // is told (`pendingUnknown` is in its type) so it can stay quiet — and quiet is the right answer,
  // because "you may or may not have already asked" helps nobody and the person can just press it.
  need(/pendingUnknown\?: boolean/.test(view) && !/(may have|might have|not sure|couldn.t check)/i.test(view),
    "item 10 · …and it stays QUIET when we could not look, rather than guessing out loud",
    "item 10 · the blocked card has started saying something about the case where we could not look — quiet is the answer there");
}

// ── item 11 · the change-detectors ──────────────────────────────────────────────────────────────
// Each of these is the ONLY thing that notices a payment, a purchase or an expense for its screen.
// A detector that cannot look must answer with something that DIFFERS, so the snapshot recomputes —
// never with the value it would give for "nothing has ever happened here".
{
  // EACH DETECTOR IS READ INSIDE ITS OWN FUNCTION, and the value it must produce is named.
  // Written file-wide first, and sabotage found it: deleting the whole error branch out of
  // `fpWithStaffPay` left the word "unread" in that file anyway (`recordsUnread`, a different
  // thing entirely), so a file-wide count passed over the exact fault it was written for.
  const body = (src, startRe, endRe) => {
    const i = src.search(startRe);
    if (i < 0) return "";
    const rest = src.slice(i + 1);
    const j = rest.search(endRe);
    return src.slice(i, j > 0 ? i + 1 + j : src.length);
  };
  const targets = [
    ["app/api/owner/analytics/route.ts", /async function fpWithStaffPay/, /\n(?:async )?function |\nconst errText|\n\/\/ `errText`/,
      "sp:unread", "the dashboard's staff-pay detector"],
    ["app/api/owner/reports/route.ts", /const staffFingerprint = async/, /\n  const moneyType/,
      "unread|", "the Team & pay report's detector"],
  ];
  for (const [file, startRe, endRe, wants, what] of targets) {
    const src = code(read(file));
    if (!src) { fail(`item 11 · ${file} is missing — if it moved, update this guard`); continue; }
    const fnSrc = body(src, startRe, endRe);
    if (!fnSrc) { fail(`item 11 · could not find ${what} in ${file} — if the detector moved, update this guard`); continue; }
    const guarded = /if \((?:[\w.?()]+\.error(?:\s*\|\|\s*[\w.?()]+\.error)*|payErr \|\| actErr)\)/.test(fnSrc);
    need(guarded && fnSrc.includes(wants),
      `item 11 · ${what} answers "unread" when its own read fails, so the figures recompute`,
      `item 11 · ${what} (${file}) no longer distinguishes a failed read — it collapses to the "nothing ever happened" value, and a recorded salary stops refreshing the screen`);
  }
  // Both of the inventory file's two detectors, not just the first — the estate roll-up is the half
  // a single check would have missed, and it is the one a multi-restaurant owner reads.
  const inv = code(read("app/api/owner/inventory/route.ts"));
  const invGuards = (inv.match(/if \(mv\.error \|\| ex\.error\)[\s\S]{0,260}?return `unread\|/g) || []).length;
  need(invGuards >= 2,
    `item 11 · …and BOTH stock detectors do it — the one restaurant's and the estate roll-up's (${invGuards} of 2)`,
    `item 11 · only ${invGuards} of the two stock detectors reports an unread read; the other collapses to "nothing bought today"`);
}

// ── item 12 · the record of an erasure ──────────────────────────────────────────────────────────
{
  const src = code(read("app/api/owner/customers/route.ts"));
  need(!/also_erased:\s*\[\s*"/.test(src),
    "item 12 · the erasure's audit row lists no tables by hand",
    "item 12 · `also_erased` is a hand-typed list again — it understated the erasure by three tables last time");
  need(/also_erased:\s*ERASABLE\.filter/.test(src) && /anonymised:\s*ERASABLE\.filter/.test(src),
    "item 12 · …it is derived from lib/personalData.ts, the same declared list the erase itself walks",
    "item 12 · the audit row is no longer derived from ERASABLE, so a new table can be erased without being recorded");
  need(/policy === "anonymise"/.test(src),
    "item 12 · …and \"deleted\" stays a different sentence from \"emptied of the person but kept\"",
    "item 12 · the audit row no longer separates a delete from an anonymise — a bill still points at that row, and an auditor needs the distinction");
  // The declared list is what makes the derivation worth anything.
  const pd = code(read("lib/personalData.ts"));
  const entries = (pd.match(/table:\s*"/g) || []).length;
  need(entries >= 9, `item 12 · …and the declared list still holds every table (${entries} entries)`,
    `item 12 · lib/personalData.ts is down to ${entries} entries — verify:personal-data is what watches for a new phone column, but a shrinking list here silently shrinks the erasure`);
}

if (!fails.length) {
  console.log(`\n✅ verify:t28-picked — ${pass} checks, all pass.`);
  process.exit(0);
}
console.error(`\n❌ verify:t28-picked — ${fails.length} failed, ${pass} passed.\n`);
for (const m of fails) console.error(`  FAIL  ${m}`);
console.error("\nThe rule under all four: a read that FAILED is never reported as a fact. Not as a");
console.error("restaurant nobody checked, not as \"you haven't asked\", not as \"nothing has changed\",");
console.error("and not as a shorter list of what was erased.");
process.exit(process.argv.includes("--hook") ? 2 : 1);
