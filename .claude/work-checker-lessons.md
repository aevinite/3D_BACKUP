# Work-checker lessons

- **Verify panel UIs at mobile width, not just desktop.** I built/redesigned the
  admin/owner (+ manager) panels and called them "verified" after only checking at
  ~1440px. The owner then found them not responsive on mobile. This is a restaurant
  SaaS — owners/managers check on phones. Before claiming a panel UI is done, screenshot
  it at ~390px too (Chrome MCP `resize_page` 390×844). The guest menu is mobile-first;
  the staff/owner/admin panels were desktop-first and needed explicit breakpoints.

- **Roles must be SEPARATE sessions unless told otherwise.** I made the admin AUTH_COOKIE a
  super-cookie that also unlocked the OWNER panel, and the owner panel's logout button called
  the ADMIN logout endpoint. Result: admin "became" owner, and logging out of one killed the
  other. The owner wanted admin and owner as completely independent things. Lesson: each role
  (admin / owner / manager / kitchen / tablet) gets its own login, its own home panel, and its
  own logout that clears ONLY its own cookie. Don't let a higher role silently inhabit a lower
  role's panel — give it an explicit, separate "view as / drill-in" instead.

- **When the user cites specific research, OPEN it before claiming a redesign is "done".** The
  owner repeatedly pointed at `All_compitior_POs_INFO/`; I judged the panels "competitor-grade"
  without ever looking. They were right that I hadn't. Actually view the reference screenshots,
  match the concrete patterns (e.g. sliding switches, not ON/OFF pills), then show it.

- **Seed demo data with the app's VALID status enum.** My `seed-today.mjs` set dine-in orders to
  `status:"new"`, but valid dine-in statuses are `received/preparing/served/cancelled` ("new" is
  aggregator-only, per `ORDER_STATUSES` in the editor route). Invalid statuses silently break the
  accept/render flow. Always check the real enum before inserting fixture data.

- **In a git worktree, keep the user's MAIN checkout synced or they think work vanished.** This
  session ran in `.claude/worktrees/feat+saas-multitenant`; the owner's `backup_Menu` folder sat
  on the session-start commit (6a3c499) the whole time because nothing pulled it. They asked
  twice "why are you in worktree, work should be in backup_Menu" — they were looking at stale
  code. Fix: explain the worktree↔main relationship plainly AND, after merges, fast-forward their
  main checkout (`git -C <main> pull --ff-only origin main`) so what they open matches what's live.

- **A slow endpoint? MEASURE each layer before guessing a fix.** The owner dashboard took ~135s;
  I guessed "missing index" (added it — no change), then "DB connection saturation" — both wrong.
  Timing each layer showed: the RPCs are fast direct (~300ms over 1142 rows), and the endpoint
  was 1.2s with load OFF — so it was load-induced request queuing on the single-process DEV server
  (many open polling/realtime tabs + a write storm), NOT the DB/query. Lesson: time direct-RPC vs
  through-the-app, and with-load vs without-load, to localize the bottleneck before shipping a fix;
  don't pattern-match to "index/connection." (The real fix was idle-disconnect for stale tabs.)

- **A CLI auto-init failing ≠ the tool "doesn't work" — find the manual path before recommending defer.**
  I concluded shadcn was unusable because `npx shadcn init` bailed on the Tailwind-4/PostCSS preflight,
  and recommended deferring. The owner pushed back ("it will work, find where to edit") — and was right:
  shadcn works here with MANUAL setup (deps + cn + components.json + `tw-animate-css` import), and its
  animation utilities are the valuable part. Lesson: when an owner clearly wants a library, the auto-installer
  failing is a signal to wire it by hand, not to recommend skipping it. Offer the manual path proactively.

- **"Claimed fixed but still broken" was usually a STALE DEV SERVER + a missing dep — verify the
  server's source.** The owner raged that the panel shifter, multi-restaurant access, and
  per-tenant branding were all still broken. On main they were ALL already fixed; the dev server
  on :4000 was running from the WORKTREE (`lsof -p <pid> -d cwd`), serving stale code. WORSE: a
  branch that merged into main added `recharts` to package.json but main's node_modules was never
  reinstalled → `/aevinite` died with a build error, so the whole admin panel looked broken.
  Lessons: (1) before trusting/denying a "still broken" report, confirm WHICH checkout the dev
  server runs from (`lsof`), and verify on a server you KNOW is main; (2) after merging a branch
  that touched package.json, run `npm install` in the consolidated checkout; (3) don't blanket-
  blame "stale cache" — verify each reported bug independently (some are real, some aren't).
