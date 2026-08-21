-- 353 · A BINNED BILL IS NOT A TAMPERED BILL (owner, 2026-08-21, sweep T23 item 6)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠ MIGRATION NUMBER: 353, the next free slot after this branch's 352 and contiguous with main's
--   351 — which matters, because the folder's own sequence check fails on any unexplained gap.
--   T21 holds an uncommitted 352 / 353 / 354 in its worktree and T24 an uncommitted 352; this
--   branch merges first, so those three renumber on their way in. That is the documented process,
--   and the parked-worktree check in verify-db-grants.mjs prints the collision on every run while
--   renumbering is still just a rename. CREATE OR REPLACE on one function, no schema change and no
--   data rewrite, so this file is correct at ANY number.
--
-- WHERE THE OWNER SEES IT — and this is why it matters more than it first looked:
--   Manager panel → 🧾 KOT ▾ → **Z-report** (the day-close sheet). Migration 332's verification is
--   PRINTED there, on purpose: *"That is the moment a restaurant states its takings, it is the paper
--   an inspector is handed, and printing the verification beside the money is what the fiscal
--   regimes this design follows actually require."* Today that sheet prints
--
--       ⚠ Bill ledger    11 problems — tell the owner
--         bill #217 changed after signing      signed at 105.00, the bill now adds up to 0.00
--         bill #216 changed after signing      signed at 105.00, the bill now adds up to 0.00
--         …
--
--   and not one of those eleven is tampering.
--
-- ── WHAT WAS WRONG ─────────────────────────────────────────────────────────────────────────────
-- `lfh_verify_bill_chain` answered three questions and had three answers for them. Its third check
-- is "does the BILL still say what was signed?", computed over the session's LIVE orders
-- (`deleted_at is null and status <> 'cancelled'`). Three completely different things satisfy that
-- test, and all three came back as the same word — `bill_changed`:
--
--   1. somebody altered a sale after it was signed                        ← the real one
--   2. the bill was put in the RECYCLE BIN after its invoice was issued   ← permitted, recorded,
--      (admin console → Bills → delete, which soft-deletes every order       reversible, and the
--       and tombstones the session — migs 188 / 280 / 291)                   admin's own screen says
--                                                                            "never erased")
--   3. the SALE was cancelled after its invoice was issued                ← migration 331 case B in
--      (the number stays, retired and marked cancelled, corrected by a       as many words: this is
--       credit note — mig 073 / 331)                                         the compliant route out
--
-- MEASURED on the backup database, calling the verifier for French House over all time: 11 of 12
-- signed bills came back `bill_changed`. Eight are bills binned after their invoice was issued, two
-- point at a session row that no longer exists, one is the arithmetic of a live bill — which
-- verifies correctly. Admin → Bills shows 831 deleted bills on that stack.
--
-- ── WHY THAT IS A FAULT AND NOT A DETAIL ───────────────────────────────────────────────────────
-- The whole value of migration 332 is that its report is READABLE. A day-close sheet that cries
-- ⚠ eleven times for eleven things that are fine is a sheet a manager learns to ignore, and then the
-- ONE line that matters is buried in it. That is exactly the failure migration 344 was written to
-- undo on the admin's Repair board ("nineteen tiles, four of them a fortnight old … so the board had
-- started to be ignored"), reappearing on the most sensitive piece of paper in the product.
--
-- ── WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT ───────────────────────────────────────
-- NOTHING IS HIDDEN. Every row the verifier used to emit, it still emits — same function, same
-- signature, same columns, one row per finding. What changes is the WORD, so a reader can tell a
-- recorded act from an unexplained one:
--
--   row_rewritten   an entry no longer matches its own signature          (unchanged — REAL)
--   chain_broken    an entry before this one was removed or re-ordered    (unchanged — REAL)
--   bill_changed    the bill STILL HAS LIVE ORDERS and they no longer add up to what was signed
--                                                                        (unchanged meaning — REAL)
--   bill_binned     NEW — this bill is in the recycle bin. Restorable, and who binned it and why is
--                   in deletion_audit. The signed amount is still printed on the line.
--   bill_cancelled  NEW — the sale was cancelled after its invoice was issued (mig 331 case B).
--   bill_gone       NEW — the chain row's bill no longer exists at all, or it never carried one.
--                   This one is still worth reading: `bill_chain.session_id` has no foreign key, so
--                   a hard-deleted session leaves a link pointing at nothing, and the ledger is
--                   append-only so the row can never be corrected.
--   checked         unchanged, and its detail now COUNTS what it saw, so nothing is silently dropped.
--
-- THE TAMPER TEST IS NOT WEAKENED, and this is the load-bearing line: a bill is only re-labelled
-- when it has NO live orders left AND the reason is visible in the data (a tombstoned session, or
-- cancelled orders). A bill that still holds live orders whose total has moved stays `bill_changed` —
-- so removing one of three orders is still reported as an alteration, which is the shape an actual
-- suppression takes. A bill whose orders are ALL soft-deleted while its session is somehow NOT
-- tombstoned also stays `bill_changed`: migration 291's trigger makes that state impossible through
-- any normal path, so if it appears, something wrote it by hand and it deserves the flag.
--
-- The hashes are untouched: checks 1 and 2 run exactly as before, in the same order, before any of
-- this. A rewritten row or a broken link is still reported first and still reads as tampering.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

