-- 125: on-screen tax wording (owner, 2026-07-05). The merged tax line on manager bills
-- ("Tax 5%") gets an owner-editable word per restaurant (Settings › Billing).
-- Nullable on purpose: null = the neutral default "Tax". The PRINTED bill is unaffected —
-- it itemises the named tax_components instead.
alter table public.settings add column if not exists tax_label text;
