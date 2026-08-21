# T29 improvements — built (🟢) and left for a decision (🟡)

Sweep #6, terminal 29. Rules: `.claude/sweep/SWEEP-RULES.md` §6. Nothing here is code tidying that no
person would notice, and nothing here is in `docs/REJECTED-IDEAS.md` (all 43 rows re-read against this
list first — zero overlap).

---

## 🟢 BUILT

### I1 · A guard for the numbers in the rulebooks
`node .github/scripts/verify-doc-counts.mjs`, wired into `.github/workflows/checks.yml`, with a row in
`docs/GUARD-MAP.md` §11. 20 counts across `CLAUDE.md`, `README.md`, `docs/CLAUDE-DETAIL.md`,
`docs/GUARD-MAP.md` and `docs/SECURITY-CHECKLIST.md`; plus "every admin route really carries the gate"
and "every `app/api/<family>` is named in the Security-gate section"; plus four load-bearing sentences
that must not vanish. Repo-only — no database, no login, no network, no `.env.local` — which is what
lets it run in CI in every worktree. Each count is anchored to its own sentence so a re-wording fails
LOUDLY rather than switching the check off silently. **Proven to exit 1 on a wrong count.**
*Why it earns its place:* `verify:pointers` already checks that every PATH and every `npm run` in
`CLAUDE.md` resolves. Nothing checked the numbers, and five of them had drifted into four documents
each. Cost: one more ~1-second CI step.

### I2 · A guard for the twin panel routes
`node .github/scripts/verify-twin-route-parity.mjs`, also in CI, also with a guard-map row. Every panel
must name its browser tab, its twin at `/r/<slug>/…` must agree, the three must differ from each
other, none may fall back to the root default, and both consoles must name theirs too.
**Proven to exit 1 when a title is removed.** *Why:* the T15 sweep named the tab on one side of each
pair; six weeks later the other side was still generic and nothing would ever have said so.
Companion to `verify:twins`, which covers the panels' behaviour rather than their route files.

### I3 · The admin console names its browser tab
`app/aevinite/layout.tsx` had no `metadata`, so **all 23 pages** of the console showed the root
layout's generic "Aevidine — Restaurant OS". `app/owner/layout.tsx` has had the line for its 16 pages
since the T15 sweep. The admin console is the surface most often open BESIDE a panel, so it was the
worst remaining one. One line, 23 pages: **"Admin console — Aevidine"**. Guarded by I2.
*Trade-off:* none I can find — it changes one string in the tab strip and nothing on any screen.

---

## 🟡 NOT BUILT — a decision for the owner

### J1 · `CLAUDE.md` has 56 bytes of headroom left
- **Where:** backend only, nothing on screen. It is the file every session reads before you type.
- **What it is:** a guard caps it at 24,000 bytes on purpose (the pre-split version was diluting
  rule-following). It is now 23,944. The **next rule anyone adds turns CI red.**
- **If yes** (move one section's remaining narrative into `docs/CLAUDE-DETAIL.md`): room for the next
  few rules, and the budget keeps meaning something.
- **If no:** nothing breaks today. The next person to add a rule hits a red check and has to decide
  which section to move — under time pressure, which is the worst moment to choose.
- **Effort:** ~30 minutes, and it is a judgement about which rule stays in the index.
- **Risk:** low mechanically, real editorially — moving the wrong line is how a rule stops being
  followed. That is why I did not pick for him. Raising the number is **not** the answer: the guard's
  own comment records that raising it is how the last budget stopped working.

### J2 · `supabase/` (362 files) is uploaded on every deploy
- **Where:** backend only, nothing on screen. `.vercelignore`.
- **What it is:** that file already excludes `/docs`, `/tests`, `/LEARN-MY-APP`, `/access-designs`,
  `/reference` and the competitor research — ~26 MB, "27% of the repo", on a stack that genuinely
  exhausts its ~100-deploy daily cap. `supabase/migrations/` is 362 SQL files that nothing at build
  time and nothing at runtime reads.
- **If yes:** a smaller, slightly faster upload on every one of those deploys.
- **If no:** nothing breaks. It is upload time, not runtime cost.
- **Effort:** one line, plus one deploy to confirm.
- **Risk:** **this is why I did not do it.** A wrong `.vercelignore` line has already 404'd the whole
  manager panel once (the unanchored `/editor` story is written into that file). I grepped and found
  nothing reading `supabase/` at build time, but "I grepped and found nothing" is not the same as
  "the next build is fine", and the blast radius is the live site. His call, and worth a deploy of
  its own rather than riding along with something else.

### J3 · The printing done-report accepts a job no computer has claimed
- **Where:** backend only, nothing on screen. `app/api/print-agent/[...path]/route.ts`, the
  `POST /job/:id/done|failed` branch.
- **What it is:** fetching a print DOCUMENT requires the job to be claimed by the machine asking
  (`job.agent_id !== agent.id` → refuse). Reporting it done or failed only refuses when the job is
  claimed **by someone else** (`job.agent_id && job.agent_id !== agent.id`), so an unclaimed job
  would be accepted. Marking an unclaimed job "done" would mean a ticket recorded as printed with no
  paper — which is the one promise the queue makes.
- **If yes** (make the two checks identical): the two halves of the same rule stop disagreeing.
- **If no:** **nothing breaks that I can demonstrate.** A helper only ever learns a job id by
  claiming it, and claiming sets `agent_id`. `ON DELETE SET NULL` can null it when the admin removes
  that computer — but removing it also kills its token, so it can no longer report anything.
- **Effort:** 5 minutes.
- **Risk:** low, but non-zero and pointed at paper. I could not state a normal-use path that reaches
  it, and §5 says not to change working code on that basis. His call.

### J4 · `/r/<slug>/<panel>` does not carry the console's per-tab pins
- **Where:** manager / kitchen / tablet, when reached at the restaurant's own address. Nothing on
  screen today.
- **What it is:** the `/manager` family builds its iframe URL through `panelIframeSrc()`, which
  carries three admin-only pins — `rid` (which restaurant), `view=real` (show the panel as the role
  really gets it) and `as=<staff id>` ("Visit their panel"). The `/r/<slug>/…` twins build the URL by
  hand and carry only `rid`.
- **If yes:** "Visit their panel" and the real-view toggle would also work if the admin ever opened a
  panel at a restaurant's own address.
- **If no:** nothing breaks. Nothing in the console links to those addresses — I grepped — so the
  pins have nowhere to come from. They are the staff's own door.
- **Effort:** ~20 minutes to route both families through one builder.
- **Risk:** medium, and it is why this is a 🟡 rather than a fix: `view`/`as` are admin-only pins, and
  widening where they are accepted is a permission-shaped change, not a tidy-up. It should be a
  deliberate decision, not a side effect of a docs sweep.

### J5 · Five unused Next starter SVGs in `public/`
- **Where:** nothing on screen, ever. `public/{file,globe,next,vercel,window}.svg`.
- **What it is:** leftovers from `create-next-app`. Referenced by nothing (I grepped `app`,
  `components`, `lib`, `public/panels`).
- **If yes:** five fewer files in the repo.
- **If no:** nothing. They are tiny and no person will ever see them.
- **Effort:** one minute.
- **Risk:** none — but it is also not an improvement to a restaurant's day, and §6 says pure tidying
  that nobody would notice is not an improvement. Mentioned only so the next sweep does not
  "discover" them again.
