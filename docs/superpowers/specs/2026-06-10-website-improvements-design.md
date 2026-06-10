# Website Improvements — Design (2026-06-10)

Outcome of a full mobile audit of the live site (menu → dish → 3D → cart → order, both
themes, production Lighthouse + performance trace). Production speed and accessibility are
already excellent; this round fixes trust bugs and UX gaps the audit found, as approved by
the owner.

## Scope (owner-approved)

1. **Prices: round to nearest ₹10 and identical everywhere.**
2. **Ratings: real averages from real reviews; fake seed reviews removed.**
3. **"3D PREVIEW UNAVAILABLE" banner removed** for dishes without a model.
4. **Two-step add-to-order:** success confirmation sheet after adding, everywhere
   (the 3D viewer currently gives no feedback at all).

### Explicit non-goals (owner said keep as-is)

- Waiter-bell button stays where it is.
- The 3D viewer keeps its green/dark design.
- Filter chip row stays a horizontal scroller (the "cut off" look is the scroll hint).
- The floating back/♥ buttons on the dish page stay (the "collision" was a normal
  scroll-under moment, not a bug).

## 1. Pricing

**Problem found:** dish page showed ₹546 while the customize modal showed ₹545; the menu
listed Caramel Cold Coffee at ₹419 but the "Goes well with" upsell showed ₹402. Two or more
code paths convert/round prices differently. Also "1 items" grammar on the bill bar.

**Design:**

- One shared money module (e.g. `lib/money.ts`) becomes the ONLY place prices are
  converted, rounded, and formatted. Rule: **INR rounds to the nearest ₹10**; non-INR
  display currencies round to a sensible step for that currency (e.g. nearest 0.5).
- Every surface uses it: menu cards, dish detail, customize modal, "goes well with",
  bill line items, subtotal/tax/total, 3D viewer price strip.
- **The server-side order calculator (the migration-029 family) must apply the exact same
  rounding** — it recomputes prices from `menu_items` for security, so client display and
  server-charged totals must agree to the rupee.
- Tax stays 5%, computed on the rounded subtotal, itself rounded with the same rule used
  for display.
- Fix pluralisation ("1 item", "2 items") in the bill bar and anywhere else it appears.

## 2. Real ratings & reviews

**Problem found:** every dish shows "4.7 ★ (3 reviews)" by the same three fictional people
(Daniel/Diego/Priya) with the dish name substituted, and the menu card shows a *different*
fake number (e.g. 4.3) than the dish page (4.7). Any customer who opens two dishes catches
it; it poisons trust in the whole menu.

**Design:**

- New Supabase table `reviews`: `id, item_slug, device_id, stars (1–5), comment (nullable,
  length-capped), created_at`. Unique on `(item_slug, device_id)` — re-rating updates your
  previous rating instead of stacking.
- **Anyone on the site can rate** (owner's decision). The `device_id` is a generated UUID in
  `localStorage` — light spam protection without accounts: one live rating per dish per
  device.
- Writes go through a server route that validates stars ∈ 1..5 and caps comment length;
  RLS keeps the table closed to direct anonymous writes except via that path (same pattern
  as orders).
- Displayed rating = average of real reviews (1 decimal), count = real count. The menu card
  and the dish page read the same aggregate (a small SQL view or aggregate select), so the
  numbers can never disagree again.
- Zero reviews → show a clean **"New"** badge instead of stars; the reviews section invites
  the first rating instead of listing fakes.
- The hardcoded fake reviews are deleted from the codebase/seed.

## 3. Remove the "3D preview unavailable" banner

Dishes with a model keep the VIEW IN 3D button. Dishes without one simply show nothing
about 3D — no teal banner advertising a missing feature.

## 4. Two-step add-to-order confirmation

After the customize modal's ADD TO ORDER succeeds, a small success sheet appears:
"✓ Added to your bill — *dish* ×qty" with two buttons: **View bill** and **Keep browsing**
(auto-dismisses after a few seconds as Keep browsing). Identical behaviour from the menu
quick-add, the dish page, and the 3D viewer — the viewer today closes the modal silently,
which invites double-adds.

## Error handling

- Review submit failure → toast with retry; never blocks browsing.
- Money module is pure/deterministic — unit-testable with fixed cases (251→250, 546→550,
  419→420).
- Server/client rounding agreement is verified by an automated test that walks one order
  end-to-end and compares totals.

## Verification (definition of done)

- `npx tsc --noEmit` passes; `node scripts/verify-cache.mjs` still passes (3D untouched).
- Phone-viewport walkthrough in Chrome MCP: same price for one dish across all six
  surfaces; rating identical on card + detail; no 3D banner on a non-3D dish; confirmation
  sheet appears from menu, dish page, and viewer.
- A test order's server-computed total equals the bill's displayed total.
