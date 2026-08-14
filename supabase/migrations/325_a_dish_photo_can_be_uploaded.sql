-- 325_a_dish_photo_can_be_uploaded.sql — somewhere for a dish's photo to LIVE.
--
-- THE PROBLEM THIS FIXES (T19 sweep, 2026-08-14). The dish form's Image card is one text box
-- labelled "Image URL" with the placeholder "https://…". There is no "choose a photo" button
-- anywhere in the menu editor, and no upload endpoint for a dish image existed — the app could
-- already upload a restaurant LOGO (/api/admin/restaurants/logo → the `branding` bucket), a
-- STAFF photo (/api/admin/users/photo → the same bucket), an inventory photo and an issue photo.
-- A dish, the one picture a guest actually looks at, was the exception.
--
-- Two things were wrong with that:
--   • an owner cannot add a dish photo without first hosting that photo somewhere themselves,
--     which is not something a beginner owner can be asked to do; and
--   • whatever address they paste is then served to guests from someone else's site. That is
--     the arrangement that had to be undone once already, when restaurant #1's 41 dish photos
--     were being pulled from an outside website.
--
-- PUBLIC-read, and migration 279 is the reason that is the RIGHT answer here rather than a
-- careless one. 279 flipped `inv-media` and `issue-media` to private because they hold a
-- restaurant's private paperwork — purchase bills, expense slips, voice notes — and it names the
-- exception in its own text: "restaurant-logos — a logo is rendered on the guest menu, to the
-- public, by design." A dish photo is that same thing. It is shown by a plain <img> tag on all
-- three guest doors, to a diner with no session, and signed links would expire on a page the
-- whole product wants cached. So: public, like `branding`, never like `inv-media`.
--
-- WRITES happen only through our service-role route (/api/editor/dish-photo) — RLS on
-- storage.objects blocks anon/authenticated writes by default and the service role bypasses it.
-- Object paths are restaurant id + timestamp + random, so a URL cannot be guessed from a
-- restaurant id alone.
--
-- Nothing else changes: menu_items.image is the same text column it has always been, and a
-- restaurant that keeps using a pasted address keeps working exactly as before. This migration
-- only creates the place to put a file, so it is additive and safe to re-run.

insert into storage.buckets (id, name, public)
values ('menu-media', 'menu-media', true)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
