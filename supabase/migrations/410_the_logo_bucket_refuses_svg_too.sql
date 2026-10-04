-- 410 · The logo bucket refuses SVG too — not only the upload route.
--
-- docs/SECURITY-CHECKLIST.md row 16 says SVG is deliberately refused, because an SVG is a document
-- that can carry script, and a restaurant logo is shown on every guest's phone. The upload route
-- (app/api/admin/restaurants/logo/route.ts) does refuse it: its EXT map is png / jpeg / webp only.
-- But the `branding` bucket itself still listed image/svg+xml as allowed — set by hand in the
-- dashboard at some point, never in a migration. So the rule held only as long as every future
-- uploader went through that one route. Found by the "sued or billed" check, 2026-10-04.
--
-- Now the bucket says the same thing the route says, so the rule holds at the storage layer as
-- well. Checked first: the bucket held 2 files, 0 of them SVG — nothing already stored is affected.
-- The 1 MB size limit is kept as it is.
--
-- Idempotent: it sets a value, so running it twice is the same as once. It does not create the
-- bucket (mig 325's pattern) — a stack without a `branding` bucket simply updates nothing.

update storage.buckets
   set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
 where id = 'branding';
