# T12 improvements — owner home screen, Audit & logs

## 🟢 Built (inside my territory, small, no migration / screen / module / permission)

| # | where | what | commit |
|---|---|---|---|
| 1 | owner → Dashboard → Recent activity, on a brand-new restaurant | the empty state said only "Nothing yet."; it now says what will fill it, like the full page does | `5d02a12b` |
| 2 | backend only, nothing on screen (owner → Audit & logs) | the 60s refresh was a bare `setInterval` that kept firing at an unattended tab (~480 reads a service). Now the console's shared activity-gated hook: stops after 2 min without input, wakes instantly on return, jitters ±20% so devices do not share one beat | `186a9192` |
| 3 | owner → Dashboard → Busy heatmap card | the "we couldn't read part of this" strip sat ABOVE the card title on the two heatmap cards and below it on the other two; all four now sit under their own title | `105dd643` |

## 🟡 Not built — needs a decision from him

1. **Which number leads the tile row.** owner → Dashboard, top row. "Revenue · last 30 days" is
   first and "Today so far" is fourth. He opens this at 11pm after service, when today is the
   number he wants first. Moving it is a layout decision with a real trade-off (the 30-day figure
   is the one that anchors every chart below), so it is his call, not mine.
2. **A visible back control on the drilled views at ≤900px.** owner → Dashboard → a dish. The
   hardware BACK and the drawer both work now (problems 8 and 10), but there is still nothing on
   screen that says "go back" — the breadcrumb is hidden at that width. Adding one means adding
   chrome to a screen he has said is already full.
3. **Let the top-bar restaurant switcher re-scope Audit & logs in place.** owner → Audit & logs,
   multi-restaurant owner. Picking a restaurant there throws him to the dashboard instead of
   narrowing the log, the way Reports and Manager mode narrow in place. It changes what the page
   shows, so it is a product decision.
4. **One wording for "how long ago".** The dashboard's mini feed says "2 min ago" and Audit & logs
   one click away says "2m ago" — two wordings for the same fact. The shared one is in
   `components/admin/shared`, which is T27's fence this wave, so I left it. (Ledger P05939.)
