# T1 — GUEST MENU CORE · problems found and fixed

Territory: the three guest doors (`/menu`, `/r/<slug>/menu`, `/q/<code>`), `MenuView`, `FoodCard`,
`NavPicker`, `Header`, `HeroTitle`, `GuestChrome`, `GuestNotFound`, `IntroSplash`, `ComingSoon`,
`app/page.tsx`, `app/not-found.tsx`.

500 phases run twice. **3 problems found; 2 fixed, 1 ruled a deliberate design by the owner and
reverted (R29).** Every fix carries a static guard in `scripts/verify-guest.mjs` proved to fail on
the pre-fix code.

---

## F1 · A differently-cased menu link loses the diner's table — HIGH · confirmed

**Who is worse off:** a diner, and the waiter serving them.
**Where:** guest menu → any door reached with a slug whose casing differs from the stored one
(`/r/French-House/menu?table=4`). On screen the menu looks perfect; what breaks is invisible.

**What happens.** `getRestaurantBySlug` folds case, so the odd casing resolves and renders. MenuView
is handed `r.slug`, so the browse state it owns is scoped correctly. But the **cart, the scanned
table, the favourites and the dining session** do not go through MenuView — they go through
`lib/tenantStorage`, whose `tenantSlug()` reads the slug straight out of `window.location.pathname`
without folding it. One diner on one phone therefore had two scopes at once:

```
lfh_menu_layout:french-house      ← MenuView, resolved slug
lfh_table:French-House            ← tenantStorage, as typed      (measured, /menu?table=4)
```

The table is what costs someone something. The menu builds its own dish links from `r.slug`, so the
**first dish the diner taps** moves them to the lower-case address, where `getScannedTable()` returns
`""`. They are asked to join a table again, at a table the app had already been told about.

**Reachable when:** any link whose casing differs — typed by hand, shared through an app that
capitalises, or a QR generated with different casing. Measured on this dev stack at 360×780.

**Fixed by:** canonicalising at the door. `app/r/[restaurant]/menu/page.tsx` now redirects to
`/r/<canonical-slug>/menu` when the address differs, carrying the query verbatim so `?table=N`
survives. Every later page in that tab inherits the corrected path, so cart, favourites and session
agree with the browse state without any of them knowing about casing. When the casing already
matches (the normal case) nothing happens.

**Guard:** `verify:guest` → `P00155`.
**Confirmed after the fix:** `/r/French-House/menu?table=4` → `/r/french-house/menu?table=4` with
`lfh_table:french-house = 4`; `/r/FRENCH-HOUSE/menu?t=9&x=1` keeps both parameters.

### ✅ ROOT CAUSE ALSO FIXED — `lib/tenantStorage.ts` (owner granted permission, 2026-08-17)

`tenantSlug()` now folds the path segment it reads, and `tgetFor`/`tsetFor` fold the slug they are
handed. That is the root cause: it protects a guest who lands *directly* on `/r/<Slug>/item/...`
from a shared dish link, without ever passing through the menu page. Safe because a slug is
lower-case by construction wherever it is created, so folding can only correct a mis-cased address —
it can never point at a different restaurant.

---

## F2 · The waiter bell parks on a control — REPORTED, FIX REVERTED ON THE OWNER'S WORD

**Status: NOT a fault any more. It is R29.** The measurements below stand and are reproducible; the
owner has weighed them and ruled that the bell stays exactly where it is.

Measured on both restaurants at 360x780. `settleBell()` scans upward for a resting place covering no
control; when it finds none within 260px it returns the bell to its corner. Two ordinary states have
no clean spot:

| state | landed on | overlap | finger at the control's own centre |
|---|---|---|---|
| search suggestions open | a dish's `+` (y 734–776, x 291–333) | 22px | `chef-call` |
| every category folded | a `.cat-group-head` | 48px | the bell owns the overlap band |

A stand-down fix was built and confirmed working, then **reverted in full** (owner, 2026-08-17):
*"i want like previous bell of call waiter should be stuck at his place we can scrool and click the
thing make sure don't change that again."* `components/MenuView.tsx` is byte-identical to `main` in
`settleBell()`.

Recorded as **R29** in `docs/REJECTED-IDEAS.md` with its comment on the fallback line, and guarded
by a new `verify:guest` check that fails if anyone hides, fades or yields the bell again. Do not
re-report this.

## F3 · A menu that isn't serving still previews as an open one — MEDIUM · confirmed

**Who is worse off:** a diner following a shared or saved link, and the restaurant whose closed menu
looks open.
**Where:** guest menu → the link preview in a chat app or a browser tab title, for
`/r/<slug>/menu` when the restaurant is switched off or its Menu feature is off.

**What happens.** `/q/<code>` has always answered a dead code with a neutral title and no platform
blurb. The tenant door did not: `generateMetadata` returned the restaurant's name, tagline and logo
whatever the state was, and only the page body checked `active` / `menuEnabled`. So the link
previewed as an open menu — name, "view the menu and order at …", logo — and then landed on
"This menu isn't available right now".

**Reachable when:** the restaurant is deactivated or its Menu master switch is off, and any link to
it is shared or already in someone's history.

**Fixed by:** the same guard, the same wording, as the QR door. Folded in from the preserved branch
`origin/fix/guest-experience-t1` after judging it on its merits — it is correct, and both reads it
uses (`getRestaurantBySlug`, `getSettings`) are the cached ones the page already makes, so it costs
no extra database read.

**Guard:** `verify:guest` → `P00165`.
**Confirmed after the fix:** a serving menu's metadata is byte-identical to before
(`"AANGAN GARDEN RESTAURANT — Menu"`, its own tagline, its own image).

---

## ✅ ALSO DONE — three rejections recorded in `docs/REJECTED-IDEAS.md`

**R28** (no cap on the 3D preload, 2026-08-16) is now in the doc with its comment on the preload
queue. Added alongside it: **R29** (the bell stays put) and **R30** (the hero fallback stays English
— *"i want english only for all"*, extending R15 and R23). All three carry a comment on the exact
line someone would otherwise change, and `verify:rejected` passes.

**Noted, not touched:** R26 and R27 are filed BELOW the `## Reversed` heading in that doc although
both record a NO, not a reversal. The guard only enforces code comments for rows above that heading,
so R27 ("never give the restaurant a delete-a-bill permission") is currently unenforced and has no
code comment. Moving it up would fail the guard until that comment is written — someone else's file
and someone else's half-finished work, so I left it and am flagging it instead.

---

## Considered and NOT reported

- **English hero fallback** (`"Welcome"` / `"Our Menu"` for a tenant with no custom hero) and the
  English `aria-label`s on the card buttons — covered by **R15** and **R23**. The owner has ruled
  twice that the guest menu's remaining English is not to be raised as work.
- **Dark by default on a tenant menu** — the intended design, per the pre-empt list.
- **The guest menu refusing to be embedded**, and **CSP being report-only** — both deliberate.
- **Aangan's cards rendering empty at 8.5s** — a cold dev-server compile only. Warm, the same page
  is complete at 2.0s with all 199 cards, real names and prices, no skeletons.
- **The third filter chip sliced by the layout switch at 360px** — known, and the owner-accepted fix
  (the measured `data-can-scroll` fade) is present and stamping correctly.
- **React's dev-only "script tag while rendering" advisory** on the dark-default inline script — it
  would only matter on a soft client navigation between two restaurants' menus, and no in-app link
  does that. No restaurant on this stack currently uses the dark default at all.
