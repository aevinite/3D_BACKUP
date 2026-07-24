-- 181_edit_menu_subopts_default.sql — sensible defaults for the redesigned access panel's
-- Edit-the-menu sub-options (owner 2026-07-24). The panel reads restaurants.access_config
-- .edit_menu.{owner_opts,manager_opts}; an unconfigured restaurant showed 0/N ticked. Backfill
-- ALL seven sub-options TRUE (add/edit/price/delete/86/categories/filters) for BOTH owner and
-- manager on any restaurant that has NO edit_menu config yet — so the panel opens with the
-- current behaviour (a manager with edit_menu can do everything) shown explicitly, and the owner
-- can then untick to restrict. NON-BREAKING: all-true = allow-all = exactly today (the editor
-- gate menuSubAllowed treats all-true the same as unconfigured). edit_3d is admin-only → NOT
-- included (never a manager/owner sub-option). Only touches rows WHERE edit_menu is absent, so it
-- never overwrites an owner's existing choices. Reversible.

UPDATE restaurants
SET access_config = jsonb_set(
  coalesce(access_config, '{}'::jsonb),
  '{edit_menu}',
  '{"owner_opts":{"add_dish":true,"edit_dish":true,"edit_price":true,"delete_dish":true,"mark_86":true,"manage_categories":true,"manage_filters":true},"manager_opts":{"add_dish":true,"edit_dish":true,"edit_price":true,"delete_dish":true,"mark_86":true,"manage_categories":true,"manage_filters":true}}'::jsonb,
  true
)
WHERE (access_config -> 'edit_menu') IS NULL;
