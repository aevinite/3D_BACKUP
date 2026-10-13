# Sweep #10 · Terminal 4 — findings (the table session — a table shows only its own party)

Ledger: `LEDGER/T4-S10.md` (574 new rows, all ✅ after the fixes) · re-run stamps `re-run 2026-10-12 (sweep #10, T4)` on 2,000
earlier rows (1,997 ✅ · 3 ⏭ · **0 regressions**). Problems found: **8**, all fixed, one commit each, each with a guard that was broken
on purpose once and seen red.

| item | screen | what was wrong | guard |
|---|---|---|---|
| 1 | Guest menu → table sheet (open a table / ask to join / re-check your table / first rules read) | a busy restaurant system was blamed on the diner's wifi ("check your internet") on five sentences; only afterLocation split timeout from no-signal. Old rows P57877 / P58284 were too broad (old miss). | verify:session-gate §H |
| 2 | Guest menu → table card, host's "let them in" prompt, shared basket, Live status bill | one failed "are sessions on here?" read at menu open switched all four off for the visit (catch → off, never asked again) | verify:session-gate §I (runs the real reader) |
| 3 | Manager floor / waiter tablet / admin Repair → Close table | a failed ownership read answered 404 "That table isn't for this restaurant." (not kept, wrong words) instead of busy | verify:table-ownership §E (runs closeSession) |
| 4 | Guest menu → ban wall → Request unblock | every failure said "couldn't match that number" — a timeout or no signal too | verify:guest-doors §11 |
| 5 | Waiter tablet (a sectioned waiter) | a failed floor-size read looked like table_count 0, so every table counted as "off-plan, visible to everyone"; now unknown → own section only, and an outside write is answered busy. Creating a waiter in the same blip said "pick at least one table". | verify:tablet-twins §20 |
| 6 | Any staff panel → raise an issue → photo / voice note | a storage failure showed the storage service's raw words ("Bucket not found", RLS text) as a 400 | verify:panel-api |
| 7 | Waiter tablet / manager → Mark paid (and 15 other actions) on a merged child table | a failed merge read answered "not merged" → Mark paid could settle the child's half of the joint bill (the 2026-08-03 incident) | verify:merge (runs the helper + the real tablet Mark paid) |
| 8 | Login doors (/login, /staff-login) | lib/botCheck.ts + REQUESTS.md said Turnstile switches on "with no code change"; no form renders the widget, so setting the keys would refuse every sign-in. Documentation corrected; building the widget is the owner's decision. | verify:panel-api |

### 2026-10-13 — owner: "make sure this never happens … don't do the eleventh one right now … do all the rest"

- **Item 1, made product-wide.** A sentence may tell a person to check their internet / connection / wifi ONLY behind proof the
  device is offline (`navigator.onLine === false`, or the browser's own "Failed to fetch" family) — `lib/session.ts` →
  `isPhoneOffline`. The table sheet and ban wall now give three answers: the restaurant's system is busy ("this one's on us") ·
  your phone seems to be offline · "we couldn't reach the restaurant's system just now" (blames nobody). Three staff sentences
  that blamed the connection on any failure were fixed too: Owner → Settings → test print, and the staff-login "blocked" screen
  (Retry and Request unblock); the Windows print helper's bad-download line no longer says "check the internet".
  Guard: `verify:guest-doors` §12 scans app/, components/, lib/, public/panels and public/*.html — any such sentence without that
  proof within the lines before it fails. Live: P173596–P173598.
- **Item 9 done** — opening a table reads and returns 14 named columns, never `*` (`lib/openSession.ts` → `OPENED_SESSION_COLS`;
  checked against the dev database). Guard: `verify:table-ownership` A2.
- **Item 10 done** — in a private window the review toast no longer says "saved as your name": `setGuestName` reads the name back
  after writing it and answers false when the phone kept nothing (the past-review rename is still sent). Guard: `verify:guest-doors`; live on the real dish page: P173599–P173600.
- **Item 11 PARKED by the owner, 2026-10-13 — "we will do it later":** the Turnstile widget on the login forms. Until it is built,
  the Turnstile keys must stay unset (setting them would refuse every sign-in — item 8).

## Looked like faults, are not (recorded so nobody files them)

- **Every test restaurant has table sessions OFF on the dev database today** (French House, Spice Route, Green Bowl, Sakura Sushi).
  The session screens were reached by holding the database's answers in the browser — the built app is real, no row written.
- **French House has 30 tables** (lfh_guest_settings and its settings row agree); a first read that showed 13 was mine, wrong row.
- **A not-found menu page answered 500 once** — the shared dev database timed out on the slug lookup and the page said so honestly;
  repeated, it is 404. `verify:offline` failed 1–4 of 58 across three runs for the same reason ("signal timed out" in its own setup).
- **The table card floats over the category row** — draggable, collapsible, remembers its spot (already recorded, P58553).
- **SessionOwner's 4-second backstop** — deliberate (P01146): only the head's visible device, only while holding an owner token.

## Outside this territory (one line each, left for their owners)

- `sweep:t3-static` P16114 / P16124 / P16129 (the saved-call queue) and `sweep:t3b` P41031 / P41041 / P41299, `sweep:t3c` P42345 — red on main, not these files.
- `verify:rpc-scoped` — `scripts/sweep/t10s10/new-r3.mjs:719` calls lfh_price_order / lfh_staff_place_order without p_restaurant_id (terminal 10's script, red on main).
- `verify:db-parity` — 2 parity problems on the AV-live side (release items).
