# Sweep 7 — T3 findings (guest basket · table session · placing an order)

**Branch** `sweep7/t3-basket-and-order` · run 2026-08-22/23 against `origin/main` **b64951ad** ·
port **4203** (proved mine). Ledger: `.claude/sweep/LEDGER/T3.md`, now **1002 rows**.

**Improvement ideas are NOT in this file.** The owner's instruction for sweep 7 is that they go in
the terminal window, and they did.

---

## First, the thing this run was mainly for: the 500 existing rows

**All 500 re-run. Zero regressions.** `npm run sweep:t3` green in ONE sitting — all five blocks —
which sweep 6's own pass 5 could not achieve (its block 5 only passed alone). Blocks 3a/3b/5 printed
52 + 31 + 25 rows ok; `verify:guest-doors` and the six named gates all green; typecheck clean; all
eight block-4 captures opened and read.

**Two rows had their EXPECTATION corrected — they were wrong when written, not broken now. Both
keep their ids:**

- **P01422** said the basket pill "is a phone-only bar and does not appear at desktop width —
  CSS-hidden, as designed". The stylesheet does not do that. `.mini-cart` is `display:flex;
  position:fixed; left:50%` at every width, and its only media query (`max-width:700px`) turns it
  into a full-width bar; its own comment says *"a compact centred pill on desktop, a full-width bar
  on phones"*. Measured at 1280 wide: x=512, width=257, centred on 640. Sweep 6 judged it from a
  capture with the bill OPEN — and the pill hides while the bill is open, which is a **different
  rule**. Both halves are now asserted live (P16458, P16458b).
- **P01423** said the pill "does not cover a dish's +". A fixed bottom bar does overlap some, mid-
  scroll, and that is normal. What matters is the END of the list, where nudging is impossible — and
  there the last row is cleared by a documented 96px reservation. See the withdrawn finding below.

---

## Six real problems, all fixed in this branch

Guard for items 2–6: **`npm run verify:guest-doors`** — 26 new checks in five sections, each naming
its item number. **Proved it can fail: with the five component files replaced by `origin/main`'s
copies, 25 of the 26 go red.**

### ITEM 1 · The T3 runners were pinned to another session's port and another session's folder — MEDIUM · confirmed
- **Where:** backend only, nothing on screen — but it is the thing that decides whether re-running
  this territory's 500 checks means anything.
- **What:** all four runners hard-coded `http://localhost:4103`, sweep 6's port. A later terminal is
  given a different one, so a re-run either measured NOTHING or — far worse — measured whatever
  OTHER live session happened to be serving there and reported its state as this branch's.
  CLAUDE.md's own rule is *"verify on a port you PROVED is yours"*. The screenshots were written to
  an absolute path inside ONE dead Claude session's scratch directory.
- **Fix:** `T3_BASE` and `T3_SHOTS`, with the old values as defaults so nothing that worked stops.
  Shots now land in `.claude/sweep/shots/T3/`, where the sweep rules say they go.

### ITEM 2 · A request for water waiting on the phone read as "0 items" — MEDIUM · watched
- **Where:** guest menu → the bell ("Need something?") with no signal → the "saved on this phone"
  chip in the bottom-left corner → tap it. The row said, in these words: **`0 items` /
  `Waiting to send · a moment ago`**, under a chip reading **"1 order waiting to send"**. The diner
  had not ordered anything. They had asked for water.
- **Who is worse off:** any diner who taps the bell in a dead spot — the corner of a restaurant with
  no bars is exactly where you press a bell rather than wait.
- **Why:** the queue has held two kinds of thing since 2026-08-06 (`GuestOrder.kind` is `"order"`
  or `"call"`) and this list was only ever written for the first. A call carries no items and no
  track summary, so every line fell through to the item count and printed the count of an empty
  basket. `reason` — the exact label they tapped, "Water", "Bring the bill" — was never rendered.
