# Phase 0 — Tenancy Core (multi-tenant foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the database multi-tenant-*capable* — add a `restaurants` table, stamp every tenant-scoped row with `restaurant_id`, make ticket/bill/invoice counters per-restaurant — **without changing any user-visible behaviour**, because everything defaults to restaurant #1 (the existing "My Little French House").

**Architecture:** One shared Postgres (pool model). A new `restaurants` table is the tenant root. Every tenant table gets a `restaurant_id uuid NOT NULL DEFAULT '<#1>' REFERENCES restaurants(id)`. The `DEFAULT` backfills existing rows and lets every current INSERT/RPC keep working untouched (they implicitly write #1). Counters move from `(key,day)` / `(key)` to `(restaurant_id,key,day)` / `(restaurant_id,key)`. App code is NOT rewritten in Phase 0 — only a `DEFAULT_RESTAURANT_ID` constant is introduced for Phase 1 to build on. Per-URL resolution, per-restaurant reads, and realtime topic scoping are **Phase 1**.

**Tech Stack:** Supabase Postgres (migrations applied via the Management API `/v1/projects/{ref}/database/query`), Next.js 16 / TypeScript. Migrations live in `supabase/migrations/NNN_*.sql`; next number is **078**.

**Non-negotiable safety principle:** This migration is **purely additive and non-breaking**. Success = the live menu, ordering, KOT numbering, and sessions all behave exactly as before, while every row now carries `restaurant_id = #1`. We apply + verify on a **dev database first**, never on live until reviewed.

---

## File Structure

- **Create:** `supabase/migrations/078_tenancy_core.sql` — the entire Phase 0 schema change (one idempotent migration).
- **Create:** `lib/tenant.ts` — exports `DEFAULT_RESTAURANT_ID` (the fixed #1 UUID) + a `resolveRestaurantId()` stub for Phase 1. One tiny, focused file.
- **Create:** `scripts/verify-phase0.mjs` — applies (optional) + runs read-only verification queries proving the schema is correct and #1 data is intact.
- **Modify:** none of the runtime app code in Phase 0. (Deliberate — keeps behaviour identical.)

**Fixed constant used everywhere:** `DEFAULT_RESTAURANT_ID = '00000000-0000-0000-0000-000000000001'`.

---

### Task 1: Write migration 078 — `restaurants` table + seed restaurant #1

**Files:**
- Create: `supabase/migrations/078_tenancy_core.sql`

- [ ] **Step 1: Create the file with the tenant root table + seed**

```sql
-- 078_tenancy_core.sql
-- Phase 0: multi-tenant FOUNDATION. Purely additive & non-breaking.
-- Every tenant row defaults to restaurant #1, so the live app is unchanged.

-- ─────────────────────────────────────────────────────────────
-- 1. Tenant root table
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS restaurants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text UNIQUE NOT NULL,
  name          text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  subdomain     text UNIQUE,         -- reserved for Phase 1+ subdomain routing
  custom_domain text UNIQUE,         -- reserved for white-label domains
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_read_restaurants ON restaurants;
CREATE POLICY public_read_restaurants ON restaurants FOR SELECT USING (true);

-- Seed restaurant #1 with a FIXED id so all DEFAULT references resolve.
INSERT INTO restaurants (id, slug, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'french-house', 'My Little French House')
ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 2: Verify (after Task 7 applies it)** — `SELECT id, slug FROM restaurants;` returns exactly the #1 row. Anon can read it (public policy mirrors `menu_items`).

---

### Task 2: Add `restaurant_id` to every tenant-scoped table (additive, default #1)

**Files:**
- Modify: `supabase/migrations/078_tenancy_core.sql` (append)

Tenant-scoped tables: `menu_items, categories, filters, settings, orders, order_items, sessions, session_members, waiter_calls, requests, blocklist, customers, reviews, feedback, otp_codes, verification_codes, payments, aggregator_orders, staff_users, staff_actions, realtime_events`.

- [ ] **Step 1: Append the column + FK + index for each table**

```sql
-- ─────────────────────────────────────────────────────────────
-- 2. restaurant_id on every tenant-scoped table.
--    NOT NULL DEFAULT #1 backfills existing rows AND lets every
--    current INSERT/RPC keep working without modification.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'menu_items','categories','filters','settings','orders','order_items',
    'sessions','session_members','waiter_calls','requests','blocklist',
    'customers','reviews','feedback','otp_codes','verification_codes',
    'payments','aggregator_orders','staff_users','staff_actions','realtime_events'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    -- add the column only if the table exists and the column doesn't
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS restaurant_id uuid '
        || 'NOT NULL DEFAULT ''00000000-0000-0000-0000-000000000001''',
        t);
      -- FK to restaurants(id); guarded so re-runs don't duplicate it
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = format('%s_restaurant_fk', t)
      ) THEN
        EXECUTE format(
          'ALTER TABLE public.%I ADD CONSTRAINT %I '
          || 'FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id)',
          t, format('%s_restaurant_fk', t));
      END IF;
      -- index leading with restaurant_id (every tenant query filters on it)
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON public.%I (restaurant_id)',
        format('idx_%s_restaurant', t), t);
    END IF;
  END LOOP;
