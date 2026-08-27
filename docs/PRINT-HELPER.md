# The print helper — one basket, many printers

> **Status:** BUILT 2026-08-20 — six stages, each driven rather than read (23 + a real print + 16 + 14 + 14 + 12 checks).
> Guarded by `npm run verify:print-helper` (100 checks, in `verify:static`) and `npm run verify:printing-sweep` (100 phases). Owner asked for it after the Aangan problem:
> one man is the owner AND the manager, sits in the owner panel in Manager mode, and the
> kitchen's auto-print window kept pulling his screen away — while three printers hang off the
> shop's computer (kitchen slips, bills, a small-paper A4 machine for banquet sheets).
> Plain-language plan for him: this file's `## In his words` section.

## 2026-08-27 — the machine with the printer sets ITSELF up (mig 367)

> Owner: *"I will select a particular user which I have created for the particular restaurant …
> that device is connected to the printer, so it will be easy for that device to set up the printer
> and all that, instead of the admin. Admin can still see it … but that device will set up, and that
> device will only get the option in settings, like everyone has their settings where they log out
> from. The UI/UX is also not identical … and which printer gets which paper — why are there only
> three options, one is bill, one is KOT and one is banquet? Right now it feels too much complicated."*

Six things changed, and each is guarded:

1. **A helper can be born on the restaurant's own screen.** `print_agents` gained `owner_device`
   (the panel's `lfh_panel_device`) and `owner_user`. Settings → Printing asks "is the computer I am
   sitting at already set up?" with one indexed read, and offers **register** / **adopt** if not.
   *Adopt* exists because a device id does not survive a cleared browser — without it the same
   machine would be registered twice, and half the tickets would come out in the wrong room.
2. **A new permission, `print_setup`** (`lib/accessTree.ts` ACTIONS, default **OFF**). It is separate
   from `print_here` on purpose: being the printer is "paper comes out of my machine", setting
   printers up is "I decide where the whole restaurant's paper comes out". It is asked on the server
   before every verb in `/api/editor/printing/*`, and it also opens the Settings tab on its own.
3. **One board, two places.** `lib/printBoardWords.ts` holds the four step headings, the three kinds
   and every sentence; `lib/printBoard.ts` holds the one read both screens make. The admin console
   and the manager panel print those words verbatim. The words file imports **nothing** — the admin
   page is a client component, so one `import type` from `printHelpers` was enough to drag the
   service-role module into the browser bundle and make `verify:static` refuse the page.
4. **One question a line, three answers.** A line used to carry six controls; five kinds of paper
   made thirty. Now: *A computer* · *A screen* · *Nobody*, and only what that answer needs appears
   under it. Backup printer, paper size, exact person and exact PC live behind **More**.
5. **`via: "off"` is a real, saved answer.** An empty line and a deliberate no used to look
   identical. They say different things now — and for **kitchen slips** the answer also writes
   `settings.auto_print_kot` through `syncKotSwitch()`, because mig 335's trigger reads that column.
   Without it the address book would say "nobody prints kitchen slips" while the basket filled for
   ever. That also removed the DUPLICATE switch from the admin board's step 1: one column, one
   control, which is what the 2026-08-26 "ON above, OFF below" fault was.
6. **The dead fifth line is gone.** `label` (parcel stickers) was never queued by anything and had no
   document builder — it was an address-book row nobody could ever fill. `ROUTABLE_KINDS` is now
   exactly `kot · bill · banquet`, which is the honest answer to "why are there only three options":
   **this app prints three documents.** A fourth would need the app to know which items belong to
   which kitchen section, and no such idea exists in the schema yet.

Driven, not read: the whole flow (register → helper hello → "Yes — print here" → auto-print on →
"Nobody" → auto-print off → test page → the helper claims it) was run headless on 2026-08-27 in both
panel skins with zero console errors, and `verify:printing-sweep` grew 12 phases (83–94) that ask the
real server as the real manager, with and without the permission.

## 2026-08-27 (later) — how far behind the printer is

> Owner: *"'the printer is off' and 'the printer is off and eleven orders are stacked up' stop looking
> the same. The second one means somebody should be reading the screen instead of waiting for paper…
> can do this too on whichever user it's on — then when anything happens they will get it."*

`waitingToPrint(rid, kind)` in `lib/printQueue.ts`: **one** round trip, an exact count with no rows
transferred, plus the single oldest row so the number can become a sentence. `STUCK_AFTER_MS` (60s)
travels with it, so no screen keeps its own idea of how long is too long.

**The count alone is never allowed to raise an alarm.** Four waiting is normal for two seconds and an
emergency after ten minutes; a badge showing "1" every time a ticket passes through the queue is
permanent furniture, and permanent furniture is invisible. Everything loud is keyed on the AGE.

Four places, same field, same words:

| Where | What a person sees |
|---|---|
| Kitchen → the 🖨❗ button | a red count badge, **only** once the oldest is over a minute old |
| Kitchen → 🖨 sheet | a **Tickets waiting** row under the three existing ones, plus a red box saying *read the orders off this screen and cook from it* |
| Manager → floor strip | one row, **first** in the strip, with *Where the paper goes →* — and **no "Resolved"**, because the tickets are still there and ticking it off would be a lie |
| Manager Settings → Printing and admin → Printing, step 4 | the same fact as a state row |

**Two faults it dragged into the light:**

1. **`state.helper` was never assigned in the kitchen panel.** The 🖨 sheet has read it since the
   helper shipped (2026-08-20) to say *"these tickets print on <printer> from <computer>"* — and
   nothing ever set it, so that whole branch was dead code. A cook standing beside a perfectly good
   printer at a silent screen got the generic answer instead of the true one, which is exactly the
   mystery the branch was written to end. `printRefused` was unused in the same way, and now says
   *why* this screen is not the printer.
2. **One dead printer produced SEVEN rows in the manager's strip** — the pile-up row plus five named
   "a reprint hasn't printed" rows, i.e. the same fault told six times, pushing the row that explains
   it off the screen. When the pile-up row shows, only the OLDEST named row is kept, because it
   carries the one button the pile-up row cannot (*Print here instead*).

A third state was added to the shared state-pair pattern: **`warn`**. `no` is neutral — a fact that
happens to be false — and it paints its value in `--muted`, so the word **STUCK** read as a
switched-off setting. `warn` carries the danger colour, a filled dot and its own border.

## 2026-08-27 (later still) — ONE file, zero typing, and it starts itself (mig 368)

> Owner: *"There wouldn't be one key for all restaurants. There would be different key for different
> restaurant or maybe a pairing code or whatever… one software only will be running in their PC just
> for printing and it will take data from this app… tell me an easy workable idea without any money
> cost."* Then, picking the handshake: *"zero typing one, yeah."*

**His first idea — one key for every restaurant — was withdrawn by him and would have been refused
anyway:** one plaintext key on every client's PC means one leak prints at, and reads the bills of,
every restaurant on the platform, and no shop could be cut off on its own.

### The handshake (the OAuth "device flow" — how a smart TV pairs with Netflix)

```
helper (holds NO secret)                    the person's browser, on THAT machine
────────────────────────                    ─────────────────────────────────────
pair/start ──► code + private secret
   opens /pair?c=<code> ──────────────────►  sees the hostname + printers it reported
                                             presses ALLOW ──► approvePairing()
pair/poll(code, secret) ◄── the token, ONCE
writes it to its own disk, for ever
```

Three things do the work, and each has a sweep phase:
1. **The browser opens on the machine at the printer.** That is the proof of "this is that computer".
2. **The code is not a credential.** Alone it can only be shown to a signed-in human for approval.
3. **The token is collected with a secret only the helper holds, exactly once.** Even the person who
   approved it cannot read it afterwards.

The **restaurant is chosen by the approver, never by the helper** — that is the whole security
boundary. A manager may only adopt into their own restaurant (the request's `rid` is ignored for
them); the admin must say which.

### What else went with it

- **The machine names itself.** `scutil --get ComputerName` / `%COMPUTERNAME%`. The "what should this
  computer be called?" box is gone — his words were *"what the fuck is a computer name"*.
- **The helper installs its own auto-start.** A macOS **LaunchAgent with KeepAlive** (so it also
  restarts if it dies mid-service), a Startup-folder shortcut on Windows, a `.desktop` entry on Linux.
  It used to be an INSTRUCTION, so it was skipped — and a skipped step means the shop opens, nothing
  prints, and nobody knows why. `HELPER_AUTOSTART` is a statement of fact now, not a to-do.
- **A single-instance lock**, because auto-start plus a double-click would otherwise put two helpers
  on one token. The second says "already running" and closes.
- **Windows fetches its own PDF printer.** Pinned URL + verified SHA-256 (checked by downloading the
  file on 2026-08-27). Windows has no built-in silent print-to-named-printer, which is why the old
  script said *"put SumatraPDF.exe next to this file"* — quietly making the client download a program
  by hand, so *"nothing is downloaded"* was only ever true on a Mac. A checksum mismatch deletes the
  file and refuses to run.
- **Windows reports paper sizes** (`Get-PrintConfiguration` + `Get-PrinterProperty`, per printer in a
  try/catch). It never did, so somebody typed them — and paper size is the setting that decides
  whether a slip prints sideways or at half size.
- **"New code / shown only once" is retired.** It minted a token to be carried by hand, and once the
  file stopped carrying one there was nowhere to show it. **Unlink** replaces it: unlink here, run the
  file there, press Allow — the same path as a first-time setup. It empties the routes that named the
  machine, so nothing points at a computer that cannot print.
- **Every restaurant on one page** (`/api/admin/printing/overview` + the `.adm-over` list). Four
  whole-table reads for the platform, grouped in memory — never N+1. Sorted worst-first: a pile-up
  outranks a sleeping computer, which outranks "no computer", which outranks "not routed". His words:
  *"it will be messy when there will be too much restaurants."*
- **`managerCan()` moved to `lib/managerCan.ts`**, unchanged. A second door asks it now (`/api/pair`),
  and a permission rule with two copies is the bug class the access rebuild exists to remove.

### Two faults found by driving it

1. **A spent pairing answered `waiting` for ever** (caught by sweep phase 104). The token had been
   collected and blanked, so `!token_once` fell through to "waiting" — a helper restarted a moment
   after collecting would sit being told to wait with a perfectly good token on its disk. `collected_at`
   now answers `expired`.
2. **The overview endpoint answered 400 to every request** — it sat below the route's
   `if (!rid) return err("Which restaurant?")`, and it is the one read with no restaurant behind it.
   The page rendered nothing and said nothing. Found by opening it.

Also fixed the same day, on the owner's report (*"in the admin, Access and permission, the UI is
clashing and overlaying"*): the Access search results panel is capped at 560px while the cards behind
run to ~1015px, so it covered the left half of every card and left the right half lit — sentences
chopped mid-word with the count pills still glowing beside them. It now has a **scrim that dims AND
blurs**; a dim alone was measured at rgb(16,20,27) → rgb(10,15,23) on the dark skin, which is a real
change and invisible to a human.

## Why the browser can never do this

A web page cannot choose a printer. `window.print()` under Chrome's `--kiosk-printing` always
goes to the machine's **default printer**, and there is no web API to pick one — so one browser
profile can only ever serve one printer. Every POS that routes paper per document (PetPooja's
station-wise KOTs, Square's printer profiles, Toast's category→station rules) does it from
**installed software**, not from a page. That is the whole reason this feature exists.

The second reason: a page must be OPEN to print. A tab that is closed, a laptop that is asleep,
a cook who quit the kitchen screen — all of them stop paper today. Printing that has to happen
when nobody is looking cannot live in a tab.

## The shape

```
    any screen (waiter's phone on mobile data · owner at home · admin console)
                                  │  drops a NOTE
                                  ▼
                        print_jobs  ── the basket, in OUR database
                                  ▲
                 "anything for me?" every 2s, outbound HTTPS only
                    ┌─────────────┴──────────────┐
              helper on the shop's computer   helper on the owner's Mac
              (3 printers)                    (1 printer)
```

Three parts:

1. **The basket** — `print_jobs` (mig 269, auto-queued by mig 335). Already live. A ticket is a
   ROW, which is what makes it survive a covered window, a reload, a power cut.
2. **The helper** — a ~40-line script on a computer that has printers. It polls, prints, confirms.
   It holds NO rules and NO layout: the brain stays server-side so their machine is never
   revisited.
3. **The address book** — per-restaurant routing rules in `settings.modules.printing`
   (`moduleBag`, so no new `settings` column — mig 326 rule).

### Why the helper polls and never listens

Everything in this app talks **outbound over HTTPS**. That is why a waiter can work on mobile
data while the printer sits on the shop's wifi — no same-LAN requirement, no fixed IP, no port
forwarding, nothing to configure on a restaurant's router, ever. A helper that had to be
*reached* would throw that away. **Any future printer client must obey the same rule** (a
CloudPRNT printer polls too, which is why it would drop straight into this design).

## The four ticks (the whole mental model)

| # | Tick | Who | What the screen says when it is missing |
|---|---|---|---|
| 1 | `auto_print_kot_allowed` — printing exists for this restaurant | admin | nothing about printing renders anywhere (R36: no greyed-out controls) |
| 2 | `auto_print_kot` — auto-print on | restaurant | "Auto-print is off" |
| 3 | a route for that kind of paper | admin (or owner if granted) | "Kitchen slips: no printer chosen" |
| 4 | the helper running | installed once, autostarts | "Shop's computer — last seen 6 minutes ago", notes wait |

Tick 1 is DELIBERATELY the existing switch. Printing is already an admin-controlled feature
(`lib/accessModel.ts` → `auto_print_kot`); a second entitlement would only be a second thing to
forget.

## Data

`print_agents` (new, mig 341)

| column | why |
|---|---|
| `id`, `restaurant_id`, `name` | "Shop's computer", "My Mac" — renameable, shown in every dropdown |
| `token_hash` | the helper's code, stored **hashed** (sha-256). The plaintext is shown once, at install |
| `fingerprint` | the machine that first used the code. A second machine reporting the same code with a different fingerprint is flagged, not silently accepted — that is the "someone copied the helper file" case |
| `printers jsonb` | what the machine reported it can see, e.g. `[{name:"Printer_POS_80", desc:"…"}]`. Dropdowns are built from THIS, so a printer nobody owns can never be chosen |
| `last_seen_at` | every poll touches it — this is the "connected / last seen 6m ago" line |
| `revoked_at` | one press kills a stolen or sold machine's code |

`print_jobs` gains (all additive, defaults safe): `agent_id`, `printer`, `payload jsonb`
(what to build: session/order/bill ids), and `kind` widens from `('kot')` to
`('kot','bill','banquet','label','test')`.

**Routing is resolved at CLAIM time, not at queue time.** The mig 335 trigger keeps inserting a
bare `kind='kot'` row; the server works out whose job it is when a helper asks. So changing the
address book takes effect on the next poll — no re-queue, no rules duplicated in SQL, and a
restaurant with no helper still has its jobs picked up by a screen exactly as today.

## The claim is the safety

One filtered `UPDATE … WHERE status='queued'` per job, as `claimKotJobs` already does. Whoever
lands first wins; everybody else gets zero rows. That single line is why "two tabs", "two
helpers", "a copied helper file" and "two computers with a printer of the same name" can all be
answered with *one piece of paper*.

## Endpoints

Agent-facing (`app/api/print-agent/[...path]/route.ts`), token in `X-LFH-Agent`:

| route | does |
|---|---|
| `POST /hello` | register or heartbeat: fingerprint + printer list in, agent identity + poll interval out |
| `GET  /next` | claim the next job for me (atomic), or 204 |
| `GET  /job/:id/document` | the finished HTML for that job — built by `public/panels/billdoc.js`, the SAME file the screen prints, so there is never a second layout |
| `POST /job/:id/done` · `/failed` | close it, or hand it back with a reason (and open a printer_event) |

Admin-facing (`/api/admin/printing/*`, behind `tokenIsValid` like all 48 others): list/rename/
revoke agents, read/write routes, mint an install code, send a test page.

## The helper itself

Plain text the person types themselves — no download, because a downloaded script is the
"Apple could not verify… / Move to Bin" dead end on macOS and SmartScreen on Windows (owner hit
both). `curl` ships with macOS and Windows 10+; Chrome is already on any machine running our
panels; so the helper needs nothing installed.

```
loop:  curl /next  →  save HTML  →  chrome --headless=new --print-to-pdf  →  send to the named
       printer  →  curl /done      (macOS/Linux: lp -d "<name>"     Windows: see below)
```

**The one platform wart:** Windows has no built-in "print this PDF silently to that printer".
Options, to be settled by testing on a real Windows box in stage 5: bundle SumatraPDF portable
(~6 MB, no installer, `-print-to "<name>" -silent`), or — for thermal printers only — skip PDF
entirely and copy the raster to the printer share (`\\localhost\<name>`). Whichever wins gets
written into the guide; the other stays documented as the fallback.

## Stages (each one lands on its own)

1. **Basket door** — mig 341, `lib/printHelpers.ts`, the agent API. Proved with a fake helper.
2. **The helper scripts** — macOS `.command`, Windows `.bat`, Linux `.sh`, by hand, autostart.
3. **Admin → Printing** — a whole new menu: agents, install steps, routes, backups, test print.
4. **Panels** — status in manager/owner Settings → Printing and the kitchen 🖨 sheet; panels stop
   printing a kind a helper owns; every screen says where the paper went.
5. **Bills + banquet through the basket**, with today's browser window kept as the automatic
   fallback so nothing becomes unprintable.
6. **Tests** — routing, no double print, helper offline, printer off, admin-view prints nothing at
   the client's shop, offline queue; guards extended.

## In his words

The basket is a list inside our app, on the internet. Any screen can post a note into it. On each
computer that has printers, a small program — the helper — looks in the basket every two seconds
and takes only the notes addressed to it, prints them, and ticks them off. You set the addresses
once from your own system: kitchen slips → the kitchen printer, bills → the bill printer, banquet
sheets → the big one. Nobody has to keep a panel open or logged in, nothing steals the screen, and
if that computer is off the notes simply wait.

## Rules this feature must keep (checked in stage 6)

- **One bill, one file** — the helper is handed the document built by `billdoc.js`. No ESC/POS text
  format, ever: that is a second layout, and a second layout drifts.
- **Egress-safe** — one poll per helper per 2s returning 204 when idle; job payloads are ids, not
  boards; no helper ever reads a full table.
- **Nothing renders when the flag is off** (tick 1), and the owner never sees what is withheld.
- **A tap is never dropped in silence** — "Sent to the Bill printer" or "Saved, will print when a
  printer is back", never a fake "printed".
- **The admin looking at a client's panel prints NOTHING at the client's shop** unless he
  deliberately says so, and that override is audited.

## What each stage actually cost, and what it caught

| Stage | Built | Faults it caught by being DRIVEN |
|---|---|---|
| 1 | mig 341 · lib/printHelpers · lib/printDocs · the agent API | `orders.platform` does not exist (an empty document, so nothing printed) · "Table 99" where the owner ruled "T7" |
| 2 | the three helper scripts | headless Chrome never exits after `--print-to-pdf` (hung for ever after ONE ticket) · `lp` returns 0 with the printer switched OFF, so the helper said "printed" when nothing did · the model name split on spaces and the PPD paper line matched with the wrong shape |
| 3 | admin → Printing | — (16/16 first run) |
| 4 | every screen stands down | the panel never carried the `helper` field, so every line about it was invisible · a device that had said "never print here" never asked the server, so the counter machine could not learn a computer had taken over |
| 5 | bills + banquet through the basket | the banquet sheet's lines read from a column that does not exist (an event sheet with no items) · `noBar` belongs on the document, not the figures |
| 6 | the guard + the hard cases | the guard tripped on its own explanation of ESC/POS · the parity harness fed the panel the wrong shape and cried drift where there was none |

## The hard cases, all measured

two computers whose printers share a NAME → one slip, to the addressed one · one code copied onto a
second machine → flagged, and the ticket still only picked up once · a refusal → back in the basket
with the reason on it · a backup printer → refused before its window, given the ticket after it · an
order deleted before printing → prints nothing and is closed, not retried for ever · auto-print
switched off mid-service → the helper idles and the ticket waits, then prints when switched back on ·
a removed computer → cannot even ask.
