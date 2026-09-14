#!/usr/bin/env node
// verify-guest-recovery.mjs — THE TWO THINGS A DINER SHOULD NOT LOSE.
//
//   node scripts/verify-guest-recovery.mjs
//
// Improvements #4 and #5 from the T2 sweep, both about the same idea: the app already knows enough
// to do better than "please try again", so it should.
//
//   #4  CALLING A WAITER SURVIVES NO SIGNAL.
//       Placing an order has survived since the offline queue was written. Calling a waiter — the
//       thing a diner does when something is WRONG, and the request most likely to be made from
//       the corner of the room with thick walls — just failed, with advice they cannot act on.
//
//   #5  ONE SOLD-OUT DISH DOES NOT COST THE WHOLE BASKET.
//       A table of six lost everything because one item ran out, and had to rebuild the order by
//       hand on a phone, having already waited.
//
// Static: it reads the shipped files. No database, no login, no deployed site — so it can never
// add load or trip one of the app's own limits, and it runs in a second.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return ""; } };
let fail = 0;
const check = (name, ok) => { console.log((ok ? "  ok   " : "  FAIL ") + name); if (!ok) fail++; };

const outbox = read("lib/guestOutbox.ts");
const route = read("app/api/guest/call-waiter/route.ts");
const chef = read("components/ChefPopup.tsx");
// The SAVED-ORDERS STRIP, wherever it currently lives. It began inside ConnectionBadge and was
// later extracted into its own GuestOutboxChip component, which turned this guard red on main
// while the product was completely correct — the exact trap this file's own header warns about
// ("check whether the guard is asserting the SPELLING of code that has legitimately changed
// shape"). Reading the UNION asserts the RULE ("the button is gated") instead of the address, so
// moving the strip again, or splitting it in two, cannot turn main red on its own. A rule that
// genuinely disappears still fails, which is the part that matters.
const badge = read("components/ConnectionBadge.tsx") + read("components/GuestOutboxChip.tsx");
const cart = read("components/CartPanel.tsx");