END $$;
```

- [ ] **Step 2: Verify (after apply)** — every table reports the column and zero NULLs:

```sql
SELECT table_name FROM information_schema.columns
WHERE column_name='restaurant_id' AND table_schema='public' ORDER BY 1;
-- expect all 21 tenant tables listed
SELECT count(*) FROM orders WHERE restaurant_id IS NULL;  -- expect 0
```

---

### Task 3: Make natural keys unique *per restaurant* (so two restaurants can share a slug/table)

**Files:**
- Modify: `supabase/migrations/078_tenancy_core.sql` (append)

Today `menu_items.slug`, `categories.slug` (PK), `filters.slug` (PK), `customers.phone` (PK), `reviews(item_slug,device_id)`, and `aggregator_orders(source,external_id)` are globally unique. Two restaurants must be able to each have a "burgers" category or a "table 1". `menu_items.id`, `sessions.id`, `orders.id`, `session_members.token`, `feedback.order_id` stay globally unique (UUIDs / app-generated) and need no change.

- [ ] **Step 1: Append the key changes (each guarded for idempotency)**

```sql
-- ─────────────────────────────────────────────────────────────
-- 3. Per-restaurant uniqueness on natural keys.
-- ─────────────────────────────────────────────────────────────
-- menu_items: slug unique per restaurant (keep id as global PK)
ALTER TABLE menu_items DROP CONSTRAINT IF EXISTS menu_items_slug_key;
ALTER TABLE menu_items DROP CONSTRAINT IF EXISTS menu_items_restaurant_slug_key;
ALTER TABLE menu_items ADD  CONSTRAINT menu_items_restaurant_slug_key UNIQUE (restaurant_id, slug);

-- categories: PK becomes (restaurant_id, slug)
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_pkey;
ALTER TABLE categories ADD  PRIMARY KEY (restaurant_id, slug);

-- filters: PK becomes (restaurant_id, slug)
ALTER TABLE filters DROP CONSTRAINT IF EXISTS filters_pkey;
ALTER TABLE filters ADD  PRIMARY KEY (restaurant_id, slug);

-- customers: PK becomes (restaurant_id, phone)
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_pkey;
ALTER TABLE customers ADD  PRIMARY KEY (restaurant_id, phone);

-- reviews: one review per (restaurant, dish, device)
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_item_slug_device_id_key;
ALTER TABLE reviews ADD  CONSTRAINT reviews_restaurant_item_device_key UNIQUE (restaurant_id, item_slug, device_id);

-- aggregator_orders: external id unique per restaurant+source
ALTER TABLE aggregator_orders DROP CONSTRAINT IF EXISTS aggregator_orders_source_external_id_key;
ALTER TABLE aggregator_orders ADD  CONSTRAINT aggregator_orders_restaurant_source_ext_key UNIQUE (restaurant_id, source, external_id);

-- settings: one row per restaurant (the existing id='site' row keeps id, gains uniqueness on restaurant_id)
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_restaurant_id_key;
ALTER TABLE settings ADD  CONSTRAINT settings_restaurant_id_key UNIQUE (restaurant_id);
```

- [ ] **Step 2: Verify** — these must NOT error on a DB that only has #1 data (no duplicates exist). After apply: `\d categories` shows PK `(restaurant_id, slug)`. Equivalent check:

```sql
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid='categories'::regclass AND contype='p';
-- expect PRIMARY KEY (restaurant_id, slug)
```

---

### Task 4: Per-restaurant counters (KOT / bill / invoice)

**Files:**
- Modify: `supabase/migrations/078_tenancy_core.sql` (append)

`daily_counters` PK `(key,day)` → `(restaurant_id,key,day)`; `seq_counters` PK `(key)` → `(restaurant_id,key)`. The counter functions gain a `restaurant_id` argument. The trigger functions `lfh_assign_kot` / `lfh_assign_bill` (and any direct callers) pass `NEW.restaurant_id`.

- [ ] **Step 1: Append counter table + function changes**

```sql
-- ─────────────────────────────────────────────────────────────
-- 4. Per-restaurant counters.
-- ─────────────────────────────────────────────────────────────
-- daily_counters: PK (restaurant_id, key, day). restaurant_id already added in Task 2.
ALTER TABLE daily_counters DROP CONSTRAINT IF EXISTS daily_counters_pkey;
ALTER TABLE daily_counters ADD  PRIMARY KEY (restaurant_id, key, day);

