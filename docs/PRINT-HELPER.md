# The print helper — one basket, many printers

> **Status:** BUILT 2026-08-20 — six stages, each driven rather than read (23 + a real print + 16 + 14 + 14 + 12 checks).
> Guarded by `npm run verify:print-helper` (163 checks, in `verify:static`) and `npm run verify:printing-sweep` (125 phases). Owner asked for it after the Aangan problem:
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
   under it. Paper size, exact person and exact PC live behind **More**. (There is no backup printer
   any more — see the note under the route table.)
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

## 2026-08-28 — the coarse "which screen prints" setting is retired (mig 369)

> Owner: *"right now I don't understand three options — 'With no answer on the Kitchen slips line
> below, which screen prints them?' — what do you mean by this option?"* Then: *"do what's left."*

`settings.kot_print_target` (mig 336, `kitchen | counter | both`) asked **the same question** as the
Kitchen slips line, in older and vaguer words, and the two could contradict each other — the printing
sweep caught the older one winning on 2026-08-26. It is gone from every screen and every code path.

**It was not a deleted dropdown.** On the dev stack **2 of 17** restaurants — French House and Aangan,
the two he tests with — were on **`both`** with the Kitchen slips line unanswered. Deleting the
setting would have silently removed their safety net. So the meaning moved first:

| old value | the route it became |
|---|---|
| `kitchen` | `{ via:"screen", panel:"kitchen" }` |
| `counter` | `{ via:"screen", panel:"manager" }` |
| `both` | `{ via:"screen", panel:"kitchen" }` — see the note below |

⚠️ **`both` NO LONGER EXISTS, and neither does any backup** (owner, 2026-08-30): *"What is this backup
printer and all that? We don't even need the backup printer — if there is a backup printer, remove it.
And if anything fails it should show me or the person: manager, owner, everyone should get a
notification that this has failed."* `backupPanel`, `backupAgent`, `backupPrinter`, `backupAfterMs`,
`SCREEN_BACKUP_MS` and `BACKUP_AFTER_MS_DEFAULT` were removed across nine files, and a restaurant that
had answered `both` simply keeps the kitchen screen. A silent second attempt somewhere else is paper
appearing in a room nobody is standing in, while the restaurant never learns its printer is broken.

**What replaced it is telling somebody.** A ticket that gives up after five tries files a
`printer_events` row of kind `auto_fail` against the printer that failed and sends an owner alert, so
the restaurant learns the printer is broken instead of the paper quietly coming out elsewhere.
(This paragraph was still describing the backup as current on 2026-08-31 — T25 round 3, item 39.)

Migration 369 is **idempotent** and only touches restaurants that have **not** answered the Kitchen
slips line — a newer decision is never overwritten. **The column stays** (schema changes here are
additive, one folder feeds two databases) with a `COMMENT` saying it is retired; nothing reads or
writes it, and `verify:print-queue` now fails if any of seven files touches it again.

### Two faults found before shipping, one mine and one the sweep's own

1. **With no route at all my first version let the MANAGER screen auto-print.** The retired column
   defaulted to `kitchen`, so a manager panel left open on a restaurant that had never touched the
   Printing board would have started pulling kitchen tickets it never used to. Sweep phase 22.
2. **The sweep's "a DIFFERENT person" shape read an owner with no restaurant filter**, so it could
   pick another restaurant's owner — the server correctly refused the shape and three phases blamed
   the product. A sweep that cannot tell its own bad data from a real fault is worse than no sweep.
   (And my new self-backup phase wrote the jsonb straight to the database, which never runs the
   validator it was testing. It goes through `/api/admin/printing/routes` now.)

`verify:printing-sweep` **112 → 118 phases**, 0 failed.

## 2026-08-28 — TWO MODES behind one toggle, and only the chosen one on screen

> Owner: *"I want both A and B — I want the toggle AND the simplified UI, and do one thing: you only
> see the option you have selected, only the setting for that option will be shown."* And on mode B:
> *"if we run that .bat or .command file it will open that Chrome which runs minimised and doesn't
> auto-open when printing required, doesn't affect other tabs while print. Test all that by yourself."*

### The two ways — and there is NOTHING TO CHOOSE (owner, 2026-08-31)

> ⚠️ **Previously** (owner, 2026-08-28): *"there will be 2 mode… I want a toggle and the simplified UI
> — like you only see the option you have selected."* **Latest** (owner, 2026-08-31): *"in admin panel
> also we don't need toggle… with toggle gone it on and off will decide that the helper will be on and
> off and kitchen panel will always be on and there will be guide for it."* The toggle is gone.

| | **A computer** (optional) | **The kitchen screen** (always on) |
|---|---|---|
| what runs | the helper program | the kitchen panel, in its own minimised Chrome |
| anything open? | nothing | that Chrome stays running |
| more than one printer? | **yes**, one per kind of paper | no — the machine's default printer |
| someone signs in? | no | **once**, in the window it opens |
| has to be set up? | yes, if you want it | **no** — it is the default |

**What decides, in one sentence: a computer prints if one is set up and named; if none is, the kitchen
screen does.** `settings.modules.printing.mode` is **deleted** (mig 372 swept the dead key out of the
three restaurants still carrying one), and `PrintMode` / `readMode` / `writeMode` are gone with it.
The answer is READ off `routes` by `lib/printHelpers.ts → resolveTarget`, which is where the paper
always read it from — the stored mode was a second copy, and a second copy that can disagree is why
it went. An **unanswered kitchen-slip line resolves to the kitchen screen**, with nobody named.

Two consequences worth knowing:
- **Clearing a paper line is not switching printing off.** Only a deliberate **Nobody** (`via:"off"`)
  does that. `syncKotSwitch` treats `null` as on for exactly this reason — before the fix, taking the
  printer off the kitchen line silently stopped the restaurant printing while the board still said
  the kitchen screen was doing it.
- **It cannot double-print.** A ticket is a ROW (mig 335) and `claimKotJobs` only wins rows still
  `queued`, so two claimers racing means the second matches nothing. The queue guarantees one copy —
  never the mode, which is part of why removing it cost nothing.

### `lib/printStationScript.ts` — the kitchen screen's launcher, and four things it took
1. **"runs minimised / doesn't auto-open"** — running the Chrome binary steals focus, and **so does
   `open -g -j -n` with a real URL**: measured, frontmost went `Finder → Google Chrome`. An
   `about:blank` test had said otherwise — the kind of easy test that ships a false promise. The mac
   launcher now **remembers who had the screen and hands it back**; measured after that,
   `Finder → Chrome → Finder`. Windows uses `start /min`.
2. **"doesn't affect other tabs"** — its own `--user-data-dir`, i.e. a separate Chrome instance. Their
   ordinary Chrome, tabs, history and logins are untouched, and quitting one does not quit the other.
3. **"doesn't auto-open when printing"** — `--kiosk-printing`. Deliberately **not** `--kiosk`, which is
   fullscreen kiosk — the opposite — and is what the old setup guide told people to use for this.
4. **The one nobody would guess: a hidden Chrome must still run its timers.** Chrome throttles
   background and occluded windows hard, and a throttled panel stops polling — the tickets simply
   queue while everything looks fine. The three `--disable-*throttling/backgrounding` flags are
   load-bearing: a hidden instance carrying them **beaconed 13 times in 14 seconds** against a local
   counter, i.e. full rate.

No password in it, like the helper: the person signs in once and that Chrome profile remembers.

### The screens, on both sides
Card 3 was three papers × (two shape buttons + computer + printer + paper + screen + person + device
+ two backup pickers — both since REMOVED with the backup printer itself, 2026-08-30) with **five** Save buttons — about twenty controls, all on screen whether they
applied or not. Now: **one toggle → only that mode's setup → the three papers**, each just
*On / Nobody* plus a printer in computer mode. Measured on screen: **22 controls in computer mode, 14
in screen mode** on the console, and **14** on the manager panel. Refinements behind **More**. The two
launcher cards share ONE component on each side, because two copies of that markup is how the boards
became "not identical" the first time.

Guarded by 16 new `verify:print-helper` checks (**132** total) and 7 new sweep phases (**125** total,
0 failed) — including that a `nobody` line survives a mode change and that a mode change re-asserts
auto-print.

## 2026-09-13 — the LOGIN is gone: a ten-minute code the screen hands out (mig 380)

