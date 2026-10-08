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
