-- 333 — A REPRINTED BILL KNOWS IT IS A REPRINT, ON EVERY DEVICE (owner, 2026-08-17: "do both 11 and 12")
--
-- WHY. The kitchen ticket has carried a big "REPRINT · DUPLICATE" banner since 2026-08-04 — the
-- owner's own ask — so a cook can never mistake a second copy for a fresh order. The BILL had
-- nothing: a re-issued copy was indistinguishable from the original, so one sale could be
-- represented by two identical sheets and nobody holding either could tell which was which. The
-- T8 sweep added the band to the shared document (public/panels/billdoc.js) on 2026-08-17; this is
-- the one fact the panels need in order to know when to ask for it.
--
-- WHY IT CANNOT LIVE ON THE DEVICE, which is the whole reason this is a column. The case that
-- matters most is the manager printing a bill at the till and a WAITER reprinting it from the
-- tablet a minute later when the guest asks for another copy. A "printed in this session" flag in
-- panel memory is right on the first device and wrong on the second — it would hand out an
-- unbranded duplicate, which is worse than not shipping the band at all. The state belongs to the
-- BILL, so it lives with the bill.
--
-- This is exactly migration 256's shape and reasoning, one table across: 256 added `printed_at` to
-- aggregator_orders so a parcel tile leaves the floor only once its bill is really printed, and it
-- says there too that it "cannot live on the device that printed, because the tile has to
-- disappear on EVERY panel, not just that one".
--
-- Purely additive: one nullable timestamp. NULL means "not printed yet", which is what every bill
-- in the table reads as today, so every existing bill prints exactly as it does now — no bill is
-- retroactively branded a duplicate. The route stamps it once and never overwrites it, so the
-- FIRST print stays the first print for good.
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS bill_printed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.sessions.bill_printed_at IS
  'When this bill was first printed on paper. NULL = never printed. Stamped once and never overwritten, so any later print is a REPRINT and the document brands it "Reprint · Duplicate" (owner, 2026-08-17). Mirrors aggregator_orders.printed_at from migration 256.';
