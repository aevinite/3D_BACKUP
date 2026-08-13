-- 316_the_three_numbers_and_the_two_switch_bags_say_what_they_are.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Two of the sweep's improvement ideas, both of them the same shape: something correct that only
-- makes sense if you already know the story. The fix is to put the story where the next person
-- actually looks — on the column — not in a document they will not open.
--
-- BACKEND ONLY, NOTHING ON SCREEN. No behaviour changes; these are COMMENTs.
--
-- I10 — THE THREE NUMBERS. A restaurant hands out three different numbers for one meal, and a
-- waiter, a cook and an accountant each care about a different one. docs/NUMBERING.md explains it
-- well and nobody reading the schema sees it.
--
-- I7 — THE TWO SWITCH BAGS DISAGREE ABOUT A MISSING KEY. `settings.features` and
-- `restaurants.owner_entitlements` are both JSONB bags of switches, and an ABSENT key means the
-- OPPOSITE thing in each: off-by-default in one, allowed-by-default in the other. Both are
-- deliberate and both are right for their own history. Together they are a trap for whoever adds
-- the third bag — so the rule is written on both columns, facing each other.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- ── I10. The three numbers ───────────────────────────────────────────────────────────────────
COMMENT ON COLUMN public.orders.kot_no IS
  'THE KITCHEN TICKET NUMBER — what the kitchen shouts and what the cook''s slip says. Resets to 1 every business day (05:00 IST rollover, migs 044/296), per restaurant, and is assigned to EVERY order including parcel and delivery (mig 261: one series for all channels). Gaps are normal — a cancelled ticket keeps its number. NOT a bill number: one bill can carry many KOTs.';
COMMENT ON COLUMN public.sessions.bill_no IS
  'THE BILL NUMBER — what the guest''s bill is called. Daily, per restaurant, and assigned LAZILY when the table''s FIRST order lands (mig 040), never when a table is merely tapped open — so a table that never orders burns no number. One per session, however many KOTs it holds. See docs/NUMBERING.md.';
COMMENT ON COLUMN public.sessions.invoice_no IS
  'THE TAX INVOICE NUMBER — the one an accountant cares about. FOREVER sequential (seq_counters, never resets daily), per restaurant, and only issued when a tax invoice is actually generated. Voiding an invoice KEEPS its number and a re-issue takes a fresh one, so this series has honest gaps by design (migs 073/286). Never reuse one.';

-- ── I7. What a MISSING switch means, on both bags, facing each other ─────────────────────────
COMMENT ON COLUMN public.settings.features IS
  'GUEST/RESTAURANT FEATURE SWITCHES (mig 035), admin-controlled. AN ABSENT KEY MEANS "USE THE CODE-SIDE DEFAULT" — which is ON for the guest-facing keys (ratings, reviews, model3d, allergies, favorites, waiter_calls, search, languages, currency, scrollspy) and OFF for the four backend-only ones (verification, payments, aggregators, gst_invoice), which have no UI anywhere on purpose. Resolved through useFeatures(). ⚠️ NOTE THE OPPOSITE RULE on restaurants.owner_entitlements, where an absent key means ALLOWED — the two bags disagree deliberately, for their own histories, and a third bag must say which convention it follows.';
COMMENT ON COLUMN public.restaurants.owner_entitlements IS
  'WHICH PARTS OF THE OWNER PANEL EXIST for this restaurant, and which manager powers the owner may grant (mig 133), admin-controlled. AN ABSENT KEY MEANS ENTITLED — deliberately, so every restaurant that existed before a section was invented kept it. Resolution: entitled(key) = owner_entitlements[key] !== false, and a power OFF here beats the owner''s own grant (effective = entitled("power_"+flag) AND manager_permissions[flag] === true). ⚠️ NOTE THE OPPOSITE RULE on settings.features, where an absent key falls back to a code default that is OFF for the backend-only switches.';

NOTIFY pgrst, 'reload schema';
