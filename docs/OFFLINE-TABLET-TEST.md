> ⚠️ **HISTORY — not a current specification.** a one-off manual test script; the automated cover is npm run verify:offline.
> Kept because it records why things were built this way. Do not follow it for new work; the
> live rules are in `CLAUDE.md`. (Banner added 2026-08-04: eleven finished documents were sitting
> in `docs/` beside the load-bearing ones with nothing to tell them apart.)

# Offline test — Waiter Tablet (10 minutes, on a real tablet)

This checks that the waiter tablet **saves your work when the internet drops** and then **sends it exactly once** when the internet comes back — no lost orders, no duplicates.

Do this on the **actual tablet** the waiters use (a real device behaves differently from a computer). Pick a **quiet time** and use a **test table** so you don't disturb real service.

---

## Before you start
1. On the tablet, open the waiter panel and log in as usual.
2. Look at the **top-right connection dot**:
   - 🟢 **green** = online (connected)
   - 🟡 **yellow** = trying / syncing
   - 🔴 **red** = offline (your work is being saved on the device)
3. Have a second device handy (your phone or a computer) opened to the **manager panel** for the same restaurant — you'll use it at the end to confirm what actually arrived.

## How to "go offline"
Easiest way: **turn on Airplane mode** on the tablet (or turn Wi-Fi off). That's it.
(You'll turn it back on later — that's the important part of the test.)

---

## Test 1 — Place an order offline
1. Make sure you're **online** (🟢). Open your **test table**.
2. **Go offline** (Airplane mode on). The dot should turn 🔴.
3. Take a normal order: add 2–3 dishes and send it.
4. ✅ **Expected:** a friendly message like **"Order saved — syncing automatically"** (NOT a red "Failed"), and the connection dot shows **🔴 Offline · 1 waiting** (or similar).
5. ❌ **If instead** you see a red **"Failed"** or the order silently vanishes → write down what happened and stop; that's a bug.

## Test 2 — Add a dish offline
1. Still offline, on that same table, tap **＋ Add dish** and add one more dish.
2. ✅ **Expected:** **"Saved — syncing automatically"** and the "waiting" count goes up by one.

## Test 3 — Mark a bill paid offline
1. Still offline, tap **💳 Mark bill paid** and pick a method.
2. ✅ **Expected:** it accepts it and shows a "saved / waiting to sync" message — again **not** a red "Failed".

---

## The important part — come back online
1. Turn **Airplane mode OFF** (Wi-Fi back on).
2. Watch the connection dot: 🔴 → 🟡 (syncing) → 🟢 (done). The "waiting" count should count **down to 0**.
3. Wait until it's fully 🟢 and shows nothing waiting.

## Confirm it landed exactly once
On your **second device (manager panel)**, open the same test table and check:
- ✅ The order from Test 1 is there **once** (not twice, not zero).
- ✅ The extra dish from Test 2 is on it.
- ✅ The bill shows **paid**.
- ✅ There are **no duplicate** orders or double charges.

If all four are true → **the offline system works.** 🎉

---

## If something's wrong
Write down (or screenshot):
- which test failed,
- exactly what the screen said (especially any red "Failed"),
- whether anything showed up **twice** or **not at all** on the manager panel.

Send that to your developer. The most important failures to report are:
- a red **"Failed"** when you were offline (it should say *saved*), or
- an order that arrived **twice** (a duplicate) or **never** after reconnecting.

## Clean up
Delete/close the test table you used so the test order doesn't sit on the real floor.
