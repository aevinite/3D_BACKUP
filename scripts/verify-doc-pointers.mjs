#!/usr/bin/env node
/**
 * verify:pointers — CLAUDE.md is rules-only; the stories behind them live in docs/.
 *
 * That split has exactly one new failure mode: a pointer that goes nowhere. A rule whose
 * "why" points at a missing file or a missing section is a rule nobody can check, and it
 * fails SILENTLY — the session just never learns the thing. So this asserts every pointer
 * out of CLAUDE.md still lands somewhere real.
 *
 * Checks:
 *   1. every `docs/…` / `.claude/…` file referenced by CLAUDE.md exists
 *   2. every `docs/PROJECT-HISTORY.md §N` reference resolves to a real §N heading — and a bare
 *      PROJECT-HISTORY mention with no §N is itself reported, because that is a pointer to 309 lines
 *   3. every `npm run <script>` named in CLAUDE.md exists in package.json
 *   4. CLAUDE.md has not silently regrown past its budget (it is re-read on every request)
 *   5. AGENTS.md stays a pointer — never a second, drifting copy of the rules
 *   6. every CLAUDE.md heading really has its full text under the SAME heading in CLAUDE-DETAIL.md
 *
 * Run: node scripts/verify-doc-pointers.mjs   (npm run verify:pointers)
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const R = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(R(p), "utf8");

// CLAUDE.md is loaded before the user types a word, on EVERY request of EVERY session, so its size
// is a real cost and this is the only thing watching it.
//
// IT WAS WATCHING THE WRONG NUMBER (fixed 2026-08-06, T10 sweep). It read:
//
//     const TOKEN_BUDGET = 25_000;   // "deliberately a little above the ~19k it sits at"
//     const BYTES_PER_TOKEN = 3.6;
//
// The ~19k in that comment is the file's BYTE count. In the guard's own maths 18,729 bytes is ~5,200
// tokens, so the budget was not "a little above" anything — it tripped at 90,000 bytes, five times
// the file. docs/CLAUDE-DETAIL.md is 76,800 bytes, i.e. the pre-split CLAUDE.md would have measured
// ~21k "tokens" and sailed through. The one check that exists to stop the narrative moving back in
// could not have detected it happening.
//
// So: BYTES, compared with a plain number, and both printed. No conversion to guess at. 24 KB is
// ~28% above today's file — room for ordinary rule additions, not room for a second document.
const BYTE_BUDGET = 24_000;

const claude = read("CLAUDE.md");
const fails = [];
const notes = [];

/* 1 — referenced docs exist ------------------------------------------------------------ */
// Some `.claude/` files are deliberately machine-local (gitignored, e.g. settings.json), so they
// are legitimately absent from a fresh checkout or a worktree. Only hold committed files to
// "must exist" — otherwise this check would fail on every clean clone, which is how a guard
// gets switched off and stops guarding anything.
const tracked = new Set(
  (() => {
    try {
      // execFileSync with an argument array: no shell, so nothing here can be interpreted
      return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 1 << 26 })
        .toString()
        .split("\0")
        .filter(Boolean);
    } catch {
      return [];
    }
  })(),
);
// EVERY directory CLAUDE.md points into, not just docs/ and .claude/.
//
// WHY THIS WIDENED (2026-08-05). The old pattern matched `docs/…` and `.claude/…` only, so it
// walked straight past `app/admin/page.tsx` — a file that has not existed for weeks, named in
// the section a new session reads to find its way around, right next to the claim that "only
// these four routes exist" when there are 55. verify:pointers printed "all resolve" the whole
// time. CLAUDE.md's own security section warns about exactly this shape of stale pointer, and
// checking all ~85 of them by hand takes one command, so a guard should be doing it.
const REF_DIRS = "docs|\\.claude|scripts|lib|components|app|public|supabase|tests";
const REF_EXTS = "md|html|sql|mjs|js|ts|tsx|css|json|sh";
const refs = new Set(
  [...claude.matchAll(new RegExp("`((?:" + REF_DIRS + ")\\/[A-Za-z0-9._/\\[\\]-]+\\.(?:" + REF_EXTS + "))`", "g"))]
    .map((m) => m[1])
    // A path CLAUDE.md names in order to say it does NOT exist. Both are load-bearing: the file
    // leads with "THERE IS NO middleware.ts" so that nobody goes looking for the security gate
    // in the wrong place, and a guard that failed on it would be arguing with the documentation.
    .filter((p) => !/^(middleware|proxy)\.ts$/.test(p) && !/(^|\/)(middleware|proxy)\.ts$/.test(p)),
);
// Ask git, once per path, whether it is deliberately ignored. `git check-ignore` exits 1 when the
// path is NOT ignored, which is the answer we want, so a non-zero exit is data and not an error.
const ignored = (p) => {
  try {
    execFileSync("git", ["check-ignore", "-q", "--", p], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch { return false; }
};
let skipped = 0;
for (const ref of [...refs].sort()) {
  if (fs.existsSync(R(ref))) continue;
  // "Untracked" is not the same as "machine-local". A file that git IGNORES (.claude/settings.json,
  // .env.local) is legitimately absent from a clone, so its pointer is fine. A file that is simply
  // GONE is a dead pointer — and treating the two the same is what hid `app/admin/page.tsx`, which
  // has not existed for weeks while this check printed "all resolve".
  if (!tracked.has(ref) && ignored(ref)) {
    skipped++;
    continue;
  }
  fails.push(`CLAUDE.md points at \`${ref}\` — that file does not exist`);
}
notes.push(
  `${refs.size} doc/.claude references, all resolve` +
    (skipped ? ` (${skipped} machine-local, not checked)` : ""),
);

/* 2 — PROJECT-HISTORY sections exist --------------------------------------------------- */
const HIST = "docs/PROJECT-HISTORY.md";
if (!fs.existsSync(R(HIST))) {
  fails.push(`${HIST} is missing — every "why" pointer in CLAUDE.md is dead`);
} else {
  const hist = read(HIST);
  const have = new Set([...hist.matchAll(/^##\s*(\d+)\./gm)].map((m) => m[1]));
  const want = new Set([...claude.matchAll(/PROJECT-HISTORY\.md`?\s*§\s*(\d+)/g)].map((m) => m[1]));
  for (const n of [...want].sort((a, b) => a - b)) {
    if (!have.has(n)) fails.push(`CLAUDE.md cites ${HIST} §${n}, but that section does not exist`);
  }
  // A BARE MENTION IS NOT A POINTER (added 2026-08-06, T10 sweep). This check reported
  // "0 §-references, all resolve" — a green tick on a loop with nothing to iterate. Meanwhile
  // CLAUDE.md's Known-gotchas heading says the stories are "in docs/CLAUDE-DETAIL.md /
  // PROJECT-HISTORY" and gives no section at all, so a session is sent to 309 lines and 12 numbered
  // sections to find one story. The check existed to keep those pointers alive; there were none left.
  const mentions = [...claude.matchAll(/PROJECT-HISTORY(?:\.md)?(.{0,12})/g)];
  const bare = mentions.filter((m) => !/^`?\s*§\s*\d/.test(m[1]));
  if (bare.length) {
    fails.push(
      `CLAUDE.md mentions PROJECT-HISTORY ${bare.length} time(s) with no §N. A pointer to a ` +
        `${hist.split("\n").length}-line file is not a pointer — cite the section, e.g. ` +
        `\`docs/PROJECT-HISTORY.md §7\`.`,
    );
  }
  notes.push(`${want.size} §-reference(s) into PROJECT-HISTORY, all resolve (${have.size} sections exist)`);
}

/* 2b — the SAME-HEADINGS promise --------------------------------------------------------
 * CLAUDE.md's own preamble says: "the complete, unabridged text of every rule below lives in
 * docs/CLAUDE-DETAIL.md under the SAME headings … open its section there BEFORE acting."
 *
 * Nothing checked that, and on 2026-08-06 it was true for 4 of 12 headings. `## Operational rules`
 * — the twenty one-liners a session uses most — had no counterpart at all, and neither did
 * `## 🚦 Deploying & the folder ladder`. A session that follows the instruction literally searches
 * the detail doc, finds nothing, concludes the detail does not exist, and acts on the one-liner.
 * That is precisely the failure the 2026-08-05 split was meant to prevent.
 *
 * Matched on the heading TEXT up to the first "(" — the detail doc habitually adds a date in
 * brackets ("Owner working agreements (2026-06-26 — FOLLOW EVERY TIME)") and that is fine; what is
 * not fine is a different name, or no section at all. Comparison ignores case and punctuation so a
 * stray dash never fails the build.
 */
{
  const DETAIL = "docs/CLAUDE-DETAIL.md";
  if (!fs.existsSync(R(DETAIL))) {
    fails.push(`${DETAIL} is missing — every "full text under the same heading" pointer is dead`);
  } else {
    const norm = (h) =>
      h.replace(/\(.*$/, "").replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
    const detailHeads = new Set(
      [...read(DETAIL).matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => norm(m[1])).filter(Boolean),
    );
    const claudeHeads = [...claude.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => m[1]);
    const orphans = claudeHeads.filter((h) => !detailHeads.has(norm(h)));
    if (orphans.length) {
      fails.push(
        `CLAUDE.md promises every rule's full text sits under the SAME heading in ${DETAIL}, but ` +
          `${orphans.length} heading(s) have no counterpart there:\n` +
          orphans.map((h) => `      · ${h}`).join("\n") +
          `\n      Rename the section in ${DETAIL} to match, or change the promise in CLAUDE.md.`,
      );
    } else {
      notes.push(`${claudeHeads.length} CLAUDE.md headings, every one resolves in ${DETAIL}`);
    }
  }
}

/* 3 — npm scripts named in CLAUDE.md exist --------------------------------------------- */
const pkg = JSON.parse(read("package.json"));
const scripts = new Set(Object.keys(pkg.scripts || {}));
const named = new Set([...claude.matchAll(/npm run ([a-z][a-z:0-9-]*)/g)].map((m) => m[1]));
for (const s of [...named].sort()) {
  if (!scripts.has(s)) fails.push(`CLAUDE.md tells you to run \`npm run ${s}\` — no such script in package.json`);
}
notes.push(`${named.size} npm scripts named, all exist`);

/* 4 — budget --------------------------------------------------------------------------- */
if (claude.length > BYTE_BUDGET) {
  fails.push(
    `CLAUDE.md is ${claude.length} bytes, over the ${BYTE_BUDGET} budget. It is re-read on every ` +
      `request of every session, so narrative belongs in docs/CLAUDE-DETAIL.md or ${HIST}, not here. ` +
      `Move a section out rather than raising this number — raising it is how the last budget stopped working.`,
  );
} else {
  notes.push(`CLAUDE.md ${claude.length} bytes (budget ${BYTE_BUDGET})`);
}

/* 5 — AGENTS.md stays a pointer -------------------------------------------------------- */
if (fs.existsSync(R("AGENTS.md"))) {
  const agents = read("AGENTS.md");
  if (agents.length > 2_000) {
    fails.push(
      `AGENTS.md is ${agents.length} bytes — it has regrown into a second copy of the rules. ` +
        `It drifted stale once already; keep it a pointer to CLAUDE.md.`,
    );
  } else if (!/CLAUDE\.md/.test(agents)) {
    fails.push(`AGENTS.md does not point at CLAUDE.md`);
  } else {
    notes.push(`AGENTS.md is a ${agents.length}-byte pointer`);
  }
}

/* report ------------------------------------------------------------------------------- */
if (fails.length) {
  console.error(`\n❌ verify:pointers — ${fails.length} problem(s):\n`);
  for (const f of fails) console.error(`  · ${f}`);
  console.error("");
  process.exit(1);
}
console.log("✅ verify:pointers — every rule's pointer resolves");
for (const n of notes) console.log(`   · ${n}`);
