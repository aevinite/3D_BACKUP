# Website Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rounded, everywhere-identical prices (INR → nearest ₹10); real averaged ratings/reviews replacing the fake seed; no "3D preview unavailable" banner; a two-step add-to-order confirmation.

**Architecture:** Prices stay stored in USD (source of truth) and the server keeps recomputing orders via `lfh_nice_usd` (migration 029) — unchanged. We add a tiny pure money module (`lib/money.mjs`) that snaps **converted display amounts** to a per-currency step (INR = 10), and route EVERY price surface through it. Reviews become a real Supabase table written through a SECURITY DEFINER RPC (same pattern as orders), with an `item_ratings` aggregate view read by both the menu cards and the dish page so the numbers can never disagree.

**Tech Stack:** Next 16 App Router, TS strict, Supabase (migrations run by `scripts/seed-supabase.mjs`), `node --test` for the new pure module, Chrome MCP + `scripts/verify-cache.mjs` for verification.

**Spec:** `docs/superpowers/specs/2026-06-10-website-improvements-design.md`

**Known facts discovered during audit (do not re-derive):**
- Two rounding paths exist today: `formatPrice` = `prettyUsd` → convert (menu cards `components/FoodCard.tsx:209`, dish page `app/item/[slug]/ItemClient.tsx:597`, viewer `app/view/[folder]/ViewerClient.tsx:122`) vs `formatMoney` = raw convert (modal `components/OrderConfirmModal.tsx:111`, bill `components/CartPanel.tsx:286`, mini bar `components/MiniCart.tsx:71`, session bill `components/SessionTableBill.tsx:88`). The modal also prices from RAW USD: `OrderConfirmModal.tsx:123` `const unit = parseFloat(item.price) + ...` (no `prettyUsd`) — that's the ₹546 vs ₹545 bug.
- "1 items" lives ONLY in the aria-label `components/MiniCart.tsx:79` (visible text at :85 is correct). This is also Lighthouse's `label-content-name-mismatch`.
- Fake reviews: seeded into `menu_items.reviews` JSONB (mapped at `lib/menu.ts:100`, seeded by `scripts/seed-supabase.mjs:95`); card rating is `menu_items.rating` TEXT shown at `components/FoodCard.tsx:206` with a `|| "4.8"` fallback; the dish page averages `localReviews` at `ItemClient.tsx:451-454`; `submitReview` (`ItemClient.tsx:401-418`) is front-end-only.
- 3D banner: the `else` branch at `ItemClient.tsx:695-699`.
- All add paths except quick-add go through `components/OrderConfirmModal.tsx` (listens `lfh:open-order-confirm`; `confirm()` at :149-198). Quick-add: `components/FoodCard.tsx:129-155`. Toasts: `lfh:toast` handled by `components/ToastHost.tsx`.
- Highest migration: 029. Migrations + seed run via `node scripts/seed-supabase.mjs` (uses rotated PAT from `.env.local` — NEVER echo it).
- No unit-test runner exists; use Node's built-in `node --test` (no new deps).

---

### Task 1: Pure money module + tests

**Files:**
- Create: `lib/money.mjs`
- Create: `tests/money.test.mjs`
- Modify: `package.json` (add test script)

- [ ] **Step 1: Write the failing test**

```js
// tests/money.test.mjs — unit tests for the pure money helpers.
// Run with: npm run test:money  (plain `node --test`, no extra dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import { niceUsd, snapToStep, displayAmount, minorRound } from "../lib/money.mjs";

test("niceUsd lands on confident menu endings (.00/.50/.99)", () => {
  assert.equal(niceUsd(4.29), 4.5);
  assert.equal(niceUsd(2.99), 2.99);
  assert.equal(niceUsd(6.49), 6.5);
  assert.equal(niceUsd(0), 0);
  assert.equal(niceUsd(NaN), 0);
});

test("INR display snaps to nearest 10", () => {
  // 6.50 USD * 84 = 546 -> 550 ; 4.99 * 84 = 419.16 -> 420 ; 2.99 * 84 = 251.16 -> 250
  assert.equal(displayAmount(6.5, 84, 10), 550);
  assert.equal(displayAmount(4.99, 84, 10), 420);
  assert.equal(displayAmount(2.99, 84, 10), 250);
});

test("2-decimal currencies snap to cents (no behavior change)", () => {
  assert.equal(displayAmount(6.5, 1, 0.01), 6.5);
  assert.equal(displayAmount(6.5, 0.92, 0.01), 5.98);
});

test("snapToStep is exact for fractional steps (no float dust)", () => {
  assert.equal(snapToStep(5.979999, 0.01), 5.98);
  assert.equal(snapToStep(545.0001, 10), 550); // wait: 545.0001/10 = 54.50001 -> 55 -> 550
});

test("minorRound rounds tax to the currency's minor unit", () => {
  assert.equal(minorRound(27.5, 1), 28);   // INR tax: whole rupees
  assert.equal(minorRound(0.275, 0.01), 0.28); // USD tax: cents
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/money.test.mjs`
Expected: FAIL — `Cannot find module '../lib/money.mjs'`

