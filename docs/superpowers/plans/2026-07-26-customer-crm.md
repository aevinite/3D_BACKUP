# Customer CRM — capture number at bill time, recognize repeat customers (2026-07-26)

**Owner request (voice, cleaned up):** staff (tablet/manager) take the customer's
name + mobile number while settling the bill — *only if the customer wants to give
it*. From then on we know when they're a repeat customer (visit count), we can greet
them by name, and we link the device(s) they used so a returning guest can be
recognized even before giving the number again. Stale device links expire after ~12
months. Owner asked "is this legal?" → yes, see Legality below. Build fully here
(cloud attempt stranded; branch `feat/customer-crm`, worktree
`.claude/worktrees/feat-customer-crm`, deps installed, next migration = **211**).

---

## 0. Legality (India DPDP Act 2023) — bake these in, they shape the design

- **Explicit opt-in consent**, never pre-ticked: a consent checkbox in the payment
  sheet, default UNCHECKED. No consent → nothing saved. Store `consent_at`.
- **Purpose limitation:** used only for visit recognition/greeting. No marketing
  blasts in v1; if ever added, that's a separate consent.
- **Right to erasure:** owner can DELETE a customer (row + devices + visit ledger)
  from /owner/customers.
- **Data minimisation / retention:** device links auto-pruned after 12 months
  (lazily, on write — no cron). Name+phone kept while the business relationship
  lasts (normal for a CRM), erasable on request.
- **Guest-facing greeting shows NAME ONLY, never the phone number.**

## 1. Current state (verified by code scan — file:line)

- `customers` table (mig `014_sessions_v2_schema.sql:36`, tenancy migs 078/079):
  PK **(restaurant_id, phone)**, `name`, `blocked`, `first_seen_at`,
  `last_seen_at`. **No visit count, no consent column.** RLS on, no public
  policies; written only via SECURITY DEFINER RPCs.
- Recognition RPC exists: `lfh_recognize_customer(p_phone, p_restaurant_id)` →
  `{known, name, blocked}` (migs 015 + 083; called in `lib/session.ts:144`).
- Owner page `/owner/customers` (`app/owner/customers/page.tsx` +
  `app/api/owner/customers/route.ts`): reads `customers`, READ-ONLY, money-free,
  gated by the existing admin **`customers` entitlement** (`entitledSubset`,
  route.ts:27). "Returning" is a weak heuristic (`last_seen_at − first_seen_at >
  60s`, route.ts:13) — replace with real visits.
- **Bill = SESSION-level** (bill_no/invoice_no live on `sessions`). Settle paths:
  - Tablet: `POST /tables/:t/pay` (`app/api/tablet/[...path]/route.ts:1098-1167`),
    body `{payment_method, payment_note}` or `{splits:[…]}`. Undo:
    `/tables/:t/unpay` (:1270). On-house :1196, khata :1226.
  - Manager (= editor panel): order-by-order `PATCH /orders/:id`
    (`app/api/editor/[...path]/route.ts:2458-2476`) driven by
    `payOrdersWithMethod` (`public/panels/editor/app.js:2566-2617`);
    split: `POST /tables/:t/pay-split` (route.ts:1736).
  - Both panels share a payment sheet **`openPaymentMethodModal`**
    (tablet app.js:1832-1890; editor app.js:2488-2558) — the natural slot for the
    customer fields (editor: between lines ~2513-2519; tablet: ~1855-1861).
    Name+phone input precedent: `openKhataPersonSheet` (tablet app.js:1941-1942).
- Guest identity during a session: `session_members` (name, phone, `device_id`
  — device added by ban system mig 077). Guest device_id already generated
  client-side (ban system) — REUSE it, don't invent a second id.
- `khata_customers` is a separate person-book (pay-later) — do NOT merge in v1.
- Parcel orders (`aggregator_orders.customer_name/phone`, mig 071) already carry
  name+phone.
- Migration numbering: 209 (platform) & 210 (QR) taken ⇒ **use 211**. Repo has
  duplicate-number collisions historically — check `ls` again right before writing.

## 2. Schema — migration `211_customer_crm.sql`

All additive (live-site safety rule). One file, sections in order:

1. **`customers` new columns:**
   `visits INTEGER NOT NULL DEFAULT 0`,
   `consent BOOLEAN NOT NULL DEFAULT false`,
   `consent_at TIMESTAMPTZ`.
   (Money-free page stays money-free — NO spend column.)
2. **`customer_visits` ledger** — makes visit counting idempotent & undoable:
   `restaurant_id uuid NOT NULL REFERENCES restaurants(id)`,
   `phone TEXT NOT NULL`, `session_id uuid NOT NULL UNIQUE`, `at TIMESTAMPTZ
   NOT NULL DEFAULT now()`, PK `(restaurant_id, phone, session_id)`; index
   `(restaurant_id, phone)`. `session_id UNIQUE` ⇒ settling twice can never
   double-count a visit (idempotent by construction).
