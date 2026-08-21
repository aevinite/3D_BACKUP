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

## 🔗 HANDOFF — for whoever owns `app/api/admin/**`

Two routes still read `settings` by the retired single-row key. **Neither looks like a fault** — both
are documented legacy fallbacks for the flagship row — but they are the last two, so whoever owns
them should decide rather than inherit them by accident:

- `app/api/admin/settings/route.ts` — the log-retention numbers (`oplog_retention_days`,
  `custlog_retention_days`, `audit_retention_years`) read off `id='site'`. There is no
  per-restaurant screen for them, so "restaurant #1's value" and "the platform's value" are the same
  statement today. If they are meant to be platform-wide, they arguably want their own table.
- `app/api/admin/maintenance/route.ts` — falls back to `id='site'` only when no `restaurant_id` was
  given, and says so in its own comment: *"`rid` is null for the legacy flagship row"*. Deliberate.

## 🅿️ PARKED BY THE OWNER, 2026-08-21

- **The manager panel's bulk bill-deleting** (🗑 Clear freed, the tick-box bulk bar, and the dead
  `{all:true}` server path no screen reaches). He asked for it removed, then parked the whole Bills
  tab piece: *"leave this idea for now will do it later."* **So 🟡 I3 below stays OPEN** — the
  unbounded read only gets large on those bulk paths, and they are still there.
- **The Bills record screen redesign.** Same instruction.
- **R27 CONFIRMED, not reversed.** Asked directly whether a manager should be able to delete an
  unsettled bill, he chose *"No — keep R27 exactly as it is."* `canDeleteBill()` returning `!g.user`
  (admin console only) is correct and stays. Worth recording because his first phrasing —
  *"he can delete one bill but with reason"* — reads like a reversal, and it is not one.

---

## 🟡 NOT BUILT — needs a decision from him

### I3 · a bulk "clear all freed records" could tombstone a bill that still has live orders
`lib/softDelete.ts`. After stamping the orders, it asks which of the touched sessions still have a
live order — `.in("session_id", sessionIds)` with no `.limit()` and no chunking. Past 1,000 returned
rows that answer comes back SHORT, so a session with live orders is missing from the "busy" set and
gets tombstoned: the ledger shows the bill as deleted while its orders read alive. That is precisely
the half-state the function's own comment was written to stop.
**Why I did not build it:** it is the money-delete path, in the wave he gated, and the right fix is
not obvious — chunking shrinks the window without closing it, and adding a refusal could block a
legitimate bulk clear. Needs his call on which he prefers.

### I4 · one successful KOT print clears a complaint about a DIFFERENT printer
`lib/printQueue.ts` → `finishKotJob(ok)` resolves EVERY open `printer_events` row for the restaurant
— the auto-solve he asked for on 2026-08-04. `printer_events` has no printer or agent column
(mig 269), so per-printer resolution is impossible without a migration. Since mig 341 made
multi-printer real, a restaurant with a separate bill printer that has run out of paper has its
complaint cleared by a KOT coming out of the kitchen printer. Needs a migration → his call.

### I5 · `lib/liveBoard.ts` keeps private copies of `pageAll` and `mapLimit`
Shared versions exist (`lib/pageAll.ts`, `lib/mapLimit.ts`) with DIFFERENT failure behaviour — the
shared `pageAll` refuses past a cap, liveBoard's logs and truncates at 20k rows. Two same-named
helpers with different answers is the drift shape this codebase keeps consolidating away. But
liveBoard's are deliberate and documented for a hot board, and unifying them changes kitchen-board
behaviour under load. A taste call with a real trade-off either way.
