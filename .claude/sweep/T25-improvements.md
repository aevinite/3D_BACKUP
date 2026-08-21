# T25 — improvements (`lib/**` remainder, phases P12001–P12500)

Working machinery for the merge terminal. The owner reads the terminal window.

---

## 🟢 BUILT — I1 · an owner's whole estate stops being one giant URL

**Where:** backend only, nothing on screen today. It decides what appears on the owner console's
sidebar and Menu picker, whether the Payroll and Inventory screens exist for a restaurant, and which
kinds of activity the owner's Audit & logs page shows.

**Measured on this stack** (not assumed — `scripts/_t25tmp/inprobe` during the run):

| id list in ONE `.in(...)` | URL bytes | result |
|---|---|---|
| 500 ids | 18.5 KB | fine |
| **800 ids** | 29.6 KB | **`Bad Request`** |
| 2,000 ids | 74.0 KB | the fetch never completes |
| a select with no `.limit()` | — | **silently capped at 1,000 rows** |

`lib/restaurantNames.ts` already knew this and chunks at 500 with `.limit(part.length)`, and its
header says why: *"past PostgREST's 1000-row default, every name after the thousandth silently
became '—' … nobody else got the fix."* `lib/liveBoard.ts` learned the URL half when an inlined id
list came back 414 and the kitchen board went blank mid-rush.

Five estate-wide readers still inlined the whole list:

| file · function | what a short answer looks like on screen |
|---|---|
| `lib/panelAccess.ts` → `enabledOwnedRestaurantIds` | restaurants missing from the owner's OWN sidebar, Menu picker, Manager mode and every `/api/owner/*` call at once, with nothing saying so. **The same fault T19 fixed one level up** (a `.limit(50)` on the ownership links) — the two reads that FILTER that paged list kept the old shape. |
| `lib/tableTags.ts` → `payrollEffectiveByRid`, `inventoryEffectiveByRid` | a restaurant whose Payroll or Inventory the admin switched ON reads as OFF, so those screens go blank. |
| `lib/ownerEntitlements.ts` → `entitledSubset`, `logViewSubset`, `getOwnerEntitlementsUnion` | a section the admin left ON reads as absent; the estate's union quietly stops covering part of it. |
| `lib/logVisibility.ts` → `loadLogVisibility` | **the worst-shaped one.** That file's own rule is "a restaurant absent from the map is `canSee → false`". Right when the reason is "outside the caller's scope", wrong when the reason is "PostgREST capped the answer". Truncation would HIDE activity the owner is entitled to see, and it would look like an empty log rather than a failure. |

**Built:** `lib/inChunks.ts` — one small helper (`readInChunks`), with the measurements in its header
and a hard rule that a failed chunk is an ERROR, never a short list. All five now route through it.

**Nobody is worse off today** (nine restaurants), which is why this is an improvement and not a
problem. It is the road, not a turn.

**Guard:** `npm run verify:id-chunks` (`scripts/verify-id-chunks.mjs`). Deliberately NARROW — it
checks only the readers whose id list is an unbounded estate, because flagging every `.in(` in `lib/`
would cry wolf on `["queued","printing"]` and on id lists already capped at 20, and a guard nobody
trusts is worse than none. Verified GREEN on the fixed tree, RED when one reader is reverted, RED
when one is renamed away. Row added to `docs/GUARD-MAP.md`.

> Note on the guard's own first draft: it matched `readInChunks\s*\(` and was RED on a fully-fixed
> tree, because every real call passes a type argument. Caught and fixed during the run; the reason
> is written into the guard so the next person does not repeat it.

---

## 🟢 BUILT — I2 · the delivery-app switch is per restaurant, not restaurant #1's row

**Approved by the owner, 2026-08-21** ("can do this too"). Backend only, nothing on screen.

`aggregatorsEnabled()` read `.eq("id","site")` — migration 003's pre-multi-tenant single-row key,
which measured on the dev database **is restaurant #1's row**. So the gate on the one door an outside
company POSTs through was My Little French House's own feature flag, answering for every restaurant.
On a stack trimmed to one client's restaurant (no #1) it would have answered `false` for ever and the
integration could never be switched on, with nothing on screen to explain why.

Now `aggregatorsEnabled(rid)` answers for that restaurant, and the no-argument form answers "does ANY
restaurant have intake on?" — the platform gate the webhook route needs before it knows which
restaurant the payload is for. **No route change was needed**, and the gate is not weakened: it is the
outermost of four, and the per-restaurant Platform ladder plus the per-channel switch are the ones
that decide. The no-argument form is a rows-free COUNT with the filter pushed into Postgres, plus a
30s cache — verified against the dev database, where the filter found exactly the 7 restaurants a
row-by-row read found for a flag that IS on. Behaviour today is identical (nobody has intake on).