> Owner, reading the report on the old setup: *"when I'm setting up helper it tells me to login wtf,
> helper is separate thing it will work on the pc itself then why login and which role to login"*.
> Then, ruling on it: *"still instead of login make something else otherwise the waiter will also do
> that printing thing and make completely diff login not this"*. Then naming the shape himself:
> *"you can generate code for each restaurant from printing menu and like the helper ask for that
> code and that generated code only works for 10 min and all that."*

**He was right, and the flow was worse than he knew.** mig 368's Allow page asked for a **staff
login on the restaurant's own counter PC** — the same login a waiter has. A permission switch
(`print_setup`) was doing the separating, and a permission switch is not a door. Four faults sat
on top of that, and all four are gone with the page:

| # | What a person saw | Why |
|---|---|---|
| 1 | a correctly signed-in manager told **"Sign in on this computer first"**, for ever | `/api/pair` answered `{signedIn:false}` for "no permission" as well as "not signed in". `print_setup` is default OFF, so this was the ORDINARY case. A kitchen login could never pass at all. |
| 2 | signing in threw the pairing away | `/login` only honours `?next` when it **exactly equals** that role's home page, so `/pair?c=…` was dropped and the tab never came back. |
| 3 | an existing session was a one-way trip | `/login` redirects a signed-in person straight to their panel without showing a form. |
| 4 | both guides promised **no login** | `/print-setup.html` said *"no password to type"* and *"Someone has to sign in? **no**"*; the board's step 5 said *"Press Allow. That is the whole setup."* |

### What it is now

```
the Printing screen — somebody is ALREADY signed in there      the computer at the printer
──────────────────────────────────────────────────────       ───────────────────────────
presses "Show a setup code" ──► one code, ten minutes         the helper asks for a code
     shown ONCE, with a countdown ─── read it out ──────────► the person types it
                                                               pair/claim
the computer appears on the board ◄─────────────────────────── token written to its own disk
```

**Nobody signs in on that machine — not to set it up, and not afterwards.** The code is the separate
door he asked for: it signs nobody in, reads nothing, lives ten minutes, is spent by the first
machine that uses it, and the only act it can perform is attaching ONE computer to ONE restaurant's
printing. A waiter cannot produce one — the Printing screen is behind the admin console or
`print_setup`, exactly as before — and a waiter's own login now opens nothing here at all.

### The trade, stated plainly

The old code was **not** a secret: seeing it gained nothing, because a signed-in human still had to
approve. **This one IS a secret for its ten minutes.** That is the price of not asking a shop's PC
for a login, and it is priced down to:

- **ten minutes**, his number · **single use** · **one live code per restaurant** (issuing a new one
  kills the old one in the same breath, so two are never working at once)
- **stored hashed** (`code_hash`, sha-256) — the database never holds the plaintext, so a row cannot
  be read back into a working code, and a board that lost the digits gets a FRESH code, never a
  second copy
- **a wall that is also the alarm** — `print_setup_code`, 20 tries per 10 minutes per address, and a
  code that WORKS clears the counter (the same rule, for the same recorded reason, as a staff login:
  a wall exists to stop repeated wrong tries, so proving you hold a real code must reset it — without
  it, setting eight machines up in one sitting from one address walls the ninth)
- **an audit row that never carries the code** — `print_setup_code_issued` says one was handed out
  and by whom; the digits are the one thing that must not be readable afterwards

What a leaked code can do, inside its ten minutes: attach one machine to that ONE restaurant's
printing. That machine can then print and reprint that restaurant's own tickets — nothing else in
the app accepts an agent token. It appears on the Printing board **by name** the moment it is used,
and one press of Unlink ends it. No other restaurant is reachable, ever.

### Three doors were DELETED, not switched off

"A new way replaces the old one" (owner, 2026-08-29). All three minted a **permanent** printing
credential and **no screen had called any of them since mig 368**:

| Gone | What it did |
|---|---|
| `/pair` + `/api/pair` | the Allow page and its door |
| `POST /api/admin/printing/agents` | made a computer row and answered with its token, plus a helper file with that token typed in |
| `agents/:id/newcode` | minted a replacement token (`verify:print-helper` had been asserting since mig 368 that no screen may show it) |
| the create branch of the panel's `this-computer` | the same, from a manager's browser |

`print_pairings` went with them — an approved-but-uncollected row still held a one-time token.

### Two faults found by DRIVING it, and neither was visible in the code

1. **A machine could not come back under its own name.** Unlink a computer, run the helper again,
   type a fresh code → *"There is already a computer with that name."* A database word, to a person
   standing at a printer, about the **commonest path there is** — re-linking, where the hostname has
   not changed. `print_agents` is `UNIQUE (restaurant_id, name)` across **all** rows and revoked rows
   are KEPT on purpose (mig 341), so the name check must not filter them out. It did. *(Inherited
   from `approvePairing`, which had the identical filter — it mattered less when re-linking meant
   pressing a button in a browser and the error landed on a page.)*
2. **The screen that handed out the code lost the machine.** The panel finds its computer by
   `owner_device`, and a HELPER has no browser — so a row born from a claim had none, and the panel
   **on the very machine that had just been set up** still said *"this computer is not set up yet"*.
   The device that ISSUED the code is the honest answer, and it is written on now. mig 367's promise
   (*"that device will set up the printer… and that device will only get the option in settings"*) is
   intact.

A third came out of the sweep: the panel's code verb sat **below** the "this browser has no device
id" line, so a panel whose device cookie had not been written was refused a code it had every right
to — and told to reload the page, for a problem that was never its own. A setup code belongs to the
restaurant, not to a browser; it sits above that line now.

### The helper, when nobody is watching

Setting up means somebody **typing**, so every path where nobody can type had to be an answer rather
than a hang:

- **an auto-started copy marks itself** — `--auto` (mac/linux), `/auto` (Windows) — and with no token
  it steps aside instead of waiting at a prompt inside a minimised window nobody will ever restore,
  which from the outside looks exactly like a helper running fine and never printing
- **a refused token clears itself** and asks for a fresh code. It used to say *"delete
  `$TOKEN_FILE` and start this file again"* — a hidden folder inside a home directory, which is not a
  thing a restaurant does, so the real outcome was a machine that never printed again
- **an unattended copy LETS GO of the lock** and stops. Waiting in a loop was the obvious way to
  write it and the wrong one: that copy can never do anything again, and while it waits it holds the
  single-instance lock — which is exactly what somebody walking up to re-link the machine needs
- **the Mac's LaunchAgent throttles at 300s**, because KeepAlive's default is ten SECONDS and an
  unlinked machine exits at once
- **Windows never puts the typed value on a command line** — it goes to a file and PowerShell strips
  it to letters and digits there. A quote or an ampersand pasted out of a chat is how a `.bat` stops
  being the file you wrote
- **the code is forgiving to type**: `K7M P2X` with the space, a dash, or lower case are all one code,
  and the alphabet leaves out every character that sounds or looks like another (`0/O`, `1/I/l`)

### How it was checked

`verify:print-helper` **159 → 173** checks, and **all 11 sabotage cases caught** — the code stored in
the clear, the unfiltered spend, the revoked-row name filter, the ten-minute life, two live codes,
the missing wall, the Allow page restored, the helper opening a browser, each of the three auto-start
entries losing its mark, `newcode` restored, and the panel trusting a `rid` from the request.
*(The first version of the auto-start check was `/--auto/` and matched **this file's own explanation
of `--auto`** — it stayed green while the plist and the Windows shortcut both lost it. Each launcher
is named separately now.)*

`verify:printing-sweep` **125 → 488 phases against a running app, 484 passed, 0 failed**, including
the real end-to-end join, the re-link case, and the two permission sections. The **real generated
helper** was then run on a Mac in a pty with HOME redirected: it prompted, took the code typed in
lower case with a space, linked, wrote its token, installed its own auto-start, and never echoed the
token — and the three unattended paths were driven the same way.

Two guards had the same **parser blind spot** and are fixed in this change: `echo(` is cmd.exe's own
idiom for echoing a value, and both `%VAR%`-in-a-block walkers read its `(` as an opened block, after
which every later line looked nested. One of them reported twenty correct lines as faults.
## 2026-09-13 — the two ways, SEPARATED, each saying whether it is on

> Owner: *"In the admin panel printer menu I told something, you made something different. I want
> both separate — on top of printer there should be 2 menu, one for screen printing by chrome kiosk
> and one for helper, and they should have colour of red or green according to they are on and off.
> Design whole UI."*

