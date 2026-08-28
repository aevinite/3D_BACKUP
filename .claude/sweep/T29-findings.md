# T29 findings — sweep #7, docs · tooling · root config · the remainder

Terminal 29 of 40, 2026-08-27/28, against `origin/main` **c005b3d3**.
Branch `sweep7/t29-docs-and-remainder` · worktree `../wt-s7-t29` · port **4229**.

Ledger: `.claude/sweep/LEDGER/T29.md` — 500 sweep-#6 rows re-run in place, plus 500 new rows in
`P29101`–`P29600`. **No regression.** Three sweep-#6 rows were filed green on a claim that was never
true; those are items 1, 4 and 5 below.

Every item below is one commit, with its number in the message, so any single one can be dropped.

---

## 1 · Nine documents in `docs/` had no row in the index of that folder
**Where:** backend only, nothing on screen — the contents page a session reads to find out what has
been written down about this app.
`docs/README.md`'s own closing line promises "Adding a document? Put it in the right table above in
the same commit." Nine live documents had no row: `SECURITY-CHECKLIST.md`, `KITCHEN-PRINT-SETUP.md`,
`PRINT-HELPER.md`, `PRINT-TEST-PLAN.md`, `CANCEL-AND-LOSS-SPEC.md` and all four HRMEX documents.
All nine existed before sweep #6 ran, so `P14044`'s green was **false, not a regression**.
**Fix:** all nine listed; the four HRMEX ones get a third table, **STUDIES**, because they are live
documents describing something that is *not built*.
**Guard:** `.github/scripts/verify-doc-counts.mjs` §5 — fails when a file in `docs/` has no row.

## 2 · The rulebook described a floating panel switcher deleted in June
**Where:** backend only, nothing on screen — `docs/CLAUDE-DETAIL.md`'s app map.
It said, in the present tense, that an "admin-only floating switcher (`components/AdminSwitcher`)
hops between panels". That component was deleted on **2026-06-26**, commit `2b9d3933`, whose message
is *"kill dead AdminSwitcher"*.
**Fix:** the sentence records the deletion and says not to re-create it.
**Guard:** `verify-doc-counts.mjs` §6 — every code path named in a LIVE rulebook resolves, or is on
an explicit list of recorded deletions. It is a LIST and not a prose heuristic on purpose: the first
draft read the surrounding sentence for the word "deleted", and that paragraph ends "…were deleted",
so it would have waved through the exact shape it exists to catch.

## 3 · The guard map sent anyone editing the guest API to a folder that does not exist
**Where:** backend only, nothing on screen — `docs/GUARD-MAP.md` §12's routing table.
It named `app/api/menu`. That has never existed; the guest API family is `app/api/guest`.
**Fix:** the row names the real folder. **Guard:** the same §6 as item 2.

## 4 · A dead owner component
**Where:** Owner panel — nothing on screen, in either skin; it is mounted nowhere.
`components/owner/RangeSlider.tsx` — the segmented date-range control the owner picked in July 2026.
The dashboard v2 rebuild replaced one global range strip with a per-card range dropdown (his own
later decision) and the file was left behind, imported by nothing. `P14188`'s "8/8 used" was wrong.
**Fix:** deleted. **Guard:** `P29438`/`P29439` in the ledger re-derive "every owner component is
imported by something" on every re-run.

## 5 · Nothing in this repo had ever read `next.config.ts`
**Where:** backend only, nothing on screen — but that file decides what every visitor's browser is
told.
`docs/GUARD-MAP.md` §11 answers *"I changed this file — which check covers it?"*. It had a row for
`.vercelignore` and for `package.json`'s dependencies, and **none for `next.config.ts`**. A grep of
every guard in the repo found not one that reads it. That single file holds the response headers,
whether the content policy is still report-only (parked 2026-08-16), whether HSTS carries `preload`,
which eight surfaces refuse an outside frame while the guest menu deliberately does not, and which
outside image hosts are granted. Each fact was hand-verified by a sweep every few weeks and by
nothing in between. `P14466`'s green was **false**.
**Fix + guard:** `.github/scripts/verify-root-config.mjs` — **24 static checks** over
`next.config.ts`, `vercel.json`, `.vercelignore`, `package.json`'s scripts and `tsconfig.json`.
Repo-only. Wired into `.github/workflows/checks.yml`, plus the missing §11 row.
Proven to exit 1 on five separate breakages — including a `preload` added to HSTS, which the first
draft could NOT see because the header value itself contains a semicolon and the lazy match stopped
inside the string.

