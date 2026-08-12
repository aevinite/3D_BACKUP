-- 311 — THE AUDIT IS KEPT FOR YEARS, AND HOW MANY IS A SETTING (owner, 2026-08-12)
--
-- His words: "audit … there should be option the auto delete audit like on the top just like the
-- log, but there should be option of three years, five years, seven years, 10 years, and one year
-- and all that — because it's an important thing and very less audit, very less things will be in
-- the audit, so make sure to save that, and you know that's the main thing for the owner."
--
-- ⚠ MIGRATION NUMBER: next free after 310 (T8's one-revenue-number migration took 310 while this branch waited
--   for the deploy lock). Renumber to the next free slot if a parallel branch took
--   it — ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE + cron.schedule (which UPSERTS by name), all
--   correct at ANY number. It rewrites no existing data, so it needs no lfh_already_applied guard.
--
-- ── WHY IN YEARS, WHEN THE ACTIVITY LOG IS IN DAYS ───────────────────────────────────────────────
-- They are different things and this migration is the place that says so.
--   · the ACTIVITY log (staff_actions) is a working diary — every order accepted, every table
--     opened. It is enormous and it is disposable, so mig 158 caps it at ONE MONTH.
--   · the AUDIT (deletion_audit, mig 251) is the money trail: every removal, with the reason, the
--     person and the amount. It is what answers "where did bill #217 go?" years later, and it is
--     TINY — one row per removal, a few hundred a year for a busy restaurant.
-- So the two must never share a window. Until now the audit had NO retention at all: nothing
-- deleted from it, which was safe but also meant no one could say what the policy WAS.
--
-- ── THE DEFAULT IS THE LONGEST, ON PURPOSE ───────────────────────────────────────────────────────
-- 10 years. `docs/COMPLIANCE-GUARDRAILS.md` §3 puts records retention at 6–8 years, so the default
-- sits above the top of that range and nothing is ever removed unless a person deliberately shortens
-- it. The floor is ONE YEAR (his shortest option) — this migration cannot be made to delete this
-- year's audit, whatever is stored in the column.
--
-- ⚠ AND IT IS STILL NOT AN OFF SWITCH. COMPLIANCE §3: "Non-disableable audit + invoice history …
-- Never add one." A retention WINDOW measured in years is not the thing that rule forbids — what it
-- forbids is a switch that stops the trail being WRITTEN, or one that empties it on demand. Neither
-- exists: lfh_record_removal has no gate, the shortest window here is a year, the prune only ever
-- removes rows older than that window, and there is no "clear the audit now" door anywhere. The
-- admin screen warns in plain words when a window below 8 years is chosen.

-- ── A · The setting. Platform-wide, like the log's (one policy for every restaurant). ────────────
ALTER TABLE settings ADD COLUMN IF NOT EXISTS audit_retention_years INTEGER NOT NULL DEFAULT 10;
COMMENT ON COLUMN settings.audit_retention_years IS
  'How many YEARS the Audit (deletion_audit) is kept for - 1/3/5/7/10, default 10. Read from the '
  'platform row (id=''site''); floor of 1 year enforced in lfh_prune_audit. The Audit is the money '
  'trail, not the activity log: it is tiny and it is the record that answers "where did that bill '
  'go" years later, so its window is in years while staff_actions is capped at a month (mig 158).';

-- ── B · How many years, answered in ONE place ────────────────────────────────────────────────────
-- Both the prune and any reader ask this, so the floor and the default cannot be stated twice.
CREATE OR REPLACE FUNCTION lfh_audit_retention_years()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT GREATEST(1, LEAST(COALESCE(
    (SELECT audit_retention_years FROM settings WHERE id = 'site' LIMIT 1), 10), 25));
$$;
REVOKE ALL ON FUNCTION lfh_audit_retention_years() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_audit_retention_years() TO service_role;

-- ── C · The prune. deletion_audit ONLY, older than the window ONLY. ──────────────────────────────
CREATE OR REPLACE FUNCTION lfh_prune_audit()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_years integer; v_gone integer;
BEGIN
  v_years := lfh_audit_retention_years();     -- already floored at 1 year
  -- One table, one condition. No restaurant loop and no other table: this function must never grow
  -- into a general cleaner, because the audit is the one record the product's safety argument rests
  -- on (docs/COMPLIANCE-GUARDRAILS.md §1).
  DELETE FROM deletion_audit
   WHERE at < now() - make_interval(years => v_years);
  GET DIAGNOSTICS v_gone = ROW_COUNT;
  -- Recorded where the admin can see it, and only when something actually went — a nightly "removed
  -- 0 rows" line would bury the one night that mattered. staff_actions is itself pruned monthly, but
  -- the count is also returned so a caller can log it wherever it needs to live.
  IF v_gone > 0 THEN
    INSERT INTO staff_actions(panel, action, detail, level, created_at)
    VALUES ('admin', 'audit_pruned',
            'removed ' || v_gone || ' audit row(s) older than ' || v_years || ' year(s)', 'warn', now());
  END IF;
  RETURN v_gone;
END $$;
REVOKE ALL ON FUNCTION lfh_prune_audit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_prune_audit() TO service_role;

-- Nightly, half an hour after the log prune so the two never contend.
-- cron.schedule UPSERTS by name, so re-running this migration is safe.
SELECT cron.schedule('lfh-prune-audit', '30 4 * * *', 'SELECT public.lfh_prune_audit();');

-- ── D · Per-kind counts over the WHOLE window, not the page ──────────────────────────────────────
-- The Audit screens grew a chip per removal type (owner, 2026-08-11). Their counts were taken from
-- the rows in hand, which was honest only while the screen held every row — and it holds a page. So
-- the counts come from the database, over the same restaurant scope and date window the list uses.
-- One grouped read, indexed by (restaurant_id, at DESC) since mig 251.
CREATE OR REPLACE FUNCTION lfh_audit_kind_counts(
  p_restaurant_ids uuid[],
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
)
RETURNS TABLE (kind text, n bigint, amount numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.kind,
         COUNT(*)::bigint                                AS n,
         COALESCE(round(SUM(COALESCE(d.amount, 0)), 2), 0) AS amount
  FROM deletion_audit d
  WHERE d.restaurant_id = ANY (p_restaurant_ids)
    AND (p_from IS NULL OR d.at >= p_from)
    AND (p_to   IS NULL OR d.at <  p_to)
  GROUP BY d.kind
  ORDER BY COUNT(*) DESC, d.kind;
$$;
REVOKE ALL ON FUNCTION lfh_audit_kind_counts(uuid[], timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_audit_kind_counts(uuid[], timestamptz, timestamptz) TO service_role;

-- Paging walks BACKWARDS through (restaurant_id, at DESC) with a cursor, and the counts group by
-- kind over the same scope — this index serves both without a sort.
CREATE INDEX IF NOT EXISTS deletion_audit_kind_ix ON deletion_audit (restaurant_id, kind, at DESC);

NOTIFY pgrst, 'reload schema';
