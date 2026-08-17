# T1 — GUEST MENU CORE · improvements

## 🟢 BUILT (inside the territory, small, no migration / screen / module / permission)

### I1 · "Not available" is no longer a dead spot on the card
`components/FoodCard.tsx`. The sold-out pill carried
`onClick={e => { e.preventDefault(); e.stopPropagation(); }}`. That kept it from behaving like a
button — but it also swallowed the whole-card `<Link>` underneath, so on a sold-out dish there was
one patch of the tile where a tap did nothing at all, while every other patch opened the dish. A
diner tapping the words "Not available" is asking *what is this, and when is it back*; the honest
answer is the dish page, which the rest of the card already gives them.

Dropping the handler is the whole change: the tap bubbles to the card's own link. Unlike the "+" and
the −/+ stepper, this element has no action of its own to protect, so there was nothing to
`preventDefault` for. **Confirmed live** by marking one French House dish sold-out, watching a real
tap on the pill open `/r/french-house/item/aglio-e-olio-in-coconut-oil?cat=pasta`, and restoring the
dish's original tags by id in the same run. Guard: `verify:guest` → `P00143`.

### I2 · The search suggestions describe themselves honestly to a screen reader
`components/MenuView.tsx`. The panel was `role="listbox"` and its children were plain links — not
one `option` anywhere inside. A listbox promises a set of selectable options and arrow-key
navigation; there is neither. A blind diner was told "list box" and then handed nothing selectable.

It is now `role="list"` with `role="listitem"` rows and an `aria-label` carrying the count
("8 matching dishes"), so the number of matches is spoken rather than discovered by swiping. This is
the same correction the category chips already received on 2026-08-12, applied to the one guest
widget that still had it. No class, style or behaviour changed — the scroll cue, the prices and the
links are untouched. Guard: `verify:guest` → `P00488`.

---

## 🟡 NOT BUILT — they need a decision from the owner

### I3 · Fold the slug in `lib/tenantStorage.ts` (the root cause behind F1)
Outside the territory, and it changes a shared helper every guest surface depends on. One line, but
it belongs to whoever owns that file. See the handoff in `T1-findings.md`.

### I4 · Record R28 in `docs/REJECTED-IDEAS.md`
Outside the territory. The owner's 2026-08-16 rejection of a cap on the 3D preload is carried in the
preserved branch as a code comment, but the doc row it must point at does not exist on `main`, and
`verify:rejected` refuses an orphan claim. Row and comment need to land together.

### I5 · A restaurant-neutral, translated hero fallback
A tenant with no custom hero shows the English literals `"Welcome"` / `"Our Menu"` in all six
languages, because `t.greeting` / `t.heroTitle` hold restaurant #1's own copy ("BONJOUR",
"All-Day Café & Bakery") and must not leak. A neutral pair of dictionary keys would fix it — but
that is `lib/i18n.ts`, and **R15 and R23 both rule that the guest menu's remaining English is not to
be raised as work**. Listed here only so the next sweep does not re-discover it and think it is new.
**Recommendation: leave it.**