-- seq_counters: PK (restaurant_id, key).
ALTER TABLE seq_counters DROP CONSTRAINT IF EXISTS seq_counters_pkey;
ALTER TABLE seq_counters ADD  PRIMARY KEY (restaurant_id, key);

-- New signatures (restaurant-scoped). Keep the 05:00 IST business-day rollover.
CREATE OR REPLACE FUNCTION lfh_next_counter(p_rid uuid, p_key text)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_n int; v_day date;
BEGIN
  v_day := ((now() AT TIME ZONE 'Asia/Kolkata') - interval '5 hours')::date;
  INSERT INTO daily_counters(restaurant_id, key, day, n) VALUES (p_rid, p_key, v_day, 1)
    ON CONFLICT (restaurant_id, key, day) DO UPDATE SET n = daily_counters.n + 1
    RETURNING n INTO v_n;
  RETURN v_n;
END; $$;

CREATE OR REPLACE FUNCTION lfh_next_seq(p_rid uuid, p_key text)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_n int;
BEGIN
  INSERT INTO seq_counters(restaurant_id, key, n) VALUES (p_rid, p_key, 1)
    ON CONFLICT (restaurant_id, key) DO UPDATE SET n = seq_counters.n + 1
    RETURNING n INTO v_n;
  RETURN v_n;
END; $$;

-- Drop the OLD single-arg signatures so nothing silently calls the wrong one.
DROP FUNCTION IF EXISTS lfh_next_counter(text);
DROP FUNCTION IF EXISTS lfh_next_seq(text);

