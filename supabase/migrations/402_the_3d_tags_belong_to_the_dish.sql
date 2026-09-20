-- 402 — the 3D hotspot TAGS belong to the DISH ROW, not to a folder name
-- (owner, 2026-09-20: "where are the tags in 3D … they were the main look for 3D … after adding
--  it back NEVER remove them")
--
-- ═══ WHAT HE IS LOOKING AT ═══
--
-- The 3D screen (/view/<folder>) pins little labelled callout cards onto the model — "🥐 Croissant
-- / Rich in Carbs / Buttery & Flaky", a thin line drawn from the card to the point on the dish it
-- names. They are the signature of this product's 3D viewer.
--
-- They come from `public/content/items/<folder>/config.json`, a file checked into the repo. That
-- directory holds exactly TWO folders — Croissant and Waffle — and they are restaurant #1's own
-- legacy demo dishes.
--
-- ═══ WHY THEY VANISHED (measured, not guessed) ═══
--
-- The route is /view/<folder>, and `model_folder` is whatever an owner typed into the editor. A
-- second restaurant that also called its croissant folder "Croissant" scored a hit on restaurant
-- #1's file and inherited the lot — #1's model, #1's dish name, #1's three tag cards, under the
-- other restaurant's own colour. Commit c86318c7 (2026-09-02) closed that by refusing the static
-- file for every restaurant except #1:
--
--     if (rid !== DEFAULT_RESTAURANT_ID) { setConfig({}); … }
--
-- Correct, and it took the tags with it. Today the dev database holds FOUR dishes with a 3D model:
-- Croissant + Waffle on french-house (#1, which keeps its tags) and the same two on `aevidine`
-- (the film restaurant, built from #1) — which since that day has shown a bare spinning model with
-- no cards at all. That is the screen in the guest film he just watched.
--
-- ═══ THE FIX: A DIFFERENT KEY, NOT A LOOSER GATE ═══
--
-- The leak was never the tags, it was the KEY. A folder NAME is typed by an owner, is not unique
-- across restaurants, and is therefore not an identity. The dish ROW is: it already carries
-- `restaurant_id`, and RLS already scopes it. So the tags move onto the row that owns the model,
-- and the gate above stays exactly as it is (scripts/verify-3d-viewer.mjs asserts it, and still
-- passes). Two restaurants sharing the word "Croissant" now get their OWN tags, not each other's.
--
-- This is also the "a new way replaces the old one" rule (CLAUDE.md): the `tags` and `frontView`
-- keys are deleted from both config.json files in the same change, so there is exactly ONE place
-- a hotspot can come from. Those files keep only what still has a reader: the model URLs and #1's
-- title/subtitle/stats fallbacks.
--
-- ═══ THE COLUMNS ═══
--
--   model_tags        JSONB NOT NULL DEFAULT '[]' — the list of callout cards for this dish's
--                     model. Shape per entry (the viewer's own, unchanged):
--                       id, emoji, name, b1, b2      — what the card says
--                       x, y, z                      — the point ON the model the line touches
--                       nx, ny, nz                   — the surface normal there (which way it faces)
--                       tagPosition "tx ty tz"       — where the card itself floats
--   model_front_view  TEXT — the saved opening pose, a model-viewer camera-orbit string
--                     ("519.36deg 71.39deg 1.937m"). Exactly one dish in the product has ever had
--                     one (#1's Waffle, hand-typed into its config.json); it is READ and honoured,
--                     and now any restaurant can have one.
--
-- Additive, defaulted, backfilled — the order CLAUDE.md requires. A dish with no tags reads as an
-- empty list, which is precisely what every non-3D dish already looked like.
--
-- ═══ EGRESS ═══
--
-- The column is NOT added to lib/menu.ts's CARD_COLUMNS, so the menu grid — the hottest read in
-- the product — carries not one byte more. Only the full-row reads (the dish page and the 3D
-- screen, which already select *) see it, and those two share one cached fetch: opening 3D from a
-- dish page costs ZERO extra round trips, where a separate hotspots request would have cost one
-- per 3D open, per guest.
--
-- ═══ THE BACKFILL IS KEYED ON THE MODEL FILE, NOT THE FOLDER NAME ═══
--
-- A tag names a point in a specific GLB's coordinate space — "the sauce is at x=0, y=-0.0382,
-- z=0.2754" is meaningless against a different model. So the backfill matches
-- `model_small_url`, the actual file: any dish pointing at this repo's demo croissant gets the
-- demo croissant's cards, whoever owns it. A tenant who uploaded their OWN croissant is untouched
-- and correctly gets nothing, because nobody has placed a point on their model yet.
--
-- It also only ever fills an EMPTY list, so a re-seed (which re-runs every migration, with no
-- ledger — see CLAUDE.md) can never overwrite tags somebody has since authored. That self-guard is
-- why this file needs no `lfh_already_applied` wrapper: re-running it is a no-op by construction.

ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS model_tags JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS model_front_view TEXT;

COMMENT ON COLUMN menu_items.model_tags IS
  'The 3D viewer''s hotspot cards for THIS dish''s model (mig 402). A list of {id, emoji, name, b1, b2, x, y, z, nx, ny, nz, tagPosition}. Empty list = a plain model with no callouts. Used to live in public/content/items/<folder>/config.json, keyed on a folder NAME that two restaurants could share; the dish row is the only key that is genuinely per-restaurant. Read by app/view/[folder]/ViewerClient.tsx via lib/menu.ts (full-row reads only — deliberately NOT in CARD_COLUMNS).';
COMMENT ON COLUMN menu_items.model_front_view IS
  'The opening camera pose for this dish in 3D (mig 402), as a model-viewer camera-orbit string: "<theta>deg <phi>deg <radius>m". NULL = the viewer''s default framing. Moved off config.json with model_tags.';

-- The 3D screen with no ?from= slug (a bookmarked or forwarded /view/<folder>) finds the dish by
-- its folder, scoped to the restaurant. Indexed so that read is never a scan; partial, because
-- fewer than a handful of rows in any menu have a model at all.
CREATE INDEX IF NOT EXISTS menu_items_restaurant_model_folder_idx
  ON menu_items (restaurant_id, model_folder)
  WHERE model_folder IS NOT NULL;

-- ── the backfill ────────────────────────────────────────────────────────────────────────────
-- Byte-for-byte the arrays that were in the two config.json files, so restaurant #1's screen is
-- unchanged and every other restaurant on the same model finally matches it.

UPDATE menu_items SET model_tags = '[
  {"id":"croissant","emoji":"🥐","name":"Croissant","b1":"Rich in Carbs","b2":"Buttery & Flaky",
   "x":-0.1438,"y":0.1532,"z":-0.1388,"nx":0,"ny":1,"nz":0,"tagPosition":"-0.1699 0.3578 -0.1457"},
  {"id":"sauce","emoji":"🫙","name":"Sauce","b1":"Creamy texture","b2":"Special Blend",
   "x":0,"y":-0.0382,"z":0.2754,"nx":0,"ny":-0.2,"nz":1,"tagPosition":"-0.2427 0.2268 0.2889"},
  {"id":"tag101","emoji":"🥗","name":"Salad","b1":"Light & healthy","b2":"Fresh & crunchy",
   "x":0.2545,"y":-0.0278,"z":-0.0008,"nx":0,"ny":1,"nz":0,"tagPosition":"0.4853 0.2463 0.0000"}
]'::jsonb
WHERE model_small_url = '/models/croissant_small.glb'
  AND model_tags = '[]'::jsonb;

UPDATE menu_items SET model_tags = '[
  {"id":"croissant","emoji":"🍦","name":" Ice Cream","b1":"Rich and creamy","b2":"Saffron infused",
   "x":0.0127,"y":0.1446,"z":0.0523,"nx":0,"ny":1,"nz":0,"tagPosition":"-0.0446 0.2932 0.2078"},
  {"id":"sauce","emoji":"🧇","name":"Belgian Waffle","b1":"Crispy golden texture","b2":"Light and fluffy",
   "x":-0.2083,"y":-0.0466,"z":-0.0017,"nx":0,"ny":-0.2,"nz":1,"tagPosition":"-0.3922 0.1610 0.0521"},
  {"id":"tag101","emoji":"🫐","name":" Blueberries","b1":"Naturally sweet","b2":"Juicy freshness",
   "x":0.2478,"y":-0.0929,"z":-0.0299,"nx":0,"ny":1,"nz":0,"tagPosition":"0.3835 0.1749 -0.0767"}
]'::jsonb
WHERE model_small_url = '/models/waffle_small.glb'
  AND model_tags = '[]'::jsonb;

-- #1's Waffle is the one dish that ever had a saved opening pose. Same rule: it follows the MODEL.
UPDATE menu_items SET model_front_view = '519.36deg 71.39deg 1.937m'
  WHERE model_small_url = '/models/waffle_small.glb'
    AND model_front_view IS NULL;
