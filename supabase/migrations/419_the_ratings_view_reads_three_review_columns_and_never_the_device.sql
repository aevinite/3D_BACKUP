-- 419 · the ratings view reads three review columns — and never the device (sweep #10 T30 round 4,
--      item 29, 2026-10-10; a REGRESSION of item 16 / mig 418, caught the same day)
--
-- WHAT WENT WRONG. Mig 418 took the guest keys' read of public.reviews away so no page could pull every
-- reviewer's device id. But public.item_ratings — the view that gives every dish card on the guest
-- menu its stars and its review count — is `security_invoker = true` (it runs with the ASKING key's
-- rights, on purpose), so the moment the guest key lost the table, the guest key lost the view: every
-- dish card's rating vanished and the dish page fell back to counting the 20 reviews it had fetched.
-- The database checks did not see it because they run with the server key; reading the screenshot of
-- the dish page ("20 reviews" on a dish with 28) did.
--
-- WHAT. Give the guest and signed-in keys back EXACTLY the three columns the view reads — the dish,
-- the stars and the restaurant — and nothing else: not the device id (the point of mig 418), not the
-- name or the comment (those reach a page only through lfh_dish_reviews). A column grant needs a row
-- policy as well under row-level security; it says what it is for.

GRANT SELECT (item_slug, stars, restaurant_id) ON public.reviews TO anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reviews' AND policyname = 'guest_reads_ratings_columns_only') THEN
    CREATE POLICY guest_reads_ratings_columns_only ON public.reviews FOR SELECT TO anon, authenticated USING (true);
  END IF;
END $$;

COMMENT ON POLICY guest_reads_ratings_columns_only ON public.reviews IS
  'Lets the item_ratings view (security_invoker) count and average reviews for the guest menu. The guest keys hold SELECT on item_slug, stars and restaurant_id ONLY — never device_id, name or comment (mig 418/419).';

NOTIFY pgrst, 'reload schema';
