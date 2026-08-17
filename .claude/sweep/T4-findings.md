# T4 findings — working without internet, and in every language

Territory: `public/sw.js` · `public/offline.html` · `public/panels/swreg.js` ·
`public/panels/offline.js` · `components/OfflineNotice.tsx` · `components/OfflineShell.tsx` ·
`components/ConnectionBadge.tsx` · `components/AppShell.tsx` · `components/BanGate.tsx` ·
`components/BotTrap.tsx` · `components/Maintenance.tsx` · `lib/i18n.ts`

500 phases run (P01501–P02000). **500 green — 486 clean on the first pass, 14 found and fixed.**
Nothing left red, nothing left skipped.

**Two rounds.** Round 1 stayed inside the 12-file territory and left 4 rows red and 9 skipped, each
blocked on a file another terminal owned or on a decision only the owner could make. He then said
**yes to all five open items and "do all, solve all"** (2026-08-17), so round 2 crossed into the
files those fixes actually live in, ran every skipped row for real, and closed all thirteen — and
found one more real problem on the way (F6, the hero splitting words in half).

---

## F1 · The last-resort screen probes a struggling server FASTER the worse the line gets

- **Where:** any panel or the guest menu → the branded "Can't open this screen" page (the one with
  "Try again" / "Go to the home screen"). Nothing looks wrong on it; the damage is the traffic it
  makes. Backend-visible only.
- **Severity:** the restaurant's own server, at the moment it is least able to take it.
- **Status:** `confirmed` — measured, then fixed, then measured again.
- **Who is worse off:** every device in the restaurant lands on this page within a second of the
  others when the server (not the internet) is what is down. It re-checks on a doubling, jittered
  timer precisely so those checks arrive spread out.
- **The path:** a phone on the edge of coverage fires `online` repeatedly. Every one of those
  events that landed while no check happened to be running scheduled ANOTHER retry timer, and no
  handle was kept anywhere, so nothing could cancel it. The chains only died by colliding.
- **Measured** (`scripts/verify-offline-retry.mjs`, the real page on a local stub): ten "back
  online" events left **47 retry gaps scheduled and produced 59 probes**. After the fix, the same
  ten events leave **22 gaps and 26 probes**.
- **Fix:** `public/offline.html` — one `retryTimer` handle, cleared before each schedule. A check
  already in flight schedules the next gap itself, so there is never a moment with no loop.
- **Guard:** `npm run verify:offline-retry` (new). Reverted deliberately: the guard goes red on
  both the count and the missing handle. Restored: green.

## F2 · A diner whose browser blocks storage gets an error screen instead of the menu

- **Where:** guest menu → the whole screen. The person sees Next's "Something went wrong" page and
  **no dishes at all**.
