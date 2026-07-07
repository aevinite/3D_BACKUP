-- Shared-cart CONCURRENCY fix (audit 2026-07-07).
--
-- The problem: lfh_set_cart (migration 019) OVERWRITES the whole session cart
-- (UPDATE sessions SET cart = p_cart). When two approved diners at the same table
-- add a dish within ~1s of each other — before one device has pulled the other's
-- change — the second write clobbers the first, and a dish silently disappears
-- before the order is placed (last-writer-wins on the whole array).
--
-- The fix: a MERGE RPC that takes only the CHANGE this device made (a delta:
-- lines added / removed / quantity-set), computed by the client against the last
-- state it synced, and applies that delta to the CURRENT server cart under a row
-- lock. So a concurrent add from another device is preserved, a remove still
-- sticks, and line order is kept. It returns the merged cart so the caller adopts
-- everyone's changes immediately.
--
-- Line identity matches the client's lineKey: id || '__' || coalesce(sig,'[]')
-- (the same dish with different options/allergy/note is a separate line).
--
-- Same guardrails as lfh_set_cart: SECURITY DEFINER, token-gated to an APPROVED
-- member of an OPEN session, granted to anon (guest-facing, but token-scoped).

CREATE OR REPLACE FUNCTION lfh_merge_cart(
  p_token   text,
  p_added   jsonb DEFAULT '[]'::jsonb,   -- whole lines this device newly added
  p_removed jsonb DEFAULT '[]'::jsonb,   -- {id, sig} of lines this device removed
  p_qty     jsonb DEFAULT '[]'::jsonb    -- {id, sig, qty} absolute qty this device set
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_m           session_members;
  v_s           sessions;
  v_cart        jsonb;
  v_ts          timestamptz;
  v_line        jsonb;
  v_key         text;
  v_removed_keys text[] := '{}';
  v_qty_map     jsonb := '{}'::jsonb;   -- key -> new absolute qty
  v_order       text[] := '{}';          -- keys in display order
  v_lines       jsonb := '{}'::jsonb;    -- key -> line object
  v_result      jsonb := '[]'::jsonb;
  v_k           text;
BEGIN
  -- Token must belong to a non-removed member.
  SELECT * INTO v_m FROM session_members WHERE token = p_token AND NOT removed;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'invalid_token'); END IF;

  -- Lock the session row so concurrent merges from different devices serialize
  -- (this is what actually prevents the lost update — each merge sees the prior
  -- one's result). FOR UPDATE blocks until the other transaction commits.
  SELECT * INTO v_s FROM sessions WHERE id = v_m.session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'invalid_token'); END IF;
  IF v_s.status <> 'open' THEN RETURN json_build_object('ok', false, 'reason', 'session_closed'); END IF;
  IF NOT v_m.approved THEN RETURN json_build_object('ok', false, 'reason', 'not_approved'); END IF;

  v_cart := COALESCE(v_s.cart, '[]'::jsonb);
  IF jsonb_typeof(v_cart) <> 'array' THEN v_cart := '[]'::jsonb; END IF;

  -- Index the removed keys.
  SELECT COALESCE(array_agg((e->>'id') || '__' || COALESCE(e->>'sig','[]')), '{}')
    INTO v_removed_keys
    FROM jsonb_array_elements(p_removed) e;

  -- Index the qty changes (absolute, clamped 1..99).
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_qty) AS t(value) LOOP
    v_key := (v_line->>'id') || '__' || COALESCE(v_line->>'sig','[]');
    v_qty_map := v_qty_map || jsonb_build_object(
      v_key, to_jsonb(LEAST(99, GREATEST(1, COALESCE((v_line->>'qty')::int, 1)))));
  END LOOP;

  -- Walk the CURRENT server cart in order: drop removed lines, apply qty sets,
  -- keep everything else (including lines other devices added that this device
  -- never knew about — that's the whole point).
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_cart) AS t(value) LOOP
    v_key := (v_line->>'id') || '__' || COALESCE(v_line->>'sig','[]');
    IF v_key = ANY(v_removed_keys) THEN CONTINUE; END IF;
    IF v_qty_map ? v_key THEN v_line := jsonb_set(v_line, '{qty}', v_qty_map->v_key); END IF;
    IF NOT (v_key = ANY(v_order)) THEN v_order := array_append(v_order, v_key); END IF;
    v_lines := v_lines || jsonb_build_object(v_key, v_line);
  END LOOP;

  -- Apply the added lines. If the same line already exists (both devices added it
  -- at once), SUM the quantities (capped at 99) so neither add is lost; otherwise
  -- append it at the end.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_added) AS t(value) LOOP
    v_key := (v_line->>'id') || '__' || COALESCE(v_line->>'sig','[]');
    IF v_key = ANY(v_removed_keys) THEN CONTINUE; END IF;
    IF v_lines ? v_key THEN
      v_lines := v_lines || jsonb_build_object(v_key, jsonb_set(
        v_lines->v_key, '{qty}',
        to_jsonb(LEAST(99, COALESCE((v_lines->v_key->>'qty')::int, 0)
                          + COALESCE((v_line->>'qty')::int, 1)))));
    ELSE
      v_line := jsonb_set(v_line, '{qty}',
        to_jsonb(LEAST(99, GREATEST(1, COALESCE((v_line->>'qty')::int, 1)))));
      v_order := array_append(v_order, v_key);
      v_lines := v_lines || jsonb_build_object(v_key, v_line);
    END IF;
  END LOOP;

  -- Rebuild the array in display order.
  FOREACH v_k IN ARRAY v_order LOOP
    v_result := v_result || jsonb_build_array(v_lines->v_k);
  END LOOP;

  v_ts := NOW();
  UPDATE sessions SET cart = v_result, cart_updated_at = v_ts, last_activity_at = v_ts
    WHERE id = v_s.id;

  RETURN json_build_object('ok', true, 'cart', v_result, 'cart_updated_at', v_ts);
END; $$;

-- Guest-facing but token-scoped, exactly like lfh_set_cart.
REVOKE ALL ON FUNCTION lfh_merge_cart(text, jsonb, jsonb, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION lfh_merge_cart(text, jsonb, jsonb, jsonb) TO anon;

NOTIFY pgrst, 'reload schema';