console.log("\n#4) A waiter call survives losing signal");
check("the queue can hold something that isn't an order", /kind\?: "order" \| "call"/.test(outbox));
check("there is a way to save one", /export async function enqueueGuestCall/.test(outbox));
check("…and the button uses it when the phone is offline",
  /enqueueGuestCall\(/.test(chef) && /navigator\.onLine === false/.test(chef));
check("it goes to its own door, not the order one", /"\/api\/guest\/call-waiter"/.test(outbox));
check("that door exists and rings the floor AT MOST ONCE",
  /withIdempotency\(postImpl, "guest"\)/.test(route) && /X-LFH-Action-Id/.test(outbox));
// EXPECTATION WIDENED, RULE UNCHANGED (T3 item 14, 2026-08-30). The guest queue gained a third
// kind — "I've left this table" — which, like a call, comes back with no order_id to track. The
// same branch now clears both, so this asserted spelling was one kind out of date. What the row is
// really about is "a delivered thing with nothing to track is cleared, not left to send twice", and
// that is what it checks now. (This guard's own header says: assert the rule, not the wording.)
check("a call that succeeds is cleared even though it has no order to track",
  /res\.ok && j\?\.ok && \(isCall\(item\) \|\| isLeave\(item\)\)/.test(outbox));
check("a STALE call is not delivered — both on the phone…", /STALE_CALL_MS/.test(outbox));
check("…and on the server, which cannot rely on the phone", /STALE_CALL_MS/.test(route));
check("the diner is told in words why a stale call didn't go", /case "call_too_old":/.test(outbox));
check("the toast only promises automatic sending when it really reached storage",
  /q\.persisted \?/.test(chef));
// ── A SAVED TAP THE RESTAURANT DID NOT TAKE MUST NOT VANISH (sweep #9 T3, item 4) ──────────────
//
// lfh_call_waiter_table (mig 334) answers `ok: TRUE` to three things that create no waiter_calls
// row: `already_sent`, `capped` and `rate_limited`. The queue removed the saved tap for all three,
// silently. Two of them are right — a call really is pending on the floor, so the diner's tap has
// been honoured. `rate_limited` is not: nothing was created, nobody is coming, and the row left the
// saved-work list with no message and no control, on the one action a diner takes when something is
// wrong.
//
// The server already draws this exact line (callLanded() in the call-waiter route excludes all
// three from dropping the floor snapshot). This asserts the PHONE keeps the same one — and that the
// two that mean "a waiter is coming" are still treated as delivered, so the fix cannot drift into
// nagging a diner about a call that was honoured.
{
  const landed = read("app/api/guest/call-waiter/route.ts");
  check("the server still knows which answers created no call",
    /already_sent/.test(landed) && /capped/.test(landed) && /rate_limited/.test(landed));
  check("…and the phone refuses to drop a saved tap the limiter turned down",
    /rate_limited[\s\S]{0,160}moveToFailed/.test(outbox));
  check("…while a call that IS pending on the floor is still finished with, not nagged about",
    !/already_sent[\s\S]{0,120}moveToFailed/.test(outbox) && !/"capped"[\s\S]{0,120}moveToFailed/.test(outbox));
  check("…and it is worded as a CALL, never as an order the diner never placed",
    /rate_limited[\s\S]{0,200}kind: kindOf\(item\)/.test(outbox));
}

console.log("\n#5) One sold-out dish doesn't cost the whole basket");
check("the phone remembers which id is which dish", /lines\?: \{ id: string; title: string \}\[\]/.test(outbox));
// EVERY save path, not "exactly two of them" (T10 sweep, 2026-08-12). This asserted the count was
// === 2. A third save path was added (CartPanel.tsx:762) and carried the lines correctly, so the
// app became MORE compliant and the guard went red — the third time in three days that a check
// pinned to a count or a spelling failed on code that was right. main was red on it, and while
// verify:static was still an `&&` chain that also muted every guard behind this one.
//
// The rule is "every path that saves an order remembers which id is which dish", so count the save
// paths and require all of them to carry it. Adding a fourth is then automatically covered, and
// REMOVING it from one still fails — which is the thing that actually matters.
{
  const saves = (cart.match(/lines: cart\.map\(\(it\) => \(\{ id: it\.id, title: it\.title \}\)\)/g) || []).length;
  const dispatches = (cart.match(/enqueueGuestOrder\(|action: "order"/g) || []).length;
  check(`…recorded by the cart at every one of its ${dispatches} save paths (found ${saves})`,
    saves >= 2 && saves >= dispatches);
}
check("a one-dish refusal is remembered as such", /item\.blocked = oneDish/.test(outbox));
check("…for the three refusals that really do name one dish",
  /\["sold_out", "hidden_item", "unknown_item"\]/.test(outbox));
check("there is an action that re-sends the rest", /export async function orderRestWithout/.test(outbox));
check("it uses a NEW at-most-once id (the server remembers the old refusal)",
  !/orderRestWithout[\s\S]{0,900}actionId: it\.id/.test(outbox));
check("it refuses to guess when it can't tell the lines apart",
  /if \(!keptLines\.length \|\| !keptItems\.length\) return \{ ok: false, left: 0 \};/.test(outbox));
check("the button is offered ONLY when it can genuinely do something",
  /o\.blocked && \(o\.lines \|\| \[\]\)\.length > 1/.test(badge));
// ── …AND THE DISH IT NAMES IS THE ONE THE LAST REFUSAL NAMED (sweep #9 T3, item 3) ─────────────
//
// `blocked` / `blockedId` are what put that button on the row, and the flush only ever SETS them —
// for sold_out, hidden_item and unknown_item. Nothing cleared them. So a basket refused for a
// sold-out dish, retried by the diner, and refused the second time for something else entirely
// (the table closed, the system was busy) kept the button — and tapping it DROPPED a dish nobody
// had refused, then re-queued the rest into the same unchanged refusal.
//
// Checked as the RULE, not the spelling: a fresh go clears everything the previous attempt learned
// about this row. The three counters were already cleared there for the same reason; these two
// belong in the same sentence.
{
  const retry = (outbox.match(/export async function retryGuestFailed[\s\S]*?\n\}/) || [])[0] || "";
  check("a fresh go really is a fresh go — all three attempt counters are cleared",
    /tries = 0/.test(retry) && /netTries = 0/.test(retry) && /busyTries = 0/.test(retry));
  check("…and so is the dish the previous refusal named, so 'Order the rest' can't drop an innocent line",
    /blocked = undefined/.test(retry) && /blockedId = undefined/.test(retry));
  check("…and that clearing really is inside retryGuestFailed, not merely somewhere in the file",
    retry.length > 200);
}

console.log("\n#7-10) the four the owner picked on 2026-09-14");
{
  const menu = read("lib/menu.ts");
  const tracker = read("components/OrderTracker.tsx");
  const leave = read("app/api/guest/leave/route.ts");
  const plan = read("lib/planTable.ts");
  const place = read("app/api/guest/place-order/route.ts");
  const bell = read("app/api/guest/call-waiter/route.ts");

  // ── 7 · the order-status read has a ceiling, WITHOUT being able to cancel a live order ─────────
  // The deadline is the easy half. The half that matters is that "I couldn't ask" stays apart from
  // "this order is gone": `null` from getOrderStatus means gone, and three of those in a row mark
  // the order CANCELLED on the diner's screen. A timeout answering `null` would have cancelled an
  // order that was cooking — and navigator.onLine stays TRUE on a hung Wi-Fi, so the tracker's
  // offline guard would not have saved it. Both halves are asserted, because the first without the
  // second is worse than neither.
  check("the order-status read carries a deadline like every other guest call",
    /STATUS_TIMEOUT_MS/.test(menu) && /get_order_status[\s\S]{0,200}abortSignal/.test(menu));
  check("…guarded, so reading AbortSignal.timeout cannot throw on an older phone",
    /typeof AbortSignal\.timeout === "function"[\s\S]{0,300}STATUS_TIMEOUT_MS/.test(menu));
  check("…and an unreachable read is RAISED, never returned as null (null means the order is gone)",
    /isUnreachable\(error\)\) throw busyError/.test(menu));
  check("…and the strip skips a round it could not ask, instead of counting it as 'gone'",
    /catch \{ continue; \}/.test(tracker) && /nullCounts/.test(tracker));
  check("…so the three-strikes rule that cancels a ghost order is still there and still counts only real answers",
    /nullCounts\.current\[o\.id\] >= 3/.test(tracker));

  // ── 8 · one round of the poll at a time ───────────────────────────────────────────────────────
  check("the order strip runs one polling round at a time, not one per breadcrumb",
    /let inFlight = false/.test(tracker) && /if \(inFlight\) return;/.test(tracker));
  check("…and the guard is released even when a round throws",
    /finally \{ inFlight = false; \}/.test(tracker));
  check("…and an unmounted strip stops asking about the rest of the list",
    /if \(cancelled\) break;/.test(tracker));

  // ── 9 · leaving drops the shared floor read only when something changed ────────────────────────
  // ASSERTED AT THE `if`, NOT AT THE DECLARATION. My first version of this check tested only that
  // the file MENTIONED `leaveLanded` — so changing the call back to a bare `if (rid)` left the
  // now-unused const sitting there and the check still passed. A sabotage run is what found it:
  // removing the fix produced ZERO failures. The condition itself is the thing to read.
  check("leaving drops the floor snapshot only when the leave really changed something",
    /already_gone/.test(leave) && /if \(rid && leaveLanded\) invalidateFloor\(rid\)/.test(leave));
  check("…and it cannot be satisfied by an unconditional drop sitting elsewhere in the file",
    !/\n\s*if \(rid\) invalidateFloor\(rid\);/.test(leave));
  check("…and all three guest doors now draw that line, not just two",
    /dropFloorIfPlaced/.test(place) && /callLanded/.test(bell) && /leaveLanded/.test(leave));

  // ── 10 · the app's table rule and the database's agree on the guest doors ──────────────────────
  // The margin is kept for STAFF, who open parcel/takeaway counters numbered above the floor plan.
  // A guest is locked to a floor table, so for them the floor plan is the line — the same line
  // migration 281 draws inside lfh_place_order_public. Asserted as BOTH halves: strict where the
  // guest is, and NOT strict where staff are, so a later "tidy-up" cannot quietly make counters
  // unreachable for a waiter.
  check("the table check can be strict, and says why in the file",
    /opts\?: \{ strict\?: boolean \}/.test(plan) && /PLAN_MARGIN/.test(plan));
  check("…the guest's ordering door is strict — the floor plan is the line",
    /offPlanTable\(publicRid, b\.table, \{ strict: true \}\)/.test(place));
  check("…the guest's bell is too",
    /offPlanTable\(rid, b\.table, \{ strict: true \}\)/.test(bell));
  {
    const staff = read("app/api/editor/[...path]/route.ts") + read("app/api/tablet/[...path]/route.ts");
    check("…and NEITHER staff door is strict, so a parcel counter above the floor plan still opens",
      /offPlanTable\(rid, \(body as Record<string, unknown>\)\.table\)/.test(staff) && !/strict: true/.test(staff));
  }
}

console.log("\nBoth) the shared promises still hold");
check("everything saved still carries a timer to send it", /ensureRetry\(\);/.test(outbox));
check("the online path is still untouched — offline is the only diversion",
  /navigator\.onLine === false/.test(cart) && /navigator\.onLine === false/.test(chef));

console.log(fail ? `\n${fail} guest-recovery check(s) FAILED` : "\nAll guest-recovery checks passed — a lost signal costs a diner neither their call nor their basket.");
process.exit(fail ? 1 : 0);
