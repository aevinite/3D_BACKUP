# Sweep #6 · T19 — improvements

## 🟢 Built (inside territory, no migration, no new screen)

- **`verify:admin-api-a`** (`scripts/verify-admin-api-a.mjs`, 179 checks, static, no database) —
  the four rules the admin server routes have to keep, so every fix in this pass has a guard:
  1. the sign-in gate precedes the first database call, in every exported handler, on **all 49** routes;
  2. named columns (two declared exceptions, each with its reason);
  3. every list read carries an explicit ceiling;
  4. no database sentence in a response body (two declared exceptions), and a failed save never
     reported as "couldn't load".
  It also carries two lessons about itself: line comments must be stripped BEFORE block comments, and
  a sanity check proves the stripper ate no code before any rule runs.

## 🟡 For him to decide (not built)

1. **Adopt `lib/readGuard.ts` (`ReadSet`) across these 25 routes.** Items 1–4 and 12 were each the
   same missing `.error` check, fixed by hand five times. The shared helper turns "did every read
   work?" into one line and makes a tolerated read a visible decision. Well over 150 lines of change
   across 25 files, so it is his call, not mine.
2. **No clash guard (`{ expect: … }`) added on these writes.** Only one admin account exists, so a
   clash is a second tab, not a second person. Building it now would be machinery for a case that
   cannot happen yet — worth revisiting if a second platform operator is ever added.
3. **The billing page could show the "next-due didn't move" warning.** Finding 9 now returns
   `warning` in the reply; surfacing it needs a change in `app/aevinite/billing/page.tsx`, which is
   T16's territory.
