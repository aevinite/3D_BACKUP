# Kitchen printing — how it works now, and how to set a restaurant up


> **A COMPUTER CAN OWN THE PAPER NOW (mig 341, 2026-08-20).** A screen printing is still supported
> and still the fallback, but the better path is a small helper program on the machine the printers are
> plugged into: it polls the queue and prints each kind of paper on its own printer. Design, the four
> ticks, and every fault found building it: **`docs/PRINT-HELPER.md`**. The admin screen is
> `/aevinite/printing`; the guard is `npm run verify:print-helper`.
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
| **WHO prints** | **admin console → Printing** → *3 · Which printer gets which paper* (which printer) and *4 · The kitchen screen* (which screen, or one named person). NOT the manager panel: its Settings → Kitchen printing section is hidden from everyone there by the owner's 2026-07-31 decision, which is how the first attempt shipped an unreachable control. ⚠️ **This row used to say "(kitchen / counter / both) → 🖨 KOT printing (mig 336)". That control is RETIRED** — migration 369/376 turned `kot_print_target` into a route, `components/admin/RestaurantSettings.tsx` dropped the key on 2026-08-28 ("no control on any screen writes it any more"), and "both" went with the backup printer on 2026-08-30. Corrected 2026-09-04. |
| The per-device confirmation | **GONE (owner, 2026-08-29)** — `PRINT_HERE_KEY` / `printHereAnswer` were deleted from `public/panels/editor/app.js`, so no strip asks a device anything. What stops a phone printing is now the SERVER: the address book names which screen (and optionally which person and which device) prints each paper, and `lib/printHelpers.ts`'s `screenMayPrint` refuses everyone else. Corrected 2026-09-04. |
| The live socket stays open while a screen is the printer | `public/panels/realtime.js` (`keepAlive`) |
| The kiosk launcher | **Nothing is shipped and nothing is offered as a download.** The reader types the one small file by hand from `public/print-setup.html`. `public/print-station/*` and `app/api/print-station/` were DELETED on 2026-08-19 — do not re-create them, do not re-add a ⬇ button anywhere (§9). |
| Problems / stuck tickets | manager panel → **the notification bell** (owner, 2026-08-30: *"I don't want it there — it should be in the notification thing that we have built… why is it taking the space of the table boxes"*). The two bands above the table grid were removed; `printer_events` rows now draw a printer row in the bell instead. `verify:printing-sweep` pins both halves ("the floor draws NO printing band above the tables" / "printing speaks through the notification bell instead"). Corrected 2026-09-04. |
| **The restaurant-facing guide** | `public/print-setup.html` — served at `/print-setup.html`, linked from manager → Settings → Kitchen printing and from the kitchen's 🖨❗ sheet. THIS file is the engineering record; that page is what a restaurant reads. Keep them honest with each other. |

---

## 3. Setting up a restaurant — the checklist

1. **Plug the printer in and make it the computer's DEFAULT printer.** A USB 80mm thermal printer is
   fine; a LAN/Wi-Fi one is better (no long cable to the kitchen). The macOS driver recipe for the
   POS-80 is in the `aangan-thermal-printer-setup` memory — do not re-derive it.
2. **Admin → the restaurant → allow auto-print** (`auto_print_kot_allowed`). Nothing prints until
   this is on.
