# T10 findings — SWEEP #8, the waiter tablet (2026-09-03)

Territory: `app/tablet/**` · `app/api/tablet/**` · `public/panels/tablet/{app.js,style.css,index.html}`.
Branch `sweep8/t10-waiter-tablet`. Ledger block **P63701–P64700**; **P63701–P64232 filed, 532 rows,
532 ✅**. `P64233`–`P64700` unused.

**The full four-part report went to the terminal, not to a file** — that is the sweep's own rule.
This file is the durable record of the NINE problems found and fixed, one commit each.

## The regression

**P12639** — *"the top bar keeps the restaurant name ≥140px at 360px"*, ✅ in sweep #7, **❌** when
measured at the start of this pass: 85px of box for 140px of text, i.e. `little Fren…` on the phone
the owner tests. Two causes, both traced:

1. A 🔔 was added to that bar on 2026-08-13, and sweep #7's T9 deliberately kept it there at phone
   width on 2026-08-22 — correctly, a notification count must be visible. It took ~52px off a bar
   that had been measured to the pixel for the tenant's own name three weeks earlier. Neither side
   re-measured.
2. Older and quieter: the 2026-08-04 rule written to give the name room sat INSIDE
   `@media (max-width: 430px)` **above** the plain `.brand .rest-name` rule, same selector, same
   specificity — so document order handed the win straight back and **the rule never applied once**.

Fixed as item 1. Re-measured 116px box for 116px of text at both 390 and 360, both skins, desktop
untouched.

## The nine

| # | what was wrong | commit |
|---|---|---|
| 1 | the restaurant's own name was cut off on the phone, and the rule meant to stop it had never applied | `5f262ced` |
| 2 | printing a bill from the handheld posted to a door that does not exist on this route; the 404 was swallowed, so `bill_printed_at` was never stamped and "Reprint" lied on every other screen | `48d9c7c1` |
| 3 | `logo_url` is read by this panel and was not in its payload, so every bill a waiter printed came out with no restaurant logo | `9eecb421` |
| 4 | "Move table" was the one action here that never confirmed the session belonged to this restaurant, and the one destination with no floor-plan check | `ccad320f` |
| 5 | the "Move table" picker offered tables the server then refused as taken — five of six on-plan tables on the dev floor | `c8a2b6cf` |
| 6 | the dish list — the heaviest read in the file — had no ceiling, and the comment claiming it was the only bounded one was wrong | `95f33c19` |
| 7 | six style rules for classes nothing can put on the screen, each a feature replaced without its old path | `95f33c19` |
| 8 | literal control bytes made a `.ts` source file classify as binary | `ad691bac` |
| 9 | four call sites passed an argument the function has never declared | `ad691bac` |

## Guards left behind

`verify:tablet-taps` grew from 106 to **113** checks, every one sabotage-tested (red on the
reintroduced fault, green once fixed):

* a declaration inside `@media` that a later identical selector overrides with a different value —
  the class of fault behind item 1, not just the instance;
* every endpoint the panel calls must exist on the tablet route, matched against the dispatcher's
  own conditions read out of the route (item 2). `verify:twins` could not see this: it compares the
  branches the three routes DO have, and nothing compared the panel's CALLS to its own route;
* every `restaurant` column the panel reads must be in the payload, plus the three the shared bill
  document resolves the identity from through a parameter in another file (item 3);
* the shift picker must ask whether a table can really TAKE a party, the helper must read the RAW
  tile, and a "Wants in" table must be excluded (item 5);
* every class the stylesheet defines must be one some file can render — learning the `x-${…}`
  prefixes the panel BUILDS, so ten live classes are not miscounted as dead (item 7).

## Seven of my own detectors were wrong before any of them was believed

Written into the checks that replaced them, because this is the recurring lesson:

* a colour parser that could not read Chrome's `color(srgb …)` notation, so a plainly readable tile
  number measured 1.19:1;
* a sabotage that left its needle as a SUBSTRING — `/cf-nudge/` still matches `cf-nudgeZZ`, so two
  guards looked blind when they were not;
* a scan that matched an **obituary comment** and reported the bug it describes as live;
* a dead-CSS check that did not know a class can be BUILT (`t-${st.cls}`);
* a tap-size check that counted an `aria-hidden` badge as a control;
* a realtime check that looked for `subscribe(topic)` when this panel hands `LFH_RT.start` a
  handler MAP;
* the dev server rebuilding underneath the run: six `/_next/` 403s that are not a product fault.

## Deliberately NOT filed

* `.dminus` (34×30) and `.iedit .qbtn` (30×30) are under 40px. Both change a cart line or a
  quantity, both instantly reversible by the ＋ beside them, and the owner has refused this exact
  shape of change three times — R4, R22, R40 — with the same reason each time. Measured and recorded
  in the ledger so the next sweep finds the numbers instead of re-discovering them.
* `.attend`'s white ink is 3.24:1 where the label actually sits and 2.78:1 on the top sliver of its
  gradient, where no glyph is drawn. Recorded with both numbers rather than filed as a fault.
* Nine reads bounded by a session, an order or a table carry no `.limit()`, deliberately: a ceiling
  on `orders(subtotal, taxable_base)` would quietly cap a legitimate discount on a long bill.
* `P37391` (`verify:avlive-release`, ❌) was left untouched — its subject is a guard that reads the
  client stack this terminal may not go near.