**Guard:** folded into `verify:settings-columns` — it is a rule about the SHAPE of the settings row,
which is what that file is for, so it needed no third new guard. Green now, red when `lib/` goes back
to the legacy key. Deliberately scoped to `lib/`: widening it finds two more in `app/api/admin` and
both are documented legacy fallbacks for the flagship row, so failing on them would make the guard
red on clean main for two things nobody agreed are wrong.

## ✅ THE OWNER SAID "DO EVERYTHING EXCEPT REDESIGN" (2026-08-21) — so all three 🟡 items were built

Recorded here because this file previously listed them as open.

### I3 → BUILT · a bulk clear can no longer tombstone a bill that still has live orders
`lib/softDelete.ts`. The "which of these sessions still has a live order?" read is chunked through
`lib/inChunks.ts` with `.limit(1000)` per chunk, and a failed chunk ABORTS the tombstone instead of
producing a shorter list. It hits the row cap sooner than an estate read does — it returns one row per
ORDER, not per session. Still worth fixing even though the bulk clear went the same day: the ADMIN
bill ledger can still hand it a long selection, and a delete path must be right on its own terms.
Guarded by `verify:id-chunks` (softDeleteOrders added to its list, with the reason).

### I4 → ALREADY ON MAIN, not rebuilt · a complaint knows its printer
Migration **351** (`351_a_complaint_knows_its_printer.sql`) plus the `lib/printQueue.ts` narrowing
(`printer.is.null,printer.eq.<name>`) landed on main while this branch was open — same fault, same
reasoning, same "narrower, never wider" rule. Checked before writing a line, so nothing was
duplicated. This is what the handoff was for and it worked.

### I5 → BUILT · liveBoard stops shadowing two shared helpers
Split in two on purpose, because the trade-off was real:
- **the fan-out was safe to share** → now `lib/mapLimit.ts`. The local copy ran in batches (fire 6,
  wait for all 6, fire 6 more); the shared one is a worker pool, so the ceiling stays FULL. Same
  maximum in flight, same input order, strictly less waiting. Measured: 12 chunks at limit 6 with one
  slow chunk — the eleven fast ones done in 34ms while the slow one took 300ms.
- **the paging was NOT** → renamed `pageBoard`, behaviour untouched. It throws where the shared one
  returns `{ error }`, and it logs-and-truncates past 20k where the shared one refuses past 50k.
  A kitchen board that draws 20,000 of 20,001 tickets beats one that refuses during a rush; a money
  total short by one row is a lie. The finding was "one name, two answers" — so the NAME was fixed,
  not the behaviour, which is the resolution that does not take the risk I flagged.
Guarded by a NAME rule in `verify:id-chunks`: no `lib/` file may define its own `pageAll`,
`mapLimit`, `readInChunks` or `idChunks` without importing it.

### The bulk bill-deleting → BUILT (his original instruction)
🗑 Clear freed, the dead tick-box bar, and the `{all:true}` server sweep are all gone. The server now
enforces ONE BILL per request on the session, not a count. R27 unchanged and re-confirmed. Guarded by
`verify:one-bill-delete`, proven red three ways.

## 🅿️ STILL PARKED BY THE OWNER

- **The Bills record screen REDESIGN.** *"leave this idea for now will do it later"*, and confirmed
  again with *"do everything except redesign"*. Nothing in this branch restyles that screen — the
  button removal leaves the "Today's bills" divider intact with no hole (watched, screenshot read).

## 🔗 HANDOFF — two things that are NOT mine

- **`app/api/admin/settings/route.ts` and `app/api/admin/maintenance/route.ts`** still read `settings`
  by the retired single-row key `.eq("id","site")`. **Neither looks like a fault** — both are
  documented legacy fallbacks for the flagship row — but they are the last two. Whoever owns
  `app/api/admin/**` should decide rather than inherit them by accident.
- **`scripts/verify-realtime.mjs` is broken on main, and it is not in my territory.** My copy is
  byte-identical to main's. Its fixture inserts a throwaway session WITHOUT `restaurant_id`
  (line 69) — the column is NOT NULL — so the insert is refused; then line 72 dereferences `s.id`
  on the null result and the guard CRASHES instead of failing cleanly. Two-line fix: pass a
  restaurant id on the insert, and `return`/fail on the error instead of falling through. I touched
  no migrations and nothing session-related.
