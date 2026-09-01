# T2 findings — sweep #8 · the dish page and the 3D viewer

Terminal 2 of 40. Branch `sweep8/t2-dish-page-and-3d`, worktree `../wt-s8-t2`, port **4302**,
against `origin/main` **fb3477b9**. The full four-part report was printed in the terminal window,
which is where the owner reads it; this file is the durable record of the faults alone.

| | |
|---|---|
| existing ledger rows covering my files, re-run | **938 / 938** |
| of those: ❌ last time and ✅ now (regression FIXED by someone else's work) | **2** — `P15932`, `P15933` |
| of those: ⏭ last time and now genuinely executed | **2** — `P00990`, `P00993` |
| still ⏭ | **10**, each with its reason re-checked |
| new checks written and executed | **500** (`P55701`–`P56200`) |
| problems found | **4** |
| problems fixed | **4** |

## 1 — another restaurant's 3D screen served restaurant #1's dish · FIXED (`c86318c7`)

`public/content/items/` holds exactly two folders, `Croissant` and `Waffle`, and they are restaurant
#1's own legacy demo dishes. The 3D route is `/view/<folder>`, and the folder name is whatever an
owner typed into the editor — so a second restaurant that calls its croissant folder "Croissant"
scored a hit on the flagship's file and inherited the lot.

**Measured on the dev stack.** `/view/Croissant?r=aangan-garden-restaurant` served, under Aangan's
own orange accent: restaurant #1's model (`croissant_small.glb` + `croissant-optimized.glb`, ~11 MB),
#1's dish name "Croissant Sandwich" in the bottom bar, and #1's three hotspot cards — "Croissant /
Sauce / Salad", with #1's own wording — pinned onto the dish. `/view/Waffle?r=pizza-palace` did the
same. The existing `dbModel` rule rescues the MODEL once the tenant's own row lands; it never covered
the hotspots, the title, the subtitle or the stats, and it cannot cover the megabytes already
downloading by then.

Not reachable on today's data (only restaurant #1 has a 3D dish at all), which is why seven sweeps
missed it. It is one tenant's first 3D upload away from being live.

Fixed: the static file is read only when this really is restaurant #1, and the decision waits for the
restaurant to resolve. Also gave `getRestaurantBySlug` a `.catch` here — it had none, so a dropped
signal fell through to #1's dish. Guarded by three new assertions in `verify:3d-viewer`.

## 2 — the X on a zoomed dish photo did not close it · FIXED (`d3306bbf`)

`.img-lightbox-close` is `position: absolute` with no z-index; the photo is a later sibling carrying
a `transform`, which makes its own stacking context and paints on top once scaled.
`elementFromPoint` at the X's own centre: the X at 1×, `.img-lightbox-img` at 2.5× and at 5×. So the
tap landed on the photo and merely un-zoomed it. Tapping the backdrop is deliberately disabled while
zoomed, so the X is the only way out and it was the one control not working. Guarded.

## 3 — the heart forgot a saved dish, and then saved it twice · FIXED (`e1efb8d8`)

**A REGRESSION, three days old.** The saved-dishes read was a passenger on the dish fetch's
`.then(...)`. Since 2026-09-01 the server hands the dish down (owner's item 9), so the page renders
completely even when the browser's own re-read stalls — and on that path the read never ran.

Measured end to end: heart the dish (list `["avocado-and-cream-cheese"]`, heart filled); re-open with
the browser's dish read held open. Dish correct, **heart empty**. Tap it → the list becomes
`["avocado-and-cream-cheese","avocado-and-cream-cheese"]`. One more tap removes both, so the guest
un-saves in the tap that looked like saving. Fixed with its own effect + a dedupe. Guarded.

## 4 — the INGREDIENTS heading could stand over an empty strip · FIXED (`3f85aeb4`)

The one labelled section on the dish page that did not hide itself when empty. 0 of 464 dishes are
in that state today, so nothing on screen changes now; 261 have neither a description nor
ingredients, so it is one restaurant's first description away. Guarded.

## Open, and NOT fixed — recorded with its reason

**The guest 404's browser tab and share preview are the platform's, not the restaurant's.** Measured:
`/item/no-such-dish-zz` and `/r/aangan-garden-restaurant/item/nope-zz` both answer HTTP 404 with a
fully white-label page — and `<title>Aevidine — Restaurant OS</title>` and
`<meta name="description" content="Aevidine — the all-in-one platform that runs your restaurant.">`.
Next discards the route's own `generateMetadata` when `notFound()` is called and falls back to the
root layout's.

Not fixed here because `verify:3d-viewer` requires `app/item/[slug]/not-found.tsx` and
`app/r/[restaurant]/item/[slug]/not-found.tsx` to stay byte-identical, and the second file is not
this terminal's territory this run. It is item 5 in the chat report, in the group that needs the
owner's word first.
