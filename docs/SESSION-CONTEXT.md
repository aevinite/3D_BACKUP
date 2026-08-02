# SESSION CONTEXT — read this FIRST after any compaction

Last written 2026-08-02. **This is the live working state.** After a compaction, read this and
`docs/ACCESS-REDESIGN-SPEC.md` before doing anything. Delete both only when everything is built,
verified and merged.

---

## 0 · Where the work happens — GET THIS RIGHT FIRST

| | |
|---|---|
| **Worktree (ALL work happens here)** | `/Users/aevinite/Documents/Projects/backup_Menu/.claude/worktrees/access-truth` |
| Branch | `deploy/b2` (tracks `origin/main`) |
| Main repo | `aevinite/3D_BACKUP` |
| Failover repo | `aevinite/3D_BACKUP2` (remote `b2repo` in the worktree) |
| **Deploy target now** | **backup-2** — `https://3d-backup-2.vercel.app` |
| Admin password (backup-2) | `Rishi@12321` |
| Local dev | port **4000**, run from the worktree (it IS current main) |

### ⚠️ THE MISTAKE THAT COST REAL TIME — do not repeat
A command that `cd`'d elsewhere (writing to the memory folder) left the shell's cwd in the
**shared folder** `/Users/aevinite/Documents/Projects/backup_Menu`. The next git block ran THERE
and committed **another session's uncommitted work** (`app/aevinite/rate-limits/page.tsx`,
99 lines) into my commit, and pushed it as a PR. Undone with `git reset --mixed`; their file came
back untouched; PR closed, branch deleted.

**Two rules:**
1. **Every git command names its repo: `git -C /abs/path …`.** Never rely on cwd.
2. **Never `git add -A` or `git add <dir>`.** Stage exact FILES by name — a directory scope was
   still wide enough to sweep a stranger's file.

The shared folder is on branch `feat/open-price-items`, 139 commits behind, with ~14 uncommitted
files belonging to other sessions. **Do not touch it, do not check it out, do not update it.**

### Deploy to backup-2 (CLI ONLY — a git push does NOT deploy it)
```
W=/Users/aevinite/Documents/Projects/backup_Menu/.claude/worktrees/access-truth
cp -R /Users/aevinite/Documents/Projects/backup_Menu_2/.vercel $W/.vercel
TOK=$(tr -d '\n\r' < /Users/aevinite/Documents/Projects/backup_Menu/.claude/.vercel2.token)
(cd $W && npx vercel@latest deploy --prod --token "$TOK")
rm -rf $W/.vercel
```
Then sync the failover REPO (the site and the repo drifted 130+ commits apart once):
```
git -C $W checkout -q -B b2sync b2repo/main && git -C $W merge -q origin/main -m "chore(backup-2): sync with main"
git -C $W rm -q -f .claude/REQUESTS.md .claude/work-checker-lessons.md 2>/dev/null   # that repo untracks these on purpose
git -C $W commit -q --no-edit ; git -C $W push -q b2repo HEAD:main
git -C $W checkout -q -B deploy/b2 origin/main
```

**backup-1 (`3-d-backup`) is deploy-capped** (100/day free). It resets ~09:20 each morning, so
backup-2 is currently AHEAD of backup-1 — the reverse of his usual rule. Catch backup-1 up when
the cap allows.

### Open it for him (he asks constantly) — must be `run_in_background: true`
`node_modules/.cache/both.mjs` opens TWO tabs: localhost:4000 and live backup-2, signed in.
Launched in the foreground the browser dies with the command.

---

## 1 · What this session is

Rebuilding **`/aevinite/access`** (Access & permissions) to his spec, then deploying to backup-2.

**Files:** model `lib/accessTree.ts` · screen `components/admin/AccessTree.tsx` · per-person
`components/admin/AccessPerPerson.tsx` · embedded editors `components/admin/RestaurantSettings.tsx`
+ `components/admin/BrandingCard.tsx` · read/write `app/api/admin/restaurants/access-tree/route.ts`
· enforcement `app/api/editor/[...path]/route.ts`, `app/api/owner/staff/route.ts`,
`app/api/inventory/[...path]/route.ts`, `app/api/maintenance/route.ts`.

---

## 2 · Structure as it stands (all shipped)

```
Main features    Menu (dining session & location · ratings · show reviews · 3D · allergy &
                 notes · favourites · veg · format & theme · maintenance · bubble effect)
                 Auto-print KOT · Bill (Format, one form) · Table (name & seats / per row / QR)
Extra features   Platforms (Zomato·Swiggy·website) · Banquet · Payroll · Inventory · Pay later
Manager          Manager menu (Edit menu +9 parts · Ratings · Audit · Dashboard · Bill)
                 What a manager may do (money actions)
                 What a manager can manage (Settings · manager panel) — the 6 SETTINGS SECTIONS
Owner's menu     Edit menu · Ratings · Audit (log inside it) · Manager mode (left to build)
Default set      Owner · Waiter (the MANAGER folder moved into Manager)
```

