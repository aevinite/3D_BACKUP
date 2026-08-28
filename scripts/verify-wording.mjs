#!/usr/bin/env node
// verify:wording — the sentences on the screens, checked as sentences.
//
// WHY THIS FILE EXISTS (T27 sweep, 2026-08-27)
//
// "Every word on every screen" is a whole sweep territory and it had no guard of its own. The two
// that touch it are narrower than they sound: verify:i18n-scope watches the 67-key guest DICTIONARY
// and the translate/don't-translate decision, and verify:audit watches that every action CODE has a
// label. Neither reads the several hundred English sentences that staff and admins actually read —
// so a refusal could say "No restaurant scope", a box could render with no words in it at all, and
// nothing anywhere went red.
//
// The four checks below are the ones that caught something real. Each names what it found the first
// time, because a guard whose failure message does not say what a real failure LOOKED like is one
// the next person deletes.
//
// Reads files only. No key, no database, no browser. Well under a second.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const read = (p) => readFileSync(`${ROOT}/${p}`, "utf8");
let failed = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { failed++; console.log(`  FAIL ${m}`); };

const files = execFileSync("bash", ["-lc",
  `cd ${ROOT} && find app components public/panels -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.js' \\) -not -path '*/node_modules/*' | sort`,
], { encoding: "utf8" }).trim().split("\n");

