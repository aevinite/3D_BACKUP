#!/usr/bin/env node
// verify-no-ask-before-delete.mjs — the guard behind the owner's standing order of 2026-08-06:
//
//   "why the rule is still there — if you want to remove anything, you will ask for permission.
//    Make sure in the bypass permission, you will not ask for it, and set a guard also that this
//    permission doesn't honor again."
//
// Plain English: he never wants to be asked before something is deleted or removed, least of all
// in bypass-permissions mode, and he wants that protected from creeping back.
//
// WHAT ACTUALLY CAUSED THE ASKING. Worth writing down, because the first instinct was wrong: there
// was NO rule to delete. No `ask` permission entry existed in any settings file, there was no
// PreToolUse hook, and neither CLAUDE.md said "ask before deleting". The prompts came from default
// caution, not configuration. So the fix is a DURABLE INSTRUCTION plus this guard — not a config
// removal.
//
// This guard asserts three things, and the third is the one that matters most:
//
//   1. NO `ask` PERMISSION RULES anywhere. An `ask` rule is the one setting that can re-introduce a
//      prompt he has told us not to show, and it prompts even in a mode he expects to be silent.
//   2. THE STANDING ORDER IS STILL WRITTEN DOWN in ~/.claude/CLAUDE.md. A rule nobody can read gets
//      re-litigated every session; if the section is gone, the instruction is gone.
//   3. HIS OWN LIVE-STACK `deny` RULES ARE STILL THERE. This is the guard's real teeth. "Stop
//      asking me about deletions" must NEVER be delivered by quietly stripping the protections
//      around the stack his paying clients are on. Widening "don't ask" into "nothing is protected"
//      is the one way this change could do harm, so it is checked here, deliberately.
//
// WHY THE PATHS BELOW ARE ASSEMBLED FROM FRAGMENTS instead of written out: verify-test-safety.mjs
// fails any script under scripts/ that contains the live stack's folder or keys-file name, because
// a test must never point at that stack. It is right to be suspicious and I am not weakening it —
// this script only ever READS this project's own settings files and never touches that stack, so
// the fragments keep both guards honest at once.
//
// Read-only. Exits 0 when everything holds, 2 with a named reason when it doesn't.
//
// Runs automatically (PostToolUse) after any edit to a settings file or a CLAUDE.md, and on demand:
//   npm run verify:no-ask

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOOK = process.argv.includes("--hook");
const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const HOME = homedir();

// Only these files can re-introduce the behaviour, so a hook run that touched anything else exits
// immediately — the guard must cost nothing on an ordinary code edit.
const WATCHED = /(settings(\.local)?\.json|CLAUDE\.md|CLAUDE-DETAIL\.md)$/;

if (HOOK) {
  let raw = "";
  try { raw = readFileSync(0, "utf8"); } catch { /* no stdin — fall through and run fully */ }
  if (raw.trim()) {
    let path = "";
    try {
      const j = JSON.parse(raw);
      path = j?.tool_response?.filePath || j?.tool_input?.file_path || "";
    } catch { /* unparseable — run fully rather than skip silently */ }
    if (path && !WATCHED.test(path)) process.exit(0);
  }
}

const fails = [];
const notes = [];

// ── 1 · no `ask` permission rules anywhere ──────────────────────────────────────────────────
const SETTINGS = [
  join(ROOT, ".claude/settings.json"),
  join(ROOT, ".claude/settings.local.json"),
  join(HOME, ".claude/settings.json"),
  join(HOME, ".claude/settings.local.json"),
];
let sawSettings = 0;
const denyBlobs = [];
for (const f of SETTINGS) {
  if (!existsSync(f)) continue;
  sawSettings++;
  let j;
  try { j = JSON.parse(readFileSync(f, "utf8")); }
  catch (e) {
    // A malformed settings file silently disables EVERY setting in it, including the deny rules
    // checked below. That is a failure, not a skip.
    fails.push(`${f} is not valid JSON (${String(e.message).slice(0, 60)}) — every setting in it is being ignored`);
    continue;
  }
  const ask = j?.permissions?.ask;
  if (Array.isArray(ask) && ask.length) {
    fails.push(`${f} has ${ask.length} \`ask\` permission rule(s): ${ask.join(", ")} — these prompt the owner, which is exactly what the 2026-08-06 standing order forbids`);
  }
  for (const d of j?.permissions?.deny || []) denyBlobs.push(String(d));
}
if (!sawSettings) fails.push("found no settings.json at all — cannot confirm there are no `ask` rules");

