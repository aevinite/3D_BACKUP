# Kitchen printing — how it works now, and how to set a restaurant up

**Written 2026-08-18, after the owner reported the real fault:** the kitchen PC could not keep the
Chrome tab in front, and *"if you minimize, or open another app on the same PC, the KOT prints
totally stop."* Two things were built the same day — the queue (below) and the print-station
launcher. Read this before touching auto-print anywhere.

---

## 1. What changed, in one paragraph

**Auto-print used to be something a browser tab NOTICED. It is now a ROW the database writes.**
When an order is created, migration 335's trigger inserts a `print_jobs` row for it (only when the
admin allowed auto-print AND the owner switched it on). Any screen that is set up to print then
CLAIMS that row with one atomic update, prints it, and reports back. Two screens can watch at once
and a ticket still comes out exactly once; a ticket nobody prints stays in the queue and the
manager's floor strip shouts about it after 90 seconds.

**In simple words:** the order now leaves a note saying "print me" that lives on the server. Whoever
is awake picks the note up. Nothing depends on a person looking at a screen, and a ticket can no
longer be lost just because a window was covered.

---

## 2. The pieces (where each one lives)

| Piece | Where |
|---|---|
| The trigger that queues a ticket | `supabase/migrations/335_a_kitchen_ticket_queues_itself.sql` |
| One shared queue implementation (read · claim · report) | `lib/printQueue.ts` |
| Kitchen screen: gets jobs on every board read, prints, reports | `app/api/kitchen/[...path]/route.ts` (`/board?autojobs=1`, `?jobs=1` on the targeted slice) + `public/panels/kitchen/app.js` (`processPrintJobs`) |
| Manager screen as a printer | `app/api/editor/[...path]/route.ts` (`/print-jobs/pending`, `/claim`, `/:id/done`) + `public/panels/editor/app.js` (`managerPrintPass`) |
| The per-device switch | manager panel → **Settings → Kitchen printing → "Print kitchen tickets on THIS screen"** |
| The live socket stays open while a screen is the printer | `public/panels/realtime.js` (`keepAlive`) |
| The kiosk launcher | `scripts/print-station/print-station-mac.command` · `…-windows.bat` |
| Problems / stuck tickets | manager panel → **Tables** → the strip above the floor grid (mig 269) |

---

## 3. Setting up a restaurant — the checklist

1. **Plug the printer in and make it the computer's DEFAULT printer.** A USB 80mm thermal printer is
   fine; a LAN/Wi-Fi one is better (no long cable to the kitchen). The macOS driver recipe for the
   POS-80 is in the `aangan-thermal-printer-setup` memory — do not re-derive it.
2. **Admin → the restaurant → allow auto-print** (`auto_print_kot_allowed`). Nothing prints until
   this is on.
3. **Manager panel → Settings → Kitchen printing → "Auto-print the KOT when a new order arrives" =
   ON.** This is the restaurant-wide switch (the owner's).
4. **On the computer the printer is attached to, open the print station** — double-click
   `print-station-mac.command` (Mac) or `print-station-windows.bat` (Windows). Change the `URL` line
   in it first: `/kitchen` for a kitchen screen, `/manager` for the counter. Log in once; that
   window keeps its own Chrome profile and stays logged in.
5. **On that same screen, choose who prints:** manager panel → Settings → Kitchen printing → *Print
   kitchen tickets on THIS screen*:
   - **Off** — this screen never prints (the default).
   - **Print here** — this screen prints every new ticket. Use it when the printer is at the counter
     and the kitchen has no screen.
   - **Backup only** — prints here only if the kitchen hasn't within 30 seconds.
   The kitchen panel needs no switch: with auto-print on for the restaurant, it prints.
6. **Test it:** send one order from the tablet, then MINIMISE the window and send another. Both
   tickets must come out. That second one is the whole point of this work.

### What the launcher actually does, and why each flag is there

- `--kiosk --kiosk-printing` — full screen, and **print with no dialog** (silent).
- `--disable-background-timer-throttling` — Chrome slows timers in a background window; this stops it.
- `--disable-backgrounding-occluded-windows` + `--disable-features=CalculateNativeWinOcclusion` —
  Chrome treats a window that another window COVERS as hidden. This is the setting that matters most
  for the owner's report: without it, opening any other app on the same PC put the printer to sleep.
- `--user-data-dir=…` — its own Chrome profile, so the everyday browser can't disturb it and it stays
  logged in.
- `caffeinate` (Mac) / `powercfg` (Windows) — the computer must not sleep. A sleeping PC prints nothing.

**In simple words:** it opens one Chrome that is set up never to doze off, in its own little world, on
the right page, and it keeps the computer awake while it is open.

---

## 4. What still works when things go wrong

| What happens | What the system does |
|---|---|
| The screen is minimised / covered by another app | It still prints. Nothing is skipped. |
| The screen is closed, or the PC is off | The ticket waits in the queue and prints the moment a printing screen opens. |
| The printer is out of paper / jammed | The print is reported failed, retried up to 5 times, then parked as `failed` — and the manager's floor strip says so, with **🖨 Print here instead**. |
| A print is retried and the first copy did come out | The second sheet is stamped **\*\*\* Reprint · Duplicate \*\*\*** (from `attempts > 0`), so nobody works from two identical tickets. |
| Two screens are set to print | The atomic claim means only one of them gets each ticket. |
| The internet drops | Orders queue on the device that took them (the offline layer); tickets print when the connection returns. |
| A database that hasn't had mig 335 yet | The kitchen panel's **net** notices no job exists for an order and prints it the old way after 20 seconds, so a stack awaiting its release does not go silent. |

---

## 5. What is deliberately NOT built yet

- **A print agent** — a tiny program running outside Chrome that claims the same rows. It is the next
  step and the endpoints are already shaped for it (`lib/printQueue.ts` + a device token would be all
  it needs). This is what the whole industry uses; it removes the browser from the picture entirely.
- **A cloud printer** (Star CloudPRNT / Epson Server Direct Print) — the printer itself polls a URL
  every ~5s and needs no computer at all. Same queue, a different claimant.
- **Finished jobs are never pruned.** `print_jobs` now gains one row per ticket. They are tiny and
  the reads are indexed, but a retention sweep belongs in `lfh_prune_logs()` (mig 053) eventually.

---

## 6. AV LIVE

Migration 335 and these panel changes are **on the backup stack only**. AV live needs its own asked-
first release, exactly like mig 238 and mig 269 before it. Until then, AV live keeps printing the old
way (the panel there still diffs its own board) — which is why the kitchen panel keeps its net.
