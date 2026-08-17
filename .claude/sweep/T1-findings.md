# T1 — GUEST MENU CORE · problems found and fixed

Territory: the three guest doors (`/menu`, `/r/<slug>/menu`, `/q/<code>`), `MenuView`, `FoodCard`,
`NavPicker`, `Header`, `HeroTitle`, `GuestChrome`, `GuestNotFound`, `IntroSplash`, `ComingSoon`,
`app/page.tsx`, `app/not-found.tsx`.

500 phases run twice. **3 real problems**, all fixed here, each with a new static guard in
`scripts/verify-guest.mjs` that fails on the pre-fix code (proved by reverting each file in turn).

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

### 🔗 HANDOFF — `lib/tenantStorage.ts` (not my territory)

`tenantSlug()` should fold the path segment it reads:

```ts
const slug = decodeURIComponent(m[1]).trim().toLowerCase();   // currently not lower-cased
```

That is the root cause and it costs one line. My redirect closes the door a QR actually opens, but a
guest who lands *directly* on `/r/<Slug>/item/...` (a shared dish link) never passes through my page
and still splits their scope. The same fold belongs in `tsetFor`/`tgetFor`'s slug argument.

---

## F2 · The waiter bell parks on a control and steals the tap — HIGH · confirmed

**Who is worse off:** a diner. Tapping "+" rang for a waiter instead of adding the dish.
**Where:** guest menu → the dish grid at 360×780 → the floating call-waiter bell, bottom right.

**What happens.** `settleBell()` scans upward in 8px steps for a resting place that covers no
control. When it finds none within 260px it used to fall back to the resting corner — "at least
where a guest expects to find it". Measured on **both** restaurants, two ordinary states have no
clean spot at all:

| state | what the bell landed on | overlap | what a finger got at the control's own centre |
|---|---|---|---|
| search suggestions open | a dish's `+` (y 734–776, x 291–333) | 22px | **`chef-call`** — the bell, not the button |
| every category folded | a `.cat-group-head` | 48px | the header, but the bell owns the overlap band |

The suggestions panel is full-width (x 21–339) and stacks unbroken from y 362 to 739, so all 33
candidate positions in the band are covered. Folding every category tiles full-width headers ~53px
apart, with the same result — which is precisely the bug the scan was written to end.

**Reachable when:** type anything into search, or fold your categories. Both are ordinary browsing.

**Fixed by:** the last-resort branch no longer returns the bell to a covering position. It **stands
down** — invisible and untappable — and comes back at the top of the same function the moment a
clean spot exists (any scroll, search cleared, category unfolded). It stands down completely rather
than just becoming transparent to taps, because a bell you can still see but which quietly opens a
dish page is a worse lie than one that steps away. Nothing vanishes in silence: the control
underneath answers the tap itself. In the six other states measured (plain, no-results,
favourites-empty, list view, mid-scroll, at the bottom) a clean lift is found and none of this runs.

**Guard:** `verify:guest` → `P00338`.
**Confirmed after the fix:** in the search-open state a finger at the "+" centre now reaches the page
instead of `chef-call`; screenshots show both "+" buttons and all six category headers unobstructed;
clearing the search brings the bell straight back (`visibility: visible`, `pointer-events: auto`).

---

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

## 🔗 HANDOFF — `docs/REJECTED-IDEAS.md` (not my territory)

The preserved branch also carries a **REJECTED (owner, 2026-08-16) → R28** comment for MenuView, on
the unbounded 3D preload: *"don't do the sixth one any time soon like in the code, also reject that
it is rejected by me."* **R28 is not in `docs/REJECTED-IDEAS.md` on `main`.**

`verify:rejected` fails on a `REJECTED` comment that no doc row records ("no orphan claims"), so I
did **not** add the comment — it would have broken a gate I have to leave green. The doc row needs
adding, and the code comment with it, in one commit. The measured facts worth keeping in the row:
2 GLB requests on a French House menu open (it has 2 such dishes, Aangan has none), and
`lib/modelLoader` already evicts past 40 MB.

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
