# T29 findings — the docs, the tooling, and everything nobody else owned

Sweep #6, terminal 29. 500 phases (`.claude/sweep/LEDGER/T29.md`, P14001–P14500).
Every row below passed the four-test gate in `.claude/sweep/SWEEP-RULES.md` §5 before a line changed.
`confirmed` = I watched it happen · `code-read` = reasoned from the source.

**Two of my own candidate findings were withdrawn after checking them properly** and are recorded at
the bottom, because a withdrawn finding is worth as much to the next sweep as a real one.

---

## F1 · The rulebook's "complete" list of gated API routes was missing three of them — HIGH · code-read

- **Where:** backend only, nothing on screen. `docs/CLAUDE-DETAIL.md` → `## Security gate`.
- **Who is worse off:** the next session or audit. That section states outright that its lists are
  COMPLETE and that *"an API route absent from here must have a gate"*. `/api/maintenance`,
  `/api/issue-media` and `/api/print-agent/**` were in neither list. **All three are correctly
  gated** — the two by a familiar helper that sits outside the four `[...path]` panel families the
  list named by shape, the third by a per-machine printing token rather than any cookie. So an audit
  obeying the rule is sent at three routes that are fine, and the worst case is someone "adding" a
  cookie gate to the printing door and stopping the paper at a restaurant.
- **Reachable:** any session that follows the rule as written. The section's own text records the
  identical thing happening to `/api/guest/call-waiter`, found nine days earlier.
- **Fixed:** all three added, each with what actually gates it and why its shape hid it, plus a note
  in the list's own "this keeps happening" paragraph.
- **Guarded:** `node .github/scripts/verify-doc-counts.mjs` — enumerates every `app/api/<family>`
  from `git ls-files` and fails if one is not named in that section. 21 families today.

## F2 · The printer setup doc still told you to use a download route that was deleted — HIGH · code-read

