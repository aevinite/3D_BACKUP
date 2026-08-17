# T4 findings — working without internet, and in every language

Territory: `public/sw.js` · `public/offline.html` · `public/panels/swreg.js` ·
`public/panels/offline.js` · `components/OfflineNotice.tsx` · `components/OfflineShell.tsx` ·
`components/ConnectionBadge.tsx` · `components/AppShell.tsx` · `components/BanGate.tsx` ·
`components/BotTrap.tsx` · `components/Maintenance.tsx` · `lib/i18n.ts`

500 phases run (P01501–P02000). **5 real problems, all fixed in this branch.** 4 🔗 HANDOFF rows
for fixes that live in another terminal's files. Everything else in this territory came back clean.

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
- **⚠ NOT FULLY CLOSED — see H1.** My file was one of four unguarded readers. After this fix the
  menu still fails on such a device, because three more reads live in other terminals' files.

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
- **Note for the next sweep:** French House offers only `en`/`fr`/`hi`
  (Access → Menu → Format), and `components/Header.tsx` correctly resets a language the restaurant
  does not offer. So German, Arabic and Korean **cannot be rendered on French House at all** — this
  is deliberate, it is not a fault, and it is why rows P01890–P01894 are `⏭`.

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

---

## 🔗 HANDOFF — the real fix lives in another terminal's file

### H1 · Three more unguarded storage reads keep the guest menu broken on a blocked-storage device
Fixing `lib/i18n.ts` (F2) was necessary but **not sufficient** — the menu still shows "Something
went wrong". Stacks captured with the `localStorage` getter made to throw name three more readers:

| file | what to change |
|---|---|
| `lib/format.ts` | `getCurrency()` and `getLanguage()` guard with `typeof localStorage === "undefined"`. **That is not a safe guard** — `typeof` evaluates the property, and the getter throws, so `typeof` throws too. Wrap the body in `try/catch` returning the default. |
| `lib/features.ts` | same shape: `typeof localStorage !== "undefined" && localStorage.getItem(lsKey(rid))`. Same fix. |
| `app/layout.tsx` | the inline theme/language bootstrap script already has `try/catch` around each read — verify it covers the `lang` read as well as the theme read (two of the captured stacks are inside this inline script). |
| `lib/supabase.ts` | the browser Supabase client throws during **module evaluation** while initialising its auth storage. Give the browser client an explicit in-memory `auth.storage` when `localStorage` is unreadable, or create it lazily. This one alone can take the page down. |

The whole class is one rule worth writing down once: **`typeof localStorage` is not a safe test.**

### H2 · `scripts/verify-offline.mjs` now produces two false reds
`ctx.setOffline(true)` correctly flips `navigator.onLine` to false — but a **service-worker-served
reload resets it to true**, measured on Playwright 1.62.1 / Chromium 151.0.7922.34:

```
onLine right after setOffline (no reload): false
onLine after an SW-served reload:          true
```

Every offline check in that script reloads the page, so `isOffline()` is false afterwards and the
bar honestly reports "Connection is struggling — showing saved data" instead of "No internet".
Two checks fail on it — the manager bar and the kitchen bar — and both are the guard, not the app:
with `navigator.onLine` pinned false, all three panels say
*"No internet — you can keep working / Showing saved data from a moment ago"* (measured, 15/15).

**I tried the two-line version and it is NOT a two-line change — do not repeat my attempt.**
Adding `ctx.addInitScript('…get:()=>false…')` inside a `goOffline(ctx)` helper and routing all
eight toggles through it took the suite from **53 passed / 2 failed to 18 passed / 3 failed**.
`addInitScript` cannot be removed once added and re-runs on every navigation, so every later ONLINE
phase in the same context still believed it was offline: the outbox never drained and the
"landed exactly once" check read 0 orders. I reverted it — a half-working fixture is worse than a
diagnosed one. What it needs is a pin that can be turned OFF and survives both a reload and a new
tab (a context cookie the getter reads, cleared by name — not `clearCookies()`, which would sign the
run out), plus a fresh context per role, because the pin leaks into every page opened afterwards.

Until then the two reds are known and harmless. The product is proven correct by direct
measurement: with `navigator.onLine` pinned false, the manager, kitchen and waiter panels all say
*"No internet — you can keep working / Showing saved data from a moment ago"*, and the manager's
floor heading correctly reads *"Table view · saved copy"* (15 of 15, screenshot read).

### H3 · `scripts/verify-offline.mjs`'s tile-chip check is flaky
"the table tile is marked as having an unsent change" failed on one run and passed on the next, same
build. The chip is stamped immediately on an outbox change and re-stamped every 1.2s, because the
panels repaint their grids constantly and wipe it — so a repaint landing in that window leaves up to
1.2s with no chip. **Change:** poll for the chip for a couple of seconds instead of reading once.
(I judged the 1.2s re-stamp not worth replacing with a MutationObserver — it self-heals, and no
person is misled for longer than a repaint.)

### H4 · `app/globals.css` → the `.maint*` block is hardcoded flagship colours
See F5(b). Listed as a 🟡 decision, not a fix — it needs the owner's answer, and the CSS is not my
file either way.
