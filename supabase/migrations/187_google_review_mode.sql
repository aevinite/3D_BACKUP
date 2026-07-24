-- 187: Google-review MODE — per-restaurant, ADMIN-controlled sub-option that sits under the
-- reviews feature. A single-select describing how the Google-review invite behaves relative to
-- the in-menu ("normal") review. Default 'off' for EVERY restaurant (owner 2026-07-24): no
-- Google prompt at all — guests see only the normal in-menu reviews, which are themselves
-- governed by the existing features.reviews / features.ratings guest toggles.
--
--   off                 → no Google invite (normal in-menu reviews only)
--   google              → Google review ONLY: a "Review us on Google" call-to-action, and the
--                          in-menu star/rate form is hidden (the restaurant collects reviews on Google)
--   google_plus_normal  → the in-menu review form AND a Google call-to-action shown together
--   google_after_normal → the Google invite appears AFTER a guest leaves a 4–5★ in-menu review
--                          (this is the behaviour the single google_review_url field had before)
--
-- The destination link stays in settings.google_review_url (mig 155); for a brand-new
-- restaurant it defaults to our own @aevinite Instagram until the owner pastes a real Google URL
-- (lib/settingsClone.ts). This is admin-only: the owner cannot change it (owner 2026-07-24).
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS google_review_mode text NOT NULL DEFAULT 'off'
  CHECK (google_review_mode IN ('off','google','google_plus_normal','google_after_normal'));

NOTIFY pgrst, 'reload schema';