**What he was looking at.** Removing the toggle on 2026-08-31 left the admin board as one stacked
column: the helper's computers, the helper's file, the three paper lines, the kitchen screen and the
station file, all in a row — and **nothing on the screen saying which of the two ways this restaurant
actually prints with.** Both halves were equally loud whether they applied or not, which is the same
complaint he made on 2026-08-28 about twenty controls being on screen at once.

**Second pass, same day, after he looked at it:** *"I want proper menu change on very top… and why
the fuck I'm on OFF one and on top it show YES it's on."* Two fair hits, both fixed:
- The ways were card **2**, under a step-1 card that existed only to hold the entitlement switch — so
  the first thing on the page was a walk-through, not the choice. **The menu is now the first thing
  under the title**, and the page below it is that one way's setup and nothing else. The numbered
  steps inside each way are gone with it (`STEPS.two/three/screen` carry no numbers; `STEPS.one` and
  `STEPS.four` still do, because the MANAGER's board is still one stacked list and shares them).
- That step-1 card printed a big green **YES** two inches above a tab reading **OFF** — two different
  switches (*may this restaurant print at all* vs *is the helper carrying paper*) in the same words.
  The card is gone; the entitlement is a **chip in the header** reading "Printing allowed" /
  "Printing is off for this restaurant". The words ON and OFF now belong to the two ways alone, and
  `verify:print-helper` fails if a YES/NO pair comes back to this board.
- And a fault found in my own screenshot of the rewrite: on a restaurant with printing switched
  **off**, the screen tab still read a green **ON**, because the kitchen-slip line underneath was
  untouched. The entitlement now multiplies both ways — no paper can come out, so neither way is on.

**Third pass, same day:** *"It should be 2 small option, also it should sync with the UI/UX."* The
two ways were big cards eating a third of the screen, in a console that already has ONE pattern for
picking between views — `.adm-tabs`, the compact pill strip on Analytics, Logs and Floor. So the menu
is no longer its own component: it **is** `.adm-tabs` (`className="adm-tabs adm-waytabs"`), with a
status dot and the word ON/OFF added, and one line of explanation underneath for whichever way you
are on. Two CSS traps, both found by measuring rather than looking:
- `.adm-waytabs button` has the **same specificity** as `.adm-tabs button` and sat EARLIER in the
  file, so the phone padding never applied — 26px tall tabs where a finger needs 34. Then `.adx
  .adm-tabs button` (the console's own compact sizing) did it again, one level deeper. Every rule is
  now `.adm-tabs.adm-waytabs`, and the phone ones are also `.adx`-prefixed AND placed after it.
- The selected tab fills with the accent gold, where a tinted green/red measured **1.6:1** and the
  shared pattern's own ink is **3.68:1** — under the 4.5 a 12px word needs. The selected tab's ON/OFF
  gets a white chip of its own and keeps its colour: ~9:1, meaning intact.

**Fourth pass — and the shape is HIS, off a real comparison.** Ten designs were built and served on
the preview port (pill strip · soft buttons · outline chips · **underline tabs** · joined segment ·
mini cards · a dropdown · a filled strip · a side list · badge tabs), each one live, each one
flippable between ON/OFF so he could see every state. *"I liked underline one."* So the board carries
design 4: `.adm-waybar` — no box, no fill, no container, just the two names on a hairline with an
accent underline under the one whose setup is open. `verify:print-helper` asserts that class by name,
because a later "tidy-up" back into a boxed strip would silently reverse a choice he made by looking
at all ten. The `.adm-tabs.adm-waytabs` work from the third pass was deleted, not left switched off.

**Fifth pass — the row got its own two controls, and the prose went inside an ⓘ.** *"I don't want
this option 'printing allowed for this restaurant'. There should be an on-and-off feature button
after the underline toggle thing, and also make an i button and put this written info inside that,
not here."* So the header is navigation only again, and the tab row ends with **ⓘ** + one button
whose verb carries the state (**Switch off** means it is currently on). The four lines that sat under
the tabs — which way is open, whether it is on, what is true today, what that way even is, plus what
the switch beside it does — are the ⓘ's content. It closes on the button, the ×, Escape, a click
outside, and the phone's Back button (`lib/backStack → useBackClose`, like every overlay in this
console); on a phone it is a bottom sheet, because `top:auto` alone left it covering the very tabs it
explains. Two tap targets were measured and grown: the ⓘ (30 → 34, 38 on a phone) and the popover's ×
(which flex had stretched to 194 × 19).

**Sixth pass — each way switches ITSELF.** *"Both should have separate on off, right now they have
same."* He was right: the one button on the row was the restaurant-wide entitlement, so both tabs
shared it. The row's button now acts on the tab you are standing on, and it writes the very route rows
the tab's colour is read from — so the word above the button and the button's own verb cannot drift:

| | switch OFF writes | switch ON writes |
|---|---|---|
| **A screen prints** | kitchen slips → `via:"off"` — nothing prints them by itself, anywhere | clears the kitchen-slip line → back to the kitchen screen (works whether it was off **or** a computer had it) |
| **A computer prints** | clears every paper that names a computer — slips fall back to the kitchen screen, bills and banquet sheets to whoever presses Print | **refused, with a reason.** Turning it on means naming a printer, and this screen must never guess one — the `writeMode` lesson. The button is disabled and says "pick a printer below". |

The restaurant-wide entitlement moved **into the ⓘ** (and onto the red banner, which is the one
moment it must not be behind anything). Driven end to end on a spare dev restaurant: screen ON → OFF
→ ON with the stored row checked at each step, the computer tab's refusal read off the real button,
then the restaurant put back to exactly the entitlement and route row it started with.

**Seventh pass — one surface, and the switch proved at the database.** *"Make sure that on/off
actually work, and change the UI/UX — it looks dark and unmerged, separate UI."*

- **Merged.** The tabs were floating on the page background above a stack of separate cards, so the
  dark page showed through between every block and the switcher belonged to nothing. The tabs are now
  the HEAD of the panel they open: one `.adm-waycard`, the tab row across its top, the chosen way's
  setup as hairline-separated `.adm-waysec` sections inside it. Both `FileCard` callers became
  sections too — a card nested in a card drew a second border.
- **Proved.** Driven on a spare dev restaurant, reading the column mig 335's trigger actually reads:
  **Switch off → `settings.auto_print_kot` = false** (no slip is ever created), **Switch on → true**.
  Then the restaurant was put back to the exact entitlement, route row and column it started with.
- Two faults this turned up, both mine, both measured: a 5% accent wash on the tab strip pushed the
  ON/OFF words to **2.67–3.08:1** and the ⓘ and switch to **3.65:1** in the LIGHT console — the wash
  is gone, and the ON/OFF word now uses the console's own `--hue` + `.hue-ink` rule (the same one
  `.rp`, `.own-av` and `.adm-chip` use to stay readable on the light skin) instead of a colour of its
  own. And `verify:print-helper` was pinned to `className="w"` exactly, so adding `hue-ink` turned it
  red for a spelling change — it takes extra classes now.

**Eighth pass — a switched-off way is ONE LINE, and the dark-skin button was invisible.** *"In dark
mode why the on button is like this… everything should be functional. When on, then only show the
bottom thing, otherwise hide them — kind of like a dropdown: if you turn it on, the dropdown comes."*

- **The button.** Measured, because a screenshot will not tell you: a plain `.adm-btn` in the DARK
  console computes to `background: rgba(0,0,0,0)` with **no border** — on a card that is bare grey
  text, not a control. It reads fine in the light skin, which is how it shipped. The two controls on
  the tab row now carry their own outline; `.primary` keeps its fill, so "Switch on" is the loudest
  thing on the row in both skins.
- **The dropdown behaviour.** A way that is switched off now shows a single line saying so and what
  turns it on — its setup is not rendered at all. Switching it on opens it.
- **The one that cannot switch itself on.** A COMPUTER is switched on by a printer being named, and
  that choice lives in the setup — so "Switch on" there OPENS the setup (and the tab stays honestly
  **OFF**, with a line at the top saying so) rather than guessing a machine. Pressed again it reads
  **Cancel** and shuts. There is no state where a button on that row does nothing.
- Driven end to end on a spare restaurant: screen OFF → collapsed + `auto_print_kot` false → ON →
  expanded + true; computer OFF → collapsed → opened (4 sections, tab still OFF) → Cancel; ⓘ opens,
  Escape closes; the person dropdown, Refresh and Stop-the-queue all still answer. Restored exactly.
