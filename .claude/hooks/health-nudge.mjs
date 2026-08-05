// Periodic production health-check nudge (UserPromptSubmit hook).
//
// The user asked for this to be DYNAMIC: not every prompt, but roughly every
// 2-5 prompts Claude should glance at production health (Sentry errors +
// Vercel deploy state) and only speak up if something is wrong.
//
// How it works: every user prompt runs this script. It counts prompts in a
// tiny state file next to this script. When the count reaches a randomly
// chosen threshold (2-5, re-rolled each cycle), it emits JSON that injects a
// reminder into Claude's context. It never blocks the prompt - worst case it
// stays silent and the prompt goes through untouched.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// State lives next to the script (gitignored) so it survives across sessions.
const here = dirname(fileURLToPath(import.meta.url));
const stateFile = join(here, "health-nudge-state.json");

// Load previous state; fall back to a fresh cycle if the file is missing/corrupt.
let state = { count: 0, threshold: 3 };
try {
  state = JSON.parse(readFileSync(stateFile, "utf8"));
} catch {}

state.count += 1;

if (state.count >= state.threshold) {
  // Cycle complete - reset the counter and re-roll the next threshold (2-5)
  // so the cadence stays irregular instead of a rigid every-Nth-prompt.
  state.count = 0;
  state.threshold = 2 + Math.floor(Math.random() * 4);

  const nudge = [
    "Periodic production health check (fires once every 2-5 prompts).",
    "At the next natural pause in this turn - NOT in the middle of a task - quickly check the latest Vercel deployment for project 3-d-backup: READY vs ERROR (VERCEL_TOKEN from .env.local).",
    "(Sentry error-checking was intentionally removed 2026-06-11 — the owner didn't want to set up a read-scoped token; do NOT re-add it.)",
    "Report to the user ONLY if something is broken or noteworthy; if all healthy, one short line at most. Never print any token. If genuinely mid-task, defer the check to the end of the turn rather than skipping it.",
  ].join(" ");

  // UserPromptSubmit JSON output: additionalContext is injected into Claude's
  // context; suppressOutput keeps the transcript clean for the user.
  console.log(
    JSON.stringify({
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: nudge,
      },
    })
  );
}

// Persist the updated counter. A write failure must not break the prompt.
try {
  writeFileSync(stateFile, JSON.stringify(state));
} catch {}