### Decisions that are easy to undo by accident
- **Five things are NOT features** (no row, permanently on): take an order · mark a bill paid ·
  generate bills · mark a table's type · move/merge/split.
- **"Change restaurant settings" and "Staff logins" are DELETED as permissions.** Whether a
  manager works with staff logins = whether the **Users** SECTION exists for them.
- **Floor layout (Classic/Custom) is admin-only with NO toggle**; Custom is shown `disabled`,
  "not built yet" — see memory `custom-floor-layout-not-built`.
- **The mark-paid undo bars are removed** (a table closes instantly; correcting a settled bill is
  the audited "Reopen a bill").
- **Delete a bill** = out of the REPORTS; the number is not reused, nothing is erased.

---

## 3 · The rules that took several rounds to get right

- A toggle exists **only** where he listed one; everything else is permanently on.
- Feature off ⇒ the control is **absent**, never greyed — EXCEPT a dropdown, which **opens
  read-only** so its settings can be read, and says "turn this on first" (+ a shake) if you try
  to change one.
- **Click anywhere on the row** to open it, not just the chevron. Controls sit outside that target.
- Every dropdown starts **closed** — but the open state and scroll position **survive a refresh**
  (sessionStorage per restaurant; open state read in the state INITIALISER, not an effect).
- **The admin's scrollport is NOT the window** — `.adm-main` on desktop, `.adm` on a phone where
  the document does not scroll at all.
- No invented sub-options. A row that owns one card puts that card **on the row**.
- **One save bar**, bottom-centre, in the purple palette, never yellow.
- **Colours sampled from his icon**: `#5f47ed → #8344ee → #ad50c5 → #dd649e`. **The section card
  is level 0** — missing that was the long-running "blue inside blue".
- **Hover steps BACK one level** (`--prev`), on EVERY row/chip/section header, text only, scoped
  with `:not(:has(.at-box:hover))` so a child does not light its parent.
- **The two-switch row** (his design 20): feature switch right, sliding LEFT as a **fixed-width**
  `Default` chip grows open. Fixed width matters — "On" vs "On + PIN" resized it and shoved the
  switch. Label is one word, "Default": it applies to EVERY user of that role, not only new ones.

---

## 4 · Bugs found, with their causes — so they are not reintroduced

- **managerCan read an absent permission as NO** while the screen showed the row's default
  (usually YES). One rule now: `managerGrantValue()` — a flag with a row → its `def`; a flag with
  **no** row → **ON** (its module toggle is the switch). Read by managerCan, invCan, MP_DEFAULT.
- **`access_config[flag].on`** is the FEATURE half, checked BEFORE the grant and before any
  per-person override. Absent = ON, no migration.
- **The save bar was SEVEN save bars** — `RestaurantSettings` drew its own and Access mounts it 7×.
  Worse: each kept its OWN draft of the SAME row, so two open panels could silently undo each
  other. Now one registry + one `SettingsSaveBar`.
- **"+ Add tax" did nothing** — the editor read through `banquetTaxOf()`, the PRINTING reader,
  which drops blank rows; adding one appended exactly that. Editor uses the RAW list now.
- **The bill's logo was hardcoded to restaurant #1.** Now each restaurant's own `logo_url`.
- **The panel cache `?v=` hash** hid the new Audit tab for up to 24h. It has conflicted on rebase
  **three times**. It can only be **recomputed** (`npm run verify:panel-cache -- --fix`), never
  chosen or hand-edited.
- **Backticks inside the styled-jsx CSS comment** close the template literal. Never use one there.

### The guard has been wrong twice — both fixed
- It could not see rows generated from the `ACTIONS` table (a text scan misses them) → it now
  imports the **compiled** model via esbuild.
- For a tab/section row it asked whether the key appeared anywhere in the codebase — keys are
  words like `tables`/`users`, so six unread rows passed green → it now requires the real reader.
- It also checked columns against ONE migration with a hand-typed exception list → scans all now.

---

## 5 · Still to do

1. **Waiter sections move into the tablet user's own profile** (currently a Settings section).
2. **More tablet powers** he said are coming — the group is built so each is one line.
3. The staff **PROFILE** another session is building gets "Access & permissions → What a manager
   can manage", reading the SAME keys. **Do not build the profile — that session owns it.**
4. Catch **backup-1** up when its deploy cap resets.

---

## 6 · How to verify (he does not accept "it should work")

```
npx tsc --noEmit -p tsconfig.json
npm run verify:access          # 20 checks, reads the COMPILED model
npm run verify:ui ; npm run verify:taps ; npm run verify:clash
npm run verify:panel-cache -- --fix     # after ANY edit to public/panels/editor/app.js
npm run build
```
Then drive it in a browser: `scripts/sweep/login.mjs` → `adminCookie(BASE)`.
**Sign in ONCE per run** and reuse the context — repeated logins ping his phone about himself.
Any script that mutates data writes its snapshot to a FILE **before** the first write and restores
in a `finally`.
