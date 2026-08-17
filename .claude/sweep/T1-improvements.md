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

## 🟡 RESOLVED — decided by the owner on 2026-08-17

### I3 · Fold the slug in `lib/tenantStorage.ts` — **BUILT** (permission granted 2026-08-17)
The root cause behind F1. `tenantSlug()` and `tgetFor`/`tsetFor` now fold the slug, so a guest
landing straight on a shared, oddly-cased dish link keeps one basket and one table.

### I4 · Record R28 in `docs/REJECTED-IDEAS.md` — **BUILT**
Done, together with R29 (the bell stays put) and R30 (the hero stays English).

### I5 · A restaurant-neutral, translated hero fallback — **REJECTED, now R30**
Owner, 2026-08-17: *"i want english only for all."* The English literals stay for every restaurant
and every language. Recorded in the doc and on the `<HeroTitle>` line. Do not re-offer it.
