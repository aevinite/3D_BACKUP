# T6 — THE KITCHEN SCREEN · problems found, and fixed in this PR

Territory: `app/kitchen/**`, `public/panels/kitchen/{app.js,index.html,style.css}`.
Restaurant used for every runtime check: **French House** (writable). Aangan untouched.
Every row created during the run was removed again in the same run, by id.

Seven problems. All seven are fixed in this branch and all seven are covered by a check in
`scripts/verify-ready-tile-and-kitchen.mjs` (`npm run verify:ready-tile`), each of which was proved
to FAIL against a copy of the panel with the fix taken back out.

---

## F1 · A "mark ready" the server refused stayed green on the board — for ever · HIGH · confirmed

**Who is worse off** — the cook (believes the dish is on the pass and cannot re-send it), the
waiter (never told), the guest (waits on food nobody is cooking).

**The path** — the cook taps the ✓ on a dish, and the server answers no. That is a real answer, not
a hypothetical: `app/api/kitchen/[...path]/route.ts` returns **404 "That dish isn't on this
restaurant's board any more"** whenever the row has moved on (the manager cancelled the KOT, the
table was closed), **403** for a device staff have blocked, and **400** for a refused value.

**What happened** — `pendingReady` is the optimistic overlay that keeps a just-tapped dish showing
ready while the server catches up. It was cleared only on the SUCCESS path, inside
`scheduleReadyReconcile`'s `.finally`. On failure the panel toasted `Failed: …` for four seconds
and then went on re-applying the overlay to **every later board read**, so the dish stayed "ready",
the ticket had already slid into the Ready lane, and the ✓ was gone — no way to try again short of
reloading the screen.

**Watched happening** on the running board (dev server 4106, French House). With the one
`items/:id/status` call answered 404, then a fresh read forced from the server:

```
before fix   lane=list-ready   hasTick=false   line="1× Espresso   ready"   class="line line-ready"
after  fix   lane=list-cooking hasTick=true    line="1× Espresso   ✓"       class="line"
```

**Fix** — `markItemReady`'s `.catch` now drops the id from `pendingReady` and restores the dish to
the status it was snapshotted at, then reconciles from the server. If the write did land and only
the reply was lost, the refetch simply paints it ready again.

---

## F2 · A refused "ALL READY" parked the whole ticket in Ready — for ever · HIGH · confirmed

Same root cause, worse consequence: the card had already been moved into the Ready lane, so an
entire table's order sat on the pass marked finished with the server holding nothing.
`markOrderReady` held TWO overlays — `pendingReady` for the session order's dish rows and
`pendingReadyOrders` for a legacy order's JSON dishes — and its `.catch` cleared neither.

Watched the same way, on `orders/:id/ready`: before the fix the ticket stayed in `list-ready` after
a fresh server read; after the fix it is back in `list-cooking` with its ✓ and ALL READY restored.

**Fix** — the `.catch` clears both overlays before reconciling.

---

## F3 · The wall board was not first-come-first-served — every delivery ticket sat behind every dine-in ticket · MEDIUM · confirmed

**Who is worse off** — the cook (cooks in the wrong order), and the restaurant (a late delivery
order is the one an aggregator penalises).

**The path** — any restaurant with the platform or parcel module on, using the wall layout.

**What happened** — `renderWall()` sorted the dine-in tickets among themselves, sorted the platform
tickets among themselves, and then glued the two lists together. The wall exists to be FIFO —
`app.js` and `index.html` both say "oldest first" — so the one thing it promises was untrue
whenever both channels had food on. The tickets a cook reads last are bottom-right of a dense grid.

**Watched happening** — one parcel ticket inserted three hours old, then deleted by id. Before the
fix it rendered last, behind one-minute-old dine-in tickets. After: **position 16 of 22, between a
2d ticket and a 25m ticket.**

**Fix** — both channels are concatenated into one list and sorted once, on the two keys the wall
already used (not-ready before ready, then oldest first), through the existing NaN-safe `cmpTime`
comparator — which a platform ticket needs more than a dine-in one, since its `created_at` comes
from a webhook.

*(The COLUMNS layout still lists dine-in before platform inside each lane. That one is a taste call
with a trade-off either way, so it is listed for the owner as I3 rather than changed here.)*

---

## F4 · On the light skin, "served ✓" was the one word on a ticket that failed to be readable · LOW · confirmed by measurement

**Who is worse off** — the cook scanning a half-served ticket for what is still theirs to cook.

**The path** — the default skin (panels default LIGHT), any ticket where the waiter has carried out
some dishes but not all.