- [ ] **Step 3: Implement `lib/money.mjs`**

```js
// lib/money.mjs — the ONLY place price math lives. Pure functions, no imports,
// so both the browser bundle (via lib/format.ts) and `node --test` can use it.
//
// Money flows like this:
//   USD in the database --niceUsd--> "confident" USD unit (matches the server's
//   lfh_nice_usd in migration 029) --displayAmount--> converted to the guest's
//   currency and snapped to that currency's step (INR snaps to 10s).

// Round a raw USD price to a confident menu ending (.00 / .50 / .99).
// MUST stay in sync with lfh_nice_usd() in supabase/migrations/029.
export function niceUsd(value) {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(n)) return 0;
  const whole = Math.floor(n);
  const frac = n - whole;
  if (Math.abs(frac - 0.99) < 0.07) return whole + 0.99;
  if (frac < 0.25) return whole;
  if (frac < 0.75) return whole + 0.5;
  return whole + 0.99;
}

// Snap a number to the nearest multiple of `step`, killing float dust
// (0.1+0.2 problems) by rounding to 6 decimals afterwards.
export function snapToStep(value, step) {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return 0;
  return Math.round((Math.round(value / step) * step) * 1e6) / 1e6;
}

// Convert a USD amount to the guest's currency and snap to its display step.
// rate: how many of the currency equal $1. step: 10 for INR, 0.01 for others.
export function displayAmount(usd, rate, step) {
  const n = typeof usd === "string" ? parseFloat(usd) : usd;
  if (!Number.isFinite(n)) return 0;
  return snapToStep(n * rate, step);
}

// Round small amounts (tax) to the currency's MINOR unit so tax doesn't jump
// in ₹10 hops: INR minor = 1 rupee, USD/EUR minor = 0.01.
export function minorRound(value, minor) {
  return snapToStep(value, minor);
}
```

- [ ] **Step 4: Fix the test's wrong expectation, run, verify pass**

