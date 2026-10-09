# SWEEP #10 · T17 — Logins, sign-outs and the gates every request passes — FINDINGS

Run 2026-10-08 on port 4417, worktree `wt-s10-t17`, branch `sweep10/t17-logins-sign-outs-and-the-gates-every`.
Ledger: `LEDGER/T17-S10.md` (500 rows, P186001–P186500, 499 ✅ · 1 ❌ cosmetic). Re-run: 213 existing rows whose
subject is a T17 file, all ✅ today, results written in place (+ P79177, corrected by fix 2).

> Problems and fixes only. Improvement ideas and the four-part report are in the terminal (S10 rule §8).

| # | problem | fix | guard |
|---|---|---|---|
| 1 | All three Sentry setups said `sendDefaultPii: true`, which in @sentry/nextjs 10.x copies the request's headers wholesale into every server error report — the staff session cookie, the admin console cookie, the passwords-uncovered unlock, the print helper's token and a delivery webhook's secret went to the outside error service. | `lib/sentryPrivacy.ts`: `dataCollection` (IP + ordinary headers kept; no cookies, no bodies) + a scrubber on beforeSend / beforeSendTransaction / beforeSendSpan. | **new** `verify:sentry-privacy` (50) — runs the SDK's own request-copying code, proves first it can see a secret |
| 2 | **REGRESSION (a guard row):** `verify:t25-doors` red on main since 2026-09-14 — P79177 still expected the printer-setup permission the owner removed that day. | P79177 now asserts the permission is gone. | `verify:t25-doors` P79177 |
| 3 | A database blip at the staff sign-in (`/api/panel-login`: restaurant lookup on a restaurant's own door, or an owner's restaurant list) threw a bare 500; the card said "Network error". | 503 + "Can't reach the server — try again in a moment."; the card tells a non-JSON server reply from no network. | P186001–P186009 |
| 4 | A sign-in cookie whose id is not a uuid reached Postgres, was refused (22P02) and read as an outage: every panel call answered 503 "busy" for the cookie's remaining week; panel layouts crashed. | `userFromCookie` shape-checks the id before any DB trip. | P186010–P186015 (stub DB read counter) |
| 5 | `/r/<slug>/owner` (a route handler) showed the platform's bare "Internal Server Error" on a slug-lookup blip. | 503 try-again page. | P186016–P186018 |
| 6 | The admin console's card said "Wrong password" to a BLOCKED device and to a platform error page. | blocked → the blocked screen; non-JSON → "server didn't answer properly". | P186019–P186022 |
| 7 | An owner's sign-in / sign-out / failed sign-in was filed under `staff_users.restaurant_id`, a filing home that 1 of 19 live dev owners does not own (owns Aangan + Burger Barn, filed under French House) — French House's log would read another restaurant's owner. | `panelAccess.ownerLogRestaurant` — always a restaurant they own, else a platform-level row. | P186173–P186180 |
| 8 | `verify:panel-secrets` could not fail: it matched `platform_channels` in comments and never ran the strip. Both sabotages (column removed; strip switched off) stayed green. | It reads the list from the code and RUNS `panelSafeSettings()`. | `verify:panel-secrets` (18) |
| 9 | `/api/staff-login` accepted `next=/\example.com` (passes "starts with / not //"; the URL parser reads it as https://example.com/) — after a correct password the admin could be forwarded to another website. | `staffAuth.sameSitePath` asks the parser itself; the card follows only the server's checked answer. | P186181–P186188 |
| 10 | At 360px the three sign-in cards (92vw / 94vw) were wider than the room inside the page's 16px gutter — right gaps 13px / 6px, off-centre. | `min(100%, …)`. Re-measured 16/16; iPad/desktop unchanged. | P186189–P186191 |

Every fix: its own commit with its number, typecheck green, sabotage-tested.

Outside T17's boundary, noticed and left for its owner: `app/api/owner/settings/route.ts` files an owner's own
password-change line under `owner.restaurant_id` — the same filing-home pattern fix 7 corrected at the sign-in door.

## Round 2 (2026-10-08, owner: "plan whole new 500 phases test … every part within your boundary")

479 new checks (P186522–P187000, the rest of the block — 500 would have needed ids from outside it): 473 ✅, 6 ❌
(two decisions offered to the owner, two outside T17's files). Problems found and fixed:

| # | problem | fix | guard |
|---|---|---|---|
| 15 | 3 of 77 stored handover-sheet copies no longer matched their account's real password (asha, diagop2, diagop7 — reset by scripts writing the hash alone): the sheet would have printed passwords that sign nobody in. | `scripts/reseal-handover-passwords.mjs --stale [--write]` clears copies that do not verify, first-save-wins; run on dev: 3 cleared, 0 left. `scripts/lib/storedPasswordCheck.mjs`, pinned to verifySecret. | P186637–P186640 |
| 16 | The gate rulebook (docs/CLAUDE-DETAIL.md → Security gate) missed `/api/guest/leave` on its "complete" public list, still described the `/api/pair` handshake deleted by mig 380 as live, and said panel-logout answers GET. | Corrected. | P186905–P186908 (all 87 routes classified by their gate) |
| 17 | The owner entrance's try-again page (item 5) scrolled 32px on a phone (100vh + padding, content-box). | `box-sizing: border-box`. | P186909 |

Outside T17's boundary, noticed and left for their owners: `app/owner/{inventory,manager,menu}/page.tsx` call
`userFromCookie` without handling AuthDbError (a database blip shows the crash page, not "try again"); 27 admin
screens call `/api/admin` with a plain fetch rather than `lib/adminFetch.ts`.

## Round 3 (2026-10-08, owner: "do all and … plan whole new 500 phases test … every part within your boundary")

Owner-picked items built first: 18 (the sign-in cards could lose their top on a sideways phone), 19 (a visible focus ring on
the sign-in boxes), 20 (Username / Password tied to their boxes), 21 (more ids: P161001–P162000 taken from the planning
session's deliberately free gap, after checking it was empty on main and in every open PR). PR #1449.

500 new checks (P161001–P161500) + the 21 round 2 lacked (P161501–P161521) + item 24's 17 guard checks (P161522–P161538):
538, all ✅ after the fixes below. Families: two break-it passes (130 rules broken one at a time), a throwaway French House
login driven through lockout / disable / password change and deleted, simultaneous wrong tries, Lighthouse on the live
doors (100 in every category), ~70,000 randomised inputs, every live restaurant's own doors, every panel read scanned for
other restaurants' ids and for credentials, items 18–20 at every size on the live site.

| # | problem | fix | guard |
|---|---|---|---|
| 22 | 32 safety rules in the sign-in area had no guard: breaking any one of them (the admin door's 10-try lock, the act-as cookie being HttpOnly, the reveal signature, the DB deadline …) left every guard green. | Each pinned in verify:t25-doors, run for real where the file loads. | P161095–P161128 |
| 23 | Wrong passwords sent at the same instant were counted as ONE (read-add-write in the app), so ten simultaneous tries never reached the 5-try lockout. | Migration 411 `lfh_staff_login_failed(p_ids, p_max, p_lock_seconds)` adds one inside a single UPDATE; staff-only grants. loginUser calls it. | P161230–P161234 |
| 24 | The second break-it pass found 17 more unwatched rules (a bare `?rid=` without the admin cookie, a restaurant's owner entrance / panel address membership, a shared manager PIN crediting both, the block-vs-lockout cutoff, the limiter's 200-char subject, the admin card's double tap …). | Each pinned in verify:t25-doors; all 17 breaks re-run and now turn it red. | P161522–P161538 |

## Round 4 (2026-10-09, owner: "one latest time … 600 phases … every single bit of thing should be covered")

694 new checks (P161539–P162232), all ✅ after the fixes. Every branch of the 23 library/route files was measured with Node's code
coverage and driven in a hermetic harness (line 96.7–100%, branch 86–100% — the unrun lines are named in the ledger); the 5 screens in a
real browser with faked server replies; the database-side counter on the dev DB with throwaway keys; the deploy on the live backup.

| # | problem | fix | guard |
|---|---|---|---|
| 25 | `lib/panelAccess.ts` still read the RETIRED owner-panel switch (settings.enabled_panels.owner, removed 2026-07-31) — it could refuse an owner "ask your admin to turn it on" with no switch left to turn. Two dev restaurants still carry it (both in the bin). | Read removed (one settings query fewer per owner sign-in). | P162135–P162137 |
| 26 | A failed read of a person's saved details made their own-details save start from nothing: the owner's ID type, last 4, verified tick and private note were erased, reply "ok". | 503 busy, nothing written (the panel queue retries). | P162141–P162142 |
| 27 | A failed read of the stored password answered "Current password is wrong." to the right password. | 503 busy. | P162143–P162144 |
| 28 | A database blip escaped `ownerScope` as a 500 on every `/api/owner/*` call (AuthDbError / OwnedLookupFailed were never caught). | Both → OwnerScopeUnavailable → the existing 503 "try again"; any other error still surfaces. | P162138–P162140 |
| 29 | The admin door's and manager PIN's wrong tries were read-add-write: 10 sent at once counted 1 and never locked (measured on dev). | Migration 414 `lfh_throttle_fail` counts inside one insert-or-update; never shortens a lock or clears a block. Applied to dev; re-measured 1…10, one lock. | P162145–P162150 |

Left for the owner (not changed): a SUSPENDED restaurant's staff are refused at `/r/<slug>/<panel>` but let in at the plain `/<panel>`
and by every panel API — the two doors disagree. Improvement ideas (not built): honour a sign-in `?next=` deep link inside the person's own
panel; stop a developer machine sending every page load to the error reporter.

## Round 5 (2026-10-09, owner: "don't do 32 and do everything else … 700 phases or more … fully error free in this boundary")

909 new checks (P162233–P163141), all ✅. Owner decisions built: R61 (item 32 rejected — doc row + code comments), item 30
(suspended = the restaurant's staff apps stop, on every door, with a plain sentence; owners and the admin unaffected) and item 31
(a deep link inside the person's own panel survives sign-in). Re-runnable now: `npm run verify:t17-signin` (501 hermetic checks).

| # | problem | fix | guard |
|---|---|---|---|
| 33 | A binned restaurant's still-signed-in staff (and an owner whose last restaurant was binned) looped between their panel and /login until the browser gave up — requirePanel sent them to /login, and /login sends anyone signed in straight back. | One shared answer, `panelDoor` (lib/panelGate.ts): /login stays put and says why; the gates redirect with `?why=`. | P162239–P162243 |
| 34 | The sign-in limit alert read "+1 more account use this name". | "uses" / "use" by count. | P162247–P162248 |
| 35 | The focus-ring comment promised no ring for a mouse click (browsers ring every focused text box). | Comment corrected. | — (comment) |
| 36 | Mutation testing (291 automatic breaks) left 72 breaks uncaught: 39 were missing tests, 33 provably harmless. The security-relevant rules among the 39 (the bot trap refusing even a right password, the right uncover password opening, the limiter failing open, an empty password never counted, the act-as cookie's 6 hours, …) had no guard. | All 39 closed in the harness and re-proved; 14 pinned in verify:t25-doors, each proved red on its own. | P162249–P162262 |

Outside T17's boundary, noticed and left: the owner/manager/kitchen/tablet layouts pass only their HOME as `?next`, so item 31's deep
link only helps once those layouts pass the page they were on; `lib/alerts.ts`'s header comment still says quiet alerts are priority
"min" (the code sends "low", on purpose); the console's "Suspended" label still says only "its guest menu is offline", and suspending
does not call forgetRestaurant, so staff stop within 30 seconds rather than at once.

## Round 6 (2026-10-09, owner: "do all 4 and also check again … until you find 0 errors")

856 new checks (P163142–P163997), all ✅. Built at the owner's word: 37 (bookmarks land back on the owner page after sign-in), 40 (the
retired per-panel switch deleted). Problems found and fixed:

| # | problem | fix | guard |
|---|---|---|---|
| 38 | The console still said a suspended restaurant's staff keep working (5 sentences + 2 comments), and a suspension took up to 30 s to reach staff. | Wording corrected everywhere; set_restaurant_active clears the remembered state. | P163143–P163144 + harness u-r6 (suspended through the real route → refused next call) |
| 39 | lib/alerts.ts's header said quiet alerts go out at ntfy "min"; the code sends "low". | Header corrected, history kept. | P163150 |
| 41 | The owner layout showed the crash page when an owner's restaurants could not be read (OwnedLookupFailed uncaught — round 2's outside note). | Reconnecting screen, like AuthDbError. | P163149, P163154 |
| 42 | Four fresh mutation passes (720 breaks) found 54 rules no test noticed breaking — e.g. the owner layout flipped to send owners WITH restaurants to sign-in (an endless loop no hermetic test could see), a manager finishing setup without their required PIN, an empty uncover password, a non-text uncover cookie, a failed seal leaving the OLD readable password on the handover sheet. | All 54 closed (harness u-mutkill2/3/4, u-r6) and each re-proved caught; the safety-relevant ones pinned in verify:t25-doors. The last pass found none. | P163151–P163158 |

Left, not this territory: `verify:guards-alive` flags two scripts in scripts/sweep/t9s10/ (T9's) that end with a bare process.exit().
