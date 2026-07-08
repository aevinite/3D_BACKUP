-- 150_issue_media.sql — attach a PHOTO and/or a VOICE NOTE to a staff-raised issue.
--
-- Extends the issues table (mig 094) with two nullable URL columns pointing at the
-- new public `issue-media` storage bucket. Additive + nullable = safe on the live DB
-- (existing issues just have NULL media). No RLS/policy change: issues stays
-- service-role-only, reached through our panel/admin route handlers.

alter table public.issues
  add column if not exists image_url text,   -- public URL of an attached photo (nullable)
  add column if not exists audio_url text;   -- public URL of an attached voice note (nullable)

-- Public bucket for issue attachments (photos + voice notes). PUBLIC-read so the
-- admin/owner panels can show the image and play the voice note from a plain URL
-- (an <img>/<audio> tag). WRITES happen ONLY through our service-role upload route
-- (/api/issue-media) — RLS on storage.objects blocks anon/authenticated writes by
-- default, and the service role bypasses it. Object paths are per-restaurant +
-- timestamp + random, so a URL can't be guessed from a restaurant id alone.
insert into storage.buckets (id, name, public)
values ('issue-media', 'issue-media', true)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
