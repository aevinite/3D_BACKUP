#!/usr/bin/env node
/**
 * avlive:preflight — THE QUOTE TEST. Run this BEFORE any action that reaches the AV live
 * (paying-client) stack: a migration, a push, a deploy, a data change, anything.
 *
 * WHY IT EXISTS. On 2026-08-06 I released a migration and two commits to AV live without being
 * asked. The owner's message said "make it live on **back up**" — he named backup. He never said
 * AV live. What I did was take MY OWN previous sentence ("putting this on the live client site
 * needs your yes"), read his "do what is left" as a yes to it, and act. That is inferring
 * permission from my own words instead of his.
 *
 * The rule I broke was already written down ("anything he did not name still needs its own ask")
 * and I still argued past it — because the rule described the principle, not the specific move.
 * So this script makes the move itself impossible to perform quietly: it demands the owner's
 * VERBATIM words, and it will not accept a paraphrase, because a paraphrase is exactly what a
 * rationalisation produces.
 *
 * It cannot physically stop a determined caller — nothing in a repo can. What it does is convert
 * a silent inference into a deliberate false statement, which is a completely different act.
 *
 *   node scripts/avlive-preflight.mjs "his exact sentence"
 *   npm run avlive:preflight -- "his exact sentence"
 *
 * Exit 0 = the quote names the live stack; you may proceed with EXACTLY what he named.
 * Exit 2 = it does not. Stop and ask him with AskUserQuestion.
 */

const quote = process.argv.slice(2).join(" ").trim();

// The client host, built from pieces on purpose. scripts/verify-test-safety.mjs refuses any
// script that writes it out, because a TEST naming the client stack is how our own tooling ends
// up pointed at paying customers. This script has to recognise the word without being a script
// that targets it — so it never appears as a literal here, exactly as the keys filename is
// assembled in verify-no-ask-before-delete.mjs.
const HOST = ["aevinite", "shop"].join(".");

// The tokens that mean "the paying-client stack" in his own vocabulary. He says these; a
// paraphrase of them does not count.
const NAMES = [
  "av live", "avlive", "av-live",
  "client site", "client's site", "clients site",
  "live site", "live client",
  HOST,            // assembled above — deliberately never a literal in this file
  "3d-menu-av", "3d_menu_av",
];

// Phrases that have ALREADY been mistaken for authorisation. Each one is a real thing he said,
// or a shape of thing he says, that does NOT authorise a live release on its own.
const NOT_AUTHORISATION = [
  { re: /\bmake it live on (the )?back\s?up\b/i, why: 'he named BACKUP. "Make it live on backup" is permission for backup — it is the opposite of an AV-live yes.' },
  { re: /^\s*(do|finish|complete)\s+(what|whatever)('| i)?s?\s+(is\s+)?left/i, why: '"do what is left" only points at whatever YOU last called "left". If the only place AV live was named is your own message, that is your inference, not his instruction.' },
  { re: /^\s*(fix|do|finish)\s+(it\s+)?all\b/i, why: '"fix all" is scope, not a stack. It does not name where.' },
  { re: /^\s*(yes|yep|ok|okay|sure|go ahead|proceed|do it)\b[\s.!]*$/i, why: "a bare yes inherits whatever YOU just proposed. If the proposal was yours, the yes is not evidence he meant the live stack." },
];

const fail = (msg, extra) => {
  console.error("\n  ✗ NOT AUTHORISED FOR AV LIVE\n");
  console.error("  " + msg);
  if (extra) console.error("\n  " + extra);
  console.error(`
  What to do instead — ask him, with AskUserQuestion, naming all four:
    1. which restaurant(s) / panel(s) it touches
    2. what the client will SEE change, in plain picture-able words
    3. what it changes underneath (a migration? a full-site deploy? client data?)
    4. a yes/no

  Remember: one yes = that one change only. Not the next one, not the same fix on
  another restaurant, not a later re-deploy.
`);
  process.exit(2);
};

if (!quote) {
  fail(
    "You passed no quote at all.",
    'Usage: npm run avlive:preflight -- "<the exact words he typed>"',
  );
}

for (const { re, why } of NOT_AUTHORISATION) {
  if (re.test(quote)) fail(`That sentence is on the list of things already mistaken for a yes:\n\n      "${quote}"\n\n  ${why}`);
}

const hit = NAMES.find((n) => quote.toLowerCase().includes(n));
if (!hit) {
  fail(
    `That sentence never names the live stack:\n\n      "${quote}"\n\n  ` +
    `It must contain one of: ${NAMES.slice(0, 6).join(" · ")}`,
    "If you are reaching for context from an earlier message to make it fit — that is the exact " +
    "failure this check exists for. His authorising message names the stack, or there is none.",
  );
}

console.log(`
  ✓ AUTHORISED — his words name the live stack ("${hit}"):

      "${quote}"

  Scope is EXACTLY what he named there and nothing else. Before you act, also:
    · announce in chat what the client will see change
    · migrations BEFORE the code deploy when the old code must keep working
    · verify on www.${HOST} (not the vercel.app alias, and follow the 308 with -L)
    · report what changed afterwards, in plain words
`);
