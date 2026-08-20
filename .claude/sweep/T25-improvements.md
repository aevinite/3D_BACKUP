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

## 🟡 NOT BUILT — needs a decision from him

### I2 · a bulk "clear all freed records" could tombstone a bill that still has live orders
`lib/softDelete.ts`. After stamping the orders, it asks which of the touched sessions still have a
live order — `.in("session_id", sessionIds)` with no `.limit()` and no chunking. Past 1,000 returned
rows that answer comes back SHORT, so a session with live orders is missing from the "busy" set and
gets tombstoned: the ledger shows the bill as deleted while its orders read alive. That is precisely
the half-state the function's own comment was written to stop.
**Why I did not build it:** it is the money-delete path, in the wave he gated, and the right fix is
not obvious — chunking shrinks the window without closing it, and adding a refusal could block a
legitimate bulk clear. Needs his call on which he prefers.

### I3 · the aggregator master switch reads restaurant #1's row
`lib/aggregators.ts` → `aggregatorsEnabled()` reads `settings` by the pre-multi-tenant key
`.eq("id", "site")` — i.e. restaurant #1's row — and uses it as the gate for EVERY restaurant's
inbound webhook. The feature is dormant (no keys, flag off), so nothing is broken. But on a stack
trimmed to one client's restaurant (the exact case `lib/ownerHome.ts` exists for) that row may not
exist, and the integration could then never be switched on. Product decision: is that switch
platform-wide or per-restaurant?

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
