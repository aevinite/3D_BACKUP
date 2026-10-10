-- 418 · a dish page learns which review is MINE — never every reviewer's device id
--      (sweep #10 T30 round 4, item 16, 2026-10-10, the owner's yes)
--
-- WHY. The guest menu read public.reviews directly with the public key (lib/menu.ts getItemReviews,
-- `select name, stars, comment, device_id, created_at`), under a `USING (true)` read policy. It needed
-- the device id for ONE thing: when a diner re-rates a dish, drop their own older review from the list
-- on screen. To do that it was handed the device id of every reviewer of every dish — a random id, not
-- a name or a phone, but an identifier the page never needed to see.
--
-- WHAT. One read function that answers the question the page actually asks: the newest 20 reviews of a
-- dish, each with `mine` — true only for the device the caller says it is. The device id itself never
-- leaves the database. Then the public and signed-in keys lose their direct read of the table (the
-- policy goes with it — a read policy with no grant does nothing, and leaving it is a trap).
-- Writes were already a function (lfh_submit_review / lfh_rename_my_reviews); nothing else in the app
-- reads this table with a public key (the owner and manager screens read it on the server).
--
-- RELEASE NOTE: this and the code that calls lfh_dish_reviews travel together — a stack given this
-- migration without the new lib/menu.ts would show no reviews (never wrong ones).

CREATE OR REPLACE FUNCTION public.lfh_dish_reviews(p_slug text, p_restaurant_id uuid, p_device text DEFAULT NULL)
RETURNS TABLE (name text, stars integer, comment text, created_at timestamptz, mine boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT r.name::text, r.stars::integer, r.comment::text, r.created_at,
         (p_device IS NOT NULL AND p_device <> '' AND r.device_id = p_device) AS mine
    FROM public.reviews r
   WHERE r.item_slug = p_slug AND r.restaurant_id = p_restaurant_id
   ORDER BY r.created_at DESC
   LIMIT 20;
$$;

COMMENT ON FUNCTION public.lfh_dish_reviews(text, uuid, text) IS
  'The newest 20 reviews of one dish at one restaurant, each marked mine for the caller''s own device — never a device id. Mig 418.';

-- A new function is PUBLIC-executable by default; say exactly who may run it (mig 038 / 267 lesson).
REVOKE ALL ON FUNCTION public.lfh_dish_reviews(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lfh_dish_reviews(text, uuid, text) TO anon, authenticated, service_role;

-- The direct read goes.
DROP POLICY IF EXISTS public_read_reviews ON public.reviews;
REVOKE SELECT ON public.reviews FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
