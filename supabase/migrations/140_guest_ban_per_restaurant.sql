-- Guest ban was GLOBAL across every restaurant (audit, 2026-07-06).
--
-- The load-time door check lfh_check_ban(device, phone) matches the `blocklist`
-- by device/phone with NO restaurant_id filter, so a ban placed by restaurant A
-- walls that guest's device out of restaurant B's menu too (blocklist rows are
-- per-restaurant since mig 101/128, but this check ignored the column). Fix =
-- a NEW scoped function the guest app calls with the CURRENT restaurant id.
--
-- Why a new function instead of altering lfh_check_ban: adding a parameter changes
-- the signature (Postgres can't CREATE OR REPLACE across a signature change without
-- a DROP, which briefly breaks concurrent callers). A new, additively-created
-- function is live-safe — the old lfh_check_ban stays for any legacy caller and is
-- simply no longer used by the guest app.

-- Composite index for the scoped lookup (tenant + device / tenant + phone).
CREATE INDEX IF NOT EXISTS idx_blocklist_rid_device ON blocklist(restaurant_id, device_id);
CREATE INDEX IF NOT EXISTS idx_blocklist_rid_phone  ON blocklist(restaurant_id, phone);

-- Per-restaurant load-time ban check. Returns the SAME json shape as lfh_check_ban
-- ({banned:false} | {banned:true, reason, ...}) but only ever matches a row that
-- belongs to THIS restaurant, so one restaurant's ban never leaks to another.
CREATE OR REPLACE FUNCTION lfh_check_ban_scoped(p_device text, p_phone text, p_restaurant_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row blocklist;
BEGIN
  IF p_restaurant_id IS NULL THEN RETURN json_build_object('banned', false); END IF;
  SELECT * INTO v_row FROM blocklist
    WHERE restaurant_id = p_restaurant_id
      AND ( (p_device IS NOT NULL AND p_device <> '' AND device_id = p_device)
         OR (p_phone  IS NOT NULL AND p_phone  <> '' AND phone     = p_phone) )
    LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('banned', false); END IF;
  RETURN json_build_object('banned', true, 'reason', v_row.reason,
                           'unban_requested', v_row.unban_requested_at IS NOT NULL);
END $$;

-- New functions are PUBLIC-executable by default (the mig-038 gotcha). Lock it down,
-- then grant to anon since the guest menu calls it with the anon key.
REVOKE ALL ON FUNCTION lfh_check_ban_scoped(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lfh_check_ban_scoped(text, text, uuid) TO anon, service_role;
