# Sweep #10 · T2 — the dish page and the 3D viewer — problems found and fixed

Ledger: `LEDGER/T2-S10.md` (505 new checks, P171001–P171765) · re-run: 3,560 older rows stamped
`s10·T2`, **0 regressions** · branch `sweep10/t2-dish-page-and-the-3d` · one commit per item.

| # | what was wrong (measured) | where | fix | guard |
|---|---|---|---|---|
| 1 | Back from iPhone AR (Quick Look) the 3D screen stayed in its AR state for the rest of the visit: callout cards hidden, camera zoom floor 5 cm, smoothing off; a 2nd trip parked the camera at 0.33 m with the dish at 40%. Quick Look/Scene Viewer fire no `ar-status`, so nothing ever undid the handoff. | `app/view/[folder]/ViewerClient.tsx` → `handleLaunchAR` | undo the handoff right after `activateAR()` unless a WebXR session started; undo any stale handoff before a new one | `verify:3d-viewer` ×2 · new-live P171565–P171569 |
| 2 | Restaurant #1's own dish door `/item/<dish>` ignored the restaurant's DARK default (the tenant twin, the menu and /q all apply it). | `app/item/[slug]/page.tsx` | the twin's boot script, byte-identical | `verify:3d-viewer` (both doors) · P171579 |
| 3 | A review note longer than 500 characters: "Review posted", all of it on screen, 500 stored — cut mid-word after a reload. | `app/item/[slug]/ItemClient.tsx` → review textarea | `maxLength={REVIEW_NOTE_MAX}` (500, = `left(comment, 500)` in mig 386) | `verify:3d-viewer` reads the limit from the newest migration · P171572 |
| 4 | The zoomed photo's ✕ — the only way out while zoomed — had no accessible name ("button"). | `ItemClient.tsx` → lightbox | `aria-label="Close photo"` | `verify:3d-viewer` · P171577 |
| 5 | On the 3D screen Tab walked through six dead hotspot buttons (three unnamed) before Add to order. | `components/PublicModelViewer.tsx` | `tabIndex={-1}` on both hotspot buttons, anchor `aria-hidden` — nothing changes on screen (R57) | `verify:3d-viewer` · P171587 |
| 6 | Guard hole: the dish page's single-diet veg-mark check could only ever pass (`const dietMeaningful = true;` stayed green). | `scripts/verify-3d-viewer.mjs` | assert the derivation and its use | sabotage.mjs: both breaks red |
| 7 | Two notes on the 3D screen said the opposite of the code (cited R44 for the tags rule; said AR replays the reveal). | `ViewerClient.tsx` comments | corrected | `verify:3d-viewer` |

Ledger honesty, recorded in the rows: sweep #9 stamped four rows "still true" whose subject had been
deleted twelve days earlier (P56223, P56224, P95424, P95388) — now ⏭ SUBJECT RETIRED.

Outside this territory (for its owner, not touched): `lib/issues.ts` `raiseIssue()` accepts a
complaint's photo/voice link if it contains `/issue-media/`, without checking it is under THIS
restaurant's own `<rid>/` folder — the restaurant should come from the session, not the request.