create or replace function lfh_verify_bill_chain(p_rid uuid, p_from timestamptz, p_to timestamptz)
returns table (kind text, seq bigint, invoice_no bigint, bill_no bigint, detail text)
language plpgsql security definer set search_path = public as $$
declare
  r          bill_chain;
  v_prev     text := null;
  v_first    boolean := true;
  v_checked  int := 0;
  v_flagged  int := 0;     -- row_rewritten / chain_broken / bill_changed  → a real problem
  v_noted    int := 0;     -- bill_binned / bill_cancelled / bill_gone     → recorded, not a problem
  v_payload  text;
  v_sub numeric; v_disc numeric; v_tax numeric; v_total numeric; v_n int;
  v_sess_exists boolean; v_sess_binned boolean; v_canc int; v_softdel int;
begin
  for r in
    select * from bill_chain
     where restaurant_id = p_rid and issued_at >= p_from and issued_at < p_to
     order by seq asc
  loop
    v_checked := v_checked + 1;
    -- 1. does this row's own hash still describe this row? (unchanged)
    v_payload := lfh_bill_chain_payload(r.restaurant_id, r.seq, r.session_id, r.invoice_no, r.bill_no,
                                        r.issued_at, r.subtotal, r.discount, r.tax, r.total, r.order_count);
    if lfh_bill_chain_hash(v_payload, r.prev_hash) <> r.chain_hash then
      kind := 'row_rewritten'; seq := r.seq; invoice_no := r.invoice_no; bill_no := r.bill_no;
      detail := 'this entry no longer matches its own signature';
      v_flagged := v_flagged + 1;
      return next;
    end if;
    -- 2. does it still point at the entry before it? (unchanged — the first row in the WINDOW is
    --    only checked against its predecessor when we have one)
    if not v_first and r.prev_hash <> v_prev then
      kind := 'chain_broken'; seq := r.seq; invoice_no := r.invoice_no; bill_no := r.bill_no;
      detail := 'an entry before this one was removed or re-ordered';
      v_flagged := v_flagged + 1;
      return next;
    end if;

    -- 3. does the BILL still say what was signed?
    select coalesce(sum(coalesce(o.taxable_base, o.subtotal, 0) + coalesce(o.nontax_amount, 0)), 0),
           coalesce(sum(coalesce(o.discount, 0)), 0), count(*)
      into v_sub, v_disc, v_n
      from orders o
     where o.session_id = r.session_id and o.deleted_at is null and o.status <> 'cancelled';
    select coalesce(sum(greatest(0, coalesce(t.base,0) - least(coalesce(t.disc,0), coalesce(t.base,0))) * coalesce(t.rate,0)), 0)
      into v_tax
      from (select coalesce(o.tax_rate,0) as rate, sum(coalesce(o.taxable_base, o.subtotal, 0)) as base,
                   sum(coalesce(o.discount,0)) as disc
              from orders o
             where o.session_id = r.session_id and o.deleted_at is null and o.status <> 'cancelled'
             group by coalesce(o.tax_rate,0)) t;
    v_total := round(round(v_sub,2) - least(round(v_disc,2), round(v_sub,2)) + round(v_tax,2), 2);

    if abs(v_total - r.total) > 0.02 then
      -- IT DOES NOT. Before calling that tampering, find out WHY — a recorded act must not read
      -- like an unexplained one. Everything below only ever runs on a bill that has already failed
      -- the arithmetic, so no bill that adds up is touched by any of it.
      v_sess_exists := false; v_sess_binned := false;
      if r.session_id is not null then
        select true, (s.deleted_at is not null) into v_sess_exists, v_sess_binned
          from sessions s where s.id = r.session_id;
      end if;
      select count(*) filter (where o.status = 'cancelled'),
             count(*) filter (where o.deleted_at is not null)
        into v_canc, v_softdel
        from orders o where o.session_id = r.session_id;

      kind := null;
      if not coalesce(v_sess_exists, false) then
        -- the bill's own record is not there any more. bill_chain.session_id carries no foreign
        -- key, and this ledger is append-only, so the link can never be repaired.
        kind := 'bill_gone';
        detail := 'signed at ' || to_char(r.total, 'FM999999990.00')
                  || ' — the bill record this entry points at no longer exists';
      elsif v_sess_binned then
        -- admin console → Bills → delete. Restorable; who did it and why is in deletion_audit.
        kind := 'bill_binned';
        detail := 'signed at ' || to_char(r.total, 'FM999999990.00')
                  || ' — this bill is in the recycle bin (restorable; the removal is in the Audit)';
      elsif v_n = 0 and coalesce(v_canc, 0) > 0 and coalesce(v_softdel, 0) = 0 then
        -- the SALE was undone after its invoice was issued. Mig 331 case B: the number stays,
        -- retired and marked cancelled, and a credit note is how it is corrected.
        kind := 'bill_cancelled';
        detail := 'signed at ' || to_char(r.total, 'FM999999990.00')
                  || ' — the sale was cancelled after this invoice was issued; the number is retired, not reused';
      end if;

      if kind is null then
        -- NONE of the recorded reasons explains it. This is the one that means what it says.
        kind := 'bill_changed';
        detail := 'signed at ' || to_char(r.total, 'FM999999990.00')
                  || ', the bill now adds up to ' || to_char(v_total, 'FM999999990.00');
        v_flagged := v_flagged + 1;
      else
        v_noted := v_noted + 1;
      end if;
      seq := r.seq; invoice_no := r.invoice_no; bill_no := r.bill_no;
      return next;
    end if;
    v_prev := r.chain_hash; v_first := false;
  end loop;

  -- The summary now says what it saw, so a caller can print "12 verified, 8 in the bin" instead of
  -- having to add the rows up itself — and so nothing this function emitted can be silently dropped.
  kind := 'checked'; seq := v_checked; invoice_no := null; bill_no := null;
  detail := v_checked || ' bill(s) verified'
            || case when v_flagged > 0 then ' · ' || v_flagged || ' unexplained' else '' end
            || case when v_noted   > 0 then ' · ' || v_noted   || ' cancelled or binned (recorded)' else '' end;
  return next;
end $$;

-- A REPLACED FUNCTION IS PUBLIC-EXECUTABLE AGAIN BY DEFAULT (the mig 038/267 lesson) — the
-- REVOKE/GRANT is not optional, and `npm run verify:grants` fails without it.
revoke all on function lfh_verify_bill_chain(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function lfh_verify_bill_chain(uuid, timestamptz, timestamptz) to service_role;

comment on function lfh_verify_bill_chain(uuid, timestamptz, timestamptz) is
  'Walks a restaurant''s signed bill ledger over a window. Emits one row per finding: row_rewritten '
  'and chain_broken (the hashes — tampering), bill_changed (the bill still has live orders and they '
  'no longer add up — tampering), and bill_binned / bill_cancelled / bill_gone (mig 353 — a bill in '
  'the recycle bin, a sale cancelled after its invoice, or a bill record that is gone: all recorded '
  'acts, listed but NOT accused), plus a `checked` summary counting each. A bill is only re-labelled '
  'when it has NO live orders AND the reason is visible in the data, so removing one order from a '
  'bill of three is still reported as an alteration.';

NOTIFY pgrst, 'reload schema';