3. **Manager panel → Settings → Kitchen printing → "Auto-print the KOT when a new order arrives" =
   ON.** This is the restaurant-wide switch (the owner's).
4. **On the computer the printer is attached to, make the print station file BY HAND** — open
   `/print-setup.html`, pick that computer's operating system, and type the one small file it shows
   you (`print-station.command` on Mac · `print-station.bat` on Windows · `print-station.sh` on
   Linux). **There is nothing to download** and **no `URL` line to edit** — the page writes the
   reader's own site address into every command. Nothing is shipped: the old downloadable starters
   were deleted on 2026-08-19 because macOS refuses any script that arrives from the web (§9). Log in
   once; that window keeps its own Chrome profile and stays logged in.
   *(For an unattended computer that prints with no window open at all, use the print helper instead
   — `docs/PRINT-HELPER.md`, admin console → Printing.)*
5. **Choose WHERE the paper comes out** — admin console → **Printing** → the restaurant. Nothing
   has to be switched: *a computer prints a paper if one is set up and named for it; if none is, the
   kitchen screen prints the slips.* Two places to answer, if you want to:
   · *3 · Which printer gets which paper* — one dropdown per paper (kitchen slips · bills · banquet
     sheets), listing each set-up computer's own printers, plus **Nobody** for "we have decided this
     does not print".
   · *4 · The kitchen screen* — leave it alone and anyone signed in on the kitchen screen prints the
     slips. Name a person only to narrow the slips to THAT person's screen.
   This is an ADMIN screen, deliberately: the manager panel's Kitchen-printing section is hidden
   from everyone there (owner, 2026-07-31).

   ⚠️ **This step used to describe "🖨 KOT printing → Which screen prints the ticket?" with three
   options including *both — the counter is the backup (30s)*, and a sixth step telling you to
   answer a "Should this screen print the kitchen tickets?" strip on the manager's Tables screen.
   NONE of that exists.** `kot_print_target` was retired by migrations 369/376, "both" and every
   backup went on 2026-08-30, and the per-device strip went on 2026-08-29. A setup guide that sends
   somebody hunting for three controls that are not there is worse than no guide. Corrected
   2026-09-04 (T11 sweep #8); the old list is recorded here rather than deleted so nobody re-adds it.
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

---

## 7. Two faults found ON TOP of the original one (2026-08-18) — do not undo either

1. **A dead job starved the whole queue.** `pendingKotJobs` took the OLDEST rows and silently SKIPPED
   any whose order had been deleted. Harmless while only manual reprints existed; fatal once every
   order queues one — a handful of orphans sat at the head of the queue and nothing printed again,
   with no error anywhere, because every layer was behaving as written. Orphans are now **retired**
   (`dismissed`, with the reason on the row), which also clears them off the manager's stuck-job strip.
2. **A cancelled order's ticket could still be cooked.** An order can be cancelled in the seconds after
   its ticket queued. The manual-reprint endpoint has refused a cancelled KOT since 2026-08-11; the
   automatic path had no such guard because until mig 335 it had no rows to guard. Same treatment now.

Both are covered by `npm run verify:print-queue`, and both were measured on the dev stack before and
after — 33 cancelled-order tickets retired themselves on the next two board reads.

## 8. Where the setup guide lives

`public/print-setup.html`, served at **`/print-setup.html`**. Linked from the admin console's 🖨 KOT
printing card and its Printing screen, the owner's settings screen and the kitchen panel's 🖨❗ sheet.
It **offers nothing to download** — it teaches the reader to make the one small file by hand, one
menu per operating system — and it has its own save-as-PDF button. THIS file is the engineering
record; that page is what a restaurant reads — keep them honest with each other.

## 9. macOS blocks a downloaded script — and the URL trap behind it (2026-08-19)

The owner downloaded the Mac starter and got **“print-station-mac.command” Not Opened — Apple could
not verify it is free of malware**, with only *Done* or *Move to Bin*. Gatekeeper refuses any script
downloaded from the web that Apple hasn't notarised, and **the old right-click → Open escape is gone on
macOS Sequoia**. The guide said to right-click → Open. It was wrong.

There was a quieter second fault in the same file: its `URL=` line pointed at the **backup** site, so
every restaurant had to find and edit it. **A wrong URL and a blocked file look identical to the person
standing at the printer** — "nothing happens".

### The first fix was WRONG, and the second one is the live answer

**Attempt 1 (2026-08-19, morning) — generate the starter instead of shipping it.** `lib/printStation.ts`
held the three scripts and `app/api/print-station/[file]/route.ts` filled in the host it was downloaded
from, so nothing had to be edited by hand. It did not work, and it could not have: **Gatekeeper flags
every script that arrives from the web, generated or not.** A freshly minted `.command` is downloaded
just the same, so the person at the printer met the identical "could not verify" dialog. Windows
SmartScreen does the same thing for the same reason.

**Attempt 2 (2026-08-19, evening) — teach the file by hand. THIS IS THE LIVE DESIGN.** A file the
person types themselves carries no download flag at all, so there is nothing for Gatekeeper or
SmartScreen to refuse. Commit `606b8969`:

- **the download is gone everywhere** — the guide, the admin console, the manager panel and the owner
  panel. `lib/printStation.ts` and `app/api/print-station/` were DELETED. Do not re-create them, and
  do not re-add a ⬇ button anywhere: that is the change that put the owner in front of the dialog.
- `public/print-setup.html` opens with a picker — *"Which computer is the printer plugged into?"* —
  and then shows **one section per OS**: Windows (Notepad → `print-station.bat`), Mac (TextEdit →
  `print-station.command`), Linux / Raspberry Pi (nano → `print-station.sh`). Picking one hides the
  other two, the choice sticks, a link into a hidden menu opens it first, and a saved PDF still holds
  all three.
- every menu is the same six steps, click by click, with a **Copy button on every command block** — a
  hand-retyped Chrome command line is how `--kiosk-printing` goes missing.
- the page writes **the reader's own site address** into every command, read from the host it was
  served from, so there is no `URL=` line left to find and edit.

Guarded by `verify:print-helper`, which asserts all three operating systems get a by-hand menu **and
that nothing is offered as a download**, and by `verify:print-queue` for the flags the command must
keep. If you are about to make this easier by shipping a file: read this section again.

## 10. One screen is the printer (mig 338, 2026-08-19)

Owner: *"divide whole printing in both manager as well as owner and kitchen — from one only printer
will be connect at one time; if connect at manager and kitchen panel it show printing happening in
manager, wanna switch"*.

`print_stations` holds **exactly one active row per restaurant**, enforced by a partial unique index —
not by app code. `lib/printQueue.ts → mayClaim()` is the single gate both routes ask before handing a
ticket to a screen, and it does all four jobs at once: the master switch (mig 107), the room (mig 336),
the station, and taking the station when it is free.

| Situation | What happens |
|---|---|
| No station | The first entitled screen that asks becomes it. **A kitchen that has always "just printed" keeps doing exactly that** — no set-up. |
| A live station elsewhere | Every other screen is *told where* and offers **🖨 Print here instead** — one tap hands it over and the loser stops on its next read. |
| The station has gone quiet (> 3 min) | Any entitled screen may take it **without asking**, so a kitchen screen that gets switched off never holds printing hostage. |
| No device cookie | Never becomes a station (there would be nothing to hand over later). |

Where it shows: kitchen **☰ → Settings → 🖨 Printing** and the 🖨 sheet · manager **Settings → Printing**
plus a floor strip · owner **Settings → Kitchen printing** (read-only, one line per restaurant).

**Everything printing-related disappears when the master switch is off** — the manager's Printing row is
filtered out of the sidebar, the kitchen's Settings has no printing section, the owner's card does not
render. His rule of 2026-07-31: not greyed, absent.

### The kitchen screen finally has a ☰ menu

It had **no way to sign out at all** before this. `☰ → Settings` now holds printing, the three
per-device preferences (sound · layout · theme, clicked through to the existing bar buttons, never
re-implemented) and **Sign out**. No profile: the kitchen has none and that has been ruled three times.

**`target="_top"` on the sign-out form is load-bearing.** These panels run inside an iframe, so a plain
submit signs out only the FRAME and leaves the page around it — the person looks signed out and is not.
The waiter tablet had the same bug since its drawer was built; both are fixed.