- **Where:** backend only for the doc itself, but it decides what a restaurant is told. The
  reader-facing page is **admin console → a restaurant → 🖨 KOT printing → "Open the setup guide"**
  (also owner → Settings, admin → Printing, and the kitchen panel's 🖨❗ sheet) → `/print-setup.html`.
- **Who is worse off:** the person setting up a restaurant's printer, and the owner. `docs/KITCHEN-PRINT-SETUP.md`
  §9 described, in the present tense, generating the starter script from `lib/printStation.ts` via
  `app/api/print-station/[file]/route.ts`. **Both were DELETED on 2026-08-19** (commit `606b8969`)
  because generating it changed nothing: macOS Gatekeeper and Windows SmartScreen flag a script for
  having ARRIVED FROM THE WEB, so the owner still met *"could not verify it is free of malware"* with
  only Done or Move to Bin. A session reading that section rebuilds the download and walks him back
  into the dialog — and the live page is guarded against exactly that (`verify:print-helper` asserts
  nothing is offered as a download), so the doc and the guard were arguing.
- **Reachable:** any session sent to that doc by `CLAUDE.md`'s KOT/bills line.
- **Fixed:** §9 rewritten as **attempt 1 (wrong, and why it could not work) → attempt 2 (the live
  design)**, naming the deleted files as deleted and saying plainly not to re-add a ⬇ button. The
  same stale claim was marked superseded in `.claude/REQUESTS.md`, and the `.gitignore` comment that
  called the `.bat` launcher "a shipped deliverable" now says the exception is dead and why.
- **Guarded:** `verify:print-helper` already asserts the live page offers no download;
  `verify-doc-counts.mjs` now also fails if `docs/KITCHEN-PRINT-SETUP.md` loses the sentence
  "offers nothing to download".

## F3 · CI was RED on clean `main`, and had been — HIGH · confirmed

- **Where:** backend only, nothing on screen — the ✗ on every push and pull request.
- **Who is worse off:** everybody. `npm run verify:static` — the step `.github/workflows/checks.yml`
  runs on every push — exited 1 on an untouched checkout of `origin/main`: **2 of 32 guards failed.**
  A permanently red check is a check nobody reads, and the next real break arrives invisible. The
  workflow's own header explains at length why one stale guard must not silence the others; this is
  the other half of the same problem.
- **Reachable:** every push, on every branch, by every one of the 30 sweep terminals.
- **The two:**
  - `verify-doc-pointers.mjs` — `docs/GUARD-MAP.md` had no row for `verify:split-payment` or
    `verify:t24-money-rules`. **Fixed** (see F4).
  - `verify-rejected-ideas.mjs` — a file in `scripts/` claims a REJECTED decision without pointing
    at the doc. **Not my territory → handoff H1**, with the exact one-line change.
- **Guarded:** `verify:pointers` already guards its half in both directions and is green again.

## F4 · The guard map had no row for two money guards, and its own counts were wrong — HIGH · confirmed

- **Where:** backend only, nothing on screen. `docs/GUARD-MAP.md`.
- **Who is worse off:** anyone who changes the split-payment flow or a money library — the map exists
  so a person can look up which check covers the file they touched, and for those two the answer was
  "nothing here". `verify:split-payment` guards *"the parts must add up to the bill the SERVER
  recomputed"*; `verify:t24-money-rules` is the whole regression guard for `lib/tax*`, `lib/paySplit`,
  `lib/clash*`, `lib/idempotency*`, `lib/userAuth`, `lib/rateLimit`. Both are about money a person
  could be wrongly charged, and both were invisible.
- **Reachable:** the moment anyone consults the map, which is what `CLAUDE.md` and `README.md` both
  tell them to do.
- **Fixed:** a row for each, in the money section, saying what it asserts and where it bites. Also
  in the same file: the headline said 97 commands (134), the admin-console heading said 22 pages (23),
  and one row named "migration 355", which does not exist — the cancel-and-loss work is
  `340_was_the_food_actually_made.sql` (renumbered from 337). All corrected.
- **Guarded:** `verify:pointers` (rows, both directions) + `verify-doc-counts.mjs` (the numbers).

## F5 · Five hard counts in the rulebooks no longer matched the code — HIGH · confirmed

- **Where:** backend only, nothing on screen. `CLAUDE.md`, `README.md`, `docs/CLAUDE-DETAIL.md`,
  `docs/GUARD-MAP.md`, `docs/SECURITY-CHECKLIST.md`, `.github/dependabot.yml`.
- **Who is worse off:** every new session, and therefore the owner. The worst one:
  `CLAUDE.md` said *"all **48** `/api/admin/*` routes check `tokenIsValid`"* and, in the same
  sentence, that the route count must EQUAL the number that grep the gate. There are **50**, and
  **all 50 carry the gate**. So a session doing exactly what the rule says counts 50, reads 48, and
  concludes two admin routes are ungated. There are none. That is an hour hunting a fault that does
  not exist — and if it "fixes" it, it edits working code. *This is the answer to the question this
  terminal was asked: what would a brand-new session reading only `CLAUDE.md` get wrong today.*
- **The five:** Next 16.2.6 → **16.3.0** · React 19.2.4 → **19.2.8** · 55 → **56** page routes ·
  48 → **50** admin API routes · 22 → **23** admin-console pages. Each was copied into three or four
  documents, so every copy was wrong the same way. (`/owner` at 16 pages was correct.)
- **Reachable:** every session, every request — `CLAUDE.md` is re-read before the user types.
- **Fixed:** all of them, in every document, and byte-neutrally in `CLAUDE.md` (it is 56 bytes under
  a 24,000-byte budget — see improvement note I3).
- **Guarded:** `node .github/scripts/verify-doc-counts.mjs`, wired into CI. 20 counts across 6
  documents, each anchored to its own sentence so a re-wording fails loudly instead of switching the
  check off silently. Proven to exit 1 when a count is wrong.

## F6 · Three panels at the restaurant's own address had no browser-tab name — MEDIUM · confirmed

- **Where:** **manager panel, kitchen panel and waiter tablet — the browser TAB, at the restaurant's
  own web address** (`/r/<slug>/manager`, `/r/<slug>/kitchen`, `/r/<slug>/tablet`). What he would
  SEE: three open tabs all reading **"Aevidine — Restaurant OS"**, with no way to tell which is which.
- **Who is worse off:** a manager and a waiter, mid-service. The T15 sweep fixed exactly this on
  2026-08-05 — it named the tab on `/manager`, `/kitchen` and `/tablet` because *"a manager with the
  manager panel, the kitchen screen and the waiter view open in three tabs had three identical tabs
  to pick from"*. The twin routes never got the line. And the twins are the addresses **a
  restaurant's own staff use**; the `/panel` form is the one the admin console opens. So the fix
  landed on the tabs we look at and missed the tabs they look at.
- **Reachable:** any restaurant whose staff sign in at their own address, which is the design.
  Watched in a browser, signed in, before and after: three identical titles → three named ones.
- **Fixed:** one `export const metadata` line in each of the three route files, matching its twin
  exactly.
- **Guarded:** `node .github/scripts/verify-twin-route-parity.mjs` — every panel must name its tab,
  its twin must agree, the three must differ from each other, and none may use the root default.
  Proven to exit 1 when a title is removed.

## F7 · `.claude/REQUESTS.md` showed three finished things as still owed — MEDIUM · confirmed

- **Where:** backend only for the file, but each item is a thing he can see:
  1. the **restaurant's name in the panel header** (manager / kitchen / tablet),
  2. the **restaurant's name on each row** of admin → Audit & logs and owner → Activity,
  3. a signed-in **admin with no restaurant chosen being sent back to `/aevinite`** instead of into a
     bare panel.
- **Who is worse off:** the owner. All three shipped. Reading his own list, he sees work he is
  already paying for as outstanding — and the third entry was even written in the past tense
  ("no longer admit…", "Also killed the silent default…") and still carried an empty box.
- **Reachable:** every time he opens the list.
- **Fixed:** all three ticked, each with a dated note saying HOW it was verified. Items 1 and 2 were
  driven in a real browser first (the manager header reads "Manager · little French house"; the
  kitchen header carries the name as a pill; owner → Activity showed 201 rows each carrying a 🏬
  name; admin → Audit & logs showed 199, across several restaurants, **and** the per-restaurant
  filter he offered as the alternative). Item 3 is one shared gate, `panelAdminRid()`.
- **Not ticked:** the other 36 open rows. A tick means built AND watched working, and I only ticked
  what I could prove.

## F8 · The rulebook said a tenant menu always opens dark; it depends on an admin setting — MEDIUM · confirmed

- **Where:** **guest menu** — the skin a diner sees on `/r/<slug>/menu` and `/q/<code>`. Documented in
  `CLAUDE.md`'s light-mode line and `docs/CLAUDE-DETAIL.md`'s Known-gotchas section.
- **Who is worse off:** whoever writes the next "both skins" check, and therefore the owner when it
  passes on the wrong assumption. The doc said tenant menus *"default to DARK when nothing is
  saved"*, full stop, in the very paragraph that warns you to check before writing such a test.
  In fact the tenant door only re-stamps dark when that restaurant's **Access → Menu → Format →
  Default** is set to dark. Neither restaurant on the dev database has it set, so both tenant doors
  open LIGHT today — I drove both, in a brand-new browser context, at 1280×800 and at 360×780.
- **Reachable:** immediately, for anyone reading the line.
- **Fixed:** both documents now state the real rule, name the setting and the screen, and record what
  the dev database actually has.
- **Also found while checking it → handoff H2:** the dish page does not repeat that boot script, so a
  dark-default restaurant's dish page renders LIGHT on a full page load. Documented in the same
  gotcha; the code fix is another terminal's file.

## F9 · `README.md` promised a green local run meant a green CI run — LOW · confirmed

- **Where:** backend only, nothing on screen. `README.md` → "Before you push".
- **Who is worse off:** whoever pushes. It said `npm run verify:push` *"runs exactly what CI runs …
  so a green run locally means a green run there."* CI also runs `verify:deps`, which `verify:push`
  does not — so a new dependency advisory turns CI red after a clean local run, and the promise is
  what makes that confusing rather than obvious.
- **Reachable:** every push.
- **Fixed:** the sentence now says CI runs those **plus two more** and names both (`verify:deps` and
  the new doc-counts guard), with what each one needs. The "~120 more verify:* scripts" beside it was
  also wrong (130) and is now counted by the guard.

## F10 · `.gitignore`'s comment named four hook guards; nine are wired — LOW · confirmed

- **Where:** backend only, nothing on screen. `.gitignore`, the block explaining why
  `.claude/settings.json` is versioned.
- **Who is worse off:** a session judging how much the PostToolUse hook covers. The comment named
  four; the hook runs nine.
- **Fixed:** it now says it was four when written, is nine now, and to read the live list out of
  `.claude/settings.json` rather than trust a count in a comment — which is precisely how it rotted.

## F11 · `docs/README.md` sent a reader to a folder that is no longer in the repo — LOW · confirmed

- **Where:** backend only, nothing on screen. `docs/README.md` → "Design artefacts".
- **Who is worse off:** anyone looking for the competitor research. `docs/competitor-dashboards/`
  does not exist; the screenshots (185 files / 26 MB) were untracked in the T10 sweep and live on the
  owner's Mac only. The same table's guard count said 95 when there are 136.
- **Fixed:** the dead row removed, replaced by a "not here any more" note saying where they live and
  that nothing in the repo points at them; the count corrected and now guarded.

## F12 · `docs/SECURITY-CHECKLIST.md` had no record of this run — LOW · confirmed

- **Where:** backend only, nothing on screen. §4, the log.
- **Who is worse off:** the owner. The file's own instruction is *"Record the date and the result in
  §4 each time"*, and the last entry was 2026-08-16.
- **Fixed:** a 2026-08-22 row naming every row I re-ran and its result — **including the one that
  failed.** `verify:grants` is RED on the dev database, and honestly so: `lfh_request_verification()`
  is created by `supabase/migrations/296` and is absent from the database, so either 296 never
  applied there or it was dropped by hand. The grant rules themselves are intact — a function that is
  not there cannot be over-granted — and nothing about it reaches a restaurant's screen. It needs
  someone who owns `supabase/migrations/`; see handoff H3.
- **Guarded:** `verify-doc-counts.mjs` fails if §4 is ever removed.

---

## 🔗 HANDOFF — the real fix lives in another terminal's file

### H1 → T28 (`scripts/**`) · this is what is keeping CI red

`scripts/verify-t24-money-rules.mjs` line ~583 explains, in a comment, why an earlier version of a
check went red on the four `REJECTED (owner, 2026-08-16)` comments that `CLAUDE.md` requires. Because
that comment contains the literal marker `REJECTED (owner,` and the file does **not** mention
`docs/REJECTED-IDEAS.md`, `verify:rejected` reports it as *"a file claiming a REJECTED decision
without pointing at the doc"*. The guard has an exemption for itself only.

**Exact change (one line):** in that comment, name the doc — e.g.
`…the four \`REJECTED (owner, 2026-08-16)\` comments that CLAUDE.md requires (docs/REJECTED-IDEAS.md)…`
That satisfies the guard's actual intent (a reader can find the decision and its date) and makes
`verify:rejected`, `verify:static` and therefore CI green again. Alternatively, teach
`scripts/verify-rejected-ideas.mjs` that a marker inside a comment ABOUT the marker is not a claim —
but the one-line version is smaller and does not weaken the check.

### H2 → T2 (`app/r/[restaurant]/item/**`) · a dark-default restaurant's dish page opens light

`app/r/[restaurant]/menu/page.tsx` and `app/q/[code]/page.tsx` each render an inline boot script that
re-stamps `data-theme="dark"` when `settings.menuDefaultMode === "dark"` and nothing is saved, because
the root layout cannot know which restaurant is opening.
`app/r/[restaurant]/item/[slug]/page.tsx` renders **outside `AppShell`** — the reason the maintenance
switch, the menu switch and the accent all had to be repeated there — and it does **not** repeat that
script. So for a restaurant whose Default is dark, a **full page load** of a dish URL (a shared link,
a refresh, a QR pointing at a dish) renders in the LIGHT skin while its menu is dark. A client-side
tap from the menu is fine: `data-theme` survives the navigation.

**Exact change:** copy the same guarded `<script>` from `app/r/[restaurant]/menu/page.tsx` (the
`settings.menuDefaultMode === "dark" && (...)` block) into the dish page, above `ItemClient`.
**Severity note, honestly:** neither restaurant on the dev database has the dark default set today, so
nothing is broken right now — the path opens the moment an admin sets it, and the control is shipped.
I documented it in `docs/CLAUDE-DETAIL.md`'s Known-gotchas as the fourth thing of that shape.

### H3 → whoever owns `supabase/migrations/` (T21–T23) · `verify:grants` is red on the dev database

`lfh_request_verification()` is created by `supabase/migrations/296_database_layer_a_sweep_fixes.sql`,
is retired by no later migration, and is **not in the dev database**. `verify:grants` reports it twice
(once as a stale `ANON_ALLOWED` entry, once as a missing function). Either 296 never applied there, or
it was removed by hand. If it is meant to be gone, `DROP` it in a migration so the intent is written
down; if not, re-apply 296. Nothing here reaches a restaurant's screen and no grant is too wide — a
function that does not exist cannot be over-granted. Not in my territory, and it needs the live
database, so it is not a CI matter either.

### H4 → T28 (`scripts/**`) · two stale comments, trivial

- `scripts/verify-cancel-loss.ts` line 3 says it guards *"P1 of docs/CANCEL-AND-LOSS-SPEC.md
  (migration 355)"*. There is no migration 355; the file is
  `340_was_the_food_actually_made.sql` (renumbered from 337 on 2026-08-19). I fixed the copy of that
  number in `docs/GUARD-MAP.md`; the guard's own header still has it.
- `scripts/set-glb-cache.mjs` line ~7 says it only ever read `public/content/menu.json`
  *"(which no longer exists)"*. It does exist and is tracked.

---

## Withdrawn — candidates that did NOT survive checking, recorded so the next sweep does not re-raise them

- **`docs/CLAUDE-DETAIL.md` "points at the deleted `.claude/work-checker-lessons.md`".** A mechanical
  dead-pointer scan flagged it. Reading the context: both mentions are already deletion RECORDS —
  one says *"which was deleted when the work-checker was retired"*, the other sits under
  **"What was deleted that day, and must never be recreated"**. The document is correct. I had
  started an edit and reverted it; the file's diff for this is empty.
- **`docs/PROJECT-HISTORY.md` "points at the retired `docs/FLOOR-TIMEOUT-WATCH.md`".** Same shape.
  The heading above it reads *"CLOSED 2026-08-05 — measured, and the watch retired"* and the sentence
  says the files *"were designed to be deleted once answered"*. Correct as written; edit reverted,
  diff empty.
- **`next.config.ts`'s `images.remotePatterns` grant for `images.unsplash.com` is dead.** It is not.
  `public/content/starter-menu.json` carries 10 unsplash photo URLs and is read by
  `lib/starterMenu.ts` — a brand-new restaurant's first dish photos come from there.
- **Eight HISTORY documents "have lost their `⚠️ HISTORY` banner".** My first grep looked for
  `⚠️ HISTORY` and the banners are written `⚠️ **HISTORY`. All nine are present and correct.
- **19 duplicated migration numbers.** `verify:ui` already reports *"362 migrations, no NEW duplicated
  number (19 already on main)"* — a known, accepted state, not something this sweep discovered.
- **The printing route's done/failed report accepts a job no computer has claimed** (`job.agent_id &&
  job.agent_id !== agent.id`), while the document fetch requires a claim strictly. I could not state
  a normal-use path that reaches it, so per §5 it is not a finding and I changed no working code.
  Listed as a 🟡 for him instead.
