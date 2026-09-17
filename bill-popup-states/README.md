# The bill popup — every state, photographed, plus a live one

`node bill-popup-states/serve.mjs` → **http://127.0.0.1:8938/**
(that server also proxies everything else to the app on :4000, so the LIVE panel embedded in the
page is the real thing on the same origin — sign-in and all).

Built 2026-09-17 because the owner asked for it: *"store every ss in one html and show me that
html for all types — from accepting, family, everything — and in that html there should be one
working one also"*.

Nothing in here is a drawing. Every picture is the real popup in the real app, taken by driving
the manager panel with Playwright:

```bash
node bill-popup-states/capture.mjs    # builds a bill on a free test table, walks the states, shoots each
node bill-popup-states/gallery.mjs    # rebuilds index.html from shots/ + shots.json + template.html
```

`capture.mjs` signs in ONCE (`scripts/sweep/login.mjs`, so the app's own login limit is never
walked into), picks a free table that no guard has claimed (`scripts/sweep/fixtureTables.mjs`),
and leaves its rows behind on purpose so the live panel on the page has a full bill to open.
Cancel them from the popup (✕ on a ticket) when you are done with them.

## The states it captures

| # | state |
|---|---|
| 01 | a free table → straight into ＋ Take order |
| 02 | a guest's order waiting, as one amber line |
| 03 | that ticket opened out — the accept detail view |
| 04 | accepted: the dishes merge into their menu place |
| 05 | the whole bill, 20 lines, menu order, merged duplicates |
| 06 | part served — the served ones sink |
| 07 | a dish's own sheet, with a row per ticket it came on |
| 08 | ✎ one dish: allergens + kitchen note |
| 09 | ticket order (KOT-wise) |
| 10 | six calls ringing at once |
| 11 | the table marked Family / VIP / Owner's guest |
| 14 | a discount on the bill |
| 15 | everything served |
| 16 | the same popup on a phone (392 × 844) |
| 17 | a short laptop window — the strips drop, the rows don't |
