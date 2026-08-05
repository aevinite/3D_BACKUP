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
 *   2. every `docs/PROJECT-HISTORY.md §N` reference resolves to a real §N heading
 *   3. every `npm run <script>` named in CLAUDE.md exists in package.json
 *   4. CLAUDE.md has not silently regrown past its budget (it is re-read on every request)
 *   5. AGENTS.md stays a pointer — never a second, drifting copy of the rules
 *
 * Run: node scripts/verify-doc-pointers.mjs   (npm run verify:pointers)
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const R = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(R(p), "utf8");

// CLAUDE.md is loaded before the user types a word, on EVERY request of EVERY session.
// 25k is deliberately a little above the ~19k it sits at, so ordinary rule additions are
// fine and only a real regrowth (a narrative moving back in) trips it.
const TOKEN_BUDGET = 25_000;
const BYTES_PER_TOKEN = 3.6;

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
  notes.push(`${want.size} §-references into PROJECT-HISTORY, all resolve (${have.size} sections exist)`);
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
const tokens = Math.round(claude.length / BYTES_PER_TOKEN);
if (tokens > TOKEN_BUDGET) {
  fails.push(
    `CLAUDE.md is ~${tokens} tokens, over the ${TOKEN_BUDGET} budget. It is re-read on every ` +
      `request of every session, so narrative belongs in ${HIST}, not here.`,
  );
} else {
  notes.push(`CLAUDE.md ~${tokens} tokens (budget ${TOKEN_BUDGET})`);
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
