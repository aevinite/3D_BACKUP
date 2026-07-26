-- 204_enable_rls_server_only_tables.sql
-- Production-readiness audit (owner, 2026-07-26): 7 tables were created without row-level
-- security. All are SERVER-ONLY — reached only through the service-role key or pg_cron, both
-- of which bypass RLS — and NONE are read through the public anon client (verified: credit_notes
-- + invoice_events → app/api/admin/bills/route.ts via supabaseAdmin; owner_analytics_cache →
-- lib/ownerCache.ts via supabaseAdmin; the four *_agg/_state tables are written by pg_cron and
-- read via RPCs). Enabling RLS with NO policy makes them deny the anon/authenticated roles
-- entirely, exactly like orders / sessions / staff_users already do.
--
-- credit_notes + invoice_events additionally still carried anon/authenticated table GRANTs, so
-- billing rows were reachable with the public key that ships in the frontend. RLS closes that;
-- we also drop the stray grants (defence in depth — same spirit as the "REVOKE staff RPCs from
-- anon" rule in CLAUDE.md / migration 038).

alter table public.credit_notes                    enable row level security;
alter table public.invoice_events                  enable row level security;
alter table public.orders_daily_agg                enable row level security;
alter table public.orders_daily_agg_state          enable row level security;
alter table public.orders_report_monthly_agg       enable row level security;
alter table public.orders_report_monthly_agg_state enable row level security;
alter table public.owner_analytics_cache           enable row level security;

revoke all on public.credit_notes   from anon, authenticated;
revoke all on public.invoice_events from anon, authenticated;
