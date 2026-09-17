# Sweep #9 · Terminal 35 — the access and permission libraries · findings

Ten files, 3,103 lines. 34 existing ledger rows re-run (0 regressions), 50 new checks written as
`P105001`–`P105050` in `.claude/sweep/LEDGER/T35-S9.md`, 12 of them driven live on port 4435.
**Two problems found, both fixed. No improvement was built** — by the owner's instruction for this
run, every improvement is listed in the terminal report instead.

## 1 · A failed settings read was handed back as "this restaurant is at its defaults"

`lib/accessState.ts` is the one reader behind Access & permissions, the Per-person tab and every
staff profile. Its restaurants read has always answered `null` when it could not be read; the
settings read took `.data` and never looked at `.error`. Everything in this model treats an absent
value as *use the row's own default*, so a blipped read did not look like a failure — it looked like
a restaurant sitting at factory settings, and the screen would have drawn every switch at a value
the database disagrees with. Screen says ON, server says NO, arriving through the reader that exists
to prevent exactly that.

Fixed by failing closed on `sq.error`. A restaurant with no settings row at all is a different case
and still works (`maybeSingle()` reports that as `data: null, error: null`). Callers already handle
`null`: the access-tree route refuses the load, and the owner staff route's `roleDefault()` answers
`null` rather than guessing.

**Guard:** `verify:access` check 56 — it reads every `await sb.from(...)` in the file and insists each
one's `.error` is looked at. Sabotage-tested twice: removing the line turns it red, and inlining the
read so nobody *can* look at `.error` turns it red with a different sentence. Green on the fix.

## 2 · A pay period could name a month that does not exist

`paymentFrom()` in `lib/staffProfileShared.ts` tested the *shape* of `for_period` and not its value,
so `2026-13` and `2026-00` walked past the refusal already written for them and became the dates
`2026-13-01` / `2026-00-01`. Postgres refuses those, so the whole payment was lost behind "That
payment didn't save." with nothing saying which field was wrong — from the function whose stated
contract is that nothing else reaches the database. Nothing on screen sends this field today, so it
was reachable only by a hand-written call; the sanitiser is still the wrong place to be lenient.

**Guard:** a new case in `lib/staffProfileShared.test.mjs` (`npm run test:units`) covering January,
December, a full date, no period at all, and the four bad shapes. Sabotage-tested: reverting the fix
fails the test.

## What was checked and found clean

The 113-row access model round-trips save-then-read without a single disagreement; no duplicate ids;
every default is one of its own row's options; the manager/waiter/owner permission lists are
distinct, complete and map to keys an enforcer really reads; a kitchen person still has no rows
(R7); the password-cover gate refuses every damaged, re-dated, expired and rotated cookie, keeps the
password out of its own cookie, and says "locked" without a hint. Full row-by-row evidence is in
`.claude/sweep/LEDGER/T35-S9.md`.
