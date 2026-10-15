-- 422_two_saves_of_one_thing_take_turns.sql — sweep #10 T12 round 2, item 10 (owner's yes, 2026-10-15).
--
-- WHERE: backend only. What a person would notice: two waiters changing the SAME dish at the same moment
-- — the second one is now told "Someone else changed the quantity while you had it open … Your change was
-- NOT saved", instead of silently replacing the first.
--
-- WHY. The panels' "first save wins, loser told" gate (lib/clash.ts expectClash) READS the row and compares
-- it with what the screen was editing from; the handler WRITES afterwards, in a separate request to the
-- database. Two saves arriving in the same instant both read the old value, both pass, and the later write
-- quietly replaces the earlier one — measured on the dev floor: two tablets asking qty 1 → 2 and 1 → 3 at
-- once were BOTH answered 200, and the dish ended at 2 with nobody told.
--
-- THE FIX: a save that carries an expectation first takes a short TURN on the row it names. A second save
-- of the same row waits until the first has finished, then makes its comparison against the value the
-- first one wrote — so it is refused, exactly as if it had arrived a second later. A turn is released the
-- moment its request ends, and is taken over after p_ttl_ms if a request died holding it, so a crash can
-- never lock a row. A turn is keyed per restaurant + table + row, never per field.
--
-- Server-only: the table has row-level security on and NO policy, no grant to the public key; both
-- functions are SECURITY DEFINER and executable by service_role alone. Idempotent; rewrites no data.
CREATE TABLE IF NOT EXISTS public.edit_turns (
  turn_key      text PRIMARY KEY,
  restaurant_id uuid NOT NULL,
  token         uuid NOT NULL,
  taken_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.edit_turns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.edit_turns FROM PUBLIC, anon, authenticated;

-- Take the turn (true) or learn that someone else holds it (false). One statement, so two callers can
-- never both win: the INSERT either creates the row, or the conflicting UPDATE fires only when the
-- holder is older than the time-to-live — and RETURNING says whose token is in the row now.
CREATE OR REPLACE FUNCTION public.lfh_edit_turn_take(p_key text, p_rid uuid, p_token uuid, p_ttl_ms integer DEFAULT 8000)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_holder uuid;
BEGIN
  IF p_key IS NULL OR p_rid IS NULL OR p_token IS NULL THEN RETURN false; END IF;
  -- Housekeeping, cheap and bounded: turns abandoned for over a minute by a request that died.
  DELETE FROM public.edit_turns WHERE taken_at < now() - interval '1 minute' AND turn_key <> p_key;
  INSERT INTO public.edit_turns AS t (turn_key, restaurant_id, token, taken_at)
  VALUES (p_key, p_rid, p_token, now())
  ON CONFLICT (turn_key) DO UPDATE
    SET token = EXCLUDED.token, restaurant_id = EXCLUDED.restaurant_id, taken_at = now()
    WHERE t.taken_at < now() - make_interval(secs => greatest(coalesce(p_ttl_ms, 8000), 1000) / 1000.0)
  RETURNING t.token INTO v_holder;
  RETURN v_holder IS NOT DISTINCT FROM p_token;
END;
$$;

-- Give the turn back. Only the holder's own token releases it, so a late release from a request whose
-- turn was already taken over cannot free somebody else's.
CREATE OR REPLACE FUNCTION public.lfh_edit_turn_release(p_key text, p_token uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.edit_turns WHERE turn_key = p_key AND token = p_token;
$$;

REVOKE ALL ON FUNCTION public.lfh_edit_turn_take(text, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lfh_edit_turn_release(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_edit_turn_take(text, uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.lfh_edit_turn_release(text, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
