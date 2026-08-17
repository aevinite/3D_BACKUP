# T4 improvements

Rule applied (§6): build it here only if it is inside my territory, ≤150 lines, needs no migration /
screen / module / permission, is not in `docs/REJECTED-IDEAS.md`, changes no rule in `CLAUDE.md`,
and makes a real restaurant's day better. Everything else is listed for the owner.

Pure code tidying that no person would ever notice is **not** an improvement and was left alone.

---

## 🟢 BUILT

### I1 · A permanent guard for the last-resort screen — `npm run verify:offline-retry`
The screen a phone lands on with nothing saved and no connection had no guard of its own. It now
has one, and it is what caught F1. It serves the **real** `public/offline.html` from a tiny local
stub — no build, no database, no login, no deployed site — so it is safe on every push and cannot
trip any of the app's own limits. Time is compressed by shrinking the page's own timers, not by
replacing its logic.

It asserts, in one place, everything a person depends on from that screen:
one backing-off retry loop however many times the device says it is back · the mechanism that makes
that possible (a handle that is cleared) · it never states a cause before it has tested one ·
device offline → blame the device · our server up but unhealthy → blame us, never the person's
internet · it always offers the way out · the honest reassurance wording, and never the blanket
promise · nothing is loaded from another origin · one unprefixed `backdrop-filter` · and the same
contract on the worker's own inline copy of the page, which no other guard looks at.

Registered in `package.json` and `docs/GUARD-MAP.md`. Deliberately **not** in `verify:static` — it
launches a browser, and that file's header explains exactly why browser guards stay out of the
static suite (CI installs the package but not the browsers). Its name was added to that header's
list so the next person sees it is the third of a set, not an oversight.

### I2 · The language guard now checks the WORDS, not just the keys
`verify-i18n-scope` proved every language carries every key — which is a check about `undefined`
and says nothing about whether a value was ever translated. That is how `de.prepTime = "Prep"` sat
in a shipped dictionary through two sweeps. Two additions:

- a **named watch-list** of values found copied verbatim from English into a language that does not
  use them (a general "is this English?" test is impossible and would fire on Pizza, Sushi,
  Protein, Burger…);
- the **storage-safety rule** from F2, so the guest menu cannot go back to crashing on a device
  that blocks site data.

Both read the CODE, not the prose — comments are stripped first, because a guard that trips on its
own documentation just teaches the next person to delete the documentation. Both were proven by
reverting each fix and watching the guard go red.

### I3 · Removed the dead imports the connection badge still carried
When the badge stopped listing orders (owner, 2026-08-13 — one place for an order that couldn't
send, not two), the retry / dismiss / order-the-rest helpers and two unused formatters were left
behind. Five lint warnings sat on the file. That matters here for one specific reason: this repo's
own history records twice that a red or noisy check stops being read, and the guards behind it stop
running. Only the count is imported now.

---

## 🟡 NOT BUILT — these need a decision

### J1 · The maintenance screen is gold and brown on every restaurant
Measured: Aangan's accent is `#e3c06f`; its maintenance ring, steam, badge and dots all compute to
French House's `#d4a574`, on the flagship's brown, in a 'Playfair Display' serif. The name and the
logo ARE the tenant's — only the colours are not. **Not built** for three reasons: the colours live
in `app/globals.css` (another terminal's file); the owner has twice said gold + the
little-French-house theme IS the intended house style (R13); and "make a tenant's screen follow its
own accent" is a product decision, not a defect. The false claim in the component's own comment has
been corrected either way.

### J2 · German, Arabic and Korean cannot be seen on the dev restaurants
French House offers `en`/`fr`/`hi` only, and `Header.tsx` correctly resets any language the
restaurant does not offer. So half the dictionary is unrenderable on the two restaurants this sweep
may touch, and three of the six language screenshots are the English menu. **Not a fault and not a
change** — recorded so the next sweep does not report the fallback as a bug, and so it knows that
proving a German or Arabic string on screen needs a restaurant that offers it.
