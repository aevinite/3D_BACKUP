-- 378_one_name_everywhere_for_a_guest.sql
--
-- ONE NAME, EVERYWHERE (owner, 2026-09-02):
--   "if you add name in review it will save as there name … when name ask again in review what will
--    name will be autofill there and there they add diff name the reviews name will be change to
--    again added name … so like everywhere there wil be 1 name … second time review will also have
--    that name"
--
-- Today a diner types a name in three unrelated places — the review box on a dish page, the
-- "what should we call you" screen when they open or join a table, and the name asked before a
-- waiter is called — and none of them knows about the others. So one person can be three different
-- people to the same restaurant on the same evening, and the floor sees "Someone" next to a review
-- signed "Mia".
--
-- The phone now keeps ONE name and fills it in everywhere (lib/guestName.ts). This function is the
-- one part that cannot live on the phone: reviews they have ALREADY left carry the old name, and he
-- was explicit that changing the name must change those too.
--
-- WHY THIS IS SAFE TO CALL WITHOUT A LOGIN, and why it is narrower than it looks:
--   * It can only ever touch rows whose `device_id` the caller already holds — that id is generated
--     by, and stored on, that browser. It is the same key `lfh_submit_review` already requires to
--     write a review at all, so this grants no reach the review path did not already have.
--   * It changes ONE column, `name`, on rows that device wrote itself. It cannot touch the stars,
--     the comment, the dish, the date, or anybody else's row.
--   * It is scoped to one restaurant, so a name given at one café never rewrites a review left at
--     another (the tenant rule, and the same scoping mig 304 added to the unban request).
--   * It is not a way to discover anything: it returns a count of the caller's OWN rows and nothing
--     else, and an unknown device simply updates nothing and answers 0.
--
-- A blank name is a DELETE of the name, not an error: `getItemReviews` already renders a missing
-- name as "Guest", so clearing it puts the review back to anonymous, which is the honest meaning of
-- clearing the box.

CREATE OR REPLACE FUNCTION lfh_rename_my_reviews(
  p_device text,
  p_restaurant_id uuid,
  p_name text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name text;
  v_n    int;
BEGIN
  -- The same device-id shape lfh_submit_review insists on, so this cannot be called with a stub.
  IF p_device IS NULL OR length(p_device) < 8 OR length(p_device) > 64 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_device');
  END IF;
  IF p_restaurant_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_restaurant');
  END IF;
  -- Trimmed, capped at 40 to match every name box in the guest app, and an empty string means
  -- "no name" rather than a review signed with a space.
  v_name := NULLIF(btrim(COALESCE(p_name, '')), '');
  IF v_name IS NOT NULL AND length(v_name) > 40 THEN
    v_name := substr(v_name, 1, 40);
  END IF;

  UPDATE reviews
     SET name = v_name
   WHERE device_id = p_device
     AND restaurant_id = p_restaurant_id
     AND name IS DISTINCT FROM v_name;      -- a no-op rename writes no row and wakes no breadcrumb
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'renamed', v_n);
END; $$;

-- The guest app calls this with the public menu key, exactly like lfh_submit_review beside it.
-- Stated explicitly rather than left to Supabase's default, which is the lesson migrations 038 and
-- 267 both record: a function's grant must be a decision somebody wrote down.
REVOKE ALL ON FUNCTION lfh_rename_my_reviews(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lfh_rename_my_reviews(text, uuid, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
