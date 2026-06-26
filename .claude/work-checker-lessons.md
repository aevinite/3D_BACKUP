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

- **In a git worktree, keep the user's MAIN checkout synced or they think work vanished.** This
  session ran in `.claude/worktrees/feat+saas-multitenant`; the owner's `backup_Menu` folder sat
  on the session-start commit (6a3c499) the whole time because nothing pulled it. They asked
  twice "why are you in worktree, work should be in backup_Menu" — they were looking at stale
  code. Fix: explain the worktree↔main relationship plainly AND, after merges, fast-forward their
  main checkout (`git -C <main> pull --ff-only origin main`) so what they open matches what's live.
