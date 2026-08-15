-- 330_the_admin_can_hand_over_a_login.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- THE OWNER, 2026-08-16: "I could able to see owner pass and all that stuff … I could able to see
-- their pass which is currently right now, and I could able to see what can be their future like
-- if they change … also make sure that there is a print option, which will show all the stuff."
--
-- WHERE: Admin console (/aevinite) → Restaurants → a restaurant → the new "Logins & passwords"
-- card, and its Print sheet.
--
-- WHAT HE WOULD SEE, BEFORE: a restaurant is handed over and the admin has no way to tell the
-- client what their passwords are. The starter passwords were shown exactly ONCE, on the create
-- screen, in plain text with nothing to copy them with — and after that nobody on earth could
-- read them back, because `password_hash` is a one-way scramble. The only remedy was to reset a
-- password the client might already be using.
--
-- WHAT THIS COLUMN IS. `password_shown` holds the SAME password as `password_hash`, kept in a form
-- the server can read back, so the admin console can print a handover sheet. It is written by
-- lib/passwordVault.ts → `sealPassword()`, which encrypts with AES-256-GCM before the value ever
-- reaches this table; nothing readable is stored. `openPassword()` is the only reader and it lives
-- server-side, behind the admin cookie.
--
-- THE TRADE, STATED OUT LOUD (owner, 2026-08-16 — he was told this before choosing it). Before
-- today a password was readable by NOBODY. From today, whoever can open the admin console can read
-- every restaurant's passwords. That is the price of being able to hand a client their logins on
-- paper, and he decided it is worth paying for his business. Three things keep the price as small
-- as it can be:
--   1. `staff_users` has RLS ON with NO policies (service-role only, since mig 115) — this column
--      inherits that, so anon and authenticated can never select it, and no panel API returns it.
--   2. It is encrypted at rest, keyed from CREDENTIAL_VAULT_KEY (falling back to the service-role
--      key), so a copy of the table alone does not read out.
--   3. `password_hash` remains the ONLY thing sign-in checks. This column is never consulted by
--      any login path — see lib/userAuth.ts, untouched by this migration.
--
-- EXISTING LOGINS ARE NOT AFFECTED AND CANNOT BE FILLED IN. Their original text was never stored,
-- so every row starts NULL and the card says "not stored yet — Reveal sets a new one". From now on
-- every create/reset/change writes it, including a staff member changing their own password, so
-- "what is it now, after they changed it" is answered.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.staff_users ADD COLUMN IF NOT EXISTS password_shown text;

COMMENT ON COLUMN public.staff_users.password_shown IS
  'The same password as password_hash, encrypted (AES-256-GCM, lib/passwordVault.ts) so the admin '
  'console can print a handover sheet. NULL = set before mig 330, or the key changed; the card then '
  'offers a one-time Reveal. NEVER used to sign anyone in — password_hash alone does that. '
  'Reachable only by the service role: staff_users has RLS on with no policies.';

-- Belt and braces: this table is service-role-only by having RLS on and no policies, but say it
-- again for the column's sake so a future policy added for some other purpose cannot widen it by
-- accident. (No-op where the grants are already this narrow.)
REVOKE ALL ON public.staff_users FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
