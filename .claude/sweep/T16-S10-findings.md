# T16 · Sweep #10 — Shared panel plumbing — findings (all fixed on `sweep10/t16-shared-panel-plumbing-the-helpers`)

One commit per item, the number in the message. Every fix has a guard that goes red on the old code
(sabotage-tested). The four-part report lives in the terminal chat, not here.

| # | what a person lost | file | how it was confirmed | guard |
|---|---|---|---|---|
| 1 | **Every profile save on every staff panel answered "Not Found" since 2026-08-05** — the ⚙ drawer's Save details / Set PIN / first-login card and "My profile & pay". The queue built the address as `undefined + /api/panel-profile`. | `maint.js`, `outbox.js` | driven: the request went to `/panels/editor/undefined/api/panel-profile` (404 on the dev server and on the backup site) | `verify:outbox` §12 |
| 2 | A discount that ran out of retries **let the settle behind it go out at full price**; Try again then landed the discount on a settled bill. | `outbox.js` | driven against a scripted server: "pay, discount" arrived in that order | `verify:outbox` §13, `verify:panel-plumbing` (+2), P04050 |
| 3 | Closing one card and opening the next straight after (**Mark unpaid → Yes → reason card**) made the next close **throw the person out of the panel**. Reported by T12. | `backstack.js` | driven: the page left every time with the second card opened a microtask or 0 ms later | new `verify:panel-backstack` (14), P65921 |
| 4 | A Wi-Fi blip on a **Firefox** staff device was filed as a red crash and could ping the owner's phone (the phrase list held only the first five words of Firefox's sentence). | `errlog.js` | driven: "NetworkError when attempting to fetch resource." was sent as a crash | `verify:t12-plumbing` P185001 |
| 5 | A slow read put the browser's words **"signal timed out"** on a manager's screen (seen on the Dashboard). | `netretry.js` | seen live on :4416 with the slow dev database | `test:netretry` (+2) |
| 6 | On the light skin the **✕ that closes the profile drawer was white on beige**, all but invisible. | `maint.js` | screenshot, manager panel at 360 px | `verify:panel-plumbing` (+2) |
| 7 | A busy moment at boot **hid the ⚙ Profile button — and Sign out — for the whole shift**; the only retry waited for an `online` event that never comes when the server, not the network, is slow. | `maint.js` | driven: two 503s at boot, server healthy a second later, no button after 20 s | `verify:outbox` §14 |
| 8 | When the profile could not be read, "My profile & pay" **told a signed-in person they were not signed in**, and the button stayed hidden. | `myprofile.js` | driven with the same busy boot; also seen live on the slow dev database | `verify:outbox` §14 (+3), P04359, P66052 |
| 9 | A change queued in the **first moment after a panel opened dropped out of the list** (on the device, but not shown, not sent, no timer) until a reload. | `outbox.js` | driven: missing 5 times out of 5; found because one of my checks went red once in four runs | `verify:outbox` §15, P04060 |
| 10 | `/api/maintenance` scoped an **OWNER** to their login's "home" row — restaurant #1 — instead of a restaurant they own. No screen calls it as an owner today; it now checks the owner's portfolio like the manager panel's route does. | `app/api/maintenance/route.ts` | read inline, then driven in memory | new `verify:public-endpoints` (22) |

## Noted, outside this territory (one line each, for their owners)

- Manager panel → floor (custom layout on, no plan): shows the developer text "The plan lives in public/panels/floor-layouts.js" to a manager — `editor/app.js` / `floor-layouts.js`.
- Manager panel → with the guest menu switched OFF there is no bell, so printer-stuck and low-stock notices (which moved into the bell on 2026-08-30 / 2026-10-03) have nowhere to appear — `editor/app.js` `syncGuestBell()`.
- Manager panel → `api()` marks every failed READ as offline (`netErr.offline = true`), so a read that timed out on a slow server reads "no internet right now" — `editor/app.js`.
- Waiter tablet → four sideways rows still have no "more this way" hint (`swipehint.js` not loaded) — T12.
- Manager panel → `LFH_BACK.layer("table-detail", …)` called unguarded (harmless, backstack loads first) — T6–T8.
- `lib/backStack.ts` (the React twin of backstack.js) may carry the same rewind-race shape as item 3 — not checked here.
- Generated ledger `T20-S8.md` rows P73981 / P74195 (auditsort) are re-run by `verify:bin-billing-usage`, not by hand.