REVOKE EXECUTE ON FUNCTION lfh_next_counter(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_next_counter(uuid, text) TO service_role;
REVOKE EXECUTE ON FUNCTION lfh_next_seq(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_next_seq(uuid, text) TO service_role;

-- Trigger functions now pass the row's restaurant_id.
CREATE OR REPLACE FUNCTION lfh_assign_kot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kot_no IS NULL THEN NEW.kot_no := lfh_next_counter(NEW.restaurant_id, 'kot'); END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION lfh_assign_bill() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.bill_no IS NULL THEN NEW.bill_no := lfh_next_counter(NEW.restaurant_id, 'bill'); END IF;
  RETURN NEW;
END; $$;
```

- [ ] **Step 2: Find & fix EVERY other caller of the counter functions** (so none break with the new signature)

Run: `grep -rn "lfh_next_counter\|lfh_next_seq\|lfh_assign_bill_on_order" supabase/migrations`
Expected callers to update if present: `lfh_assign_bill_on_order` (lazy bill assignment), `lfh_generate_invoice` (uses `lfh_next_seq`), `lfh_platform_insert` (platform KOT). For each found, append a `CREATE OR REPLACE` in 078 that passes the row's `restaurant_id` (e.g. `lfh_next_seq(v_rid, 'invoice')`, deriving `v_rid` from the session/order it operates on). **Quote the full updated body in the migration — no partial edits.**

- [ ] **Step 3: Verify** — KOT still increments per business day for #1:

```sql
SELECT lfh_next_counter('00000000-0000-0000-0000-000000000001','kot');  -- returns next int, no error
SELECT restaurant_id, key, day, n FROM daily_counters ORDER BY day DESC LIMIT 5;
```

---

### Task 5: `lib/tenant.ts` — the default-restaurant constant (Phase 1 builds on this)

**Files:**
- Create: `lib/tenant.ts`

- [ ] **Step 1: Write the file**

```ts
// lib/tenant.ts
// Single source of truth for tenant resolution.
// Phase 0: only the default restaurant exists; everything resolves to it.
// Phase 1: resolveRestaurantId() will read the URL slug / subdomain.

/** The seeded "restaurant #1" (My Little French House). Matches migration 078. */
export const DEFAULT_RESTAURANT_ID = "00000000-0000-0000-0000-000000000001";
export const DEFAULT_RESTAURANT_SLUG = "french-house";

/**
 * Resolve the active restaurant id. In Phase 0 this is always the default.
 * Phase 1 replaces the body with slug/subdomain resolution; callers don't change.
 */
export function resolveRestaurantId(_slug?: string | null): string {
  return DEFAULT_RESTAURANT_ID;
}
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit` (or `npm run lint`) passes with the new file. Nothing imports it yet, so behaviour is unchanged.

---

### Task 6: `scripts/verify-phase0.mjs` — read-only proof the foundation is correct

**Files:**
- Create: `scripts/verify-phase0.mjs`

- [ ] **Step 1: Write a script that runs the verification queries via the Management API** (same pattern as `scripts/seed-supabase.mjs` — read `.env.local`, POST to `/v1/projects/{ref}/database/query`; NEVER print secrets). It must assert:
  1. `restaurants` has exactly the #1 row.
  2. All 21 tenant tables have a `restaurant_id` column and **0** NULLs.
  3. `categories`/`filters` PK is `(restaurant_id, slug)`.
  4. `lfh_next_counter('<#1>','kot')` returns an int.
  5. A guest-shaped read still returns #1's menu: `SELECT count(*) FROM menu_items WHERE restaurant_id='<#1>'` equals total menu_items count.

```js
// scripts/verify-phase0.mjs  (skeleton — fill the asserts above)
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env.local","utf8")
  .split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0];
async function q(query){
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,
    {method:"POST",headers:{Authorization:`Bearer ${env.SUPABASE_ACCESS_TOKEN}`,"Content-Type":"application/json"},body:JSON.stringify({query})});
  if(!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json();
}
// ... run the 5 assertions, console.log PASS/FAIL per check, exit 1 on any FAIL.
```

- [ ] **Step 2: Verify** — `node scripts/verify-phase0.mjs` prints PASS for all 5 checks against the dev DB.

---

### Task 7: Apply 078 to the **dev** database (never live yet)

- [ ] **Step 1:** Confirm the target. If the owner provided a dev Supabase, point `.env.local`'s `SUPABASE_ACCESS_TOKEN` + `NEXT_PUBLIC_SUPABASE_URL` at it (or use a separate `.env.dev`). **Do NOT run against the live project.**
- [ ] **Step 2:** Apply only 078 (not a full reseed):

Run: `node -e "import('./scripts/applyMigration.mjs')"` *or* reuse `runSql` from `seed-supabase.mjs` to POST the contents of `078_tenancy_core.sql` once, then `NOTIFY pgrst, 'reload schema';`.
Expected: HTTP 200, no SQL error.
- [ ] **Step 3:** Run `node scripts/verify-phase0.mjs` → all PASS.

---

### Task 8: Smoke-test that the live behaviours are unchanged (on the branch + dev DB)

- [ ] **Step 1:** `npm run dev` (port 4000) pointed at the dev DB.
- [ ] **Step 2:** In Chrome MCP, load `/menu` → dishes render (now reading #1 rows). Place a test order → it succeeds and gets a KOT number. Open the kitchen/tablet panels → the order appears. Confirm a `reviews`/feedback write still works.
- [ ] **Step 3:** Confirm in SQL that the test order/session rows carry `restaurant_id = #1`. Expected: identical UX to production, every new row stamped #1.

---

### Task 9: Commit

- [ ] **Step 1: Commit the migration, the lib, the verify script, and the plan.**

```bash
git add supabase/migrations/078_tenancy_core.sql lib/tenant.ts scripts/verify-phase0.mjs docs/superpowers/plans/2026-06-25-phase0-tenancy-core.md
git commit -m "feat(saas): Phase 0 tenancy core — restaurants table + restaurant_id everywhere (defaults to #1, behaviour unchanged)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage (vs `docs/SAAS-ARCHITECTURE-PLAN.html` §2 + §9 Phase 0):**
- "shared DB, every row tagged `restaurant_id`" → Task 2 ✅
- "per-restaurant counters" → Task 4 ✅
- "restaurants table + migrate existing as #1" → Task 1 ✅
- "additive, default #1, behaviour unchanged" → DEFAULT on every column + Tasks 8 verify ✅
- "indexes on filtered column" → Task 2 adds `idx_<t>_restaurant` ✅
- RLS hardening of the public-read tables and **scoping the guest/staff RPCs** are intentionally **Phase 1** (they require the client to pass a real restaurant_id; in Phase 0 only #1 exists so unscoped reads are still correct). Flagged here so it isn't forgotten.

**2. Placeholder scan:** Task 4 Step 2 and Task 6 require discovering exact callers/asserts at execution time — these are explicit *actions with commands*, not vague placeholders. Acceptable, but the executor MUST quote full function bodies when updating counter callers.

**3. Type consistency:** `DEFAULT_RESTAURANT_ID` literal `'00000000-0000-0000-0000-000000000001'` is identical in Task 1 seed, Task 2 column defaults, and `lib/tenant.ts`. Counter functions are consistently `(uuid, text)` everywhere after Task 4.

**4. Risk notes:**
- The `DO $$ ... FOREACH` block (Task 2) only touches tables that exist and columns that don't — safe to re-run.
- Key changes (Task 3/4) assume **no duplicate natural keys exist** — true on a single-restaurant DB. If ever run on data that already has duplicates, they'd fail loudly (good — fail before corrupting).
- Applying to **dev first** (Task 7) is mandatory before live.
