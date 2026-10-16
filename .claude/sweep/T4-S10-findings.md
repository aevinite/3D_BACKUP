# Sweep #10 · Terminal 4 — findings (the table session — a table shows only its own party)

Ledger: `LEDGER/T4-S10.md` (579 round-1 rows + 361 round-2 rows, all ✅ after the fixes) · re-run stamps `re-run 2026-10-12 (sweep #10, T4)` on 2,000
earlier rows (1,997 ✅ · 3 ⏭ · **0 regressions**). Problems found: **8**, all fixed, one commit each, each with a guard that was broken
on purpose once and seen red.

| item | screen | what was wrong | guard |
|---|---|---|---|
| 1 | Guest menu → table sheet (open a table / ask to join / re-check your table / first rules read) | a busy restaurant system was blamed on the diner's wifi ("check your internet") on five sentences; only afterLocation split timeout from no-signal. Old rows P57877 / P58284 were too broad (old miss). | verify:session-gate §H |
| 2 | Guest menu → table card, host's "let them in" prompt, shared basket, Live status bill | one failed "are sessions on here?" read at menu open switched all four off for the visit (catch → off, never asked again) | verify:session-gate §I (runs the real reader) |
| 3 | Manager floor / waiter tablet / admin Repair → Close table | a failed ownership read answered 404 "That table isn't for this restaurant." (not kept, wrong words) instead of busy | verify:table-ownership §E (runs closeSession) |
| 4 | Guest menu → ban wall → Request unblock | every failure said "couldn't match that number" — a timeout or no signal too | verify:guest-doors §11 |
| 5 | Waiter tablet (a sectioned waiter) | a failed floor-size read looked like table_count 0, so every table counted as "off-plan, visible to everyone"; now unknown → own section only, and an outside write is answered busy. Creating a waiter in the same blip said "pick at least one table". | verify:tablet-twins §20 |
| 6 | Any staff panel → raise an issue → photo / voice note | a storage failure showed the storage service's raw words ("Bucket not found", RLS text) as a 400 | verify:panel-api |
| 7 | Waiter tablet / manager → Mark paid (and 15 other actions) on a merged child table | a failed merge read answered "not merged" → Mark paid could settle the child's half of the joint bill (the 2026-08-03 incident) | verify:merge (runs the helper + the real tablet Mark paid) |
| 8 | Login doors (/login, /staff-login) | lib/botCheck.ts + REQUESTS.md said Turnstile switches on "with no code change"; no form renders the widget, so setting the keys would refuse every sign-in. Documentation corrected; building the widget is the owner's decision. | verify:panel-api |

### 2026-10-13 — owner: "make sure this never happens … don't do the eleventh one right now … do all the rest"