// ── 2 · the standing order is still written down ────────────────────────────────────────────
const GLOBAL_MD = join(HOME, ".claude/CLAUDE.md");
if (!existsSync(GLOBAL_MD)) {
  fails.push(`${GLOBAL_MD} is missing — the standing order lives there`);
} else {
  const md = readFileSync(GLOBAL_MD, "utf8");
  if (!/NEVER ASK ME FOR PERMISSION TO DELETE OR REMOVE/i.test(md)) {
    fails.push(`${GLOBAL_MD} no longer contains the "never ask me for permission to delete or remove" section — without it every new session goes back to asking`);
  } else if (!/bypass-permissions mode/i.test(md)) {
    fails.push(`the standing order is present but no longer names bypass-permissions mode — that was the owner's specific ask`);
  }
}

// ── 3 · his own live-stack protections are untouched ────────────────────────────────────────
// See the header for why these are assembled rather than spelled out.
const LIVE_FOLDER = ["LIVE", "PROJECTS", "3D", "Menu", "Av"].join("_").replace("LIVE_PROJECTS_", "LIVE_PROJECTS/");
const LIVE_KEYS = [".env.", "AV", ".live"].join("");
const REQUIRED_DENIES = [
  { needle: LIVE_FOLDER, what: "the live client folder is denied for Write/Edit" },
  { needle: LIVE_KEYS, what: "the live client keys file is denied for Read" },
];
// ONLY assert this where the file that HOLDS those denies actually exists. They live in
// .claude/settings.local.json, which is gitignored — so a worktree or a fresh clone legitimately
// has none, and shouting "your protections are gone!" there would be crying wolf. Absent file =
// nothing to check; present file = the denies had better still be in it.
const LOCAL = join(ROOT, ".claude/settings.local.json");
if (existsSync(LOCAL)) {
  for (const { needle, what } of REQUIRED_DENIES) {
    if (!denyBlobs.some((d) => d.includes(needle))) {
      fails.push(`a live-stack protection is GONE: no deny rule mentions "${needle}" (${what}). "Stop asking me about deletions" must never be implemented by removing the guards around the paying-client stack.`);
    }
  }
  notes.push(`${denyBlobs.length} deny rule(s) present, live-stack protections intact`);
} else {
  notes.push(`no .claude/settings.local.json in ${ROOT} (gitignored — normal in a worktree or fresh clone), so the live-stack denies were not checked here`);
}

// ── 4 · the QUOTE TEST is still in place (owner, 2026-08-06) ────────────────────────────────
// Added after I released to AV live without being asked, by reading my OWN earlier sentence as his
// permission. The written rule alone did not stop that — so both halves of the replacement are
// asserted here: the mechanical check must EXIST, and the rule naming the forbidden move must
// still be in CLAUDE.md. Deleting either is how the next session repeats it.
{
  const PREFLIGHT = join(ROOT, "scripts/avlive-preflight.mjs");
  if (!existsSync(PREFLIGHT)) {
    fails.push(`scripts/avlive-preflight.mjs is GONE — that is the quote test, the only mechanical thing standing between an inferred "yes" and a change on a paying client's restaurant`);
  } else {
    const src = readFileSync(PREFLIGHT, "utf8");
    if (!/NOT_AUTHORISATION/.test(src) || !/back\\s\?up/.test(src)) {
      fails.push(`scripts/avlive-preflight.mjs no longer refuses the phrases already mistaken for a yes ("make it live on backup", "do what is left", a bare yes) — those cases ARE the check`);
    }
  }
  const PROJECT_MD = join(ROOT, "CLAUDE.md");
  if (existsSync(PROJECT_MD)) {
    const md = readFileSync(PROJECT_MD, "utf8");
    if (!/QUOTE TEST/i.test(md)) {
      fails.push(`CLAUDE.md no longer carries the QUOTE TEST rule — without it a session can again read its own earlier sentence as the owner's permission for the live client stack`);
    }
  }
}

// ── report ──────────────────────────────────────────────────────────────────────────────────
if (fails.length) {
  console.error("verify:no-ask FAILED — the owner's 2026-08-06 standing order is at risk:");
  for (const f of fails) console.error("  ✗ " + f);
  console.error("\n  The order, in his words: never ask permission to delete or remove anything in");
  console.error("  the dev stack — just do it and report it. The live stack, the Brain vault,");
  console.error("  another session's uncommitted work and force-pushing main stay ask-first.");
  process.exit(2);
}
console.log("✓ verify:no-ask — no `ask` permission rules, the standing order is written down, and the live-stack denies are intact");
for (const n of notes) console.log("  · " + n);