- **Severity:** that diner cannot browse or order. High for the person it happens to.
- **Status:** `confirmed` — reproduced in a headless browser against the production build.
- **Who is worse off:** a diner whose phone browser is set to block all cookies / site data
  (Chrome "Block all cookies", Safari's equivalent, a locked-down profile). The app already treats
  this device class as real — `lib/guestDevice.ts` says in as many words that it "returns '' if
  storage is unavailable", and both queues switch to "this is NOT saved" for it.
- **The path:** `localStorage` is not always a readable property — a browser blocking site data
  throws `SecurityError` **from the getter itself**. `lib/i18n.ts` → `useLanguage` read it bare,
  inside a `useEffect`. A throw in an effect is not caught anywhere, so the whole React tree goes.
- **Measured:** with the getter made to throw, the menu rendered `firstHeading="Something went
  wrong"`, `dishes=0`, console `SecurityError: The operation is insecure.` A normal run on the same
  build renders 59 dishes.
- **Fix:** `lib/i18n.ts` — one wrapped `readLang()` helper used by both reads, falling back to
  English (the picker's own default and the language the dictionary is complete in).
- **Guard:** `scripts/verify-i18n-scope.mjs` now fails if `lib/i18n.ts` reads storage outside that
  helper. Proven by reverting.
- **CLOSED IN ROUND 2 — see H1.** `lib/i18n.ts` was one of TWO genuinely unguarded readers, not
  four: `lib/format.ts` was the other (its `typeof localStorage` guard throws too), and
  `lib/supabase.ts` touched storage during module evaluation. `lib/features.ts` and the
  `app/layout.tsx` inline script turned out to be already wrapped. With all of it fixed, the menu
  renders 59 dishes with BOTH `localStorage` and `sessionStorage` throwing.

## F3 · Every time a diner comes back to the tab, the ban check runs twice

- **Where:** guest menu → nothing on screen. Backend only: it is a database round trip
  (the `lfh_check_ban` RPC), made twice instead of once.
- **Severity:** the owner's egress and database load, on the app's single busiest surface.
- **Status:** `confirmed` — counted in a browser, before and after.
- **Who is worse off:** the owner pays for double the ban-check queries. It happens every time any
  diner switches to WhatsApp and back, which is constant all through a meal.
- **The path:** `components/BanGate.tsx` bound ONE handler to both `visibilitychange` and `focus`.
  Returning to a browser tab fires both.
- **Measured after the fix:** 1 check on first load, and **3 checks across 3 tab-returns**.
- **Fix:** a 2-second coalescing window. `focus` is kept, because on a desktop it fires on its own
  when clicking back into the page without visibility ever changing. The window is deliberately
  short — the whole point of re-asking is that the wall lifts on the guest's next look the moment
  staff unblock them.
- **Guard:** manual re-check written into ledger row P01864 (counting a real tab-return needs a
  browser and a signed-in guest surface; it does not reduce to a file check).

## F4 · A German diner was shown an English abbreviation on every dish card

- **Where:** guest menu → a dish card → the prep-time line, on a restaurant that offers German.
- **Severity:** low, and cosmetic — but it is a shipped dictionary claiming six complete languages.
- **Status:** `code-read`. The rendered check is not reachable on French House (see below).
- **The path:** `lib/i18n.ts` → the `de` block had `prepTime: "Prep"` — the English word, copied
  from the English block. Every other value in every other block is translated.
- **Why two sweeps missed it:** the existing guard proves every language carries every KEY, which
  is about `undefined`, and says nothing about whether a VALUE was ever translated.
- **Fix:** `prepTime: "Zub."` (the ordinary German shortening of *Zubereitung*, same length as the
  other languages' labels, so no card re-flows).
- **Guard:** `scripts/verify-i18n-scope.mjs` now carries a named watch-list of values found copied
  verbatim from English. Proven by reverting.
- **How the rendered check was finally run (round 2):** French House offers only `en`/`fr`/`hi`
  (Access → Menu → Format), and `components/Header.tsx` correctly resets a language the restaurant
  does not offer — deliberate, not a fault. Rather than WRITE a restaurant's Access settings on a
  database ten terminals share, the guest-settings REPLY is patched in the browser so the page
  believes all six are offered. Nothing is written anywhere, and the real dictionary, components and
  fonts are what get exercised. German then rendered "Gerichte suchen…", "Ganztags Café &
  Bäckerei", "noch keine Bewertungen" — and no "Prep". That same run is what exposed F6.

## F5 · Two comments described behaviour the code does not have

- **Where:** backend only, nothing on screen — but these are the comments a future session trusts
  instead of checking, which is exactly how this territory's real bugs got written.
- **Severity:** low, and real: a wrong comment in this repo is load-bearing.
- **Status:** `code-read`, both verified against the code and against a measurement.
- **(a)** `components/BotTrap.tsx` claimed "the elapsed field is written on submit-time read rather
  than on a timer, so it costs nothing while the page sits open". There has always been a
  `setInterval(write, 500)`. The claim was the stated reason the elapsed number can be trusted.
- **(b)** `components/Maintenance.tsx` claimed the screen "can never leak French House branding onto
  another tenant". True of the name and the logo; **false of every colour on it.** Measured in a
  browser: Aangan's accent is `#e3c06f`, and its maintenance ring, steam, badge and dots all
  compute to French House's `#d4a574` on the flagship's `#221309` background, in a
  'Playfair Display' serif. There is not one `var(--accent)` in the `.maint*` block.
- **Fix:** both comments now say what is true. The maintenance COLOURS are left alone on purpose —
  see the 🟡 item; the owner has said more than once that gold + the little-French-house theme is
  the intended house style (R13), so that is his call, not a fix to slip in.


## F6 · The hero tagline split words in half on every language but English *(found in round 2)*

- **Where:** guest menu → the big tagline under the greeting, at the very top of the screen. On a
  phone a German diner read **"Ganztags Café & Bäcke / rei"** and a French one
  **"Café & Boulangerie To / ute la Journée"**.
- **Severity:** the largest text on the guest menu, on the restaurant's own tagline, broken at a
  random letter with no hyphen. French House itself offers both those languages.
- **Status:** `confirmed` — measured on a Samsung A35 (360×780) and read in a screenshot.
- **Who is worse off:** every diner at any restaurant whose tagline is long enough to wrap at phone
  width. English hid it completely, because "All-Day Café & Bakery" fits on one line — which is why
  it survived this long.
- **The path:** the hero reveals letter by letter, so every letter is its own `<span>`. Those spans
  were `display: inline-block` — an **atomic** inline box, which the browser is allowed to end a
  line after — and `components/HeroTitle.tsx` replaced every space with a **non-breaking** one. So
  the heading could break between any two LETTERS and at none of its SPACES: exactly backwards.
- **Fix, and it is two halves that only work together:**
  `components/HeroTitle.tsx` — the tagline's spaces become real `U+0020`, so a break opportunity
  exists at all; `app/globals.css` — the tagline's letters become `display: inline` with
  `white-space: pre-wrap`. Inline boxes create no break opportunities, so the line breaker sees the
  whole heading as ordinary text and breaks at spaces. Safe here specifically because the tagline
  animates **opacity only** (movement is deliberately not animated, to keep the gradient clip
  still), and opacity works fine on an inline box. **Changing only the CSS makes it worse** — the
  NBSPs stay, nothing can break, and the heading runs off the side of the phone and is clipped:
  measured, screenshot read, which is why both halves are asserted by the guard.
  The GREETING is untouched: it animates `y`, so it still needs its inline-block, and it is one
  short tracked word that never wraps.
- **Verified after:** 48 of 48 — six languages × two skins — no word split, nothing clipped or
  overflowing, letters at full opacity (the reveal still plays), and the gradient still paints in
  both skins.
- **Guard:** `verify:i18n-scope` now asserts all three parts (real space, inline+pre-wrap for the
  tagline, inline-block kept for the greeting), each with the reason written into the failure text.
- **Not to be confused with the parked item:** Arabic's letters still do not JOIN across element
  boundaries. That is the separate, already-recorded, deliberately-parked decision and it is
  unchanged here — this fix is about where a LINE may break, not about glyph shaping.

---

## 🔗 HANDOFF — all four are now DONE in this branch

Round 1 wrote these up because they lived outside the 12-file territory. The owner said do them, so
they were done here rather than passed on. **The merge terminal should know these files were touched
by T4:** `lib/format.ts`, `lib/supabase.ts`, `app/globals.css`, `components/HeroTitle.tsx`,
`scripts/verify-offline.mjs`. None of them had any other commit on `main` since this branch started.

### H1 · The blocked-storage crash — CLOSED
Round 1 named four files. Measured properly, only **two** were at fault, and the write-up is
corrected here rather than left overstated:

| file | verdict |
|---|---|
| `lib/format.ts` | **was broken, fixed.** `getCurrency()`/`getLanguage()` guarded with `typeof localStorage === "undefined"`, which is not a safe test — `typeof` evaluates the property and the getter throws. Both now go through one wrapped `readStored()`. |
| `lib/supabase.ts` | **was broken, fixed.** The browser client built a session store on `localStorage` during **module evaluation**, so the throw took the whole page down. `supabase.auth` is called in **zero** places in this codebase (the app has its own sign-in) and realtime uses the anon key, so `persistSession: false` removes the storage touch entirely. |
| `lib/features.ts` | **already safe** — `readSaved()` is wrapped in try/catch, and the setItem call has its own. Round 1 was wrong to list it. |
| `app/layout.tsx` | **already safe** — both inline reads have their own try/catch. The two captured stacks were those wrapped reads being *caught*, not crashing. |

Verified after: the guest menu renders 59 dishes with **both** `localStorage` and `sessionStorage`
throwing, no error screen, and the offline strip still speaks on that device.

### H2 · `verify:offline`'s two false reds — CLOSED, and the suite is now 55/0
The diagnosis stood: `ctx.setOffline(true)` flips `navigator.onLine`, but a service-worker-served
reload resets it to true (Playwright 1.62.1 / Chromium 151.0.7922.34), and every offline check
reloads. Round 1's naive fix took the suite from 53/2 to **18/3**, because `addInitScript` cannot be
removed and re-runs on every navigation, so later ONLINE phases still believed they were offline.

The working version: the init script is installed **once per context** and reads a **cookie**, which
is per-context, survives a reload, and is visible to a brand-new tab — so the pin can be turned back
OFF. The cookie is only ever overwritten, never cleared, because clearing cookies by hand would take
the run's single sign-in with it. All eight offline/online toggles go through `goOffline()`/
`goOnline()`. **Result: 55 passed, 0 failed.**

### H3 · The flaky tile-chip check — CLOSED
It now polls for up to 8s and, if time runs out, reports what is actually on the tile. The ⏳ mark is
stamped on the queue change and re-stamped on a slow tick because the panels repaint constantly and
a repaint wipes it, so a single read was a coin toss.

### H4 · The maintenance screen's colours — CLOSED (the owner said yes)
`app/globals.css` `.maint*` now derives every colour from one `--maint-ink`, which follows the
restaurant's own `--accent`, via `color-mix` (already used ~100 times in that file). `.maint-flagship`
— set by `Maintenance.tsx` for restaurant #1 only — pins the exact hand-tuned values that were there
before, so **#1 is byte-for-byte unchanged**: measured `rgb(212,165,116)` on `rgb(34,19,9)` at both
viewports. A tenant now measures its own accent (Aangan: `#e3c06f`, dot `rgb(227,192,111)`).

`components/AppShell.tsx` also had to move its Service-Mode return **below** the palette: it used to
bail out above the two `<style>` tags, so the maintenance screen rendered with no tenant palette
emitted at all and `--accent` fell back to #1's. Teaching the CSS to follow `--accent` would have
achieved nothing without that.

The display font is deliberately still the product's `'Playfair Display'` — it appears in eight other
places in that stylesheet, it is not #1's branding, and there is no per-restaurant font variable.
Per-tenant typography would be its own piece of work.

**R13 is untouched and still stands:** the guest SEARCH DROPDOWN and the panels stay
golden/little-French-house on purpose. Only the maintenance screen was asked about and answered yes.
