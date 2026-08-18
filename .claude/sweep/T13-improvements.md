# T13 improvements — the owner's Menu editor, Team and Settings

**FIVE things are built.** Two fell out of a fix during the sweep (G1, G2); three more were built on
**2026-08-18 after the owner read the list and picked them himself** (Y3, Y4, Y5). Two remain unbuilt
(Y1, Y2) — he did not pick them, so they stay parked. He also **vetoed problem 3**; see the findings
file and `docs/REJECTED-IDEAS.md` R31.

---

## 🟢 Built

### G1 · The Menu page now costs one database read instead of two
**Phase:** P06223. Rode along with problem 5's fix (same commit — separating them would have meant
reading the same table twice on purpose).
`entitledSubset` read the `restaurants` table for `owner_entitlements`, then the page read the same
table again for the names. Asking for `id, name, owner_entitlements` in one go answers both
questions in one trip. Nothing visible changes; the page opens on one round trip to Mumbai instead
of two, which is exactly the discipline `docs/SAAS-EFFICIENCY-PLAYBOOK.md` asks for.

### G2 · `verify:staff-accounts` can be run from a worktree, and no longer deletes other people's rows
**Phase:** P06276. Its own commit.
Two problems in the test tooling, not the product:
* Its base URL was hard-coded to `http://localhost:4000` — the owner's own window. A sweep lane is
  given its own port precisely so it never points anything there, so the guard could not be run from
  a worktree at all (and simply failed with connection errors whenever :4000 was not up). It now
  takes `--base` / `LFH_BASE`, defaulting to the old value, so an ordinary run is unchanged.
* Its pre-clean deleted every account matching `/^zztest/i` — "delete whatever is there". With
  several sweep lanes sharing one dev database that is the filter the project's own test-safety rule
  forbids: it can remove another run's in-flight fixtures, which then looks like a product fault to
  whoever owns them. It is now scoped to the fourteen names the script itself uses, which is all its
  stated purpose (repeatability after a crash) ever needed.

Result: 40/40 against port 4113, cleaning up its own rows and its own rate-limit rows.

---

## ✅ His ruling, 2026-08-18

He read the list and answered. **Y3, Y4 and Y5 were approved and are BUILT** — see the section below
each one. **Y1 and Y2 he did not pick, so they are not built.** He also **vetoed problem 3** in the
findings file (recorded as R31 in `docs/REJECTED-IDEAS.md`).

## 🟢 Built on his instruction (2026-08-18)

### Y3 · Find someone on the Team roster — BUILT
*"can do this"*. A search box at the end of the tab strip that filters every restaurant card at once,
matching name, login, phone and role — including the word the row actually SHOWS, so "waiter" finds
a tablet login. Filters the list already on screen; fetches nothing. Add form stays usable, the card
header says "1 of 8 shown", and no match says so instead of "No staff yet". Guard §9.

### Y4 · Working people first, disabled under their own heading — BUILT
*"can do this too"*. A disabled login used to sit wherever creation order put it. Now: the people on
shift, then "Disabled · N — cannot sign in", same card, still one tap from Enable. Both groups render
through ONE row function — two copies of a hundred-line row is how twin surfaces drift. Guard §9.

### Y5 · The banner is headed by the reason — BUILT
*"can do this too"*. "Someone got there first." for a clash (amber, not danger red), "That didn't go
through." for a refusal, "Something went wrong." only for a real failure. The kind is attached where
the error is thrown, and every message goes through one door so the heading can never disagree with
the text under it. Guard §9.

## 🟡 Not picked — left alone

### Y1 · Nothing explains why a kitchen row looks emptier than the others
**Phase:** P06482. Owner panel → Team → any kitchen row.
Kitchen logins have no profile, no completeness bar and no pay chip. That is his ruling, made three
times, and it is right. But on screen it just looks like a row with things missing rather than a row
that is complete as designed. A single quiet line ("kitchen logins don't have a profile") would say
so. **Not built** because adding words about a decision he already made is a product call, and he
has refused adjacent additions to the kitchen panel three times — I am not going to guess a fourth.

### Y2 · The roster's action buttons are 26px tall on a phone
**Phase:** P06386. Owner panel → Team → any row, on a phone.
Measured 26–28px. They are tappable and each is full-width, but that is below every other tap target
in the same file (table tiles 36px, tabs 40px) and one of them is "Remove", which cannot be undone.
**Not built** because raising them makes every row taller and the roster longer to scroll, which is a
real trade-off on the screen he actually uses, and the phone layout here was already tuned once in
the 2026-07-07 audit.

*(Y3, Y4 and Y5 used to be listed here. He approved all three on 2026-08-18 — they are
BUILT, in the section above.)*
