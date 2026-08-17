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

## 🟢 BUILT IN ROUND 2 — the owner said yes to all five open items

### I4 · The hero tagline's guard (three parts, all in `verify:i18n-scope`)
F6 needed a fix in TWO files that only works as a pair, so the guard asserts both halves plus the
part that must NOT change (the greeting keeps its inline-block for its `y` animation). Each failure
message says WHY, so the next person does not "simplify" one half back.

### I5 · `verify:offline` is a working guard again — 55 passed, 0 failed
It was 53/2, and both reds were the harness. The pin now lives in a cookie the init script reads, so
it can be turned back OFF; and the tile-chip check polls instead of reading once. A suite with two
permanent reds is how this project has twice lost ten checks without noticing.

---

## 🟡 NOTHING IS LEFT UNBUILT

Every item round 1 listed for a decision was answered **yes** (owner, 2026-08-17) and is done:

| round-1 item | outcome |
|---|---|
| J1 / H4 — the maintenance screen's colours | **built.** Follows the tenant accent; #1 byte-for-byte unchanged. |
| H1 — the rest of the blocked-storage crash | **built.** Two real culprits fixed; two of the four turned out already safe. |
| H2 — `verify:offline`'s false reds | **built.** 55/0. |
| H3 — the flaky tile-chip check | **built.** Polls for up to 8s. |
| J2 — the unrenderable languages | **run.** All six rendered and read at 360px in both skins, without writing to any restaurant. It is what found F6. |

**One thing is deliberately still parked, and it is his own recorded decision, not an omission:**
Arabic's letters do not JOIN in the animated hero and the intro wordmark, because each grapheme sits
in its own element and browsers cannot join across element boundaries. That is written down as a
rejected/parked item with his own words attached. F6 changed where a LINE may break; it did not and
was not meant to change glyph shaping. Confirmed still parked, not re-raised as work.