## 6 · After linking a printer's computer, a manager was sent to a password prompt
**Where:** the Allow page a printer's computer opens for itself (`/pair`) → the green **"This
computer can print now"** screen → the button **"Choose which printer prints what →"**. Same on the
**"Already linked"** screen.
That button went to `/aevinite/printing` for everybody. The printing board lives in TWO places
(mig 367): the Aevidine console, and the restaurant's own **Manager panel → Settings → Printing**.
The person at the printer is usually the manager, and `/aevinite` redirects them to
`/staff-login?next=/aevinite` — a password prompt they have no answer to, which reads like their own
sign-in just failed, at the exact moment the guide says to go and choose printers.
**Fix:** the button branches on who pressed Allow. The admin still gets the console; a manager gets
their own panel plus a line naming **Settings → Printing** in words (the panel has no deep link to
that section, so the words are the direction). `GET /api/pair`'s already-linked answer now carries
`who` — without it that screen could not tell the two apart.
**Guard:** `.github/scripts/verify-unowned-routes.mjs`, also in CI. It judges each `/aevinite` link
**by the line it is written on**, not by whether the file mentions an admin check somewhere — the
first draft did the latter and would have passed the original fault.

## 7 · The printer guide replaced the Printing screen instead of opening beside it
**Where:** Admin console → **Printing** → the header line **"The restaurant's own guide →"**.
Four other places offer that same guide — the owner's Settings, the admin restaurant card and its
three per-OS jumps — and all four open it in a new tab, because it is read *while* a printer is
being set up. This one used `next/link`. The guide is a static file in `public/`, not a route, so it
navigated in place: the screen somebody was mid-setup on disappeared, and the guide has no way back.
**Fix:** a plain link with `target="_blank" rel="noopener"`, identical to the other four.
**Guard:** `verify-unowned-routes.mjs` now checks all five call sites.

## 8 · Every button label on the Allow page sat jammed against the top of its button
**Where:** the Allow page (`/pair`) — every screen of it, on a phone and on a desktop. The label sat
flush against the TOP edge of a 52px button with **34px of empty space underneath**, measured.
The rule asked for `line-height: 52px` and then, three declarations later, `font: inherit`. `font`
is a **shorthand**: it resets `line-height` to `normal`, so the 52px was thrown away and the browser
fell back to a 19.5px line at the top of a 52px box. Nothing else was wrong — markup, class names,
colours and the tap target were all correct, which is why no existing guard could see it.
**Fix:** centred with grid instead. That also survives a label that WRAPS, which "Choose which
printer prints what →" does on a phone; a 52px line-height would have pushed the second line out.
**Guard:** `verify-unowned-routes.mjs` fails when any rule on that page declares `line-height`
before a `font` shorthand.

---

## Not fixed, and why