// A file's text with comments removed — so a comment EXPLAINING a banned word is never mistaken
// for the product saying it. (The first draft of this guard failed on its own explanatory notes.)
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// THE SENTENCES A PERSON ACTUALLY READS — taken from the CALL SITES that show them, never by
// sweeping every quoted string in the file. The first draft did sweep them all and reported 77
// hits, every one of them a PostgREST filter, a console.error, a stored log detail or a fragment
// of a template. A guard that cries wolf is worse than no guard, so this one only reads:
//
//   · the refusal helpers every route answers through — bad("…"), err("…"), adminFail("…")
//   · toasts — toast("…")
//   · what goes inside an empty-state box
//   · JSX text nodes
//
// Deliberately NOT read: `detail:` (a stored audit record, not a screen — and its own id problem is
// check 3 below), console.* (ours), and anything inside a comment.
function sentences(src, path) {
  const code = codeOf(src);
  const out = [];
  const push = (s) => { if (s && /[a-z]{3}/i.test(s) && /\s/.test(s)) out.push(s); };
  // The refusal helpers every route and panel answers through. The character class here is worth
  // reading twice: an earlier draft wrote it as [^"\\\\\\n], which in a regex literal excludes the
  // LETTER n, so every refusal containing an "n" was silently truncated and this check quietly saw
  // almost nothing. It looked green. Proved by sabotage instead of by reading — see the note at the
  // bottom of this file.
  for (const m of code.matchAll(/\b(?:bad|err|adminFail|toast|fail)\(\s*("(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)/g))
    push(m[1].slice(1, -1));
  for (const m of code.matchAll(/class="empty[^"]*">([^<]{0,200})</g)) push(m[1]);
  // Text nodes. In a .tsx that is JSX; in a panel .js it is the HTML the panels build in template
  // literals — which is where MOST of the words a staff member reads actually live, so leaving the
  // panels out would have made this guard look green over the biggest half of the product.
  if (/\.(tsx|js)$/.test(path || "")) {
    for (const m of code.matchAll(/>([^<>{}\n]{6,200})</g)) {
      const t = m[1].trim();
      if (!/^[A-Za-z\u00C0-\u024F\u0900-\u1CFF]/.test(t)) continue;   // a word, not `(null); const`
      if (/[=;()\[\]]|=>|&&|\|\||\bconst\b|\bfunction\b|\breturn\b/.test(t)) continue;  // code, not a sentence
      push(t);
    }
  }
  return out;
}
// ── 1 · no refusal or label hands a person one of OUR words ──────────────────────────────────
//
// Found: eight refusals across the manager, waiter, kitchen and inventory panels said "No
// restaurant scope — open this panel from the admin console.", two of them with no next step at
// all. "Scope" is what WE call the restaurant a request belongs to. A waiter reading it on a
// tablet has been told nothing.
{
  // Each entry: the word, and the plain thing to say instead. Kept short on purpose — a long list
  // becomes noise, and noise is how a guard stops being read.
  const OURS = [
    [/\bscopes?\b/i, "say which restaurant, not \"scope\""],
    [/\bpurged?\b/i, "say \"permanently removed\" — that is what the button says"],
    [/\bcomped\b/i, "say \"given free\" — \"on the house\" is the name, this is the explanation"],
    [/\bentitlements?\b/i, "say what the person can DO, not the word we file it under"],
    [/\bpayloads?\b/i, "say what could not be sent"],
    [/\bnull\b/, "a person never needs to hear about null"],
    [/\bboolean\b/i, "say on or off"],
  ];
  // Allowed, with the reason. A word is on this list because a REAL SENTENCE legitimately needs it.
  const ALLOWED = [
    // ⛔ REJECTED (owner, 2026-08-28) — docs/REJECTED-IDEAS.md → R48. "No restaurant scope" STAYS.
    // It was reworded into plain words and he turned it down on the reachability, not the wording:
    // *"if you make everything perfect the no 3 will not even happen"*. He is right, and it is worth
    // writing down rather than re-deriving: lib/panelScope.ts → panelRestaurantId returns
    // `g.user.restaurant_id || DEFAULT_RESTAURANT_ID` for ANY signed-in staff member, so a waiter,
    // manager or cook can never see this sentence. It reaches exactly one reader — the ADMIN
    // super-user who opened a panel directly instead of through the console — and that reader knows
    // what "scope" means. Do not reword these eight, and do not re-report them.
    //
    // The word stays WATCHED, so a NEW "scope" on a screen a real person reads is still caught. This
    // allowance names the sentences, not the word.
    /^No restaurant scope\.?$|^No restaurant scope — open this panel from the admin console\.$/,
    // "scope" as ordinary English about how far a thing reaches, in a message to US, not to staff.
    /one restaurant\)|all restaurants\)/,
    // The reader here is a developer calling the API with the wrong verb, not anyone on a screen.
    /Use DELETE \/api\/admin\/owners/,
    // Request-SHAPE refusals: the console always sends the right type, so the only caller that can
    // ever read these is one being written. Naming the type is the useful thing to say to that
    // reader; turning it into prose would be pretending a contract error is a screen.
    /\(boolean\) is required/,
  ];
  const hits = [];
  for (const f of files) {
    for (const s of sentences(read(f), f)) {
      if (ALLOWED.some((a) => a.test(s))) continue;
      for (const [re, say] of OURS) if (re.test(s)) hits.push({ f, s: s.slice(0, 90), say });
    }
  }
  if (!hits.length) ok(`no visible sentence hands a person one of our own words (${OURS.length} watched)`);
  else {
    fail(`${hits.length} visible sentence(s) use a word only this codebase understands:`);
    for (const h of hits.slice(0, 12)) console.log(`         ${h.f}\n           ${JSON.stringify(h.s)}\n           → ${h.say}`);
    if (hits.length > 12) console.log(`         …and ${hits.length - 12} more`);
  }
}

// ── 2 · an empty state is never an empty BOX ─────────────────────────────────────────────────
//
// Found: the manager's Bills screen. Search for a bill that only exists today, with Yesterday
// showing, and yesterday's group rendered `<div class="empty">${searching ? "" : emptyMsg}</div>`.
// .empty carries 60px of padding top and bottom, so that is 120px of blank nothing under a heading
// reading "0 bills". Suppressing the wrong sentence was right; suppressing ALL of them was not.
{
  const bad = [];
  for (const f of files) {
    const src = codeOf(read(f));
    // class="empty"…>${ … ? "" : … }  — a ternary in an empty box with an empty string on a branch
    for (const m of src.matchAll(/class="empty[^"]*">\$\{([^}]{0,160})\}/g)) {
      const expr = m[1];
      if (/\?\s*""\s*:|:\s*""\s*$|\|\|\s*""\s*$/.test(expr)) bad.push({ f, expr: expr.slice(0, 80) });
    }
  }
  if (!bad.length) ok("no empty state can render as a box with no words in it");
  else {
    fail(`${bad.length} empty state(s) can render with an empty string inside the box:`);
    for (const b of bad) console.log(`         ${b.f}\n           \${${b.expr}}\n           → say why it is empty; the BOX still has 120px of padding`);
  }
}

// ── 3 · a log LIST line drops the machine id; the opened row keeps it ────────────────────────
//
// Found: thirteen admin actions stamp their detail with the row id, so the owner's Activity log
// printed `created waiter "ravi" · id 3f8b1c2e-…-9d8e7f6a5b4c`. The id belongs in the record and
// in the popup a support question is answered from — not in the line, where on a phone it pushes
// the words that matter off the end.
{
  const shared = read("components/admin/shared.tsx");
  if (/export function detailForList\(/.test(shared))
    ok("detailForList() still exists — the list line's version of a log detail");
  else
    fail("detailForList() is gone from components/admin/shared.tsx, so a raw row id is back in the " +
         "Activity log's list lines. The standing rule for that screen is that it reads as English.");

  for (const [f, who] of [["app/owner/activity/page.tsx", "the owner's Activity log"],
                          ["app/aevinite/logs/page.tsx", "the admin's Logs list"],
                          ["components/admin/shared.tsx", "the admin overview feed"]]) {
    if (/detailForList\(/.test(codeOf(read(f)))) ok(`${who} renders its list lines through detailForList()`);
    else fail(`${f} no longer calls detailForList(), so ${who} prints the raw stored detail — ` +
              `including the uuid tail that thirteen admin actions append.`);
  }

  // The other half, and the one that is easy to lose: the OPENED row must NOT trim, or the id is
  // gone from the product entirely and a support question has no answer.
  const modal = codeOf(read("components/admin/LogDetailModal.tsx"));
  if (/formatActionDetail\(/.test(modal) && !/detailForList\(/.test(modal))
    ok("…and the opened row still shows the FULL detail, so the id is one tap away, not lost");
  else
    fail("components/admin/LogDetailModal.tsx no longer shows the full detail. Trimming the id from " +
         "the list is only safe because the opened row keeps it — otherwise the id is gone for good.");
}

// ── 4 · one thing, one name ──────────────────────────────────────────────────────────────────
//
// The cheap version of the sweep's shared-vocabulary check: a handful of things this product names,
// and the synonym that would make a manager training a waiter translate between two screens. Only
// words with a settled name are listed — a concept still finding its name does not belong here.
{
  const NAMES = [
    { thing: "a bill given free", name: "on the house", wrong: /\bcomped\b/i },
    { thing: "the kitchen ticket", name: "KOT", wrong: /\bdocket\b|\bchit\b/i },
    { thing: "a takeaway order", name: "Parcel", wrong: /\bto[- ]go order\b/i },
    { thing: "removing for good", name: "permanently removed", wrong: /\bpurged?\b/i },
  ];
  const bad = [];
  for (const f of files) for (const s of sentences(read(f), f))
    for (const n of NAMES) if (n.wrong.test(s)) bad.push({ f, s: s.slice(0, 80), n });
  if (!bad.length) ok(`${NAMES.length} things this product names still have exactly one name on screen`);
  else {
    fail(`${bad.length} screen(s) invented a second name for something that already has one:`);
    for (const b of bad.slice(0, 10)) console.log(`         ${b.f}\n           ${JSON.stringify(b.s)}\n           → ${b.n.thing} is called "${b.n.name}" everywhere else`);
  }
}

// ── 5 · a stored LOG DETAIL is read on a screen too, so it obeys the same words ───────────────
//
// Checks 1–4 deliberately skip `detail:` templates, because a log detail is a RECORD first. But it
// is also rendered — on the owner's Activity log and the admin's Logs list — so a word that would
// be wrong in a refusal is wrong here too, just later.
//
// Found: every audit LABEL already said "Permanently removed a restaurant" / "…an owner", and the
// restaurant's own detail line said "permanently removed restaurant …" — but the owner's said
// "PERMANENTLY purged owner …". One line, on one screen, using a word the screen beside it had
// already stopped using. Owner, 2026-08-28: keep "removed" everywhere.
{
  const WRONG = [
    [/\bpurged?\b/i, "say \"removed\" — that is the word the audit label and the button both use"],
    [/\bcomped\b/i, "say \"given free\""],
    [/\bentitlements?\b/i, "say what the person can DO"],
  ];
  const hits = [];
  for (const f of files) {
    const src = codeOf(read(f));
    for (const m of src.matchAll(/detail: *`([^`]{4,300})`/g)) {
      for (const [re, say] of WRONG) if (re.test(m[1])) hits.push({ f, t: m[1].slice(0, 90), say });
    }
  }
  if (!hits.length) ok(`no stored log detail uses a word the screens have stopped using (${WRONG.length} watched)`);
  else {
    fail(`${hits.length} log detail template(s) use a word the screens no longer use:`);
    for (const h of hits) console.log(`         ${h.f}\n           ${JSON.stringify(h.t)}\n           → ${h.say}`);
  }
}


console.log("");
if (failed) {
  console.log(`${failed} check(s) failed — see above.`);
  console.log("Every one of these found something real once. If a hit is genuinely fine, add it to");
  console.log("that check's allow-list WITH the reason — do not widen the pattern.");
  process.exit(1);
}
console.log("All checks passed — the sentences on the screens still read as English.");
if (!existsSync(`${ROOT}/docs/REJECTED-IDEAS.md`)) process.exit(0);

// ── HOW THIS FILE WAS PROVED ─────────────────────────────────────────────────────────────────
//
// A guard nobody has watched fail is indistinguishable from one that cannot. Each of the four
// checks above was proved by SABOTAGE: put the old fault back, watch this go red, put it back.
//
//   1  restore "No restaurant scope" in app/api/issue-media/route.ts     -> 1 FAIL
//   2  restore `searching ? "" : emptyMsg` in the manager Bills list     -> 1 FAIL
//   3  point the owner's Activity log back at formatActionDetail         -> 1 FAIL
//   4  restore "Comped deliberately." in the manager's bill receipt      -> 2 FAIL
//
// Two of the four did NOT go red the first time, and both silences were bugs in THIS file rather
// than in the product:
//
//   · the refusal regex had been written with a character class that excludes the LETTER n, so
//     every refusal containing an "n" was truncated and check 1 read almost nothing — while
//     printing ok. Fixing it took the sentences this guard reads from a handful to 1,203.
//   · text nodes were read from .tsx only, so the panels — where most of the words a staff member
//     actually reads are built, in template literals — sat entirely outside check 4.
//
// If you add a check here, sabotage it before you believe it.