- One more contrast fault caught on the way: "Cancel" kept the accent fill and measured **3.43:1**
  white-on-orange. It is the outlined style now.

**What it is.** The menu is two tabs on a hairline:

| | **A computer prints** (the helper) | **A screen prints** (Chrome, out of the way) |
|---|---|---|
| green when | a computer is named for at least one paper, and that machine still exists | the kitchen slips are left to a screen — the kitchen panel, or one named person's |
| red when | no paper is pointed at a computer | the slips are switched off, or a computer took them |
| clicking it | opens *The computer that prints* + *Which printer gets which paper* + the helper file | opens *Whose screen prints the kitchen slips* + the print-station file |

Under the strip, one small line names the way you are on, whether it is ON or OFF, what is true today
and what that way actually is — so the tabs stay small without the teaching being lost.

**⚠️ This is not the stored mode coming back, and the distinction is the whole design.** The deleted
`settings.modules.printing.mode` was a SECOND ANSWER that could disagree with the routes; these cards
are a **mirror** of the one answer, derived in the page from the same three route rows
`lib/printHelpers.ts → resolveTarget` reads on the server. Nothing is posted, nothing is stored, and
**both cards can be green at the same time** — a computer on the bills while the kitchen screen keeps
the slips is an ordinary restaurant, and a real toggle could not express it. Turning the helper on
still means naming a printer in step 4; turning the screen on still means leaving the slips alone.

