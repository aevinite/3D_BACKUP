# Sweep #9 · Terminal 1 — the guest menu and its three doors

**2026-09-14 · branch `sweep9/t1-guest-menu-and-three-doors` · port 4401 · production build.**
Territory: `app/layout.tsx` · `app/menu/page.tsx` · `app/not-found.tsx` · `app/page.tsx` ·
`app/q/[code]/page.tsx` · `app/r/[restaurant]/menu/page.tsx` ·
`app/r/[restaurant]/menu/not-found.tsx` · `components/MenuView.tsx`.

Ledger rows re-executed directly: **303** · regressions: **0** · new rows: **50**
(`P101601`–`P101650`) · problems found: **2** · fixed: **2** · improvements built: **0**
(list-only this run, by the owner's instruction — they are in the chat report).

Both problems are the same shape: a rule this codebase already wrote down, applied to the dish
doors and never carried across to the MENU doors beside them.

## 1. A closed restaurant's menu said "Aevidine" in the diner's browser tab

`/r/<slug>/menu`'s not-found boundary had no `metadata` export, so Next fell back to the root
layout's platform default. Measured on a production build:

```
/r/no-such-place-xyz/menu  →  404
<title>Aevidine — Restaurant OS</title>
<meta name="description" content="Aevidine — the all-in-one platform that runs your restaurant.">
```

while `/r/french-house/item/no-such-dish-zz` beside it answered `<title>Menu</title>`. That
boundary is also what a switched-off restaurant and a restaurant whose Menu master switch is off
serve — the commonest way a real diner reaches it.

**Fixed** by giving the boundary the same neutral `metadata` export the dish boundaries have, with
their wording copied. **Guard:** `verify:notfound` now fetches this door's served `<head>` beside
the two dish doors; it was red on this path before the fix.

## 2. A restaurant closed for the evening still invited an order

Both menu doors checked `active` and `menuEnabled` and not `serviceMode`. Measured with
`demo-bistro` put into service mode for ten seconds (restored in a `finally`, and read back):

| door | title | description | preview picture |
|---|---|---|---|
| the dish door (fixed 2026-08-22) | `Menu` | This menu isn’t available right now. | none |
| `/r/demo-bistro/menu` | `Demo Bistro — Menu` | View the menu and order at Demo Bistro. | the logo |
| `/q/ZAVMWRDC` (the printed sticker) | `Demo Bistro — Menu` | View the menu and order at Demo Bistro. | the logo |

…over a screen that then tells the diner the restaurant is closed.

**Fixed** on both doors; both already had the settings in hand, so it costs no extra read.
**Guard:** `verify:guest` row `P00165` now requires all three switches on both menu doors, and the
new condition reads false against `origin/main`'s copy of each file.

## What was re-run, and what was not

- **303 rows re-executed directly** — `P00001`–`P00100`, `P00145`–`P00186`, `P00201`–`P00215`
  (source, comments stripped), `P00301`–`P00375` (driven, 5 honest `⏭`), `P15161`–`P15235` (the
  whole door matrix over 9 live restaurants, 3 switched-off ones and the printed-code door).
- **511 rows carried by proof**: all eight owned files are byte-identical to their state at the
  last green pass, so a static read of them returns the same answer.
- The remaining driven rows of the sweep-#8 blocks were **not** re-executed one by one, and that is
  said plainly rather than claimed. Full accounting in `LEDGER/T1.md` → "SWEEP #9".

Four detectors of mine came back red and were withdrawn, not filed — they are listed in the ledger
so a withdrawn finding is as useful as a confirmed one.
