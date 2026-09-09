# RUNBOOK — how to run Aevidine without asking anybody

**Read this first if you are new, or if something is broken and you need to act now.**
This page is deliberately short and every command on it has been run. Longer explanations live in
`CLAUDE.md` (the rules) and `docs/GUARD-MAP.md` (which check covers which file).

Written 2026-09-09 because the only handover document was from June and stale. If a command here
stops being true, that is a bug in this page — fix it here first.

---

## 1 · The one thing to know

**The site runs itself.** Vercel builds `main` and deploys it. Nobody has to be at a keyboard for the
restaurants to keep working. Everything below is about *changing* it safely.

---

## 2 · Run it on your machine

```bash
npm ci                 # once, and again whenever package.json changes
npm run dev            # http://localhost:4000
```

You need `.env.local` in the repo root (Supabase URL + keys, `ADMIN_PASSWORD`, `VERCEL_TOKEN`). It is
gitignored and never committed. Copy it from a machine that has it; there is no way to regenerate it
from the repo.

`PORT=4107 npm run dev` runs a second copy on another port — do that if 4000 is already busy, and
**never** point a second dev server at port 4000, because that is the one people check work on.

Sign in at `/login` (staff) or `/aevinite` (the admin console, password from `ADMIN_PASSWORD`).

---

## 3 · Did I break anything?

```bash
npm run verify:push
```

**~25 seconds.** Types, lint, three unit suites, 33 static guards, the access model and the doc
counts. If this is green your change is safe to open a PR with. Run it before every push.

```bash
npm run verify:static          # just the 33 guards, ~15s
npm run typecheck              # types only — `npm run lint` does NOT check types
```

**Do not casually run `npm run verify:everything`.** It is the full 500-phase suite, it needs a
server, it WRITES to the database, and it takes about 40 minutes. One full pass at the end of a
piece of work is right; five passes is not.

---

## 4 · A guard went red. Now what?

**In this order, and the first step is the one people skip:**

1. **Read what it actually asserts.** Open the guard and read the check that failed, not just its
   message. Roughly a third of red guards in this repo were the *guard* being wrong — asserting the
   spelling of something that legitimately changed, or matching the dated comment that records a
   removal.
2. **Ask whether the rule still exists.** If the code changed on purpose, the guard is stale. Then
   **invert it, do not delete it**: make it assert the new rule. A deleted guard is a rule nobody
   ever checks again.
3. **Check it is your fault.** `git stash && npm run verify:push` — if it is still red, you inherited
   it from `main` and someone else's change is the cause.
4. **Judge a guard by sabotage, never by reading it.** Break the thing on purpose and confirm it goes
   red; put it back and confirm it goes green. A guard that passes both ways is protecting nothing.

Every guard's name maps to a file in `docs/GUARD-MAP.md`. `node .github/scripts/verify-doc-counts.mjs`
fails if a number written in a rulebook no longer matches the code.

---

## 5 · Ship a change

```bash
git fetch origin && git checkout -b fix/<short-name> origin/main
# ... work ...
npm run verify:push
git add <only your files>            # never `git add -A` in the shared folder
git commit && git push -u origin HEAD
gh pr create --base main
# wait for the checks to pass, then:
gh pr merge <number> --merge
```

Vercel deploys `main` automatically. Confirm it: `gh api repos/aevinite/3D_BACKUP/commits/<sha>/status`
should say `success`.

**Two rules that exist because they were learned the hard way:**

- **Several people share this folder.** Before deploying, look at `.claude/deploy.lock`. If it exists
  and is less than ~15 minutes old, somebody else is mid-deploy — wait. Take it by writing your own
  line into it, and delete it when you are done, success or failure.
- **Stage only your own files.** Unrecognised modified files in this folder are another session's
  live work. Leave them. If `git pull` refuses because of them, that is the system working — use a
  worktree off `origin/main` instead.

---

## 6 · The three things to ask about first

Everything else you may change, delete or rewrite without asking. These three you may not:

| | why |
|---|---|
| **The live client stack** — the `LIVE_PROJECTS` folder, the `3d-menu-av` Vercel project, its own Supabase database, and its own keys file (all four named in `CLAUDE.md`) | paying restaurants are on it. Read-only by default; even reading is announced first. `npm run verify:test-safety` fails if any script here points at it. |
| **Another session's uncommitted work** in this folder | it is not yours to throw away |
| **Force-pushing `main`** | it destroys other people's commits |

---

## 7 · Where things are

| you want | it is in |
|---|---|
| a guest screen | `app/menu`, `app/r/[restaurant]`, `app/q/[code]` — **three doors, every guest rule must hold in all three** |
| the admin console | `app/aevinite/…` (password-gated; there is no `/admin`) |
| the owner console | `app/owner/…` |
| the manager or menu-editor panel | `public/panels/editor/app.js` — `/manager` embeds it; `/editor` is an old URL that redirects to `/manager` |
| the kitchen screen | `public/panels/kitchen/app.js` |
| the waiter tablet | `public/panels/tablet/app.js` |
| a printed bill, ticket or banquet sheet | `public/panels/billdoc.js` — **one file, all three documents** |
| a panel's server API | `app/api/<panel>/[...path]/route.ts` |
| the database | `supabase/migrations/` — every file has a header explaining the decision |

The panels are plain JavaScript served as static files, not React. They are versioned by content
hash: after editing one, run `npm run verify:panel-cache -- --fix` or staff keep the old file for up
to 24 hours.

---

## 8 · Change the database

```bash
node scripts/run-migration.mjs <one-file.sql>
```

**One file at a time.** Do NOT re-seed: a re-seed re-runs *every* migration with no ledger, and two
migrations have done real damage that way. Any migration that rewrites existing data must be wrapped
in `lfh_already_applied('<key>')` so running it twice is safe.

Schema changes are additive: add with a default → backfill → only then enforce.

---

## 9 · When something is wrong on the live site

1. **Is it deployed?** `gh api repos/aevinite/3D_BACKUP/commits/$(git rev-parse origin/main)/status`
2. **Is it the build you think?** Panels carry a content hash — check the `?v=` the site serves
   matches the file in the repo. A "broken live site" is often a stale panel in one browser.
3. **Is it one restaurant or all of them?** Every tenant row carries `restaurant_id`; a fault in one
   restaurant only is almost always its settings, not the code.
4. **The printing queue never loses a ticket.** A slip that did not come out is a row in
   `print_jobs` with a status and an attempt count, and a failure after five tries files a printer
   problem and pings the owner. Look there before assuming anything was lost.

---

## 10 · What this project expects of a change

Not style rules — these are the four that guards actually enforce, so a change that ignores them
will not merge:

1. **A new way replaces the old one.** Adding a thing removes the thing that did that job, in the
   same change. Leave an obituary comment saying what went and why.
2. **Every write is looked at.** A database write whose error nobody reads is not a write; it is a
   screen that lies about what happened.
3. **No tap vanishes in silence.** A user action either happens, is held, or is visibly refused.
4. **Anything that can only be proved by looking, gets looked at.** Drive the screen, in the right
   role, at ~390px as well as on a desktop. A green suite is not evidence that a screen is right.
