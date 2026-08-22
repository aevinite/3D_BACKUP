# T30 improvement ideas

Sweep #6, terminal 30 of 30. Ideas only — things that work today but could be better. Problems
live in `T30-findings.md`.

## Built by this terminal (inside its own territory)

1. **`LEDGER/INDEX.md` — the ledger got a table of contents, an ID registry and a gap list.**
   Before: 26 ledger files and no way to know what they covered, which ids were free, or what
   nobody had checked. Now: all 30 territories with their permanent blocks, a coverage table
   computed by cross-producing every file in the repo against every territory, a named gap list
   ordered by what a restaurant loses, the three ID faults with a reserved repair block, the
   standing pre-empts with their sources, the commands that recompute every number, and an honest
   answer to "will the next run be clean?".

2. **The skill now says "re-run before you re-invent", four times over.**
   `SKILL.md` gained a Stage 0 that runs before planning, and the rule is in its frontmatter
   `description:` so it is visible before the body loads. `PROMPT-STYLE.md` gained Rule Zero — a
   prompt without its ledger rows is a broken prompt — and the prompt skeleton itself now carries
   the re-run instruction. Cleanup in both files is now forbidden from ever deleting or archiving
   `LEDGER/`.

3. **`docs/QA-500-PHASES.md` distinguishes the suite from the ledger.**
   Two different things were both called "the tests". The doc now opens with a table separating
   them — the suite is a gate that runs in minutes, the ledger is a memory of everything ever
   checked — and closes with how a sweep finding becomes a suite phase, and why a ledger row
   pointing at a dead guard is worse than no row (the `verify:cache` lesson).

## 🟡 For the owner to decide — not built

4. **A guard that keeps the ledger index honest.** A `verify:ledger-index` script could fail the
   build when a ledger file has no INDEX row, when two files claim one id, when a row is malformed,
   or when the "re-run first" instruction goes missing. This terminal cannot build it: the script
   would live in `scripts/**` (T28) and its `verify:*` entry in `package.json` (T29). The full
   source is written out in `.claude/sweep/T30-guard-verify-ledger-index.mjs.txt` so whoever owns
   those files can drop it in unchanged.
   *Trade-off:* one more guard to keep green, and it only protects process documents — no
   restaurant notices it. But without it, the index silently goes stale the moment T26–T29 file,
   and a stale index is worse than none because the next sweep trusts it.

5. **Name an owner for `access-designs/`, `LEARN-MY-APP/` and `reference/` — or say they are out
   of scope.** Right now they are neither, so every sweep re-discovers them and no sweep checks
   them. *Trade-off:* if they are genuinely not shipped code, the honest answer is a one-line
   "out of scope" note, which costs nothing and stops the rediscovery.

6. **Write commands into the prompts instead of counts.** Every count in the sweep-#6 prompts was
   wrong within days. `docs/QA-500-PHASES.md` already solved this for the phase count. *Trade-off:*
   a prompt that says `find app -name page.tsx | wc -l` is slightly less readable than "56 pages" —
   and it is right a year later.