The `snapToStep(545.0001, 10)` case above is intentionally written wrong in Step 1 to make you THINK: 545.0001/10 = 54.50001 → rounds to 55 → 550. That IS the correct behavior (banker's-adjacent midpoint goes up). Keep the assertion as 550.

Run: `node --test tests/money.test.mjs`
Expected: PASS (5 tests)

- [ ] **Step 5: Add the npm script**

In `package.json` `"scripts"`, add: `"test:money": "node --test tests/money.test.mjs"`.

- [ ] **Step 6: Commit**

```bash
git add lib/money.mjs tests/money.test.mjs package.json
git commit -m "feat(pricing): pure money module — INR snaps to nearest 10"
```

---

### Task 2: Route every price surface through the money module

**Files:**
- Modify: `lib/format.ts` (rewrite `formatPrice`/`formatMoney` on top of money.mjs; add `STEP`/`MINOR` tables + `toDisplay`/`formatAmount` exports)
- Modify: `components/OrderConfirmModal.tsx:111,123` (prettyUsd the unit; format via new path)
- Modify: `components/CartPanel.tsx` (bill lines/subtotal/tax/total in display-domain)
- Modify: `components/MiniCart.tsx:71,79` (display-domain subtotal + aria-label plural fix)
- Modify: `components/SessionTableBill.tsx:88` (same treatment)

- [ ] **Step 1: Rewrite lib/format.ts money section**

Replace `niceRound`, `prettyUsd`, `formatPrice`, `formatMoney` (lines 106-169) with:

```ts
import { niceUsd, displayAmount, minorRound } from "./money.mjs";

// Display step per currency: INR prices snap to ₹10 (owner's decision 2026-06-10);
// 2-decimal currencies keep cents. Tax/minor rounding uses MINOR (₹1 / 1 cent).
const STEP: Record<CurrencyCode, number> = { USD: 0.01, INR: 10, EUR: 0.01, AED: 0.01, SAR: 0.01, QAR: 0.01 };
const MINOR: Record<CurrencyCode, number> = { USD: 0.01, INR: 1, EUR: 0.01, AED: 0.01, SAR: 0.01, QAR: 0.01 };

// The "confident" USD unit price — single source of truth, mirrors the server's
// lfh_nice_usd (migration 029). Kept under its old export name for callers.
export const prettyUsd = (price: string | number): number => niceUsd(price);

// USD -> guest currency as a NUMBER, snapped to the currency's step.
// All bill math must happen on these numbers so what's summed is what's shown.
export const toDisplay = (usd: string | number, currency?: CurrencyMeta): number => {
  const cur = currency || getCurrency();
  return displayAmount(usd, cur.rate, STEP[cur.code]);
};

// Round an already-display-domain amount (e.g. tax) to the currency's minor unit.
export const toMinor = (amount: number, currency?: CurrencyMeta): number => {
  const cur = currency || getCurrency();
  return minorRound(amount, MINOR[cur.code]);
};

// Format an already-display-domain NUMBER with symbol + separators. No rounding
// here beyond decimals — the number must already be snapped by toDisplay/toMinor.
export const formatAmount = (amount: number, currency?: CurrencyMeta): string => {
  const cur = currency || getCurrency();
  const formatted = (Number.isFinite(amount) ? amount : 0).toLocaleString("en-US", {
    minimumFractionDigits: cur.decimals,
    maximumFractionDigits: cur.decimals,
  });
  const tight = cur.symbol.length === 1;
  return tight ? `${cur.symbol}${formatted}` : `${cur.symbol} ${formatted}`;
};

// Menu/dish PRICE: confident USD -> converted -> snapped -> formatted.
export const formatPrice = (price: string | number, currency?: CurrencyMeta): string =>
  formatAmount(toDisplay(prettyUsd(price), currency), currency);

// Bill-line money: a USD number (already includes add-ons) -> converted -> snapped.
// Same snapping as formatPrice, so a dish NEVER shows two different prices.
export const formatMoney = (price: string | number, currency?: CurrencyMeta): string =>
  formatAmount(toDisplay(price, currency), currency);
```

- [ ] **Step 2: Fix the modal's raw-USD unit (the ₹546 vs ₹545 bug)**

`components/OrderConfirmModal.tsx:123` — change:

```ts
const unit = parseFloat(item.price) + chosen.reduce((s, c) => s + c.price, 0);
```
to:
```ts
// Base price goes through prettyUsd so the modal's number matches the menu
// card / dish page exactly (the old raw parseFloat was the ₹546-vs-₹545 bug).
const unit = prettyUsd(item.price) + chosen.reduce((s, c) => s + c.price, 0);
```
(import `prettyUsd` from `@/lib/format`; `fmt` at :111 already uses `formatMoney`, which now snaps identically.)

- [ ] **Step 3: CartPanel bill math in display-domain**

In `components/CartPanel.tsx` find the subtotal/tax/total computation (the totals shown near :286 and used around :510-540). Replace USD-domain sums + `formatMoney` rendering with display-domain math (complete pattern — adapt variable names to what's there):

```ts
import { toDisplay, toMinor, formatAmount, getCurrency } from "@/lib/format";

// Every line is converted+snapped FIRST, then summed, so the printed lines
// visibly add up to the printed subtotal in every currency.
const cur = currency || getCurrency();
const lineAmounts = cart.map((it) => toDisplay(parseFloat(it.price), cur) * it.qty);
const subtotalDisp = lineAmounts.reduce((s, n) => s + n, 0);
const taxDisp = toMinor(subtotalDisp * 0.05, cur);  // 5% tax in the guest's minor unit
const totalDisp = subtotalDisp + taxDisp;
```

Render each line with `formatAmount(lineAmounts[i], cur)`, subtotal `formatAmount(subtotalDisp, cur)`, tax `formatAmount(taxDisp, cur)`, total `formatAmount(totalDisp, cur)`. Also apply to the "Goes well with" upsell price: it must use `formatPrice(suggestedItem.price, cur)` (the ₹419-vs-₹402 bug came from formatting it differently).

- [ ] **Step 4: MiniCart + SessionTableBill**

`components/MiniCart.tsx` — subtotal becomes display-domain and the aria-label pluralizes:
```ts
// subtotal state holds USD; convert+snap per line for display
const price = currency ? formatAmount(cart.reduce((s, it) => s + toDisplay(parseFloat(it.price), currency) * it.qty, 0), currency) : "";
```
(The component currently keeps a `subtotal` USD number in state — either keep cart lines in state or compute on `lfh:cart-updated`; smallest change wins.)
Line 79: `` aria-label={`View bill — ${count} item${count !== 1 ? "s" : ""}, ${price}`} ``

`components/SessionTableBill.tsx:88` — same display-domain treatment as CartPanel Step 3 for whatever totals it formats.

- [ ] **Step 5: Type-check + unit tests**

Run: `npx tsc --noEmit` → exit 0. Run: `npm run test:money` → PASS.

- [ ] **Step 6: Browser verification (the actual acceptance test)**

Dev server on :4000, phone viewport. For ONE dish (avocado-and-cream-cheese, INR):
menu card price = dish page price = customize-modal base+total = bill line = viewer price strip, all multiples of ₹10; bill lines sum to subtotal; tax = 5% in whole ₹; mini bar says "1 item".

- [ ] **Step 7: Commit**

```bash
git add lib/format.ts components/OrderConfirmModal.tsx components/CartPanel.tsx components/MiniCart.tsx components/SessionTableBill.tsx
git commit -m "fix(pricing): one rounding path everywhere — INR nearest 10, bills add up"
```

---

### Task 3: Reviews backend (migration 030 + seed change)

**Files:**
- Create: `supabase/migrations/030_real_reviews.sql`
- Modify: `scripts/seed-supabase.mjs:95` (stop seeding fake reviews)

- [ ] **Step 1: Write migration 030**

```sql
-- 030_real_reviews.sql — real customer ratings replace the fake seeded ones.
-- Reviews are written ONLY through the SECURITY DEFINER function below
-- (same pattern as lfh_place_order_public in 029): the table has no public
-- INSERT policy, so the function's validation can't be bypassed.

CREATE TABLE IF NOT EXISTS reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_slug   text NOT NULL,
  device_id   text NOT NULL,             -- per-browser UUID; 1 live rating per device per dish
  name        text,                      -- optional display name ("Guest" if blank)
  stars       int  NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment     text CHECK (char_length(comment) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_slug, device_id)          -- re-rating UPDATES instead of stacking
);
CREATE INDEX IF NOT EXISTS reviews_item_idx ON reviews(item_slug);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read_reviews" ON reviews;
CREATE POLICY "public_read_reviews" ON reviews FOR SELECT USING (true);
-- (no INSERT/UPDATE policy on purpose — writes go through the function)

CREATE OR REPLACE FUNCTION lfh_submit_review(
  p_slug text, p_device text, p_stars int, p_name text, p_comment text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_stars IS NULL OR p_stars < 1 OR p_stars > 5 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_stars');
  END IF;
  IF p_device IS NULL OR length(p_device) < 8 OR length(p_device) > 64 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_device');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM menu_items WHERE slug = p_slug) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_such_item');
  END IF;
  INSERT INTO reviews(item_slug, device_id, name, stars, comment)
  VALUES (
    p_slug, p_device,
    left(coalesce(nullif(trim(p_name), ''), 'Guest'), 40),
    p_stars,
    left(nullif(trim(p_comment), ''), 500)
  )
  ON CONFLICT (item_slug, device_id)
  DO UPDATE SET stars = EXCLUDED.stars, name = EXCLUDED.name,
                comment = EXCLUDED.comment, created_at = now();
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION lfh_submit_review(text, text, int, text, text) FROM public;
GRANT EXECUTE ON FUNCTION lfh_submit_review(text, text, int, text, text) TO anon, authenticated;

-- One aggregate the menu card AND the dish page both read — they can never disagree.
CREATE OR REPLACE VIEW item_ratings WITH (security_invoker = true) AS
  SELECT item_slug,
         round(avg(stars)::numeric, 1) AS avg_rating,
         count(*)::int AS review_count
  FROM reviews GROUP BY item_slug;
GRANT SELECT ON item_ratings TO anon, authenticated;

-- Wipe the fake seeded reviews and the invented per-dish rating numbers.
UPDATE menu_items SET reviews = '[]'::jsonb, rating = NULL;
```

- [ ] **Step 2: Stop the seed from restoring fakes**

`scripts/seed-supabase.mjs:95` — delete (or comment out) the `reviews: item.reviews` mapping line so future re-seeds never write fake reviews again. Add the why: `// reviews intentionally NOT seeded — real ones live in the reviews table (migration 030)`.

- [ ] **Step 3: Apply to the live DB**

Run: `node scripts/seed-supabase.mjs` (runs all migrations incl. 030, re-upserts items, verifies anon read; uses the rotated PAT from .env.local — output is safe but NEVER print the env file).
Expected: script reports success; then verify via the read-only Supabase MCP: `SELECT count(*) FROM reviews;` → 0, and `SELECT reviews FROM menu_items LIMIT 1;` → `[]`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/030_real_reviews.sql scripts/seed-supabase.mjs
git commit -m "feat(reviews): real reviews table + RPC, fake seed wiped (migration 030)"
```

---

### Task 4: Data layer — ratings/reviews in lib/menu.ts + device id

**Files:**
- Create: `lib/device.ts`
- Modify: `lib/menu.ts` (MenuItem type, getMenuItems, getMenuItem, new submitReview)

- [ ] **Step 1: lib/device.ts**

```ts
"use client";

// A stable anonymous id for this browser, used to allow exactly one live
// rating per dish per device (owner chose "anyone can rate" — this is the
// light spam brake). Falls back to a throwaway id if storage is blocked.
export const getDeviceId = (): string => {
  try {
    const KEY = "lfh_device_id";
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return `anon-${Math.random().toString(36).slice(2, 12)}`;
  }
};
```

- [ ] **Step 2: lib/menu.ts changes**

Type: on `MenuItem`, change `rating: string` semantics — add fields:
```ts
rating: string;        // now: "" when no real reviews (was a fake seed number)
reviewCount: number;   // real count from item_ratings (0 = show "New")
```
In `getMenuItems()`: after fetching `menu_items`, also `const { data: ratings } = await supabase.from("item_ratings").select("*");` and merge by slug:
```ts
const rmap = new Map((ratings || []).map((r) => [r.item_slug, r]));
// ...inside the row mapping:
rating: rmap.get(row.slug)?.avg_rating?.toString() ?? "",
reviewCount: rmap.get(row.slug)?.review_count ?? 0,
```
In `getMenuItem(slug)`: same aggregate merge PLUS fetch the visible list:
```ts
const { data: revs } = await supabase
  .from("reviews")
  .select("name, stars, comment, created_at")
  .eq("item_slug", slug)
  .order("created_at", { ascending: false })
  .limit(20);
// map to the UI's existing shape { name, rating, text }:
reviews: (revs || []).map((r) => ({ name: r.name || "Guest", rating: r.stars, text: r.comment || "" })),
```
New export:
```ts
// Save (or update) this device's rating for a dish. Server validates everything.
export async function submitReview(slug: string, deviceId: string, stars: number, name: string, comment: string) {
  const { data, error } = await supabase.rpc("lfh_submit_review", {
    p_slug: slug, p_device: deviceId, p_stars: stars, p_name: name, p_comment: comment,
  });
  if (error) return { ok: false as const, reason: error.message };
  return data as { ok: boolean; reason?: string };
}
```

- [ ] **Step 3: Type-check** — `npx tsc --noEmit` will FAIL at `FoodCard.tsx`/`ItemClient.tsx` if they still assume old fields; that's Task 5's job. If it fails ONLY there, proceed; otherwise fix menu.ts.

- [ ] **Step 4: Commit**

```bash
git add lib/device.ts lib/menu.ts
git commit -m "feat(reviews): data layer — aggregates, review list, submit RPC, device id"
```

---

### Task 5: UI — real ratings, "New" badge, working Rate Dish

**Files:**
- Modify: `components/FoodCard.tsx:206`
- Modify: `app/item/[slug]/ItemClient.tsx` (:401-418 submitReview, :449-454 rating calc, :585-600 header stars, :717 review count)
- Modify: `lib/i18n.ts` (new `newDish` label, 6 languages)
- Modify: `app/globals.css` (badge style)

- [ ] **Step 1: i18n key** — in every language object in `lib/i18n.ts` add `newDish`: en `"New"`, fr `"Nouveau"`, de `"Neu"`, ar `"جديد"`, hi `"नया"`, ko `"신메뉴"`. (Follow the file's existing key style.)

- [ ] **Step 2: FoodCard rating** — replace line 206 `{item.rating || "4.8"} ★`:

```tsx
{item.reviewCount > 0 ? (
  <>{item.rating} ★ • </>
) : (
  <span className="new-dish-badge">{t.newDish}</span>
)}
```
(If FoodCard doesn't already use `useLanguage()`, import it the same way ItemClient does. Keep the `• 3-5 min` part rendering after either branch.)

- [ ] **Step 3: Badge style** — `app/globals.css`:

```css
/* Small pill shown on dishes that have no real reviews yet. */
.new-dish-badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--accent);
  border: 1px solid var(--accent);
  opacity: 0.85;
}
```

- [ ] **Step 4: ItemClient rating + submit**

Rating calc (:449-454) becomes (localReviews now starts as the REAL list from the DB):
```tsx
const rating = localReviews.length > 0
  ? localReviews.reduce((sum, r) => sum + r.rating, 0) / localReviews.length
  : 0;
