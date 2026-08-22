# T26 — THE LOOK: improvement ideas (not built)

## 🟢 built in this run
Nothing separate — every 🟢 opportunity I found in my territory was a measured fault, so it is in
`T26-findings.md` as a fix rather than here. The one thing built that is not a fault is the guard:
`npm run verify:look-ink` (static + live), because a fix nothing guards comes back.

## 🟡 for the owner to decide

1. **The light consoles' secondary text is a whisker under the readable floor.** `--muted` in the
   admin and owner light blocks is `#6b7280`; on the card tints actually used it measures 4.11–4.25:1
   against the 4.5:1 that 11–13px text needs. One token per block, same hue one step deeper, lifts
   about thirty places at once — table headers, page sub-lines, every `.adm-muted` note, the
   chart-type buttons. It also makes every console screen very slightly heavier, which is a look
   decision, and DARK is the default skin on both consoles anyway.
2. **The waiter tablet has the loosest touch discipline of the three panels.** The kitchen board
   mentions 44px thirty-two times and comes back with one control under it; the manager panel
   twenty-six times and twelve under; the waiter tablet fourteen times and seven-to-ten under —
   and the tablet is the panel actually held one-handed in an aisle. Raising it needs a per-control
   pass with the wrap risk R41 already warns about, so it is his call, not a sweep's.
3. **The kitchen board's status colours are one hue step off the other two panels' in the DARK skin**
   (green `#5fae6e` vs `#22c55e`, red `#e2664f` vs `#ef4444`, gold `#d8a657` vs `#d4a574`). The
   kitchen's file says the warmth is deliberate. In the LIGHT skin all three already agree exactly.
   Worth a decision: is the kitchen meant to look warmer than its siblings, or the same?
4. **Overlay backdrop alphas are ad hoc.** The manager panel alone uses thirty distinct dim values,
   the app thirty-nine. Nobody is worse off and every one is readable, but two overlays on the same
   screen dim by different amounts. A three-value scale would make the product feel more like one
   product. Pure taste with a real churn cost.
5. **The guest menu's chips and nav buttons are 32–37px tall on a phone**, under the 44px the panels
   hold themselves to. The guest is not mid-service with wet hands, and R41 shows widening controls
   has cost layout before — so this is a deliberate-looking difference, but it is the biggest single
   inconsistency between the guest side and the staff side.
6. **The admin DARK console's active nav label reads 4.14–4.48:1.** Fixing it means *lightening* the
   accent, and the accent is already the brightest blue in that palette — so it needs a new
   ink-on-dark-tint token rather than a nudge. Small win, new token.
