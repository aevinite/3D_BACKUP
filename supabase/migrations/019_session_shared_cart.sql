-- v2: SHARED CART across a dining session. The pre-order cart used to live only
-- in each device's localStorage. Now the session carries the canonical cart, so
-- the head and every approved member at the table build ONE order together and
-- see each other's changes live.
--
-- The guest app still keeps the cart in localStorage (so every existing cart
-- component works unchanged); a sync component mirrors it to/from these two RPCs.
-- Only an APPROVED member of an OPEN session may write; any member may read.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cart            JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cart_updated_at TIMESTAMPTZ;

-- ── read the session's shared cart (any non-removed member) ────────────────
CREATE OR REPLACE FUNCTION lfh_get_cart(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m session_members; v_s sessions;
BEGIN
  SELECT * INTO v_m FROM session_members WHERE token = p_token AND NOT removed;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'invalid_token'); END IF;
  SELECT * INTO v_s FROM sessions WHERE id = v_m.session_id;
  RETURN json_build_object(
    'ok', true,
    'open', v_s.status = 'open',
    'approved', v_m.approved,
    'cart', COALESCE(v_s.cart, '[]'::jsonb),
    'cart_updated_at', v_s.cart_updated_at);
END; $$;

-- ── write the session's shared cart (approved member, open session only) ───
CREATE OR REPLACE FUNCTION lfh_set_cart(p_token text, p_cart jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m session_members; v_s sessions; v_ts timestamptz;
BEGIN
  SELECT * INTO v_m FROM session_members WHERE token = p_token AND NOT removed;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'invalid_token'); END IF;
  SELECT * INTO v_s FROM sessions WHERE id = v_m.session_id;
  IF v_s.status <> 'open' THEN RETURN json_build_object('ok', false, 'reason', 'session_closed'); END IF;
  IF NOT v_m.approved THEN RETURN json_build_object('ok', false, 'reason', 'not_approved'); END IF;
  v_ts := NOW();
  UPDATE sessions SET cart = COALESCE(p_cart, '[]'::jsonb), cart_updated_at = v_ts, last_activity_at = v_ts
    WHERE id = v_s.id;
  RETURN json_build_object('ok', true, 'cart_updated_at', v_ts);
END; $$;

GRANT EXECUTE ON FUNCTION lfh_get_cart(text)        TO anon;
GRANT EXECUTE ON FUNCTION lfh_set_cart(text, jsonb) TO anon;

NOTIFY pgrst, 'reload schema';
