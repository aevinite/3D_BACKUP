# Sweep #9 · Terminal 33 — findings

**Territory:** the database, migrations at POSITIONS 321 → the end of the sorted folder.
Re-derive: `ls supabase/migrations/*.sql | sort | sed -n '321,$p'` — 81 files, 12,898 lines,
`314_a_settled_bill_is_annotated_not_rewritten.sql` → `393_the_last_fifteen_guest_tables_lose_their_leftover_public_grant.sql`.
A positional range is not a numeric one: the folder carries 19 duplicate numbers, so position 321
is the file named `314_…`.

**Ledger:** `LEDGER/T33.md` (new — this territory had none), ids `P104801`–`P104850`.
Re-run in place: 69 rows in `T23.md`, 12 in `T4.md`. **Zero regressions.**

---

## 1 · The restaurant-scoped RPC guard reported a guess that no longer exists

`scripts/verify-rpc-scoped.mjs` printed **"59 RPCs take a restaurant (25 of them still default it
to #1)"** on every run, and its header argued at length that removing those defaults was a worse
trade than the trap. Both stopped being true on 2026-09-15: migration 385 removed the `DEFAULT
<restaurant #1>` from all 22 signatures by DROP + CREATE, re-issuing every grant, and migration 386
replaced the same guess inside the bodies with `lfh_rid()`. **The live dev database has ZERO
functions defaulting `p_restaurant_id`** — read straight out of `pg_get_function_arguments`.

The number was wrong because of HOW it was computed, not because a comment went stale: the scan
walked every migration file and recorded the FIRST file that gave a function a default, never
noticing a later file taking it away.

**Fixed:** it reads the NEWEST statement about each function in the filename order the seeder
itself applies, and a later `DROP FUNCTION` removes it from the census — which is what excludes the
three retired functions (`lfh_open_session`, dropped by 304, and the two verification stubs) that
still carry the old default in the last file that created them. The line now reads "none of them
defaults it". The assertion is unchanged.

**Sabotaged, not trusted:** re-adding a DEFAULT to 386's `lfh_kitchen_tickets` moved the count to 1;
emptying the argument list at `app/api/admin/floor/route.ts:107` failed the guard with exit 1.

## 2 · The folder-sequence check counted duplicate numbers instead of checking them

`verify:grants` announced **"19 historical pairs, all verified disjoint"** every run. Two things
were wrong.

**A count cannot see a swap.** It compared the number of duplicate-numbered pairs against a
hard-coded 19. That 19 included a 290 pair later resolved by renumbering one file — which freed a
slot, so when a genuinely NEW pair arrived (**388**, two files merged within hours of each other on
2026-09-16) the total was still 19 and the line stayed green.

**And it never checked disjointness at all.** "All verified disjoint" described a hand check
someone did once in a sweep. Checked mechanically now: 18 of the 19 pairs really are disjoint. The
19th is not — **both 388 files rewrite `lfh_delete_order_item`.**

That overlap is harmless, read line by line rather than assumed: the seeder applies these in
filename order, so `…a_cancelled_order…` runs first and `…a_money_function…` wins, and the winning
copy carries BOTH fixes — it drops the dead `v_rate := 0.05` (its own change) and keeps
`cancelled_at = COALESCE(cancelled_at, NOW())` (the other file's), because it was generated from
the live definition after the first had already landed. A careful author, not a property of the
folder.

**Fixed:** pairs are identified by NUMBER against a written list, disjointness is checked
mechanically, and an overlapping pair with no reason recorded in `EXPLAINED_OVERLAPS` fails. This is
migration 155's standing lesson — "a migration recreate reverts a fix" — given a check that can see
it. **Sabotaged:** a second `393_*.sql` fails; renaming the explanation key fails.

## 3 · Migration 386 said twenty fallback arms were dead code; one of them is the one actually taken

386 replaced the "answer as French House when no restaurant is given" guess in nineteen bodies and
deliberately LEFT twenty others that coalesce a ROW's own `restaurant_id`, writing down the reason:
*"Migration 358 made those columns NOT NULL, so that arm is unreachable — dead code, not a trap."*

True of nineteen. Not the twentieth, measured rather than guessed:

* six of the sixty-six tenant tables still have a NULLABLE `restaurant_id` — `action_idempotency`,
  `error_signatures`, `fix_requests`, `invoice_events`, `rate_limit_rules`, `staff_actions` — 358
  left those on purpose;
* `lfh_rt_emit` fires on sixteen tables and `staff_actions` is one of them, and its body reads
  `v_rid := COALESCE(r.restaurant_id, '…0001')`;
* **763 of 6,672 rows in `staff_actions` carry no restaurant, and they are RIGHT to** — they are
  platform-level admin events belonging to no single restaurant (`owner_create`,
  `restaurant_purge`, `owner_suspend`, `admin_reveal_unlocked`, `login`, `client_error`), newest
  dated 2026-09-16. Each writes a live-update breadcrumb labelled as My Little French House's.

**Nothing is wrong on any screen today**, which is why this is a correction plus a check and not a
behaviour change: the `audit` topic has exactly one listener — the admin console — and
`lib/useRealtime.ts` subscribes it with NO restaurant (`topic=eq.audit`), so it receives these
events either way. The mislabel sits in the stored breadcrumb's `topic_rid`, which nothing reads for
this topic. It becomes real the moment anyone subscribes to `audit` WITH a restaurant, which is how
every other topic is consumed.

**Fixed:** 386 gains a correction block (comments only — the SQL is byte-identical, so re-running
the file changes nothing) naming the one live arm and where it lives; `verify:rid-required` gains
half D, which CHECKS the claim instead of asserting it, reading the trigger catalogue rather than
the body text, because guessing the table from the body is exactly what made this arm invisible.
Its header also credited "migration 384" for 386's work — 386 WAS written as `384_…` and renumbered
when 385 landed, and 384 is now a different migration entirely.

**The behaviour change is NOT made here.** It belongs in migration 267's function, not in 386, and
no person gets a wrong answer from it today — so it is listed for the owner's decision.

---

## Not fixed, and why

**`verify:t24-money-rules` is RED on clean `main`, and it is not mine.** Reproduced on the shared
folder with no changes: *"every action code the app can WRITE resolves to a real area and screen
(167 codes) → got ["admin","manager"]"*. Fully diagnosed: `admin` and `manager` are panel NAMES, not
action codes, and the guard's two ternary regexes do not apply the `PANEL_NAMES` filter its literal
loop does — **and it does not strip `//` comments before scanning**. The single thing it matches
today is a COMMENT: `app/api/maintenance/route.ts:119`, where T28 (sweep #9, 2026-09-15, `92d72ab4`)
wrote `logAction(s.admin ? "admin" : "manager", …)` inside a `//` line *explaining this exact blind
spot*, having fixed it in `verify:audit` and not in this guard. So the guard is red because of the
sentence documenting why it used to go red.

`scripts/verify-t24-money-rules.mjs` is T24's file and the comment is T28's; two terminals editing
one guard is how a conflict lands. The one-line fix is to strip comments before the scan, the way
`verify-rid-required.mjs` does for SQL. Carried to Part 4 of the chat report as the top item,
because a red guard blocks every session in this folder through the PostToolUse hook.
