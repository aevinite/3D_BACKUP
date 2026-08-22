-- 361_a_sale_is_locked_from_the_kitchen_not_the_till.sql
--
-- Uncouples the "an issued bill cannot be hard-deleted" lock from the BILL NUMBER, and anchors it to
-- the KOT number instead. Strictly stronger, and it removes the last reason a compliance rule cared
-- when a bill number happens to be handed out.
--
-- WHERE THIS CAME FROM. The owner asked for `bill_no` to be drawn when the bill is actually made
-- rather than when a table's first order lands — which is what PetPooja and Toast do, and he is right
-- that it is the normal convention. Working out what that would take turned up this: the lock that
-- stops a sale being erased was USING `bill_no is not null` as its test for "this bill has been
-- issued". Because today the number arrives with the first order, that test happens to mean "this
-- table has ordered". Move the number later and the test silently weakens — an order that is neither
-- paid nor served, on a table nobody has billed yet, becomes hard-deletable. A numbering change would
-- have quietly loosened a compliance guard, which is exactly the kind of thing that is invisible in
-- review.
--
-- So the lock stops asking about billing at all. Every order draws a KOT number the instant it is
-- created (migration 036's BEFORE INSERT trigger) — measured on the dev database the day this was
-- written, 0 of 30,642 orders had a NULL `kot_no`. "This order was sent to the kitchen" is therefore
-- a permanent fact that no billing decision can move, and it is TRUE EARLIER than `bill_no` ever was.
-- The lock now fires from the moment the order exists rather than from the moment it is billed.
--
-- The other two tests are untouched: `payment_status = 'paid'` and `status = 'served'`. The
-- session-level test is untouched too — a session with a `bill_no` or an `invoice_no` still cannot be
-- hard-deleted. And the audited purge keeps its one explicit escape hatch (`lfh.allow_purge`), which
-- is how a restaurant is permanently deleted after its wait.
--
-- Nothing about how numbers are ASSIGNED changes here, and no migration in this branch moves
-- `bill_no`. Moving it turned out to be blocked for a reason worth writing down where the next person
-- will look:
--
--   THE BILL MUST PRINT OFFLINE. `public/panels/tablet/app.js` builds the bill window from session
--   data the panel ALREADY HOLDS, prints it, and only then fire-and-forgets the "it went on paper"
--   stamp — with the comment "offline — the paper still came out". `bill_no` comes from
--   `lfh_next_counter`, an atomic counter that lives on the server and cannot be reached with no
--   network. Assign the number only when the bill is made and an offline bill prints with NO NUMBER
--   AT ALL, which is worse than the occasional gap it was meant to remove. The convention PetPooja
--   and Toast follow assumes an online till; this app deliberately does not.
--
-- The visible half of the owner's concern was solved separately and without touching any counter:
-- the printed sheet now shows `bill_no` only when there is no invoice number to show instead, so a
-- customer sees the number they would actually quote and the gappy internal one stays internal.

CREATE OR REPLACE FUNCTION public.lfh_block_issued_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare issued boolean := false;
begin
  -- Explicit, transaction-local escape hatch — set ONLY by the audited purge path.
  if coalesce(current_setting('lfh.allow_purge', true), '') = 'on' then
    return old;
  end if;

  if tg_table_name = 'orders' then
    -- `kot_no is not null` REPLACED a lookup of the session's bill_no (mig 361). Every order gets a
    -- KOT number at insert (mig 036), so this is true from the moment the order exists — earlier and
    -- more reliably than any billing state, and it no longer depends on WHEN a bill number is drawn.
    issued := (old.payment_status = 'paid')
           or (old.status = 'served')
           or (old.kot_no is not null);
  elsif tg_table_name = 'sessions' then
    issued := (old.bill_no is not null) or (old.invoice_no is not null);
  end if;

  if issued then
    raise exception 'lfh: an issued bill cannot be hard-deleted — soft-delete it (deleted_at) instead (% %)', tg_table_name, old.id
      using errcode = 'check_violation',
            hint = 'Corrections use void / soft-delete; permanent erase only via the 90-day restaurant purge.';
  end if;
  return old;
end $$;

-- Staff-only, like every function here (the mig-038 rule). A trigger function's grant does not decide
-- whether the trigger fires, but leaving it public-executable is the drift mig 038/267 exists to stop.
REVOKE ALL ON FUNCTION public.lfh_block_issued_delete() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_block_issued_delete() TO service_role;

NOTIFY pgrst, 'reload schema';
