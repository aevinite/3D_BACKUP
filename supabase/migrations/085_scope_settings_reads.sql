-- 085_scope_settings_reads.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Phase 1c (final settings-read sweep): make every RPC read the CORRECT
-- restaurant's settings row. `settings` became one-row-per-restaurant in 079
-- (UNIQUE (restaurant_id)), but a handful of RPCs still read the singleton with
-- `WHERE id = 'site'` — that text PK only ever matches restaurant #1's row, so a
-- SECOND restaurant would wrongly inherit #1's require_otp / sessions_enabled /
-- table_count / geofence / gst / retention etc.
--
-- The earlier scoping passes already fixed most settings reads in their LATEST
-- definitions:
--   • lfh_floor_state()  → 081 reads `WHERE restaurant_id = v_rid`   (done)
--   • lfh_geo_ok(...)    → 083 reads `WHERE restaurant_id = COALESCE(p_…,#1)` (done)
-- The OTP/order helpers that read settings were re-derived in 084 — EXCEPT one
-- line that slipped through: lfh_place_order still read `require_otp` from the
-- `id='site'` singleton even though it had ALREADY derived v_rid from the
-- session. That is the bug this migration closes.
--
-- This migration changes EXACTLY ONE settings read, in ONE function, with a
-- plain `CREATE OR REPLACE` — signature, SECURITY DEFINER, SET search_path,
-- return type and grants all unchanged (no DROP, no new param, no re-grant). The
-- function body below is reproduced VERBATIM from 084 with the SINGLE settings
-- read swapped from `WHERE id = 'site'` to `WHERE restaurant_id = v_rid`, where
-- v_rid is the session-derived restaurant already in scope two lines above.
--
-- ── DELIBERATELY LEFT UNSCOPED (cannot be fixed by a settings-read swap) ──────
-- Three functions still read `features->>… / retention FROM settings WHERE
-- id='site'` in their LATEST definition, but have NO per-call restaurant context
-- (no p_restaurant_id, no token, no order, no session) — and adding a param is
-- out of scope here. They are reported, NOT guessed:
--   • lfh_request_verification(text,text) / lfh_check_verification(text,text)
--       (040) — dormant BACKEND-ONLY verification gate (feature OFF by default,
--       hidden from every UI). Their only inputs are a raw contact + channel/code,
--       neither of which carries a restaurant. Scoping them needs a per-restaurant
--       parameter, a separate decision.
--   • lfh_prune_logs() (053) — a service_role-only pg_cron housekeeping job with
--       NO arguments that DELETEs aged rows across the whole DB. Reading one
--       restaurant's retention is wrong, but the correct fix is to LOOP over
--       restaurants applying each one's retention — a redesign, not a read swap.
-- ─────────────────────────────────────────────────────────────────────────

-- ── place a SESSION order (029) — derive restaurant from the session ────────
-- Reproduced verbatim from 084. The ONLY change vs 084: the require_otp read now
-- targets THIS session's restaurant (`WHERE restaurant_id = v_rid`) instead of
-- the `id='site'` singleton, so a 2nd restaurant honours ITS OWN require_otp.
-- v_rid is COALESCEd to #1, so behaviour on the single live restaurant is
-- byte-for-byte identical to today.
CREATE OR REPLACE FUNCTION lfh_place_order(p_token text, p_items jsonb, p_allergies text[])
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m session_members; v_s sessions; v_order uuid; v_item jsonb; v_req_otp boolean; v_priced jsonb;
        v_rid uuid;
BEGIN
  SELECT * INTO v_m FROM session_members WHERE token = p_token AND NOT removed;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'invalid_token'); END IF;
  SELECT * INTO v_s FROM sessions WHERE id = v_m.session_id;
  IF v_s.status <> 'open' THEN RETURN json_build_object('ok', false, 'reason', 'session_closed'); END IF;
  IF NOT v_m.approved THEN RETURN json_build_object('ok', false, 'reason', 'not_approved'); END IF;
  -- DERIVE the restaurant from the session this token belongs to (NOT the #1 default).
  v_rid := COALESCE(v_s.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  IF lfh_is_blocked(v_m.phone, v_s.table_number, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  SELECT require_otp INTO v_req_otp FROM settings WHERE restaurant_id = v_rid;
  IF COALESCE(v_req_otp, true) AND NOT v_m.phone_verified THEN
    RETURN json_build_object('ok', false, 'reason', 'otp_required');
  END IF;

  -- SERVER prices the order. If a line is unknown/sold-out, bail with that reason.
  v_priced := lfh_price_order(p_items);
  IF NOT (v_priced->>'ok')::boolean THEN RETURN v_priced::json; END IF;

  INSERT INTO orders(table_number, items, subtotal, tax, total, allergies, status, session_id, member_id, restaurant_id)
    VALUES (v_s.table_number, v_priced->'items',
            (v_priced->>'subtotal')::numeric, (v_priced->>'tax')::numeric, (v_priced->>'total')::numeric,
            COALESCE(p_allergies, '{}'), 'received', v_s.id, v_m.id, v_rid)
    RETURNING id INTO v_order;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_priced->'items') LOOP
    INSERT INTO order_items(order_id, session_id, title, qty, unit_price, options, removed, note, restaurant_id)
      VALUES (v_order, v_s.id,
        COALESCE(v_item->>'title', ''),
        COALESCE((v_item->>'qty')::int, 1),
        COALESCE((v_item->>'price')::numeric, 0),
        v_item->'options',
        CASE WHEN jsonb_typeof(v_item->'removed') = 'array'
             THEN COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(v_item->'removed') x), '{}')
             ELSE '{}' END,
        v_item->>'note', v_rid);
  END LOOP;

  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_s.id;
  RETURN json_build_object('ok', true, 'order_id', v_order);
END; $$;

-- Grants are intentionally NOT touched: plain CREATE OR REPLACE keeps the
-- existing anon EXECUTE privilege from 015 / 029. This is a guest RPC — it must
-- stay reachable by guests.

NOTIFY pgrst, 'reload schema';
