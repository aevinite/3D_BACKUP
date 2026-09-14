# THE REPORT FORMAT — the only shape a sweep-#9 terminal reports in

**Owner, 2026-08-13, STANDING, re-stated for every sweep since.** He was once given the same
information twice: as a wall of prose, and as this. His reply to the second was *"i loved this
format whenever i asked for improvement or problem make sure this format should be there idc where
you write this rule"*. It is not a style preference. It is the shape that lets him actually decide,
and it is required **whether he asks for it or not**.

**Print this in your CHAT WINDOW. Never write it to a file.** Not an improvements file, not your
findings file, not your ledger, not the PR body. He reads the terminal windows — that is the whole
point of this run. Sweep #6 wrote ~178 ideas into files and he never saw one of them.

---

## What is different in sweep #9

- **PART 2 IS EMPTY, AND THAT IS CORRECT.** His instruction for this run: *"They will do the fixes.
  They will not do the improvements. They will list that improvements."* You fixed problems; you
  built no improvements. Part 2 gets one line saying exactly that, and every idea you had lives in
  Part 4 instead.
- **The counters at the top say 50, not 500** — 50 new checks each, on top of re-running the
  existing ledger rows that cover your files.
- **NO QUOTA.** If your territory produced two items, print two. If it produced none, print none
  and say *"this part is clean"* with the row counts that prove it. Padding a report to look busy
  costs more than a clean one.

---

## The six lines. Every single item carries them, in this order.

| line | what goes in it |
|---|---|
| **Where** | **panel → exact screen or tab → what he would SEE.** Never a file name in this line. If it has no screen, write **"Backend only, nothing on screen"** in exactly those words. |
| **What it is** | Plain words. No jargon in the first sentence — no "refactor", "idempotent", "regex", "race", "hydration". A file path may come at the END, after he already knows what you mean. |
| **If yes** | What actually changes for him. |
| **If no** | What he lives with. Say **"nothing breaks"** when that is true — it usually is, and hiding it is how a tidy-up gets mistaken for a fire. |
| **Effort** | Real minutes or hours. For something you already did: "already done — 20 min". |
| **Risk** | none / low / high — **and what the risk actually is**, in plain words. |

And around the items:

- **Number every item, continuously, across all four parts** — 1, 2, 3 … right through to the end.
  He replies "do 4 and 9", not sentences. Two items must never share a number.
- **Group the ones he must choose about**: 🟢 *I can do these right now* · 🟡 *These need something
  from you first*.
- **End with your own recommendation and the reason.** "If you only want the useful ones: 4, 9 and
  12, because…". He asked for judgment, not a menu.
- **Never** a bare list of titles. **Never** a wall of prose. **Never** bury a choice in a paragraph.

---

## The four parts, in this order

Print a **running version every ~25 checks** so he can read you without waiting for the end, and a
**final version** when you finish.

```
════════════ TERMINAL <N> of 40 — <territory in four words> ════════════
Ledger rows re-run: <x> of <y>   ·   REGRESSIONS found: <n>
New checks written: <x> of 50    ·   problems found: <n>   ·   fixed: <n>
Improvements spotted (NOT built, by your instruction): <n>  → all in Part 4
──────────────────────────────────────────────────────────────────────────


🔧 PART 1 — PROBLEMS I FOUND AND FIXED
   Each one is its own commit with its number in the message, so you can kill any single
   one without touching the rest. Regressions come first.

### 1. <plain-words title — what was wrong, not what you changed>
- Where: <panel> → <exact screen or tab> → <what you would SEE>
- What it is: <plain words. What went wrong for a real person.>
- If yes (keep the fix): <what changes for you>
- If no (I drop that one commit): <what you go back to>
- Effort: already done — <time>. Risk: <none / low / high — and what it is>

### 2. …

   If you found nothing: say "This part is clean — <x> ledger rows re-run, 50 new checks, no
   problems." and move on. That is a complete result, not a failure.


✅ PART 2 — IMPROVEMENTS I ALREADY MADE
   NONE — you told me this run fixes problems and only LISTS improvements. Every idea I had
   is in Part 4 below, waiting on your number.


💡 PART 3 — THE OLDER SWEEPS' IDEAS FOR MY AREA, CHECKED AGAINST THE CODE AS IT IS TODAY
   You never saw most of these — they went into files nobody read to you. One line each.

   • <the old idea, one plain line>   →  ALREADY BUILT — <what does it now, and where you saw it>
   • <the old idea>                   →  NO LONGER RELEVANT — <what changed>
   • <the old idea>                   →  STILL OPEN — carried down to Part 4 as item #<n>

   Every STILL OPEN one gets a full numbered entry in Part 4. Do not leave it as a one-liner.


🤔 PART 4 — THINGS THAT NEED YOUR DECISION
   Nothing here is done. Nothing here gets built unless you say a number. This is where every
   improvement lives this run, plus anything I found and chose NOT to fix.

🟢 I CAN DO THESE RIGHT NOW

### 4. <plain-words title>
- Where: …
- What it is: …
- If yes: …
- If no: nothing breaks — <what you live with>
- Effort: <real minutes/hours>. Risk: <none/low/high — and what it is>

🟡 THESE NEED SOMETHING FROM YOU FIRST

### 9. <plain-words title>
- Where: …
- What it is: …
- What I need from you: <the one decision, the one number, the one yes/no>
- If yes: …
- If no: …
- Effort: …. Risk: ….


⭐ MY RECOMMENDATION
   If you only want the ones worth having: <numbers>, because <one honest sentence>.
   The ones I would skip: <numbers>, because <one honest sentence>.
════════════════════════════════════════════════════════════════════════════
```

---

## The rules underneath the format, which cost real time when broken

- **"Where" is the line he loses patience over.** He has said plainly that a list naming files
  instead of screens leaves him *"completely lost"*. Panel first, then the exact screen or tab, then
  what he'd see with his own eyes. A migration file is named as **a migration file**, never as
  "history" or "the log".
- **"If no: nothing breaks" is usually the truth — say it.** Every item that reads like a fire when
  it is a tidy-up burns his attention and makes the next real fire look the same.
- **Effort is minutes and hours, not "small / medium / large".**
- **A found-and-fixed problem still gets the six lines**, because he can still veto it. That is what
  one-commit-per-item is for.
- **A regression is labelled a regression, in those words**, with the ledger id that was green
  before: "row P67231 was ✅ on 2026-09-12 and is ❌ today".
- **Plain language is not optional and not simplification.** Give the real developer word when you
  need it, then say the same thing in plain words underneath — he is learning the vocabulary, not
  being protected from it.