- **Fix:** the row names what was asked for and says "Staff will be called"; the chip counts
  "requests for staff". **Item 2b:** a MIXED queue drops the noun entirely ("2 waiting to send"),
  matching the connection badge at the top of the same screen, because "2 orders" would be untrue
  about one of them.
- **Watched:** before → `CHIP: 1 order waiting to send / ROW: 0 items`. After → `CHIP: 1 request for
  staff waiting to send / ROW: Water / Staff will be called`. Captures kept.

### ITEM 3 · The table gate could never let go of a restaurant's own rules — MEDIUM · code-read
- **Where:** guest menu → "+" on a dish at a restaurant with table sessions on → the "Which table
  are you at?" popup. It decides the table-number range that popup accepts, whether a location check
  is needed, and how far from the restaurant still counts as being there.
- **What:** the gate kept a private map of settings per restaurant and READ it in preference to
  asking, so the FIRST time a guest opened the popup fixed those three answers for the whole life of
  the page. A restaurant that added tables mid-service kept refusing the new ones: at 40 tables, a
  diner at table 35 was still told *"This place has tables 1–30"*.
- **Why it was missed:** sweep 6 keyed that map by restaurant, which fixed a *different* fault.
  Nothing gave it a way to be DROPPED — and a cache in front of a breadcrumb is the known way these
  updates die in this codebase; it is written up on `invalidateSettings()` itself.
- **Fix:** always ask `getSettings()` (which dedups, holds a short TTL, and IS dropped by a realtime
  breadcrumb). The map stays as a **fallback only**, so a blip no longer dead-ends a diner on "check
  your internet" — better in both directions.

### ITEM 4 · "You left the table" was said whether or not the restaurant heard it — MEDIUM · code-read
- **Where:** guest menu → the floating table card ("Hosting Table 12") → "Leave" → "Yes, leave",
  and "Change table" beside it.
- **Who is worse off:** a diner on a bad connection, and the restaurant. If they were the HEAD, the
  table still had a head who had walked off, and anyone waiting to be let in never would be.
  "Change table" was worse: it cleared the phone and navigated away, so they went to sit elsewhere
  believing the old table was released.
- **Why:** both handlers threw the answer away, and `leaveSession()` never throws — a timeout comes
  back as `{ ok:false, reason:"timed_out" }`. Same shape as the false "we've let the staff know"
  that FIX-2 of sweep 6 fixed in this same territory.
- **Fix:** read the answer. The local clean-up still happens either way, deliberately — refusing to
  let someone go because the network is down would TRAP them. "Change table" now stops before
  navigating, so the sentence is not wiped by the page load. `ok === true` cannot cry wolf here:
  `lfh_leave_session` (mig 146) has **no refusing branch at all**, so anything else is transport.

### ITEM 5 · The host's "Let them in" could fail and say nothing at all — MEDIUM · code-read
- **Where:** guest menu → the popup on the HOST's phone when someone asks to join ("Mia wants to
  join") → "Let them in", "Not them", and the link "Let anyone join automatically".
- **Who is worse off:** the host, and the friend physically standing at the table. The popup simply
  stayed with the same person first in the queue; the host tapped again, and again, and nothing ever
  said why.
- **Fix:** read the answer and say so. The popup STAYING is correct — the person really is still
  waiting — so only the sentence was missing. "Let anyone join automatically" does two things, so a
  PARTIAL result now says which half worked. The one genuine refusal (`not_owner`, mig 015: this
  device is no longer the head) gets its own sentence instead of a useless "try again in a moment".

### ITEM 6 · The Live-status tab shimmered for ever when the first read never landed — MEDIUM · watched
- **Where:** guest menu → the bill → the "Live status" tab (the shared table bill, "Your table").
  With no signal, three pulsing grey bars and nothing else, for as long as the tab stayed open.
  Measured: the whole tab's text was the two words **"YOUR TABLE"**.
