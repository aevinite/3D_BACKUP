-- 218 — remember which PROBLEMS have been dealt with, not just which log rows (owner 2026-07-28)
--
-- WHY: the Repair console remembered individual error ROWS (staff_actions.resolved_at, mig 181).
-- Resolving a problem cleared the rows that existed at that second, but nothing recorded "this
-- KIND of error has been handled". So the next identical error came back as a fresh red alarm and
-- could pop another Claude window for a problem already fixed — which is exactly what happened
-- on 2026-07-28 (a 414 kitchen-board ticket popped a session that rebuilt a fix another session
-- had already shipped).
--
-- This table is that memory, keyed by a NORMALISED signature of the error (ids/numbers stripped —
-- see lib/errorSignature.ts) so "the same one" still matches when the message carries a different
-- order id. Two states, and the difference matters:
--
--   'fixed'   — a real bug, fixed. Old occurrences never alarm again and can't open a duplicate
--               ticket. But an occurrence AFTER fixed_at is NOT silenced: it means the fix did not
--               hold, so it shows as a problem again, labelled "came back after a fix". The owner
--               was explicit: fixed must mean GONE, never merely hidden.
--   'ignored' — the owner decided this isn't a real problem ("never show me this again"). Rows are
--               still written to the log for the audit trail, but pre-resolved so nothing alarms.
--
-- Un-muting is a plain DELETE of the row (the Repair page's "Show this again" button).
-- Billing-compliance note: this hides nothing about a SALE — it only mutes engineering noise in
-- the admin's own repair console. Every staff_actions row is still written and still readable.

CREATE TABLE IF NOT EXISTS error_signatures (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = the signature applies to every restaurant (a platform-wide bug); a uuid scopes it to one.
  restaurant_id uuid REFERENCES restaurants(id) ON DELETE CASCADE,
  panel         text NOT NULL,
  action        text NOT NULL,
  sig           text NOT NULL,
  state         text NOT NULL DEFAULT 'fixed' CHECK (state IN ('fixed', 'ignored')),
  fixed_at      timestamptz NOT NULL DEFAULT now(),
  fixed_by      text,                       -- 'owner' | 'claude'
  pr_url        text,
  note          text,
  -- How many times this error has been seen SINCE fixed_at (0 = the fix is holding).
  recurrences   integer NOT NULL DEFAULT 0,
  last_seen_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One memory per problem. COALESCE so a platform-wide (NULL restaurant) signature can coexist
-- with per-restaurant ones without NULLs defeating the unique index.
CREATE UNIQUE INDEX IF NOT EXISTS error_signatures_key_uniq
  ON error_signatures (COALESCE(restaurant_id, '00000000-0000-0000-0000-000000000000'::uuid), panel, action, sig);

-- The hot lookup: every logError() asks "is this problem already handled?" before inserting.
CREATE INDEX IF NOT EXISTS error_signatures_lookup
  ON error_signatures (panel, action, sig);

-- Staff-only, like every other repair table (CLAUDE.md: new objects are PUBLIC-executable /
-- readable by default — lock them down explicitly).
REVOKE ALL ON error_signatures FROM PUBLIC;
REVOKE ALL ON error_signatures FROM anon;
REVOKE ALL ON error_signatures FROM authenticated;
GRANT ALL ON error_signatures TO service_role;
ALTER TABLE error_signatures ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: RLS with zero policies blocks anon/authenticated outright, while the
-- service-role client (which every admin/repair route uses) bypasses RLS as designed.

COMMENT ON TABLE error_signatures IS
  'Memory of which error KINDS have been fixed or deliberately ignored, so a handled problem cannot re-alarm or open a duplicate Claude ticket. An occurrence after fixed_at is a regression and is NOT silenced (mig 218).';

-- ── Upsert one memory ────────────────────────────────────────────────────────────────────────
-- A function (not a plain upsert) because the unique index is on a COALESCE expression, which
-- PostgREST's on-conflict cannot target. Re-recording a signature refreshes fixed_at and RESETS
-- recurrences: a fresh fix starts from zero, otherwise an earlier failed attempt's counter would
-- make the new fix look broken immediately.
CREATE OR REPLACE FUNCTION lfh_remember_error_signature(
  p_restaurant_id uuid,
  p_panel text,
  p_action text,
  p_sig text,
  p_state text,
  p_by text,
  p_pr_url text DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_state NOT IN ('fixed', 'ignored') THEN
    RAISE EXCEPTION 'state must be fixed or ignored';
  END IF;
  IF coalesce(btrim(p_sig), '') = '' THEN
    RAISE EXCEPTION 'signature required';
  END IF;

  UPDATE error_signatures
     SET state = p_state, fixed_at = now(), fixed_by = p_by,
         pr_url = coalesce(p_pr_url, pr_url), note = coalesce(p_note, note),
         recurrences = 0, last_seen_at = NULL
   WHERE coalesce(restaurant_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_restaurant_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND panel = p_panel AND action = p_action AND sig = p_sig
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    INSERT INTO error_signatures (restaurant_id, panel, action, sig, state, fixed_by, pr_url, note)
    VALUES (p_restaurant_id, p_panel, p_action, p_sig, p_state, p_by, p_pr_url, p_note)
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

-- ── Count an occurrence seen after the fix ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION lfh_bump_error_signature(p_id uuid, p_seen timestamptz DEFAULT now())
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE error_signatures
     SET recurrences = recurrences + 1,
         last_seen_at = greatest(coalesce(last_seen_at, p_seen), p_seen)
   WHERE id = p_id;
$$;

-- Staff-only (CLAUDE.md mig-038 rule: a new function is PUBLIC-executable by default).
REVOKE ALL ON FUNCTION lfh_remember_error_signature(uuid, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_bump_error_signature(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_remember_error_signature(uuid, text, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION lfh_bump_error_signature(uuid, timestamptz) TO service_role;
