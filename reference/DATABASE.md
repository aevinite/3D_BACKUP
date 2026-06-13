# Database reference — frozen snapshot (2026-06-13)

This is the live Supabase schema at the moment we froze the old version, captured
so the unified rewrite can be built against the exact same backend. The rewrite
**reuses this same database** — do not recreate it; just point the new app at it.

Source of truth for DDL stays `supabase/migrations/*.sql` (also copied under
`reference/code-snapshot/supabase/`). This file is the quick human-readable map.

## Tables (public schema)

### settings  — one row, id = 'site' (global config + feature flags)
| column | type | null | default |
|---|---|---|---|
| id | text | NO | |
| bubbles_enabled | boolean | NO | true |
| updated_at | timestamptz | NO | now() |
| service_mode | boolean | NO | false |
| table_count | integer | NO | 12 |
| sessions_enabled | boolean | NO | false |
| require_location | boolean | NO | true |
| require_otp | boolean | NO | true |
| geo_lat | double precision | YES | |
| geo_lng | double precision | YES | |
| geo_radius_m | integer | NO | 250 |
| features | jsonb | NO | '{}' |
| gstin | text | YES | |
| tax_rate | numeric | YES | |
| tax_inclusive | boolean | YES | |
| invoice_prefix | text | YES | |

### sessions  — a table's dining session (open/closed = "is this table busy")
| column | type | null | default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| table_number | text | NO | |
| status | text | NO | 'pending' |
| auto_approve | boolean | NO | false |
| opened_by | text | YES | |
| opened_at | timestamptz | YES | |
| closed_at | timestamptz | YES | |
| last_activity_at | timestamptz | NO | now() |
| created_at | timestamptz | NO | now() |
| cart | jsonb | NO | '[]' |
| cart_updated_at | timestamptz | YES | |
| bill_no | integer | YES | |
| invoice_no | integer | YES | |

### session_members  — people seated in a session
| column | type | null | default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| session_id | uuid | NO | |
| phone | text | YES | |
| phone_verified | boolean | NO | false |
| name | text | YES | |
| token | text | NO | |
| role | text | NO | 'guest' |
| approved | boolean | NO | false |
| location_ok | boolean | NO | false |
| removed | boolean | NO | false |
| joined_at | timestamptz | NO | now() |

### orders  — a placed order / bill (the money record)
| column | type | null | default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| table_number | text | YES | |
| items | jsonb | NO | |
| subtotal | numeric | NO | 0 |
| tax | numeric | NO | 0 |
| total | numeric | NO | 0 |
| allergies | text[] | NO | '{}' |
| created_at | timestamptz | NO | now() |
| status | text | NO | 'received'  (received→preparing→served→cancelled) |
| payment_status | text | NO | 'pending'  (pending/paid) |
| archived | boolean | NO | false  (true = cleared off the floor) |
| session_id | uuid | YES | |
| member_id | uuid | YES | |
| kot_no | integer | YES | |
| discount | numeric | NO | 0 |
| discount_note | text | YES | |

### order_items  — per-line items of a session order
| column | type | null | default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| order_id | uuid | NO | |
| session_id | uuid | YES | |
| title | text | NO | |
| qty | integer | NO | 1 |
| unit_price | numeric | NO | 0 |
| options | jsonb | YES | |
| removed | text[] | NO | '{}' |
| note | text | YES | |
| status | text | NO | 'received' |
| served_at | timestamptz | YES | |
| created_at | timestamptz | NO | now() |

### menu_items  — the dishes
id(text), slug, title, price(text), image, category, veg(bool), is4d(bool),
model_folder, model_small_url, model_optimized_url, description, long_description,
rating(text), time(text), nutrition(jsonb), ingredients(jsonb), reviews(jsonb),
related_slugs(jsonb), sort_order(int), created_at, tags(text[]), allergens(text[]),
search_alias(text), options(jsonb), dish_no(int).

### categories  — slug, name(jsonb 6-lang), icon, color, sort_order, active, created_at
### filters  — slug, name(jsonb), icon, sort_order, active, created_at
### customers  — phone(PK), name, blocked, first_seen_at, last_seen_at
### feedback  — id, order_id, table_number, rating(int), comment, name, created_at
### reviews  — id, item_slug, device_id, name, stars(int), comment, created_at
### item_ratings  — (view-like) item_slug, avg_rating, review_count
### waiter_calls  — id, table_number, note, resolved, created_at, session_id, member_id
### requests  — id, table_number, session_id, type, name, phone, status('pending'), created_at
### blocklist  — id, phone, table_number, member_id, reason, blocked_at
### daily_counters  — key, day(date), n  (per-day KOT/bill numbering)
### seq_counters  — key, n  (running sequences)

### BACKEND-ONLY (feature-flagged OFF, plumbing only)
- **otp_codes** — id, phone, code, expires_at, attempts, consumed, created_at
- **verification_codes** — id, contact, channel, code, purpose('order'), expires_at, used, created_at
- **payments** — id, order_id, session_id, amount, currency('INR'), method, status, gateway_ref, created_at
- **aggregator_orders** — id, source, external_id, payload(jsonb), status('received'), order_id, created_at

## RPC functions (public schema)

Guest/anon-facing (called from the menu, via the anon key):
`lfh_open_session`, `lfh_join_session`, `lfh_leave_session`, `lfh_get_cart`,
`lfh_set_cart`, `lfh_place_order_public`, `lfh_session_state`, `lfh_table_status`,
`lfh_call_waiter`, `lfh_request`, `lfh_leave_feedback`, `lfh_recognize_customer`,
`lfh_send_otp`, `lfh_verify_otp`, `lfh_request_verification`, `lfh_check_verification`,
`lfh_geo_ok`, `lfh_is_blocked`, `lfh_nice_usd`, `get_order_status`.

Staff/service-role only (REVOKEd from anon — see migration 038):
`lfh_approve_member`, `lfh_remove_member`, `lfh_set_auto_approve`, `lfh_place_order`,
`lfh_price_order`.

Triggers: `assign_dish_no`, `lfh_assign_bill`, `lfh_assign_bill_on_order`,
`lfh_assign_kot`, `lfh_session_close_cleanup`, `lfh_session_delete_cleanup`,
`set_order_table_number`.

> NOTE for the rewrite: `lfh_table_status` and `lfh_session_state` already exist —
> these are the natural foundation for the **single source of truth** for floor
> state that every panel must read (fixes the "one screen says busy, another says
> free" bug). Verify/extend these rather than re-deriving table state in each panel.
