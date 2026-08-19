# Print system — the whole test plan, and what it found (2026-08-19)

Written because the owner asked whether everything had actually been TESTED, and the honest answer
at that moment was "most of it". This is the list, and the result of running all of it. Re-run it
after touching anything in `lib/printQueue.ts`, the two print routes, or the three panels' printing UI.

**Result: 26 / 26 pass.** Two faults were found by writing it down (both fixed in the same commit):
 · the kitchen Settings sheet had a 37px ✕ and a 37px Sign out — under this project's 44px finger
   target, on the one screen that is touched with wet hands;
 · (in the sweep before it) the tablet's sign-out had never been driven after I changed its form.

Sections A and B are Playwright runs with the screens FORCED HIDDEN (`document.hidden = true`),
because "it works while I watch it" is exactly the failure this whole feature exists to remove.

## A · Already proven in this session (re-run to confirm on the current main)
A1  a lone kitchen screen prints with no set-up, hidden the whole time
A2  exactly one active station exists
A3  a second entitled screen is TOLD where printing is, and prints nothing
A4  "print here instead" moves the station in one tap; the loser stops
A5  a station gone quiet is taken over automatically
A6  auto-print OFF → no printing section on the kitchen screen, no Printing row in the manager
A7  auto-print ON → the row returns with the status + guide + 3 starters
A8  kitchen ☰ opens, Settings has Sign out, sign-out really signs out
A9  a ticket whose order is deleted / cancelled is retired, not printed
A10 a deleted-order ticket does not starve the queue

## B · Changed but NOT driven yet — this sweep
B1  TABLET sign-out really signs out (I changed its form and never drove it)
B2  OWNER Settings → Kitchen printing renders with printing ON and names the station
B3  OWNER card is ABSENT when printing is off everywhere
B4  kitchen ☰ Settings at 390px: no sideways overflow, every control ≥ 44px
B5  manager Settings → Printing at 390px: no sideways overflow
B6  the guide at 390px after the rebuild: no sideways overflow, copy buttons work
B7  ☰ and ⋯ coexist at 360px: both reachable, no overlap
B8  take/release OFFLINE: queued through the outbox, nothing lost, no crash
B9  the three generated starters from the CLIENT site + ?panel=manager, syntax-valid
B10 the kitchen's manual 🖨 on a ticket still prints when this screen is NOT the station
B11 two kitchen tabs on the same device (same cookie) do not double-print
B12 a phone-shaped manager screen that says "No" is never offered printing again

## C · Guards that must stay green
C1  verify:print-queue · verify:static (31) · typecheck · lint
C2  verify:taps · verify:tablet · verify:manager-behaviour · verify:panel-plumbing
C3  verify:realtime · verify:busy · verify:audit · verify:read-guards · verify:access
C4  verify:panel-cache · verify:grants · verify:db-parity (report only)
