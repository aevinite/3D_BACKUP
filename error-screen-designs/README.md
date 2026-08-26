# Ten designs for the two "something went wrong" screens

Prototypes, built 2026-08-26 because the owner asked for five animated designs for each of the
404 page and the no-internet page, all ten different, and said to build them rather than describe
them.

**Nothing here is wired into the app.** Each file is a standalone page you can open on its own, so
picking one costs nothing and rejecting nine costs nothing. Look at them with
`node error-screen-designs/serve.mjs` (or through the preview server on port 9000) and pick by number.

## Why the two screens are treated differently

The dino game works because you are **stuck waiting** — it turns dead time into something to do.
That is the right instinct for the **no-internet** screen. On the **404** the person wants to
*leave*, so a game there traps them: those five are short animations with an obvious exit.

| # | file | screen | the idea |
|---|---|---|---|
| 1 | `404-1-cloche.html` | 404 | a cloche lifts off an empty plate; the 404 IS the plates |
| 2 | `404-2-ticket.html` | 404 | an order ticket flutters onto the spike: "table 404 — no such table" |
| 3 | `404-3-waiter.html` | 404 | a waiter walks in, trips, and three plates settle as 4-0-4 |
| 4 | `404-4-toast.html` | 404 | a toaster pops toast burnt with 404. Tap it and it pops again |
| 5 | `404-5-torn-menu.html` | 404 | a real menu page with one item torn out; 404 behind the tear |
| 6 | `off-1-egg.html` | no internet | an egg fries, and its doneness IS the countdown to the next check |
| 7 | `off-2-steamer.html` | no internet | a dumpling steamer whose steam calms exactly as the retry backs off |
| 8 | `off-3-catch.html` | no internet | playable: slide a tray and catch falling plates |
| 9 | `off-4-noodle.html` | no internet | a noodle strand that doubles on every pull, like the retry gap |
| 10 | `off-5-pass.html` | no internet | a kitchen pass; the bell rings on every retry |

## The rules every one of them keeps

- **No external anything.** No images, no web fonts, no libraries — the real no-internet page is a
  static file that by definition cannot fetch. Every drawing here is inline SVG or CSS.
- **The real element ids are kept** (`#title`, `#why`, `#retry`, `#home`, `#hint`, `#brand`), so the
  one that gets picked drops onto the existing logic — the verdict, the retry loop, the way out and
  the restaurant's name — instead of replacing it.
- **Reduced motion is honoured.** Anyone who has asked their phone to stop animating gets a still
  version that still says everything.
- **Cheap animation.** A phone with no signal is often a phone with a low battery: CSS transforms
  only, nothing per-frame except the one that is a game, and everything stops when the tab is hidden.
- **Under ~20 KB each**, because the no-internet page is pre-saved onto every device.
