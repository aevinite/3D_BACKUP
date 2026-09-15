-- 030_real_reviews.sql — real customer ratings replace the fake seeded ones.
-- Reviews are written ONLY through the SECURITY DEFINER function below
-- (same pattern as lfh_place_order_public in 029): the table has no public
-- INSERT policy, so the function's validation can't be bypassed.

CREATE TABLE IF NOT EXISTS reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_slug   text NOT NULL,
  device_id   text NOT NULL,             -- per-browser UUID; 1 live rating per device per dish
  name        text,                      -- optional display name ("Guest" if blank)
  stars       int  NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment     text CHECK (char_length(comment) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_slug, device_id)          -- re-rating UPDATES instead of stacking
);
CREATE INDEX IF NOT EXISTS reviews_item_idx ON reviews(item_slug);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read_reviews" ON reviews;
CREATE POLICY "public_read_reviews" ON reviews FOR SELECT USING (true);
-- (no INSERT/UPDATE policy on purpose — writes go through the function)

CREATE OR REPLACE FUNCTION lfh_submit_review(
  p_slug text, p_device text, p_stars int, p_name text, p_comment text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Validate everything server-side; the client is never trusted.
  IF p_stars IS NULL OR p_stars < 1 OR p_stars > 5 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_stars');
  END IF;
  IF p_device IS NULL OR length(p_device) < 8 OR length(p_device) > 64 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_device');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM menu_items WHERE slug = p_slug) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_such_item');
  END IF;
  -- Upsert: a device re-rating a dish replaces its previous rating.
  INSERT INTO reviews(item_slug, device_id, name, stars, comment)
  VALUES (
    p_slug, p_device,
    left(coalesce(nullif(trim(p_name), ''), 'Guest'), 40),
    p_stars,
    left(nullif(trim(p_comment), ''), 500)
  )
  ON CONFLICT (item_slug, device_id)
  DO UPDATE SET stars = EXCLUDED.stars, name = EXCLUDED.name,
                comment = EXCLUDED.comment, created_at = now();
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION lfh_submit_review(text, text, int, text, text) FROM public;
GRANT EXECUTE ON FUNCTION lfh_submit_review(text, text, int, text, text) TO anon, authenticated;

-- One aggregate the menu card AND the dish page both read — they can never disagree.
CREATE OR REPLACE VIEW item_ratings WITH (security_invoker = true) AS
  SELECT item_slug,
         round(avg(stars)::numeric, 1) AS avg_rating,
         count(*)::int AS review_count
  FROM reviews GROUP BY item_slug;
GRANT SELECT ON item_ratings TO anon, authenticated;

-- Wipe the fake seeded reviews and the invented per-dish rating numbers.
--
-- ⚠️ RUN-ALONE GUARD (sweep #9, T29, 2026-09-15). Both columns are GONE: migration 359
-- ("a rating is given, not typed") dropped `menu_items.rating` and `menu_items.reviews`, because
-- a real rating has lived in the `reviews` table and the `item_ratings` view since this very file.
-- A bare UPDATE naming them therefore raises `column "reviews" does not exist` on any database
-- that has reached 359 — which is every live one — so `node scripts/run-migration.mjs
-- 030_real_reviews.sql`, the single-file workflow CLAUDE.md recommends, ABORTS here rather than
-- no-ops. (A full re-seed was always fine: migration 001 creates both columns, this file empties
-- them, 359 drops them.)
--
-- The write is now conditional on the columns still being there, so the file lands in the same
-- state on both kinds of database: on a fresh seed it still wipes the seeded fakes, and on a
-- database past 359 it does nothing at all. Same shape as migration 043's `to_regprocedure` gate
-- — EXECUTE so PostgreSQL only PLANS the statement once the answer is yes.
DO $wipe_seeded_reviews$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'menu_items' AND column_name = 'reviews'
  ) THEN
    EXECUTE $wipe$ UPDATE menu_items SET reviews = '[]'::jsonb $wipe$;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'menu_items' AND column_name = 'rating'
  ) THEN
    EXECUTE $wipe$ UPDATE menu_items SET rating = NULL $wipe$;
  END IF;
END $wipe_seeded_reviews$;