Three details that are deliberate:
- **The colour is never the only signal.** Each card carries a dot, the word **ON**/**OFF**, and a
  sentence naming what is true today ("Kitchen slips · Bills — printed by a computer").
- **Selection is drawn in the accent, not in red/green.** "This way is working" and "this way's setup
  is open below" are two different facts; drawing both in colour is how they get confused.
- **A helper that is set up and ASLEEP stays green**, with an amber line inside it naming the machine.
  Flipping it red would read as "nothing is set up" when the truth is "it is set up and the PC is off",
  and the tickets are waiting on purpose (mig 335).

The board lost its numbering with it — the menu is the structure now, and each way is two cards deep.
The log at the bottom lost its hard-coded "5 ·" too. The manager's own board
(`public/panels/editor/app.js`) is untouched and still one stacked, numbered list.

Dead styling went with it: `.adm-mode` and `.adm-confirm` in `app/globals.css` had rendered nothing
since 2026-08-31. Guarded by 4 new `verify:print-helper` checks (**160** total), each sabotage-tested
— the menu exists, **the ON/OFF word is on the tab's own chip** (the first version of that check
tested the whole file and stayed green when the chip was gutted, because the board carries that
ternary twice), it posts nothing, both setups stay reachable, and no YES/NO row returns.

Measured on the real screen at 1440 and 390, dark and light, on both tabs: no text under 4.5:1, none
under 11.5px, nothing clipped, no sideways scroll — with the measurer itself sabotage-checked first.

## 2026-09-13 (same day) — it did not work on a real Windows PC, and why nothing here caught it

> Owner, with a photo of the helper window on his own Windows machine:
> *"right now the code is not working it's showing like this"* — and in the photo:
> `Get-Content : A positional parameter cannot be found that accepts argument '^'.`

**One character.** Four lines I added read the server's answer through PowerShell inside a
`for /f "usebackq"` — and I wrote the pipe as `^|`. Inside `for /f`, the command text is handed to
cmd, and **a pipe between double quotes is already literal**: there is nothing to escape. The caret
went straight through to PowerShell as a stray argument.

**Three reads in the same file have always used a plain `|` and have always worked** (`pollMs`, the
job id, the printer). Mine did not match them. That is the whole fault.

**Why it was worse than a broken message.** It broke all four reads of the join at once — the error
sentence, the token, the restaurant and the computer name — and it failed in the most misleading way
available: a **correct** code was **spent on the server**, the token read came back empty, the helper
said *"The site answered oddly"* and went round again. **So every attempt burned a fresh code**, and
neither screen said why.

**Why nothing here caught it.** There is no Windows machine and no PowerShell on this side — §D of
`verify:print-documents` already says this is the boundary that section works inside. Everything that
COULD be checked was: the generated file was syntax-checked, walked for `%VAR%`-in-a-block, and the
Mac half was run for real in a pty. None of that executes cmd.

**What now stands in for a Windows machine**, in `verify:print-helper` block 8j:
1. **no cmd escape (`^|` `^&` `^<` `^>`) inside a quoted `-Command`** — and deliberately *not* "no
   caret at all", because `-replace '[^A-Za-z0-9]'` is a PowerShell character class and is correct;
2. **every `for /f` read must match the exact shape of the three a real Windows PC has run.** With no
   way to execute the platform, "it is identical to what works" is the strongest assertion available
   — and it is the one that would have stopped this.

Both were sabotaged four ways and caught every time.

### And the code could not be copied — or rather, it could, silently

> *"im also not able to copy the code or code is being copy but it not show button click animation
> and also at bottom copied written"*

The admin board's Copy called `navigator.clipboard.writeText` **directly**, bypassing the page's own
`copy()` — so the code really was on the clipboard and **nothing on the screen moved**. The only way
to find out was to paste somewhere and look. The manager panel had **no Copy button at all**.

Both now go through the board's own copy helper: the button changes to **Copied ✓** and changes back
by itself, *"Copied."* appears at the bottom, and a browser that **refuses** the clipboard is said out
loud instead of looking identical to success. The answer lands in **both** places on purpose — a toast
at the foot of a tall settings page can be off screen while the thumb is still up on the code.

Driven in Chrome on both boards: the clipboard was read back and compared to the rendered code, the
button's label was checked before, during and after, and the toast was counted. 13/13.
`verify:print-helper` **173 → 184**. Three of the new checks were blind on their first write — one
matched its own commented-out line, one matched the OTHER copy button's toast, one matched this
file's own prose — and each is now anchored to the handler it guards, with comments stripped.

## 2026-09-13 (third round) — the same photo twice, and why nothing could tell the copies apart (mig 381)

> Owner, sending the identical error an hour after it was fixed and shipped: *"this again it's not
> working bro"*.

**He was running the old file, and there was no way for anybody to know that** — not from his
screen, not from his photograph, not from our board. The two copies fail the same way and look the
same doing it. That is the fault this section is about; the caret was only the thing underneath it.

**The server knew and could not say.** The record is unambiguous: a code was made at 15:42:12,
**claimed at 15:43:20 by `INFINITE`**, a `print_agents` row was created carrying all six of his real
printers — *POSPrinter POS80*, *KOT Printer* — and it **never said hello**. An old helper cannot read
the token out of the reply, so the shape of the failure was:

- the code was **spent** → he had to fetch another one
- a **dead computer row** was left → it littered the board and took the machine's name, so the next
  attempt would have come back as *INFINITE (2)*
- **nothing anywhere said why** → so the next attempt did exactly the same thing

### Every file now carries a stamp, and it stamps itself

`helperVersion(os)` hashes the file's own generated text — SITE line masked, so one file has one
stamp on backup, live and localhost — and the result is printed in the banner:

```
    Site       https://3-d-backup.vercel.app
    Computer   INFINITE
    Version    1148654
```

**Derived, never typed.** A version somebody has to remember to bump is wrong exactly when it
matters. Change one character of any branch and its stamp changes by itself. One line in a photo now
answers the question that cost two rounds.

### An unstamped claim is refused, and the refusal costs nothing

A claim with no stamp can only come from a file made before today, so it is refused — **checked
after the code is known good**, so an unstamped claim with a *wrong* code still reads exactly like
any other wrong code and this cannot be used to tell real codes apart.

| | before | now |
|---|---|---|
| the code | **spent** | **untouched** — the one on screen still works, clock still running |
| the board | a dead row appears | nothing is created |
| the reason | nowhere | `refused_old_file_at`, and **both boards say it in words** |

That last row is the load-bearing one: an old helper **cannot** show our message, because reading it
is the very thing that is broken in it. The only screen that can carry the answer is the one he is
already looking at.

### And a setup that never finished gives the name back

His dead `INFINITE` row would have kept that name for ever, so every retry became *(2)*, *(3)*. A row
that has **never said hello at all** and is **older than any setup code can live** is a ghost: it is
renamed (`INFINITE (never started, 2026-09-13)`) and retired, freeing the real name. Narrow on
purpose — a machine that genuinely joined says hello seconds later, as the helper's own next act, so
nothing real can sit inside that window. Rows are renamed and retired, never deleted: the record of
what printed where has to stay readable (mig 341).

### Checked

Driven against a running app with the **old file's exact request** — no `helper` field, his
hostname, his printer list — and then the same code again from a stamped one: refused with a
sentence · code not spent · no row created · board told · same code then works · **name taken back
from the dead row** · the dead row kept, renamed, retired · hello succeeds, which the old one never
could · a wrong code reads identically with or without a stamp. 9/9.

`verify:print-helper` **184 → 191**, `verify:printing-sweep` **488 → 490 phases, 0 failed**. Eight
sabotage cases, and **two were blind on the first write**: "the file carries a stamp" matched the
copies inside the claim body while both banner lines were deleted (the banner is the whole point —
the server can be *told* the version, but only a printed line answers a photograph), and the
Windows check needed both of that file's banners removed before it would go red. Each is now
asserted per file, on a line that is actually echoed.

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
   (The *backups* part of that menu is gone: the backup printer was removed on 2026-08-30.)
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
with the reason on it · ~~a backup printer → refused before its window, given the ticket after it~~
(that case no longer exists — the backup printer was removed on 2026-08-30, and a ticket that gives up
now files a printer problem and alerts the owner instead) · an
order deleted before printing → prints nothing and is closed, not retried for ever · auto-print
switched off mid-service → the helper idles and the ticket waits, then prints when switched back on ·
a removed computer → cannot even ask.

## 2026-09-14 — ONE WAY AT A TIME: the last print boxes are gone, and every screen says whether it is working

> Owner: *"There are two modes, right? First, helper mode — the computer — and second, screen printing
> where we use Chrome kiosk. Whenever the helper mode is on and Chrome is off, it should not pop up
> the print. If the helper mode is set up and inside the helper mode KOT is set up, for the KOT there
> shouldn't be the pop up of print… in the kitchen panel or stuff like that, if the screen printing is
> off, there shouldn't be a pop up. … For the bill and banquet, if the printer is set up it should not
> pop up that print thing. If it is not set up, then it's okay — but if it is set up then it should
> not pop up. It should just notification that it is sent to the helper or computer, sent to the
> printing queue… because it is already going to the helper's queue, so we don't want to give them
> also the option to print. But if the printer is not decided, then there should be the pop up —
> otherwise there would be an error, because there wouldn't be anything to print that."*
>
> And: *"On the manager panel and on the owner panel, when the helper is on, in the settings of both
> panels you could able to see that everything is connected and everything is live. And if not
> connected, you could able to see. … They can also test from there — print a KOT, print a bill, or
> print a banquet bill."*

### What was already true, and what was not

The AUTOMATIC ticket has obeyed this since mig 341: `screenMayPrint` answers "no — a computer has it"
and the kitchen board is offered nothing. The BILL and the BANQUET sheet have asked
`POST /print/send` on every press since the same migration, and open their window only on `noRoute`.

The gap was every 🖨 **a person presses**. Three buttons called the local print straight out, whatever
the address book said:

| Where he'd see it | What happened |
|---|---|
| Kitchen panel → any ticket → the 🖨 top-right | Chrome's print box, and a second copy of the ticket out of whatever printer that screen defaults to |
| Kitchen panel → a delivery ticket → its 🖨 | the same, and a delivery ticket out of the counter's bill roll is a bag nobody packs |
| Manager → Tables → ☰ → "Print / reprint a KOT" → "Prints here, on this device" | the first and biggest button on the sheet, whatever the routes said |
| Waiter tablet → 🖨 on a KOT → "Print here" | a print box on a handheld that usually has no printer and that nobody is watching — a LOST ticket from the button meant to rescue one |

All four ask first now, through one door per panel (`print/send`, kind `kot`). `noRoute` is the word
that keeps every restaurant without a helper working exactly as before — which is the other half of
his sentence and is asserted separately.

**The escape hatch hides, it does not go** (his ruling, same day, when offered the choice): while the
computer is answering there is ONE button; the moment it stops answering — or tickets stack up behind
it — "print here instead" comes back, because that is when somebody needs paper now. The 🔔 bell has
kept "Print here instead" for exactly that case since 2026-09-03.

A delivery ticket has no `orders` row, so it travels as `payload.aggId` and is drawn by
`lib/printDocs → kotHtmlForAggregator`.

### "Is it working right now" — one answer, three screens

`lib/printHelpers → paperStatus(rid)` writes the three rows ONCE: label, a green/red dot, a one-word
state (LIVE · ASLEEP · OFF · SCREEN · WINDOW) and the whole sentence. The admin board, the manager
panel and the owner panel render what they are handed and derive nothing. Three papers × three
screens × green-or-red is nine chances to disagree about whether a restaurant is printing, and these
boards have drifted apart twice already.

**Only an unanswered COMPUTER is red.** A deliberate "Nobody" is green, and so is a bill that opens a
window — those are decisions, and colouring a decision as a fault is the don't-cry-wolf rule.

### Test prints a REAL document

`kind: "test"` proves a printer is alive. It cannot answer the question a restaurant actually has —
does the BILL fit this roll, did the banquet sheet come out A4 or A5. So Test queues a **real job of
that kind on that kind's own route**, with `payload.sample = true`, and the helper's document
endpoint draws it from the same `billdoc.js` every screen prints from.

⚠️ **It may never be mistaken for a sale**, which is `testHtml`'s own rule read from the other side: a
sale may never disappear, and a non-sale may never appear (`docs/COMPLIANCE-GUARDRAILS.md`). Three
things keep it honest — a band top and bottom, **no bill number and no invoice number**, and nothing
written anywhere but the `print_test` diary line.

### Four faults found by printing one and LOOKING at it

1. **The band landed before `<!doctype html>`.** `billDocHtml` emits the bill as a FRAGMENT — doctype,
   title, style, content, and no `<html>`/`<head>`/`<body>` anywhere. Matching `<body…>` fell through
   to `band + html`, the browser dropped into quirks mode, and the page printed as **72 bytes of
   raster** where the same bill is 24,000. Every text assertion passed: "TEST PRINT" really was in the
   file, because grep does not care where. (`withPaper` carries the same lesson from 2026-08-26 — the
   bill has no `</head>` either.)
2. **The sample bill printed ₹1,555 of dishes over a ₹0 TOTAL.** `billMoney` takes its figures from
   the ORDER ROW's columns and the synthetic order carried none. `billData`'s own comment forbids
   exactly this: rows and total may not disagree, reconcile to the rupee.
3. **The sample banquet sheet said GST 0%** for a restaurant that charges 5% — its figures are frozen
   on the bill row by design, so a sample shows nothing unless it is filled in from `bqTaxModel`.
4. **The kitchen door was born without the admin-view rule.** The manager's twin got it in August and
   the tablet's a day later; the check that enforces it was a list of two files, so a third panel
   learning to send paper joined the fault and not the guard. The list is three long now.

### Two things found on the owner's own screen

- **The old "Kitchen · KOT printing" card was still on the manager's Settings**, beside the Printing
  board — an auto-print toggle with **no permission check**, a sample print that opened Chrome's print
  dialog, and a paragraph telling the reader to use Chrome in kiosk-printing mode as if it were the
  only way. Its comment claimed it was *"hidden from everyone in this panel"*. It never was:
  `settingsSections()` hides only what `managerSettingsOff()` names, and that can only ever return
  tables · users · access. Deleted — his own words: *"there is two printing things, one is working and
  one is just showing."*
- **The owner's printing row lied on his own data.** `/api/owner/printing` answered for `ids[0]`, so an
  owner whose first restaurant does not print saw NOTHING at all; and every row that was not the
  answered one fell to a branch that states, in amber, *"no screen has taken it yet — tickets are
  waiting"*. Pizza Palace showed that while a computer was printing its slips perfectly. This is the
  third round of one restaurant's answer landing on another's row — every row now carries its own.

### How it was checked

`verify:print-helper` grew **201 → 232**, with **15 sabotage cases** run one at a time and every one
caught. `verify:printing-sweep` is 506 phases (one rewritten: a kitchen slip may go through the bill
door now, and the rule that survives is that an unknown kind and a foreign order are still refused).

End to end on a virtual thermal printer built from the real ZJ-80 driver — 38 checks, including the
three samples fetched by a real helper and pushed through a real CUPS queue: the kitchen slip arrived
as **32,951 bytes** of raster, the bill as **41,606**, and both were read on the paper.

## 2026-09-14 (later) — one lane per printer, a paper a restaurant does not have, and who may change any of it

> Owner, on a screenshot of the printer dropdown: *"Even though this time printers are connected, why
> couldn't I able to select the printer?"* · *"Whenever there are more prints in the queue it is working
> slowly — if there are three different printers connected to the PC and set up for different prints, so
> all that we have different queue. For example, you can send kitchen and print bill simultaneously in
> parallel."* · *"If we have not provided the feature of banquet, it should not even show the banquet also
> in the printing section."* · *"In the manager panel and the owner panel there shouldn't be able to change
> it — just for them to see that a computer is online, printer is online, whichever printer we have set up
> all online, you are good to go."*

### 1 · A sleeping printer could not be chosen — and that was worse than it looked

Every option in the admin console's picker carried `disabled={!a.connected}`, and **connected means
"polled in the last 30 seconds"**. Three consequences, all real:

- **One missed poll locked the screen.** Measured on his own Mac the same night: the helper went quiet
  for two minutes while its process was perfectly healthy.
- **After the shop closes, nobody could set printing up at all.** The PC is off overnight, so every
  printer is greyed — choosing which printer gets the bills would mean going to the restaurant and
  switching a computer on.
- **It contradicted the product's own rule.** `helperFor` says in as many words that routing to a
  sleeping machine is correct and the ticket WAITS.

It came from his 2026-08-29 words — *"if the PC is disconnected, both printers will be disconnected
only"* — which asked to SHOW the state and was built as BLOCKING the choice. The state is still shown
(the group says asleep, the option says asleep, and the confirmation says "it prints as soon as that
computer is back"); the choice is allowed. The manager panel never blocked it, so this also ends a
drift between the two boards.

### 2 · One lane per printer

The helper printed **strictly one job at a time**, whatever printer it was for: fetch → Chrome render
(~2-3s) → `lp` → poll the queue for up to **15 seconds** → report. A bill for a customer standing at
the counter queued behind every kitchen slip in front of it, on a different printer that was idle.

`claimSome()` hands back **at most one job per distinct printer**, so one worker per job can never
collide with another, and a round takes as long as its SLOWEST printer instead of the sum of them.
Measured: three 3-second jobs in 3.0s, starting 0.7ms apart.

- **The claim is untouched** — still one filtered UPDATE, so a ticket still comes out exactly once.
- **Per-job files are load-bearing**: two workers sharing one `job.pdf` print each other's paper, and
  two Chromes sharing one profile directory fight over its lock and one writes nothing.
- **The old single-job door still answers.** A helper is a text file somebody pasted into Notepad;
  there is no way to push a new one, so `/next` without `?max=` returns exactly what it always did.
- **Windows** re-runs the same .bat with `/lane`, dispatched before the single-instance lock. Every
  lane exit writes a finished-flag, and the parent's wait is **bounded at 90s** — a lost flag costs one
  slow round, never a helper that stops printing. ⚠️ This is the platform nothing here can execute.

### 3 · A paper the restaurant has not bought is not shown, and cannot be routed

`papersForRestaurant()` drops banquet when the module is off. Both boards already iterate `kinds`, so
the line disappears everywhere at once — and the **server refuses** a route or a sample for it, because
hiding a control has never been the gate. Only banquet is gated, and that is not an oversight: kitchen
slips and bills are core, and a restaurant that prints nothing at all is already handled by
`auto_print_kot_allowed`, which hides the whole section.

### 4 · Setting printers up is Aevidine's

Asked directly which of his two rulings won, he answered: **"That setup will be done by me only, and
maybe I was talking about the screen."** So `print_setup` is retired from the Access screen, the four
setup verbs are **deleted** from the panel route rather than gated, and `maySetup` is a constant
`false`. The manager panel's Printing section is a status screen: the three papers live, a Test print,
the computers read-only, what has printed, and the **kitchen-screen launcher** — the "screen" half he
named in the same breath, which holds no secret and moves nobody's paper. Full record:
`docs/REJECTED-IDEAS.md`.

### How it was checked

A new sweep, `npm run verify:print-scenarios` — **183 phases over 12 restaurant shapes**: menu-only ·
printing on with no computer · linked but nothing routed · one printer for everything · three printers
one per paper · asleep · removed · "Nobody" · queue stopped · banquet off *and* on · manager and owner
read-only · two restaurants at once. Ten **invariants** are asked of every shape, which is the half that
catches real faults — a rule that is right for a full restaurant and wrong for a menu-only one is
exactly the kind that ships.

`verify:print-helper` **232 → 244**. `verify:printing-sweep` 507, with its banquet grid now switching
the module ON for the grid and back afterwards — it had been routing a paper its restaurant did not
have, and the new gate caught it.

## 2026-09-14 (third round) — the PRINTER holds the queue, not the helper

> Owner, with a screenshot of the macOS Printers window showing four jobs stacked on one printer:
> *"The screenshot is not showing that it's slow — it is just for your reference that a printer can
> also have its queue. You don't have to give everything to the helper. The printer's queue will be
> faster than the helper's, so put that thing in the printer queue such that it works fast."* And:
> *"If there is a queue in KOT, is the bill still printing instantly? Make sure it is fast and it is
> not causing any kind of error in the UI. The UI of the queue will also kind of change according to
> the number of papers that have been set up for different printers."*

### Where the seven seconds went

Measured on a real helper with real CUPS queues before changing anything:

```
chrome render        1535 ms
a fixed 1s "settle"  1028 ms
lp submit             103 ms
WAIT for CUPS to say
   "it came out"     4326 ms   ← 62% of it, standing still
total per ticket     7029 ms
```

**Four of every seven seconds were the helper watching a queue CUPS was already managing.** Eight
kitchen slips took sixty-six seconds. That is his point exactly, and it is now measured rather than
argued.

### What changed

The round **renders in parallel, submits IN ORDER, and lets go.** Confirmation happens on a LATER
round (`confirm_sent`), so the 2026-08-20 rule is untouched — nothing is ever reported "printed"
until the printer itself has said so. The helper simply stopped standing still while it waited.

- **Submits are ordered and renders are not.** A kitchen expects its tickets in the order they were
  rung; the app hands the round out oldest-first and the submit loop preserves it. CUPS then keeps
  that order in its own queue, which is the whole point.
- **Two per printer per round, not one.** One was needed while parallel *workers* submitted; with a
  single ordered submit loop it is safe. The cap is now about STARVATION — eight kitchen slips must
  not fill the round and leave a bill for the customer at the counter waiting for it.
- **The one-second settle is gone**, replaced by "the PDF has stopped growing" (two identical sizes
  200 ms apart). It was a whole second of guess on every single ticket.

| | before | after |
|---|---|---|
| 8 kitchen slips + a bill | **67.0s** | **41.6s** |
| a bill sent INTO a running 10-slip backlog | — | **7.5s** |
| the printer's own share of that | | **~3.8s** |

**CUPS alone, with no helper at all, prints six of these tickets in 23 seconds — 3.8s each.** The
helper is now delivering faster than the printer can consume, which is the correct end state: the
bottleneck is the hardware, not us.

### THE WINDOWS ONE, which nothing here can run

Its own comment has said since 2026-08-20 that headless Chrome **does not exit** after
`--print-to-pdf`. And then the lane called `WaitForExit(25000)` and waited for that exit anyway — a
backstop being paid **in full, twenty-five seconds on every ticket.** On a busy Windows till that is
the whole of "the printing is slow", and it went unmeasured because Windows is the one platform
nothing on this side executes. It waits for the PDF to stop growing now, with fifteen seconds as a
ceiling rather than a price. Written for **PowerShell 5.1**, which is what Windows actually ships —
guarded, because a PS7 operator parses here and throws there.

### Two faults found while doing it

- **A vanished CUPS job was reported as a failure.** With `PreserveJobHistory` set to No a finished
  job disappears immediately and never reaches the completed list. Calling that a failure means the
  app retries a ticket that is already on paper — **every ticket, on every machine set up that way.**
  A job that has left the queue without us cancelling it now counts as printed.
- **The queue heading contradicted its own rows.** Caught by reading both boards ninety-six times
  while a backlog printed: the per-printer rows added to 14 under a heading saying 15, because a
  ticket finished between two separate counts. The total is the sum of the breakdown now — one read,
  one answer.

### The queue, per printer

Both boards break the queue down by printer, worst first, whenever more than one is involved. A
queued kitchen slip carries no printer yet (the address book is applied at claim time), so it is
resolved through the routes rather than dropped — otherwise the tickets that have waited longest
would be the ones missing from the count.

### Checked

`verify:print-helper` **244 → 253**, with **ten sabotage cases**; three were blind on first write —
two matched the *other* operating system's copy and one matched its own obituary comment, which is
the same fault three times in one day. `verify:print-scenarios` 183. A UI-load pass reads every
printing screen ~96 times while fourteen slips and a bill are in flight, and asserts no bad status,
no row without words, no red for the wrong reason, and no heading that disagrees with its own rows.

## 2026-09-14 (fourth round) — "does it get every job instantly, one by one, as fast as possible?"

> Owner: *"Make sure that whatever the printing job, the helper gets it instantly. One by one, send
> it to the printer and the printer will hold the queue to print, and that printing will happen fast
> and sending should be as fast as possible, and one by one in the queue only. Does it do all this?"*

Checked point by point, with numbers rather than opinion.

| his ask | before this round | now |
|---|---|---|
| the printer holds the queue | ✅ (earlier today) | ✅ |
| sent **one by one** to the printer | ✅ sequential `lp` / Sumatra | ✅ |
| **in order** | ✅ mac/linux; ⚠️ **Windows could invert** | ✅ all three |
| **sending as fast as possible** | ⚠️ the round held every ready page | ✅ each goes when *it* is ready |
| the helper gets it **instantly** | 1.93s average | **1.59s** — bounded by the 2s poll |

### Each page goes the moment THAT page is ready

The round rendered everything, then submitted everything. A page finished in 1.5s sat idle until its
slowest sibling caught up. Nothing was bought by it: the ORDER is kept by the submit loop being
**sequential**, not by the renders ending together. Each render now leaves a marker and the submit
loop walks the batch in order, waiting only for the page it is about to hand over.

### A Windows ordering bug this round INTRODUCED, and fixed

Raising the per-printer cap to two was safe on mac and linux, which submit from one ordered loop. On
Windows each lane is a **separate process that renders and submits its own job** — so two lanes for
one printer could reach it in either order. A kitchen's tickets are expected in the order they were
rung. Each lane is now told which job precedes it and waits for that lane's finished-flag before
handing its own page over: renders still race, the handover does not. Bounded at thirty seconds,
because a ticket slightly out of order is a far smaller fault than one that never comes out.

Also caught: a `:label` written **inside a parenthesised block**, which cmd.exe does not reliably
jump to — the same family as the `%VAR%`-inside-a-block fault this file already paid for once. Now
guarded.

### Hello was being paid on every single poll

Measured: **379 ms against the live site, 452 ms locally** — about a fifth of the delay between a
waiter sending an order and the computer hearing about it, paid **43,000 times a day per restaurant**
for an answer that almost never changes. It carries the printer list, the seen-just-now stamp, the
poll interval and the site's one way of saying "this computer is unlinked" — none of which need two
seconds. It runs every fifth poll (~10s) now, comfortably inside the thirty seconds the board treats
as connected. **Faster and cheaper at once:** tickets are noticed sooner because the poll is no
longer queued behind a hello, and traffic drops by about a third.

### What is left, and it is a deliberate cost

The remaining ~1.6s is the **2-second poll**, and that number is a decision already recorded in this
file: *"at 2s one helper is ~43,000 requests a day; twenty restaurants is ~864,000, each one a
function call and a database read"* — which is why `pollMs` exists and why it **can only ever slow
down**. Halving it to 1s would take pickup to about 0.8s and double that bill. Long-polling would cut
requests but multiply function-seconds, which is the wrong trade on serverless. It is a price
question, not a code one, so it stays where it was decided.

### Checked

`verify:print-helper` **253 → 263**, four sabotage cases on the new rules, all caught.
`verify:print-scenarios` 183/183. A backlog of 8 slips + a bill finishes in **39.4s** against a floor
of ~30s of pure printer time, with the bill out in **7.5s**.

## 2026-09-14 (fifth round) — which printers are ON, and the wall of code behind a button

> *"The code is visible all the time. Make sure there is a button to, uh, which is written show the
> code. Then only code should be shown. In both worlds, because it is annoying. First of all, there
> should be the list of computer connected or not, and when the computer is connected, in that
> computer which printers are connected. There should be that, and then there should be a code. Right
> now, which printer are connected and which are online and all offline, all that stuff is not there
> only. Make sure it should be there."*

### 1 · A printer's state was never REPORTED, so no screen could show it

Not hidden — **missing**. The helper told us a printer's NAME, its MODEL and its PAPER SIZE, and
nothing about whether the thing was switched on. The admin console said `· 6 printers` and stopped;
the manager panel listed the names joined by dots. So all three boards could say a computer was
connected while saying nothing at all about the printer the paper actually comes out of — which is
the one a cook is standing next to.

Every helper now reports one of four words per printer, and **one call answers it** on each system:

| | how it is read | ready | paused | not answering |
|---|---|---|---|---|
| mac · linux | `lpstat -l -p <queue>` — the "is idle / disabled" line **and** the Alerts line under it, in one call | neither below | `disabled` | `Alerts: …offline…` |
| windows | `Get-Printer`, which we already call — no extra call at all | neither below | `PrinterStatus = Paused` | `WorkOffline` **or** `PrinterStatus = Offline` |

`WorkOffline` is checked FIRST on Windows and that is deliberate: *Use Printer Offline* is a setting
a person can tick by accident, the printer then reports `Normal`, and every job silently queues for
ever. It is the most common "it is connected but nothing prints" on Windows.

**`unknown` is its own state and is never folded into "offline".** A helper file from before today
reports nothing, there is no way to push a new file to a restaurant's computer, and saying "offline"
about a printer we simply have not asked about would send somebody to a working printer. It reads
**Not reported**, in grey, with the reason said **once under the list** rather than on every row —
his own Windows PC has six printers, and the same twenty-word sentence six times over is the
annoyance he asked to be rid of arriving by another door.

The four words live in **one** place (`lib/printBoardWords.ts → PRINTER_STATE_WORDS`) and are *sent
to the panels* in the board payload. `public/panels/` is plain JavaScript and cannot import the
library, and a second copy of four words in `app.js` is exactly how these two screens came to be
"not identical" the first time.

### 2 · Both walls of code are behind a button

Two screens were pouring script down the page on every visit:

- the **admin console's** two file cards (helper file · print-station file) — one component,
  `FileCard`, so both got the button at once;
- the **manager panel's** print-station file — **6,760 characters, 330 pixels tall**, above the
  instructions for using it, on a screen a *manager* opens. This was the one that mattered, and it
  was only found by looking at the rendered page.

**Copy still works while the code is shut**, and that is the point rather than a nicety: nobody reads
the file, they paste it. Making somebody reveal 250 lines in order to copy them is the same
annoyance wearing a button.

### 3 · Nothing is "LIVE" while nothing can print — found by the new sweep

`printingOn()` lived privately inside `app/api/print-agent`, where only the helper's own door could
read it. And it gates the **whole** poll: while printing is switched off or the queue is stopped,
`/next` answers 204 for **every** kind — bills and banquet sheets included, whatever the
`auto_print_kot` column is called.

So all three boards showed **three green LIVE rows and three working-looking Test buttons** on a
restaurant where no paper could come out, and pressing Test answered *"Sample sent — paper should
appear in a moment"* about a page nothing would ever fetch.

- it is now `lib/printHelpers → printingRunning()`, one copy, read by the door **and** the rows
  (the route's private copy was deleted, not left beside it);
- the rows have their own word, **STOPPED**, and it outranks every other state;
- the two reasons are kept apart, because the fix differs — *switched off* means the tickets are
  never made; *stopped* means they are made, waiting, and all come out when it restarts;
- and all three Test verbs (admin · manager · owner) **refuse** with that reason. Hiding the button
  has never been the gate in this product.

### 4 · A poll is a sign of life

`last_seen_at` was written by `hello` and nothing else — safe only while hello was asked on every
poll, which stopped being true when it moved to every fifth round. A round does not return until the
backlog is empty, so a helper printing a rush stayed inside one round for the best part of a minute,
past the 30-second window everything uses to decide "connected". **The machine printing hardest was
the one reported as asleep**, with its Test buttons greyed out to match.

Any authenticated ask from a helper now counts, written at most once every ten seconds
(`SEEN_REFRESH_MS`) — so a helper polling every two seconds pays one small indexed update per five
polls, not one per poll, and a helper that has stopped still turns cold after 30s.

### 5 · `verify:print-speed` — 519 phases, and what they measured

A new sweep, about the speed rework only and nothing else, because `verify:printing-sweep` predates
it and every one of its 507 phases passes whether the helper takes 1.6 seconds or 7. Numbers from a
full run on this Mac, through three virtual thermal printers with the real ZJ-80 driver:

| | |
|---|---|
| job created → the helper is handed it | **~400 ms** (median; 373–665 ms over 20 runs) |
| an idle poll (the answer is 204) | **~175 ms** median |
| the bare CUPS floor, no helper at all | **5,493 ms** per page |
| one ticket, to PAPER | **7,473–9,114 ms** — i.e. the floor plus a poll and a render |
| one ticket, to the app AGREEING | ~9,900 ms — slower **on purpose** (nothing is called printed until the printer says so) |
| 8 slips + a bill, start to finish | **36.3 s** |
| a bill dropped into a running 10-slip backlog | **~10.7 s** |
| 26 tickets, amortised | **3,585 ms** each |

Two faults it drilled rather than asserted: a finished CUPS job that `PreserveJobHistory No` has
already forgotten being read as "failed" (which printed **every ticket twice**), and the asleep-while-
printing fault above.

⚠️ **Its paper chapters are OPT-IN** (`--live-helper`), and that is not tidiness. They run the real
shipped helper with a throwaway `HOME` so it cannot touch a real token or a real launchd job — and
headless Chrome then looked for the login keychain inside that throwaway folder, found none, and put
**"Keychain Not Found — A keychain cannot be found to store Chrome"** in front of the owner, once per
page it rendered, twice. Proven afterwards with `security default-keychain`: under a bare throwaway
HOME macOS itself answers *"A default keychain could not be found"*. The run now links the real
keychain into that HOME, and the shipped helper passes `--use-mock-keychain --password-store=basic`
as a precaution — a PDF render has no business in the system password store, and this file is started
by a login item, so it can be running while the keychain is locked.

### 6 · A test may never leave its orders on somebody's kitchen board

The same session found that every printing sweep has been leaving its test orders behind **for
weeks**. The teardown called `DELETE` on its own `orders` rows, wrapped in a bare `catch {}`; mig
331's CHECK refuses a hard delete (*"an issued bill cannot be hard-deleted"* — a sale may never
disappear) and the empty catch swallowed the 400 every single run.

It surfaced as the owner's kitchen panel grinding on **3,893 test orders** — 1,284 from that day's
run and 1,456 from earlier ones. Both sweeps now **soft-delete and archive** (`deleted_at` +
`archived`, which is what `lib/liveBoard.ts` filters on, so the row survives and every board is
clear), and they **count what is left afterwards and say so**. `verify:print-helper` fails if either
one grows a hard `DELETE` back.

## 2026-09-16 — three faults behind one question: "are these findings right?"

He pasted two findings from a sweep terminal (items 4 and 5 — the printing board saying "saved" for
writes that saved nothing, and the stop-queue button able to wipe a restaurant's whole setup) and
asked whether they were real. Both were. **Both are also still unmerged**, on
`origin/sweep9/t26-admin-api-part-a`, ten commits ahead of main with no open PR.

Checking them turned up three more, all in this file's own area.

### 1 · `writeRoutes` could lose the address book TWO ways, not one

The item-5 fix names a sibling it could not reach: *"the sibling read-modify-write in
lib/printHelpers → writeRoutes has the same shape… it is reported rather than changed here because
that file is not this terminal's to edit."* It was right, and it was worse than the one it fixed:

```
const current = await readRoutes(rid);        // ← unchecked. Blip = EMPTY routes…
…                                             //   …and the patch is merged ONTO current,
const s = (await sb…select("modules")…).data  // ← unchecked. Blip = EMPTY bag…
await sb…update({ modules: bag })             //   …and the bag is written WHOLE.
```

So one transient read failure while somebody pointed the **bill** line at a printer would silently
un-route the **kitchen slips and the banquet sheet**; a failure on the second read would additionally
erase **every other module's allowed/enabled state**. The function whose entire job is not to lose
the address book could lose it twice over, and its own comment already named the damage
(*"overwriting `modules` wholesale would silently switch other features off"*) without checking for
it.

Both reads are checked now, and `readRoutes` gained a sibling — `readRoutesChecked` — so a caller
that must not guess can tell a failed read from a restaurant that has simply set no printer up.
`readRoutes` itself still returns a plain `PrintRoutes`, because a throw on the helper's poll path
would leave a ticket in a worse state than empty routes would.

**Verified:** pointing one paper line at a printer leaves the other two intact and the module bag
byte-identical — driven through the real API, before and after.

### 2 · "Nobody prints the kitchen slips" stopped the BILLS

`auto_print_kot` is the kitchen-slip **line**, stored twice (`syncKotSwitch` keeps the line and the
column in step — *"one decision, two places"*). The helper's door treated it as a **master switch**:

```
if (!(await printingOn(rid))) return 204;     // for EVERY kind
```

So a restaurant set up exactly the way the owner described it — *slips on the kitchen screen, bills
on a computer* — was handed **nothing at all**, and its bills never printed. The bill route sat there
naming a live computer and a real printer.

Measured on 2026-09-16, before: slips → Nobody, bills → a computer, a bill queued, `/next` answered
**204**. After: **`GOT: bill on Counter`**, while a kitchen-slip sample is still refused in plain
words. Only a **stopped queue** is a master stop now; the slip switch suppresses slips alone, inside
`claimSome`, which is safe twice over — mig 335's trigger already refuses to queue a slip while that
column is false, and the claim only ever hands over a kind whose route names the asking machine.

### 3 · …and it had been invisible, which is why it lasted

Before the **STOPPED** rows landed two days earlier, that restaurant's board said the bill line was
**LIVE**, and its Test button answered *"Sample sent — paper should appear in a moment"* about paper
that could not come out. The state that made it visible is what made it findable.

Two corrections to STOPPED itself, both from guards that were already right:

- **never red.** `ok: false` broke a standing rule this file's own type states — *"a deliberate
  'Nobody' is not red… colouring a decision as a fault is crying wolf."* Switching something off is a
  decision. Red stays for the one involuntary failure: a computer that owns paper and is not
  answering.
- **only where it changes the answer.** If no paper is routed at a computer at all, the per-paper
  answers are already true *and* more specific. Saying "printing is switched off for this restaurant"
  told a menu-only restaurant its printing was off when it had simply never set a printer up.

### 4 · The suite was degrading the database it tested against

`verify:print-speed` rang up a brand-new **order** for every ticket it needed — about **1,300 per
run** — because `newKot` goes through mig 335's trigger, which is the honest path for measuring a
handover. But most of §3 is about which tickets the **claim** hands over, not about the trigger.

Orders **cannot be hard-deleted** (mig 331; verified again here — even a never-billed, archived test
order is refused: *"permanent erase only via the 90-day restaurant purge"*). So the table only grows.
At **19,759 rows** the inserts began hitting Postgres's own `57014` statement timeout, and fifteen
phases reported *"the ticket was never handed over"* — blaming the printing feature for the harness
being unable to ring up an order.

- the claim-only phases (the ordering grid, twelve starvation depths, the rush drain, the races, the
  board-under-load reads) now hang their tickets off **one pooled order**: ~1,300 → **~90** per run;
- and a `57014` **skips with the real reason** instead of going red, so the answer reads "purge the
  test restaurant", not "printing is broken".

⚠️ **Still open:** that restaurant needs purging before the trigger-path phases are reliable again.
Nothing in the app can do it — by design, a sale may never disappear.

### 5 · Two guards of mine that were wrong, caught by sabotage

- one **matched its own obituary comment** (`"Kitchen · KOT printing"` appears in the note recording
  that the card was deleted), so it went red the moment the deletion was documented properly. Third
  time this family has done that; it reads `code()` now.
- one was **pinned to the old code's shape**: it forbade the exact line that made the slip switch a
  master switch, so putting the master switch back in a *different* shape sailed through all 302
  checks. It now asserts the rule — there is exactly **one** way to turn all paper off, and it is the
  stopped queue.
