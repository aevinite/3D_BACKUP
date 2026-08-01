# SESSION CONTEXT — read this FIRST after any compaction

Written 2026-08-01. **This is the live working state of this session.** If context was compacted,
read this file and `docs/ACCESS-REDESIGN-SPEC.md` before doing anything else. Delete both only
when every line is built, verified and merged.

---

## 0 · Where the work happens

| | |
|---|---|
| Worktree | `/Users/aevinite/Documents/Projects/backup_Menu/.claude/worktrees/access-truth` |
| Branch | `deploy/b2` (tracks `origin/main`) — commit, PR, squash-merge, then deploy |
| Repo | `aevinite/3D_BACKUP` |
| **Deploy target right now** | **backup-2** — `https://3d-backup-2.vercel.app` |
| Admin password (backup-2) | `Rishi@12321` |
| Dev server for checks | `npx next dev -p 4055` — NEVER port 4000 (that is the shared folder) |

**How to deploy to backup-2** (git push does NOT deploy it — it is CLI-only):
```
cp -R /Users/aevinite/Documents/Projects/backup_Menu_2/.vercel .
TOK=$(tr -d '\n\r' < /Users/aevinite/Documents/Projects/backup_Menu/.claude/.vercel2.token)
npx vercel@latest deploy --prod --token "$TOK"
rm -rf .vercel
```
**backup-1 (`3-d-backup`) is deploy-capped** until ~09:20 on 2026-08-02 (100/day free limit), so
backup-2 is currently AHEAD of backup-1 — the reverse of the usual rule. Catch backup-1 up when
the cap resets.

**Open it for him in Chrome** (he asks for this constantly). Must be `run_in_background: true`
or the window dies with the command:
```js
// node_modules/.cache/o.mjs — launchPersistentContext({channel:"chrome", headless:false}),
// sign in through the FORM at /staff-login (one login), then goto /aevinite/access.
```

---

## 1 · What this whole session is about

Rebuilding **`/aevinite/access`** — the Access & permissions screen — to the owner's spec.
Model: `lib/accessTree.ts`. Screen: `components/admin/AccessTree.tsx`. Embedded editors:
`components/admin/RestaurantSettings.tsx` + `components/admin/BrandingCard.tsx`.
Read/write: `app/api/admin/restaurants/access-tree/route.ts`. Guard: `npm run verify:access`.

### Already shipped this session (do NOT redo)
- The permission fault: `managerCan` read an absent key as NO while the screen showed the row's
  default (usually YES). One rule now — `managerGrantValue()` in `lib/accessTree.ts`: a flag with
  a row → that row's `def`; a flag with **no** row → **ON** (its module toggle is the switch).
  Read by `managerCan` (editor route), `invCan` (inventory route) and `MP_DEFAULT`.
- `access_config[<flag>].on` = the **feature** half ("does this restaurant have it"), checked in
  `managerCan` BEFORE the grant and before any per-person override. Absent = ON, no migration.
- Sections: **Main features · Extra features · Manager · Owner's menu · Default set for user**.
- **Manager** → **Manager menu** → Edit menu (9 parts) · Ratings · Log · Dashboard · **Bill**
  (Delete a bill · Reopen with a settable window), then *What a manager may do*.
- Five things stopped being features (permanently on, no row): take an order · mark a bill paid ·
  generate bills · mark a table's type · move/merge/split.
- Owner's menu gained **Audit** with the activity log inside it.
- The mark-paid **undo bars are removed** (tables close instantly; reopening is the audited path).
- Colours sampled from HIS icon: **#5f47ed → #8344ee → #ad50c5 → #dd649e**. The **section card is
  level 0** — that was the long-missed bug behind "blue inside blue".
- The row control he picked (**design 20**): switch right, sliding LEFT as a **fixed-width**
  `Default` chip grows open on its right. Fixed width matters — "On" vs "On + PIN" resized it and
  shoved the switch. Label is one word, "Default", because it applies to EVERY user of that role,
  not only new ones.
- **One save bar**, not seven (see §3).

---

## 2 · What is LEFT (the only outstanding work)

1. **Banquet billing UI** — cramped and unfriendly; reorganise it properly.
2. **Banquet preview** — show what the banquet bill will look like.
3. **Prove bill saving works** — he reported the fallback tax rate not saving. Very likely fixed
   by the save-bar work in §3, but it has NOT been proven with an edit → save → reload.
4. **Test every feature and every toggle** — his words: "test all the feature and all the toggle,
   is it working as it should".

---

## 3 · Bugs found and fixed — the WHY, so they are not reintroduced

- **The save bar was SEVEN save bars.** `RestaurantSettings` drew its own fixed bar; Access mounts
  it seven times (billing, banquet, kitchen, sessions, tables, floor, qr). Seven stacked on one
  spot = his "two buttons" and the flicker. Worse: each instance kept its **own draft of the same
  settings row**, so two open panels could each save and silently undo the other. Fixed with a
  module-level registry + one `SettingsSaveBar` exported from `RestaurantSettings.tsx`, mounted
  once on `app/aevinite/access/page.tsx`.
- **"+ Add tax" did nothing.** The editor read through `banquetTaxOf()`, the PRINTING reader,
  which drops blank-label/zero-rate rows. Adding a row appends exactly that → discarded on the
  next render. Editing was broken the same way (map over the FILTERED list ⇒ wrong indexes). The
  editor uses the RAW list now; `banquetTaxOf` stays the reader for what prints.
- **The bill's logo was hardcoded to restaurant #1** (a littlefrenchhouse.in URL). Now every
  restaurant's own `logo_url`; no logo ⇒ the bill starts with its name.
- **The (i) sat on top of the switch** (both top-right). Moved after the controls.
- **Backticks inside the styled-jsx CSS comment** closed the template literal — never put a
  backtick in that block.
- **`verify:access` used to be blind** to rows generated from the `ACTIONS` table (a text scan
  can't see them). It now imports the **compiled** model via esbuild. Keep it that way.

---

## 4 · His standing rules for this screen

- A toggle exists **only** where he listed one; everything else is permanently on.
- Feature **off ⇒ the control is ABSENT**, never greyed — except a dropdown, which **opens
  read-only** so its settings can be READ, and says "turn this on first" if you try to change one.
- **Click anywhere on the row** to open it, not just the chevron.
- Every dropdown starts **closed**.
- No invented sub-options. If a row owns one card, that card goes **on the row**.
- Save bar: **one**, stuck bottom-centre, in this palette (never yellow).
- Colours: section blue → row purple → options pink → blue, four steps before repeating.

---

## 5 · How to verify (he does not accept "it should work")

```
npx tsc --noEmit -p tsconfig.json
npm run verify:access      # 20 checks, reads the COMPILED model
npm run verify:ui
npm run verify:taps
npm run verify:panel-cache -- --fix   # after ANY edit to public/panels/editor/app.js
npm run build
```
Then drive it in a real browser with `scripts/sweep/login.mjs` → `adminCookie(BASE)`.
**Sign in ONCE per run** and reuse the context — repeated logins ping his phone with a
rate-limit alert about himself.

Restoring data after a test is mandatory: capture the original, `finally { restore }`, and
assert it came back byte-for-byte.