const reviewCount = localReviews.length;
```
Header stars row (:585-600): when `reviewCount === 0`, render `<span className="new-dish-badge">{t.newDish}</span>` instead of the stars + number + "(N reviews)".

`submitReview` (:401-418) becomes async + persistent (name now OPTIONAL — drop it from the validation):
```tsx
const submitReview = async () => {
  if (!reviewText.trim() || selectedRating === 0) {
    window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "Almost there", subtitle: "add a note & star rating", kicker: "review", variant: "error" } }));
    return;
  }
  // Save to the database (one live rating per device per dish; re-rating updates).
  const res = await submitReviewRpc(item!.id, getDeviceId(), selectedRating, reviewName.trim(), reviewText.trim());
  if (!res.ok) {
    window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "Couldn't save review", subtitle: "please try again", kicker: "review", variant: "error" } }));
    return;
  }
  // Show it immediately (replace this device's previous review if there was one).
  const mine = { name: reviewName.trim() || "Guest", rating: selectedRating, text: reviewText.trim() };
  setLocalReviews([mine, ...localReviews]);
  setReviewName(""); setReviewText(""); setSelectedRating(0);
  window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "Review posted", subtitle: "thanks for sharing", kicker: "review", variant: "success" } }));
};
```
Imports: `import { submitReview as submitReviewRpc } from "@/lib/menu";` and `import { getDeviceId } from "@/lib/device";`. NOTE: `item.id` vs slug — pass whatever `lfh_submit_review` expects: the SLUG. Check what `item.id` holds in lib/menu.ts mapping (if id ≠ slug, use the slug field).
Name input placeholder (:732) → `placeholder={`${t.yourName} (optional)`}` or equivalent existing-style label.

- [ ] **Step 5: Verify** — `npx tsc --noEmit` exit 0. Browser: dish page shows "New" (DB now empty of reviews); submit a 5★ review → toast, appears in list; reload → still there (DB!); menu card for that dish now shows "5.0 ★"; a second submit from the same browser UPDATES instead of duplicating. Card and detail page show the same number.

- [ ] **Step 6: Commit**

```bash
git add components/FoodCard.tsx app/item/[slug]/ItemClient.tsx lib/i18n.ts app/globals.css
git commit -m "feat(reviews): real averaged ratings in UI, New badge, persistent Rate Dish"
```

---

### Task 6: Remove the "3D PREVIEW UNAVAILABLE" banner

**Files:**
- Modify: `app/item/[slug]/ItemClient.tsx:690-699`

- [ ] **Step 1: Delete the else-branch** — replace lines 690-699 with:

```tsx
{/* Show the 3D button only when a model actually exists; dishes without
    one simply don't mention 3D at all (no greyed-out "unavailable" button). */}
{item.is4d && item.modelFolder && (
  <button id="view-3d-btn" className="btn btn-cyan" onClick={goToViewer}>
    <i className="fas fa-cube"></i> {t.viewIn3D}
  </button>
)}
```

- [ ] **Step 2: Verify** — Espresso (no 3D): no banner, ADD TO CART centers nicely. Avocado croissant: VIEW IN 3D still there and works.

- [ ] **Step 3: Commit**

```bash
git add app/item/[slug]/ItemClient.tsx
git commit -m "feat(item): drop the 3D-unavailable banner — absence over apology"
```

---

### Task 7: Two-step add-to-order confirmation

**Files:**
- Modify: `components/OrderConfirmModal.tsx` (success step inside the dialog)
- Modify: `components/FoodCard.tsx:129-155` (quick-add toast gets a tap-to-open-bill)
- Modify: `components/ToastHost.tsx` (support `detail.event` → dispatch on tap)

- [ ] **Step 1: Success step in the modal**

Add state `const [added, setAdded] = useState<{ qty: number; title: string } | null>(null);`.
In `confirm()` (:149-198): on success, for NEW adds replace the toast + `setOpen(false)` (lines 191-192) with:
```tsx
if (editSig) {
  // Editing from the bill: the bill is already open — keep the quick toast there.
  window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: `${item.title} updated`, kicker: "your order" } }));
  setOpen(false);
} else {
  setAdded({ qty, title: item.title }); // flip the dialog to its success step
}
```
At the top of the JSX (after the `if (!open || !item) return null;` guard), render the success step INSTEAD of the form when `added` is set:
```tsx
if (added) {
  return (
    <>
      <div className="overlay active" onClick={() => { setAdded(null); setOpen(false); }} />
      <div role="dialog" aria-modal="true" aria-label="Added to your bill" className="order-confirm order-confirm-done">
        <div className="done-check" aria-hidden="true">✓</div>
        <h3 className="done-title">Added to your bill</h3>
        <p className="done-line">{added.qty} × {added.title}</p>
        <div className="done-actions">
          <button type="button" className="btn-cancel" onClick={() => { setAdded(null); setOpen(false); }}>
            Keep browsing
          </button>
          <button type="button" className="btn-confirm" onClick={() => { setAdded(null); setOpen(false); window.dispatchEvent(new Event("lfh:open-cart")); }}>
            View bill
          </button>
        </div>
      </div>
    </>
  );
}
```
Auto-dismiss: `useEffect(() => { if (!added) return; const tm = setTimeout(() => { setAdded(null); setOpen(false); }, 4000); return () => clearTimeout(tm); }, [added]);`
Reset `added` to null whenever a new `lfh:open-order-confirm` arrives (in the existing open handler).
Style (`app/globals.css`): reuse the modal's button classes; add:
```css
.order-confirm-done { text-align: center; padding: 32px 24px; }
.order-confirm-done .done-check { width: 56px; height: 56px; margin: 0 auto 12px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 28px; color: #fff; background: var(--accent); }
.order-confirm-done .done-actions { display: flex; gap: 12px; justify-content: center; margin-top: 20px; }
```

- [ ] **Step 2: Quick-add toast becomes actionable**

`components/ToastHost.tsx`: where a toast with `href` navigates on tap, also support `detail.event`: if set, tapping the toast does `window.dispatchEvent(new Event(detail.event))` instead of navigating. (Find the click handler; add the branch with a comment.)
`components/FoodCard.tsx:153` quick-add toast becomes:
```ts
window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: `${item.title} added`, subtitle: "tap to view your bill", kicker: "your order", event: "lfh:open-cart" } }));
```

- [ ] **Step 3: Verify all four paths (phone viewport)**

(a) menu "+" quick-add → toast, tapping it opens the bill; (b) menu customize → modal → ADD → success step → View bill opens bill; (c) dish page ADD TO CART → same; (d) 3D viewer Add to Order → same success step (modal is shared). Success step auto-closes after ~4s.

- [ ] **Step 4: Commit**

```bash
git add components/OrderConfirmModal.tsx components/FoodCard.tsx components/ToastHost.tsx app/globals.css
git commit -m "feat(cart): two-step add confirmation — success sheet with View bill"
```

---

### Task 8: Full verification + ship

- [ ] **Step 1:** `npx tsc --noEmit` → 0. `npm run test:money` → PASS. `npm run lint` → clean (or no new warnings).
- [ ] **Step 2:** `node scripts/verify-cache.mjs` → PASS (3D caching untouched). NOTE: it visits `/item/gourmet-burger` and expects no unexpected toasts on the happy path — our changes add no toast there.
- [ ] **Step 3:** Chrome MCP phone walkthrough: price-equality checklist (Task 2 Step 6), review round-trip (Task 5 Step 5), no 3D banner, confirmation sheet from all four paths, dark mode sanity screenshot.
- [ ] **Step 4:** Run the work-checker agent on the full diff; fix anything it flags.
- [ ] **Step 5:** Push: `git push origin main` (root repo only — `editor/` untouched this round). Watch the Vercel deploy go READY, then spot-check ONE price and the review flow on production.