- **Why:** `loaded` only flips true on a SUCCESSFUL read, and a transient failure deliberately
  returns early without touching it — that early return is what keeps an already-drawn bill on
  screen through a blip, and it is right. Nobody joined the two facts up: if the FIRST read fails
  there is no bill to protect and the skeleton has nothing to become.
- **Fix:** an honest sentence — *"We can't reach the restaurant's system right now… Nothing is lost
  — it appears here as soon as the connection is back"* — with a "Try again". Once anything HAS
  loaded, the old behaviour is untouched. The green pulsing dot also goes grey while that message is
  up, because a live dot beside "we can't reach the system" claims the opposite.
- **Watched both ways:** before → `SKELETON still shimmering: 1`, text "YOUR TABLE", no Try again.
  After → `0`, the sentence, Try again visible. Captures kept, both skins.

---

## Candidates I measured and WITHDREW — do not re-file these

These are in the ledger as `🔎` rows (P16490, P16571–P16584) so the next sweep does not spend the
same hours. Three of them are cases where **my own measurement, not the product, was the wrong
thing** — which is the same lesson sweep 6 recorded and worth recording again.

1. **"The basket bar covers a dish's + at the end of the menu" (P16490).** Measured three ways.
   (a) Right after adding, one "+" at y=727 resolved to `.mini-cart` — real, but mid-scroll.
   (b) Walking all 69 add-buttons: covered at 445 positions, **0 permanently unreachable**.
   (c) At the list's TRUE end the last "+" is at y=592 with the pill at 710–762 — clear, because of
   a documented 96px reservation whose comment names this exact failure from 2026-08-04. My first
   "broken" reading came from a probe that set `scrollTop` to an end captured BEFORE lazy content
   grew the list. **Not a fault.**
2. **"A failed shared-basket sync is never retried" (P16572).** True, and deliberate: migration 144
   **SUMS** quantities for an added line, so a blind retry after a merge that succeeded but whose
   reply was lost would order two of everything. Raised as an improvement instead, with the cost
   stated.
3. **"`getMenuItem` uses `select(*)`" (P16346).** Deliberate: `mapRow`'s `has(row, "col")`
   mechanism exists precisely to tell "column not selected" from "selected but null", and the
   narrowing was applied to the CARD payload on purpose — its own comment says *"this must shrink
   the CARD payload only"*. Narrowing it would silently drop keys the dish page reads.
4. **"The live order path ignores a clash message" (P16571).** Correct as written: only a REPLAY
   carries the markers a clash is judged on, so a live order can never receive one.
5. **`ActiveOrder.itemCount` is inconsistent after "Order the rest" (P16573).** True, and **dead
   data** — nothing renders that field for an active order.
6. Plus nine more standing pre-empts (P16574–P16584): the 4-second approve poll, the keystroke-by-
   keystroke remembered table, fire-and-forget `setMemberName` and the heartbeat, the dev-only
   offline-reload chip, the unscoped device preferences, the deliberate absence of a cancel button
   on a waiting order, the tax-free mini-cart, and Aangan's differences.

---

## 🔗 Two handoffs — files outside this territory

1. **`components/OfflineNotice.tsx` (T4 — the offline layer).** The red strip along the bottom says
   *"Your **order** is saved and will send by itself"* whatever the phone is holding. After item 2
   the panel directly above it says "Water / Staff will be called", so the two now disagree on the
   same screen. One sentence; I have not touched another terminal's file on the last leg of my run.
2. **`.claude/sweep/LEDGER/INDEX.md` (T40 — the ledger and the scaffolding).** Its registry said
   "next free ID `P15101`", which `npm run verify:ledger-index` correctly fails against any sweep-7
   ledger. I moved that one line to `P35101` — past sweep 7's whole `P15601`–`P35100` allocation —
   because the guard's own message says to, and left a note saying T40 owns the file and should
   overwrite the block with its rebuild. Any other terminal needing the same line should write
   exactly this value, so the conflict is trivial. Also corrected T3's own row (500 → 1002 rows).