| what | why not |
|---|---|
| **A restaurant whose admin sets the DARK menu default gets a LIGHT dish page on a full page load.** `app/r/[restaurant]/menu/page.tsx` carries the boot script behind `settings.menuDefaultMode === "dark"`; `app/r/[restaurant]/item/[slug]/page.tsx` carries none. Ledger rows `P14317`, `P14460`, `P14462`. | **T2's file** — outside this territory. Handed off by sweep #6 and still open on `main`. Neither dev tenant has the dark default set today, so nothing is broken right now; the path opens the moment an admin sets it. |
| **`public/content/starter-menu.json` loads 62 of its 72 dish photos from `www.themealdb.com`, which `next.config.ts` does not grant.** Ledger row `P29492`. | Nothing breaks today: the dish cards render a plain `<img>`, not `next/image`, so the grant is never consulted, and the content policy allows any https image host. Granting an outside host is a **permission decision**, and it is a landmine only for the day a card switches to `next/image` — where it would hit **brand-new restaurants only**. Reported as a numbered decision, not silently granted. |
| **Three rows on `.claude/REQUESTS.md` are built in the code but still read as owed** (the 2026-07-28 per-tab admin session separation, the `?view=real` "see the actual panel" toggle, and the `admin:view` log marking with its 🛡 pill). | His own rule says a tick means built **AND watched working in a browser**. I have code evidence for all three and a browser check for none. Ticking them would claim something I did not do. Raised as a numbered decision instead. |

## After he read the report — 2026-08-28

He answered the numbered items. What changed:

| item | his answer | what happened |
|---|---|---|
| **6** — the Allow page sent a manager to a password prompt | **don't do it** | reverted, and the two checks that guarded it removed in the same commit — a guard left asserting a reverted fix is a red check nobody can act on |
| **7** — the printer guide replaced the Printing screen | **don't do it** | reverted, same commit, guard check removed |
| **8** — button labels jammed at the top of their buttons | *"show me the visual diff"*, then **do it** | shown side by side on port 6765 (before/after, desktop and phone, with the measured 0px-above/34px-below and 16/18 after); **kept** |
| **9** — `CLAUDE.md` had 56 bytes left | **do it** | 23,944 → 23,209. No rule dropped: two bullets that had grown back into paragraphs were compressed to pointers, both already written out in full elsewhere |
| **10** — a starter-menu image host was not granted | **do it** | granted, and the guard now checks BOTH directions |
| **11** — three built rows read as owed | **do it** | two driven in a browser and ticked; the third part-verified and deliberately left open, with what was and was not seen written into the row |
| **12** — the dish page lost a restaurant's DARK default | **do it** | fixed in T2's file on his explicit word, driven with a real dark-default restaurant, guarded, and the detail doc's paragraph flipped from a known-fault note to the rule |
| **13** — five unused starter pictures | **do it** | deleted |

**Final tally: 500 sweep-#6 rows re-run (494 ✅ · 6 ⏭ · 0 ❌ · 0 regressions) and 500 new rows
(500 ✅). Eleven items fixed and on the branch; two fixed and then reverted on his word.**

## Guards added by this run

| command | checks | where it runs |
|---|---|---|
| `node .github/scripts/verify-doc-counts.mjs` (extended) | +2 sections: every document in `docs/` has a row in its index; every code path named in a live rulebook resolves or is a recorded deletion | CI, every push |
| `node .github/scripts/verify-root-config.mjs` (**new**) | 24 — the browser headers, the region, the upload list, the build settings | CI, every push |
| `node .github/scripts/verify-unowned-routes.mjs` (**new**) | 15 — the Allow page and its door, the setup-guide links, the two crash boundaries, the first paint | CI, every push |

All three are repo-only: no key, no database, no network, no running app. Every one was proven to
exit 1 before it was committed.

## Gates

`npm run typecheck` ✅ · `npm run lint` ✅ (0 errors) · `verify:static` 33/33 ✅ ·
`verify:access` ✅ · `verify:pointers` ✅ · `verify:no-ask` ✅ · `verify:rejected` ✅ ·
`verify:print-helper` 100/100 ✅ · `verify:taps` ✅ · `verify:twins` ✅ · `verify:ui` ✅ ·
`verify:deps` ✅ · `verify:clash-coverage` ✅ · `verify:ledger-index` ✅ · `test:money` /
`test:errors` / `test:units` ✅ · the three new guards ✅. `verify:everything` was **never** run.

Zero database rows created. Aangan read once, never written. Port 4229 only. Four sign-ins for the
whole run.
