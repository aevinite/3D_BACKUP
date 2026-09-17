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

// ── item 11 · a search that cleaned down to nothing is not an absent search ─────────────────────
//
// `lib/searchText.ts` used to answer a bare string, so `""` meant BOTH "nothing was typed" and
// "everything typed was stripped". Nine callers were written `if (safe) q = q.or(…)`, so the second
// case applied NO FILTER — typing `*` on owner → Guests answered with the whole list. Two admin
// callers were worse: they built the filter unconditionally, so an emptied search became `ilike.%%`.
//
// It now answers a discriminated union (`none` | `term` | `unsearchable`). THE DANGEROUS PART OF
// THAT CHANGE, and the reason this check exists: an object is ALWAYS truthy and stringifies to
// `[object Object]`, and TypeScript accepts both — so `if (search)` and `${search}` still COMPILE
// against the new type while quietly meaning something else. I made exactly that mistake in
// `app/api/admin/customers/route.ts` while doing this, and `tsc` was silent about it.
{
  const CALLERS = [
    "app/api/owner/customers/route.ts", "app/api/owner/oplog/route.ts",
    "app/api/admin/customers/route.ts", "app/api/admin/oplog/route.ts", "app/api/admin/audit/route.ts",
    "app/api/tablet/[...path]/route.ts", "app/api/editor/[...path]/route.ts",
    "app/owner/customers/page.tsx",
  ];
  const lib = code(read("lib/searchText.ts"));
  need(/export type SearchTerm/.test(lib) && /kind: "unsearchable"/.test(lib),
    "item 11 · the cleaner answers WHICH of the three things happened, not a bare string",
    "item 11 · lib/searchText.ts is back to a bare string — \"nothing typed\" and \"nothing searchable typed\" are one value again, and every caller collapses them");
  need(!/export function safeSearch/.test(lib),
    "item 11 · …and the old one-value cleaner is gone, not left beside it",
    "item 11 · safeSearch still exists next to searchTerm — the next search box will pick the one that hides the bug (a new way REPLACES the old one)");

  const stringified = [];
  const truthy = [];
  for (const f of CALLERS) {
    const src = code(read(f));
    if (!src) continue;
    // Which local names hold a SearchTerm on this file?
    const names = [...src.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*searchTerm\(/g)].map((m) => m[1]);
    for (const n of names) {
      // `${name}` without `.term` — an object in a template literal becomes "[object Object]".
      if (new RegExp("\\$\\{" + n + "\\}").test(src)) stringified.push(`${f} → \${${n}}`);
      // `if (name)` / `name &&` / `name ?` — always true for an object, so the branch never guards.
      if (new RegExp("(?:if\\s*\\(|&&\\s*|\\|\\|\\s*)" + n + "\\s*(?:\\)|&&|\\?)").test(src)) truthy.push(`${f} → if (${n})`);
    }
  }
  need(stringified.length === 0,
    `item 11 · no caller drops a whole SearchTerm into an ilike pattern (${CALLERS.length} files read)`,
    `item 11 · a SearchTerm is being stringified, which produces the literal text "[object Object]" as the search: ${stringified.join(", ")}`);
  need(truthy.length === 0,
    "item 11 · …and none of them tests one for truthiness, which an object always passes",
    `item 11 · a SearchTerm is used as a condition — an object is ALWAYS truthy, so that branch no longer guards anything: ${truthy.join(", ")}`);

  // The point of the whole change: every caller must handle the unsearchable case somehow.
  const unhandled = CALLERS.filter((f) => {
    const src = code(read(f));
    return src && /searchTerm\(/.test(src) && !/unsearchable/.test(src);
  });
  need(unhandled.length === 0,
    "item 11 · …and every caller answers the unsearchable case instead of falling through to no filter",
    `item 11 · these use searchTerm but never mention \`unsearchable\`, so a box of wildcards falls through to the unfiltered list again: ${unhandled.join(", ")}`);
}

// ── item 12 (owner-picked, 2026-09-17) · the owner's three standing exclusions, declared once ───
//
// No owner ever sees `panel in (admin,db)`, `level = 'error'`, or `action = 'ui_taps'`. Those three
// were written out twice — as local consts in /api/owner/oplog (page AND count) and as hard-coded
// strings in /api/owner/staff's per-person card. Two copies of a filter that decides what is
// COUNTED is precisely how a footer comes to describe a set the page is not showing, which is the
// fault that produced "page 4 of 3" in the same file a day earlier.
//
// The type cannot enforce this: `withoutHiddenKinds` had to take an unconstrained generic, because
// every structural constraint made TypeScript answer TS2589 on the head-count. So the check is here.
{
  const lib = code(read("lib/logVisibility.ts"));
  need(/export const OWNER_LOG_EXCLUDES/.test(lib) && /export function withoutHiddenKinds/.test(lib),
    "item 12 · the three standing exclusions are declared once, in lib/logVisibility.ts",
    "item 12 · OWNER_LOG_EXCLUDES / withoutHiddenKinds is gone — the exclusions are back to being copied per route");
  for (const [what, frag] of [["the admin's own rows", '"\\(admin,db\\)"'],
                              ["app faults", '"level\\.is\\.null,level\\.neq\\.error"'],
                              ["the raw button taps", '"ui_taps"']]) {
    need(new RegExp(frag).test(lib), `item 12 · …including ${what}`,
      `item 12 · lib/logVisibility.ts no longer declares the exclusion for ${what}`);
  }

  // Every owner surface that reads the activity table must come through the one function.
  const SURFACES = ["app/api/owner/oplog/route.ts", "app/api/owner/staff/route.ts"];
  const handRolled = [];
  const missing = [];
  for (const f of SURFACES) {
    const src = code(read(f));
    if (!src) { missing.push(`${f} (unreadable)`); continue; }
    if (!/withoutHiddenKinds\(/.test(src)) missing.push(f);
    // A copy that drifted back in — the literals, anywhere in the route.
    if (/\(admin,db\)/.test(src) || /level\.is\.null,level\.neq\.error/.test(src) || /neq\("action", "ui_taps"\)/.test(src)) handRolled.push(f);
  }
  need(missing.length === 0,
    `item 12 · …and every owner activity surface applies them through it (${SURFACES.length} read)`,
    `item 12 · these read staff_actions for an owner without withoutHiddenKinds, so they decide for themselves what is hidden: ${missing.join(", ")}`);
  need(handRolled.length === 0,
    "item 12 · …with no route keeping its own copy of the filter beside it",
    `item 12 · the exclusion strings are hand-written again in: ${handRolled.join(", ")} — two copies of a filter that decides what is COUNTED is how a footer describes a set the page is not showing`);

  // The list and the count beside it must be filtered by the SAME thing — that is the actual bug.
  const op = code(read("app/api/owner/oplog/route.ts"));
  const uses = (op.match(/withoutHiddenKinds\(/g) || []).length;
  need(uses >= 2,
    `item 12 · …and the Activity page's list and its total both come through it (${uses} call sites)`,
    `item 12 · only ${uses} call site in /api/owner/oplog — the page and the count beside it must be narrowed by the same filter, or the footer counts rows the page will not show`);
}

if (!fails.length) {
  console.log(`\n✅ verify:t28-picked — ${pass} checks, all pass.`);
  process.exit(0);
}
console.error(`\n❌ verify:t28-picked — ${fails.length} failed, ${pass} passed.\n`);
for (const m of fails) console.error(`  FAIL  ${m}`);
console.error("\nThe rule under items 9-12: a read that FAILED is never reported as a fact. Not as a");
console.error("restaurant nobody checked, not as \"you haven't asked\", not as \"nothing has changed\",");
console.error("and not as a shorter list of what was erased.");
process.exit(process.argv.includes("--hook") ? 2 : 1);
