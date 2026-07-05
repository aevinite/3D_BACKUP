-- 124: editable printed-bill footer (owner, 2026-07-05).
-- The print template (editor printBill) already reads settings.bill_footer with
-- per-restaurant fallbacks ("Merci…" for #1, per-cuisine sign-offs, generic thanks);
-- this adds the real column so Settings › Billing can save a custom sign-off.
-- Nullable on purpose: null = "use the fallback", so no backfill is needed.
alter table public.settings add column if not exists bill_footer text;