- **Item 1, made product-wide.** A sentence may tell a person to check their internet / connection / wifi ONLY behind proof the
  device is offline (`navigator.onLine === false`, or the browser's own "Failed to fetch" family) — `lib/session.ts` →
  `isPhoneOffline`. The table sheet and ban wall now give three answers: the restaurant's system is busy ("this one's on us") ·
  your phone seems to be offline · "we couldn't reach the restaurant's system just now" (blames nobody). Three staff sentences
  that blamed the connection on any failure were fixed too: Owner → Settings → test print, and the staff-login "blocked" screen
  (Retry and Request unblock); the Windows print helper's bad-download line no longer says "check the internet".
  Guard: `verify:guest-doors` §12 scans app/, components/, lib/, public/panels and public/*.html — any such sentence without that
  proof within the lines before it fails. Live: P173596–P173598.
- **Item 9 done** — opening a table reads and returns 14 named columns, never `*` (`lib/openSession.ts` → `OPENED_SESSION_COLS`;
  checked against the dev database). Guard: `verify:table-ownership` A2.
- **Item 10 done** — in a private window the review toast no longer says "saved as your name": `setGuestName` reads the name back
  after writing it and answers false when the phone kept nothing (the past-review rename is still sent). Guard: `verify:guest-doors`; live on the real dish page: P173599–P173600.
- **Item 11 PARKED by the owner, 2026-10-13 — "we will do it later":** the Turnstile widget on the login forms. Until it is built,
  the Turnstile keys must stay unset (setting them would refuse every sign-in — item 8).

### Round 2 — 2026-10-15/16 — owner: "replan the whole test … every single thing within the boundaries … covered … completely error free"

**Re-run first.** All 579 round-1 rows re-run (579 ✅); the 2,000 earlier rows on these files stamped `re-run 2026-10-15
(sweep #10, T4 round 2)` against today's code, the 32 guards they lean on and the old T3/T5 runners. Nine old checks whose
subject moved on purpose were re-aimed (reason beside each); three that phase 1 had filed as "not my files" were mine and are
corrected (P16129, P59098, P59470).

**Measured, not claimed.** `scripts/sweep/t4s10/cover.mjs` maps V8 coverage of every run — in memory, and in the new **screen
lab** (`scripts/sweep/t4s10/lab/`: the seven screens and the restaurant context bundled for Chromium, every database answer held
in the page) — back to the lines of the 24 files. Then `mutate.mjs` broke the code ONE place at a time, with a control first,
until **every one of the 1,022 break points in the 24 files had been tried**; each break no check noticed was run again on a
quiet machine, and is either now caught by a check written for it or explained as making no difference (163, below).

| | |
|---|---|
| new checks this round | **361** (P173601–P173987: in memory 29 · screen lab 253 · written for surviving breaks 60 + 13 · live on :4404 6) — all ✅ |
| lines of the 24 files run by a check | 99.2% → **every reachable line** (left: two catches that cannot be reached, one dead line — below) |
| deliberate breaks | **1,022** = every point · **859 caught** · 163 make no difference (timings, pixel sizes, `null`/`undefined`, a guard backed by a disabled button, starting values overwritten before anything shows, fields nobody reads) |

| item | where it lives | what was wrong | guard |
|---|---|---|---|
| R2-1 | Guest menu → a mistyped or dead restaurant link (`/r/<a slug nobody owns>/…`) → the "not available" page | the page still mounts every guest widget, and they asked the database about **French House** (its settings, ban list, customer greeting) — on a page that is not French House | verify:guest-doors §18 · live P173961–P173966 |
| R2-2 | Guest menu → a diner with dishes in their basket joins a table that has its own | one busy second on the first send marked the merge done, so the next refresh wrote the table's basket over the phone: **the dishes the diner brought vanished** and never reached the table | verify:guest-doors §15 · lab |
| R2-3 | Guest menu → basket → "Your table" bill → the pulsing green dot | the dot greyed only when the FIRST read failed; a restaurant that stopped answering mid-meal left a pulsing "live" dot over numbers that could be minutes old | verify:guest-doors §16 · lab |
| R2-4 | Guest menu → table sheet → after a failed join | the join's own limit and a phone banned mid-visit both said "We couldn't reach the restaurant's system just now" (untrue; and a banned phone would retry for ever); the no-signal order save could leave "One moment…" up for good; a Retry that could not tell the restaurant kept the last screen's "Connection trouble" | verify:guest-doors §17 · lab |

**Round 2 — looked like faults, are not:** the table card appears ~0.5 s after a join because components/RealtimeProvider.tsx turns
"session changed" into the refresh nudge (a lab without it showed a one-minute wait — the lab now mounts it) · `tenantSlug()` throws
on a damaged percent-escape, but middleware.ts redirects such an address before any page runs, and every storage read catches it ·
"Leave" / "Change table" tapped twice in the SAME instant could send twice; a human double tap (≥80 ms) cannot (the card re-draws
with its buttons off first) · lib/guestName.ts's two catches cannot be reached (tget/tset swallow every failure) — a harmless second
net · components/SessionGate.tsx `pollRef` is cleared but never set (dead, harmless) · 15 lab "reds" were the lab's own `http://`
origin (no geolocation, no crypto.randomUUID) — the lab is https now.

**Round 2 — outside this territory:** ~~`/q/<a code nobody owns>` lets the guest widgets fall back to French House~~ — FIXED
2026-10-16 on the owner's word (R2-5 below; app/q/[code]/page.tsx touched for it) · verify:scoped-reads:
lib/guestTokenRestaurant.ts reads session_members by token with no restaurant filter · verify:rpc-scoped:
scripts/sweep/t10s10/new-r3.mjs:719 · verify:guards-alive: t27r2 / verify-admin-* name three retired admin routes,
verify-guest-menu-switch.mjs has no app-up preflight or --base, t11s10/run.mjs ends on a bare process.exit · T5 static P58782
(public/sw.js), P59073 / P59080 (components/GuestNotFound.tsx), P59116 (components/ChefPopup.tsx dispatches table-scanned 3×,
the row expects 2) — all red on main, none in these files.

**Round 2 follow-up (2026-10-16) — the owner: "do the qr one".**

| item | where it lives | what was wrong | guard |
|---|---|---|---|
| R2-5 | Guest menu → scan a QR code that matches no table (a replaced sticker, a typo, a restaurant whose menu is off) → the "This QR code isn't active" page | watched on the backup site before the fix: that page asked the database for **French House's** settings, its ban list and its returning-customer greeting (`lfh_guest_settings` naming restaurant #1). The dead-code page now stamps its own address as "no restaurant" before hydration (`lib/tenantStorage.ts` → `NO_TENANT_KEY`); `tenantSlug()` answers `""` on exactly that address; the restaurant context asks nothing; a live code clears the mark | verify:guest-doors §19 · P173967–P173968 (live) · P173988–P173998 |
| R2-6 | Guest menu → a dish page → leave a review with a name, in a private window or on a phone whose storage is full | **the item-10 promise had come undone**: the review said "saved as your name — Mia" for a name the next visit will not have. Cause: sweep #10 T3 round 4's item 47 (a refused write is now kept in the page's memory, so a basket survives) made my read-back always succeed. The answer is now checked against the phone's own storage | verify:guest-doors §13 (two lines) · P173218 (re-aimed) |

Re-aimed for the same item-47 move (intended, not faults): P173053 (a blocked storage keeps tsetFor's value for the page) and
P173117 (the scanned table is kept for the page). The screen lab's address hook now follows an in-app move, as Next's does, so a
check could see the context leave "ready" (P173998 — it caught the one break of the new code that had survived).
Measured after both fixes: every break point of the three shared files touched (tenantStorage 26, restaurant-context 23,
guestName 11 — 60) tried: 50 caught; 10 make no difference — six in restaurant-context and two in tenantStorage's run-once
legacy move as in round 2, one inside a comment in guestName, and memGet's `?? null` (an empty saved value reads as nothing
either way; nothing writes one). The first pass showed line 191 surviving only because the break test did not load the new
block — fixed in mutate.mjs, then caught by P173998. All non-live blocks 866/866 · block l 8/8 on :4404.
**Outside this territory, found 2026-10-16:** `verify:offline` stops at 20 passed / 1 failed — Manager panel → the offline
clash test cannot seat its table: the seed order is refused "This looks identical to an order you just sent." (the
duplicate-order rule in app/api/editor/[...path]/route.ts). IDENTICAL on main (`--base https://3-d-backup.vercel.app`,
5dc40893, without these commits) and on this branch — not these files; left for the manager-panel / offline owner.

**Round 2 — improvements, not faults:** the table card's remembered "keep it open" choice is overridden by its open-then-fold
greeting on every reload (lib: components/SessionStatusWidget.tsx) — harmless, the owner may prefer it either way.

## Looked like faults, are not (recorded so nobody files them)

- **Every test restaurant has table sessions OFF on the dev database today** (French House, Spice Route, Green Bowl, Sakura Sushi).
  The session screens were reached by holding the database's answers in the browser — the built app is real, no row written.
- **French House has 30 tables** (lfh_guest_settings and its settings row agree); a first read that showed 13 was mine, wrong row.
- **A not-found menu page answered 500 once** — the shared dev database timed out on the slug lookup and the page said so honestly;
  repeated, it is 404. `verify:offline` failed 1–4 of 58 across three runs for the same reason ("signal timed out" in its own setup).
- **The table card floats over the category row** — draggable, collapsible, remembers its spot (already recorded, P58553).
- **SessionOwner's 4-second backstop** — deliberate (P01146): only the head's visible device, only while holding an owner token.

## Outside this territory (one line each, left for their owners)

- `sweep:t3-static` P16114 / P16124 / P16129 (the saved-call queue) and `sweep:t3b` P41031 / P41041 / P41299, `sweep:t3c` P42345 — red on main, not these files.
- `verify:rpc-scoped` — `scripts/sweep/t10s10/new-r3.mjs:719` calls lfh_price_order / lfh_staff_place_order without p_restaurant_id (terminal 10's script, red on main).
- `verify:db-parity` — 2 parity problems on the AV-live side (release items).