**Measured on the running board**, pixel-sampled with the real computed colours: `.done` rendered
`rgb(22,163,74)` on the white ticket = **3.30:1** at 18px/900. 18px bold sits just under the
18.66px that would let the 3:1 large-text threshold apply, so it needed 4.5:1. Every other word on
a kitchen ticket passed in both skins — this was the only failure, in either skin.

It survived three previous sweeps because the ✓ button's glyph right beside it is the same colour
and legitimately passes (20px/900 → large text → 3:1).

**Fix** — `html[data-theme="light"] .done { color:#15803d }`, the exact value the ✅ Ready heading
was already given for the same reason. Re-measured: **5.02:1**. The dark skin was fine (6.40:1) and
is untouched; the pink "ready" tag keeps its own more specific rule.

---

## F5 · A print that failed at the moment of printing was swallowed whole · MEDIUM · code-read

**Who is worse off** — a print-first kitchen, and the manager who is never told.

**The path** — `printKot` builds a hidden iframe and calls `w.print()` 250 ms later. That call sat
in an **empty catch**. By then `printKot` had already returned `true`, so the cook was toasted
"Printing KOT #313", the ticket was recorded in `printedIds`, and the kitchen could work a whole
service with nothing on paper and nothing on screen or in the log saying so.

This is the exact thing the catch at the bottom of the same function was written to forbid — it
only ever covered the synchronous setup.

**Fix** — the deferred catch un-records the ticket (so the next pass retries it, and the cook's
genuine next 🖨 is not branded "*** REPRINT · DUPLICATE ***" for a ticket that never came out),
writes it to the Everything Log, and tells the cook and the manager through the same
once-a-minute throttle a synchronous failure already uses.

---

## F6 · The 🖨 reprint button was 38×22 on every screen above 760px · MEDIUM · confirmed by measurement

**Who is worse off** — a cook with wet hands, on the exact control a print-first kitchen reaches
for after a jam or a paper-out.

**Measured** at 1280×800, at **1194×834 (a real kitchen tablet)** and at 768×1024 (an older iPad in
portrait): **38×22 px** — the smallest control on the screen, against the 44px finger target the
rest of the product holds to, and packed against the age chip in a tight ticket header. Only the
phone media block (≤760px) had ever widened it, to 40px.

A kitchen screen is a touch screen at 1194px exactly as much as at 360px. This is the same
reasoning and the same 44px the T14 tablet sweep applied to the 86 board's toggles, which were
37px for the same reason.

**Fix** — the 44px minimum moved into the base rule, so it holds at every width; the phone-only
rule is gone (it was setting the lower 40px and winning on cascade order). Re-measured **44×44** at
360, 768, 1194 and 1280. The button looks the same — the padding does the growing.

---

## F7 · The same stuck overlay, on the offline path · MEDIUM · code-read

A ✓ tapped with no signal keeps its dish painted ready through `pendingReady` and deliberately
skips the reconcile — there is nothing to reconcile against yet. When the queue drains, most
replays land and the refetch simply agrees. But a replay the server **refuses** (`lib/clash` — the
table was closed and billed while this screen was offline) leaves the server saying "preparing" and
the board saying "ready", for the rest of the shift, exactly as in F1.

**Fix** — the `lfh:outbox-flushed` handler clears both overlays once the post-flush read has landed
(after it, never before — clearing first strips the protection during the very refresh most likely
to be stale). After a drain, the server is the truth for everything that was queued.

---

## 🔗 HANDOFF — the real fix lives in someone else's file

### H1 · A QR guest order at an already-open table lands on the pass in silence

**Watched happening.** An order placed through the public (no-session) guest path —
`app/api/guest/place-order/route.ts` → `lfh_place_order_public`, which is how a diner who scans the
QR and orders **without joining the session** reaches the kitchen — arrives with
`status = 'preparing'` (auto-accepted, mig 164) and `member_id = null`. The kitchen chimes for
`status === 'received'`, or for `'preparing'` **only when `member_id` is set**, because a null
member is how it tells a waiter-placed order apart ("the waiter is standing at the table"). So this
one rings nothing. Confirmed on the running board: ticket on the pass in 2.0 s, zero oscillators.

**Why it is not fixed here.** The kitchen has no way to tell that ticket from a waiter's. `orders`
carries no channel/source column at all (the same absence that made an old `o.source === "parcel"`
branch unreachable — see the note on `whereFor`). The fix has to stamp the channel on the row:

- **`supabase/migrations/…`** — add a channel/source marker to `orders` (or set `member_id` for a
  public-path guest order, if that is the truer model).
- **`app/api/guest/place-order/route.ts`** — pass it on the public branch.
- Then one line here: the chime filter widens to include it.

Until then a restaurant whose diners order by QR without joining a session gets silent tickets.
