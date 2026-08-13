-- Let a guest set/update the name on their OWN table membership, token-scoped
-- (owner, 2026-06-13). The order-confirm step asks the guest's name; this writes
-- it to session_members.name so it shows on the bill and the kitchen/editor, and
-- so staff can block by a real name. Token-scoped + SECURITY DEFINER: a guest can
-- only ever rename their own membership, never someone else's.

CREATE OR REPLACE FUNCTION lfh_set_member_name(p_token text, p_name text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_token IS NULL OR length(p_token) < 8 THEN
    RETURN json_build_object('ok', false, 'reason', 'bad_token');
  END IF;
  UPDATE session_members
     SET name = NULLIF(trim(p_name), '')
   WHERE token = p_token AND removed = false
   RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'no_member');
  END IF;
  RETURN json_build_object('ok', true);
END; $$;

GRANT EXECUTE ON FUNCTION lfh_set_member_name(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