3. **`customer_devices`** — device links with expiry:
   `restaurant_id uuid NOT NULL`, `phone TEXT NOT NULL`, `device_id TEXT NOT
   NULL`, `first_seen_at`/`last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
   PK `(restaurant_id, phone, device_id)`; **index `(restaurant_id, device_id,
   last_seen_at)`** (the greeting lookup path). RLS ON, no public policies.
4. **RPCs** (all `SECURITY DEFINER`, and per the mig-038 gotcha: `REVOKE FROM
   PUBLIC, anon, authenticated` + `GRANT TO service_role` — EXCEPT the one
   anon-callable greeting RPC):
   - `lfh_capture_customer(p_restaurant_id uuid, p_session_id uuid, p_phone
     text, p_name text, p_consent boolean)` → service_role only. If NOT
     p_consent: return early, save nothing. Else: normalize phone (digits,
     keep last 10–12); upsert `customers` (set name when non-empty, consent
     true, consent_at now(), bump last_seen_at); INSERT `customer_visits` ON
     CONFLICT (session_id) DO NOTHING; increment `customers.visits` ONLY when
     the ledger row was actually inserted; copy the session's
     `session_members.device_id`s (non-null, distinct) into `customer_devices`
     (upsert bumping last_seen_at); DELETE this phone's device rows with
     `last_seen_at < now() - interval '12 months'` (lazy retention). Returns
     `{visits, name}`.
   - `lfh_uncapture_customer(p_session_id uuid)` → service_role only. Delete
     the ledger row for that session; if one was deleted, decrement that
     customer's `visits` (floor 0). (Devices stay — the person still owns them.)
   - `lfh_greet_device(p_restaurant_id uuid, p_device_id text)` → **anon
     EXECUTE allowed** (guest menu calls it). Look up `customer_devices` row
     seen within 12 months, join `customers` where `consent AND NOT blocked`;
     return `{known boolean, name text, visits int}` — **NEVER the phone**.
     STABLE, single indexed lookup.
   - Extend `lfh_recognize_customer` to also return `visits` (edit the
     HIGHEST-numbered existing definition — mig-recreate gotcha: a later
     CREATE OR REPLACE from a stale copy silently reverts fixes).

## 3. Server endpoints

- **Capture (called once per bill, after a successful settle):** add
  `customer-capture` route in BOTH panel APIs (tablet + editor mirrors), body
  `{table, name, phone, consent}` → resolves the table's just-settled session
  (or accepts `session_id`), calls `lfh_capture_customer` via `supabaseAdmin`.
  Wrap with `withIdempotency(..., "<panel>")` (offline-queue rule) and send via
  the panels' `api()` helper so it carries `X-LFH-Action-Id`.
- **Recognize (staff, on phone blur):** `customer-recognize?phone=…` in both
  panel APIs → `lfh_recognize_customer` → `{known, name, visits, blocked}`.
  Explicit columns, one row — trivial egress.
- **Undo — server-side, no client change:** in tablet `/tables/:t/unpay`
  (route.ts:1270) and in editor `PATCH /orders/:id` when `payment_status` flips
  paid→unpaid (route.ts:2458) and editor's table-level unpay: call
  `lfh_uncapture_customer(session_id)`. Reversing the payment reverses the visit.
- **Owner erase:** `DELETE` handler in `app/api/owner/customers/route.ts`
  (body `{restaurant_id, phone}`) — scope through the EXISTING `ownerScope` +
  `entitledSubset("customers")`, delete customers row + customer_devices +
  customer_visits. Never trust client restaurant_id beyond the owner's own set.
- **Guest greeting:** `app/api/guest/greet/route.ts` (or extend existing guest
  config call) → `lfh_greet_device(rid, device_id)`. Tenant-resolved rid from
  the path slug, NOT from the client.
- **Parcel (stretch, only if trivially cheap):** parcel settle already has
  name+phone in `aggregator_orders` — call capture with consent=true only if
  the parcel form gains the same consent tick; otherwise SKIP in v1.

## 4. Panel UI (vanilla JS — remember app.js CACHE-BUST: bump the version query
     when editing `public/panels/*/app.js`, else /manager iframe serves stale)

- **`openPaymentMethodModal` (tablet + editor):** new optional section under the
  method grid — "📱 Save customer (optional)": phone input, name input, consent
  checkbox labelled plainly ("Customer agrees to save name & number to
  recognise their next visits"), default UNCHECKED. Phone blur → recognize →
  inline chip "✨ Repeat customer — visit #5 · Rishi" and auto-fill the name (and
  pre-tick nothing). Prefill phone/name from the session's `session_members`
  head if present. Resolve object gains `{custName, custPhone, custConsent}`;
  `payBillWithMethod` (tablet) / `payOrdersWithMethod` (editor) fire ONE
  `customer-capture` call after settle succeeds (fire-and-forget with toast on
  failure). Render the section ONLY when the restaurant's `customers`
  entitlement is on (panels' bootstrap/config already carries entitlements —
  verify the exact flag name at build time).
  Split-settle's dedicated screen: **v1 skips it** (deliberate; regular sheet
  covers it). Khata/pay-later: **excluded** — no money moved yet.
- **No new back-stack layer needed** (fields live inside the already-registered
  payment modal). If any NEW confirm dialog is added (owner delete), register it
  (`useBackClose` / `LFH_BACK.layer`).
- **Guest greeting (`/r/<slug>/menu`):** on menu mount, if a device_id exists in
  localStorage (ban-system id) AND no greeting cached this session: call the
  greet endpoint ONCE, `sessionStorage`-cache the answer (zero repeat egress),
  and show a small dismissible "Welcome back, {name} 👋" toast via the existing
  `lfh:toast` bus. Feature-gated by `useFeatures()`/entitlement; renders nothing
  when off or unknown.
- **Owner `/owner/customers`:** add **Visits** column (real count), a small
  consent dot (✓ consented), swap the 60s "returning" heuristic for
  `visits >= 2`, summary tile "Repeat customers" = count(visits ≥ 2) via cheap
  head-count, and a per-row **Delete (erase)** with confirm. Stays money-free.
  Keep 300-row cap + explicit columns. `asSuffix()` rule applies (owner pages).

## 5. Egress & cost discipline (non-negotiables applied)

- Every new query: scoped `.eq("restaurant_id", …)`, explicit column list,
  LIMIT; indexed lookups only (`customer_devices(restaurant_id, device_id,
  last_seen_at)`, ledger `(restaurant_id, phone)`).
- No new polling; no whole-board reads; greet = 1 tiny call per guest session
  (sessionStorage-cached); recognize = 1 call per staff phone-blur.
- No cron: device retention pruned lazily inside capture writes.
- Owner page keeps its existing single scoped read (+1 head-count).

## 6. Verification checklist (dev DB, worktree server on port 4001 — NOT 4000)

1. `node scripts/apply-migration.mjs supabase/migrations/211_customer_crm.sql`
   (dev DB `wnsfcizc…` — NEVER seed-supabase.mjs, it reverts editor data).
   Verify RPC grants: anon can call ONLY `lfh_greet_device`.
2. `npm run lint` / build green in the worktree.
3. Headless Playwright (chrome-devtools MCP hangs — use repo Playwright +
   pw-helper login), diag users, non-#1 restaurant included:
   - Tablet: settle a table entering name+number+consent → `customers` row
     (visits=1, consent_at set), ledger row, `customer_devices` row exists.
   - Settle idempotency: replay capture (same action id) → still visits=1.
   - Unpay → visits back to 0, ledger row gone. Re-settle → 1 again.
   - Same phone second session → visits=2; recognize chip shows "visit #2".
   - No consent ticked → NOTHING written.
   - Guest with same device_id reopens menu → "Welcome back" toast, name only.
   - Manager panel same capture flow (cache-busted app.js!).
   - Owner page: Visits column, repeat tile, delete erases all three tables.
   - ~390px phone width on the payment sheet + owner page.
   - Blocked customer: greet stays silent.
4. `verify-board-sig` untouched paths still pass; no new columns need rt_emit
   (customers isn't a live-board table; no realtime trigger in v1 — owner page
   is open-on-demand).

## 7. Ship ladder (owner rules)

1. PR from `feat/customer-crm` → review → **deploy-lock ritual** → merge to
   main → backup-1 (3-d-backup) auto-deploy → verify live (real settle loop).
2. backup-1 stays ahead; **AV live only after explicit owner yes** (ask with
   the ask-user-question tool): run mig 211 on AV DB `kclqk…`, scripted code
   copy, verify end-to-end there. backup-2 after.
3. Memory note + REQUESTS.md tick when verified everywhere.

## v1 deliberate exclusions (say them honestly)

- Split-settle's dedicated screen has no capture fields (regular sheet does).
- Khata & parcel flows don't feed the CRM yet.
- No marketing/export of numbers; no cross-restaurant sharing (phone is scoped
  per restaurant by PK — same person at two restaurants = two records, by design).
- Staff-side "greet at table-open" (tile greeting) — later; v1 greets in the
  payment sheet (recognize chip) + guest menu toast.
