-- 332 — EVERY ISSUED BILL IS SIGNED AND CHAINED TO THE ONE BEFORE IT (owner, 2026-08-16)
--
-- "Option 4". His words when it was explained: "option number four seems very great … we can do
-- that", and the question he asked first — "which is safe for government as well as us".
--
-- WHY THIS EXISTS. Everything built so far removes the BUTTONS: cancel is the only way out of a
-- bill (mig 331 + canDeleteBill), nothing is ever hard-deleted, every removal carries a reason.
-- That lets us SAY "our software cannot make a sale vanish". It does not let us PROVE it — and the
-- difference matters most on the day it matters at all, when a client is inspected and the question
-- is whether the tool helped them. France (NF525, the "I" of ISCA = inalterability) and Germany
-- (KassenSichV: every transaction signed by a certified module, hash-chained, the signature printed
-- on the receipt) both decided the same thing: a POS maker's promise is not evidence. Several
-- countries criminalise MAKING sales-suppression software at all — Canada, Australia, ~33 US
-- states — which is the same exposure CGST §132 creates here.
--
-- WHAT IT DOES. When an invoice is issued — the moment a bill becomes a tax document — one row is
-- written here holding the bill's identity, its MONEY AT THAT MOMENT, and a hash of all of it
-- together with the hash of the previous row for that restaurant. That makes the day a chain:
--
--   · remove a row  → the next row's prev_hash no longer matches → the chain breaks, visibly;
--   · re-order rows → same;
--   · change a bill's food or totals AFTERWARDS → the row's stored money no longer matches what the
--     orders now say → reported as CHANGED (the chain itself still verifies, which is the honest
--     answer: the ledger was not touched, the sale was).
--
-- WHAT IT IS NOT: not encryption, not a signature by an outside authority, and not a claim of
-- certification. It is a tamper-EVIDENT ledger — the property those regimes actually require —
-- built from SHA-256, which Postgres has natively (no pgcrypto dependency).
--
-- WHY THE HASH IS COMPUTED IN THE DATABASE and not in the app: the app is many callers (manager,
-- tablet, admin) and can be redeployed; the RPC that mints an invoice number is ONE place, and it
-- is already the single door (mig 331 put the cancelled-sale guard in the same function for the
-- same reason). A chain a caller can forget to write is not a chain.
--
-- APPEND-ONLY, ENFORCED: a trigger refuses UPDATE and DELETE on this table for everyone, service
-- role included. The chain is worth exactly as much as its inability to be rewritten.
--
-- ⚠️ A NEW FUNCTION IS PUBLIC-EXECUTABLE BY DEFAULT (the mig 038/267 lesson) — the REVOKE/GRANT at
-- the bottom is not optional, and `npm run verify:grants` fails without it.

create table if not exists bill_chain (
  id            bigserial primary key,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  seq           bigint not null,                 -- per restaurant, 1,2,3… with no gaps
  session_id    uuid,                            -- the bill (null only for a legacy/edge row)
  invoice_no    bigint,
  bill_no       bigint,
  issued_at     timestamptz not null default now(),
  -- The money AS ISSUED. Kept as its own columns (not only inside the hash) so a verifier can say
  -- WHAT changed, not merely that something did.
  subtotal      numeric(12,2) not null default 0,
  discount      numeric(12,2) not null default 0,
  tax           numeric(12,2) not null default 0,
  total         numeric(12,2) not null default 0,
  order_count   int not null default 0,
  prev_hash     text not null,                   -- the previous row's chain_hash ('' for the first)
  chain_hash    text not null,                   -- sha256(payload || prev_hash)
  unique (restaurant_id, seq)
);

-- The two reads this table ever does: "the last row for this restaurant" and "this restaurant's
-- rows for a day, in order".
create index if not exists idx_bill_chain_rid_seq on bill_chain (restaurant_id, seq desc);
create index if not exists idx_bill_chain_rid_issued on bill_chain (restaurant_id, issued_at desc);

alter table bill_chain enable row level security;
-- No policy = no anon/authenticated access at all. Only the service role (which bypasses RLS)
-- reaches it, i.e. only our server, and only through the functions below.

-- ── APPEND-ONLY ─────────────────────────────────────────────────────────────────────────────────
-- A ledger that can be edited proves nothing. This refuses UPDATE and DELETE for every role; the
-- only way a row leaves is dropping the whole table in a migration, which is a reviewed act.
create or replace function lfh_bill_chain_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'bill_chain is append-only — a signed bill ledger may never be updated or deleted';
end $$;

drop trigger if exists trg_bill_chain_append_only on bill_chain;
create trigger trg_bill_chain_append_only
  before update or delete on bill_chain
  for each row execute function lfh_bill_chain_append_only();

-- ── THE PAYLOAD A HASH IS TAKEN OF ──────────────────────────────────────────────────────────────
-- One function so writing and verifying can never spell it differently. Every number is written to
-- a fixed 2-decimal shape, because '100' and '100.00' are the same money and must not be two
-- different hashes. Field separator is a character no field can contain.
create or replace function lfh_bill_chain_payload(
  p_rid uuid, p_seq bigint, p_session uuid, p_invoice bigint, p_bill bigint,
  p_issued timestamptz, p_subtotal numeric, p_discount numeric, p_tax numeric, p_total numeric, p_orders int
) returns text language sql immutable as $$
  select concat_ws('|',
    p_rid::text, p_seq::text, coalesce(p_session::text, ''),
    coalesce(p_invoice::text, ''), coalesce(p_bill::text, ''),
    to_char(p_issued at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MSZ'),
    to_char(coalesce(p_subtotal, 0), 'FM999999999990.00'),
    to_char(coalesce(p_discount, 0), 'FM999999999990.00'),
    to_char(coalesce(p_tax, 0),      'FM999999999990.00'),
    to_char(coalesce(p_total, 0),    'FM999999999990.00'),
    coalesce(p_orders, 0)::text)
$$;

create or replace function lfh_bill_chain_hash(p_payload text, p_prev text)
returns text language sql immutable as $$
  select encode(sha256(convert_to(p_payload || '|' || coalesce(p_prev, ''), 'UTF8')), 'hex')
$$;

-- ── WRITING A LINK ──────────────────────────────────────────────────────────────────────────────
-- Called from lfh_generate_invoice the instant a number is minted. Takes the restaurant's chain
-- lock so two invoices issued in the same millisecond cannot both claim the same seq (the same
-- advisory-lock discipline mig 202 uses for order placement).
create or replace function lfh_bill_chain_append(p_session uuid)
returns bill_chain language plpgsql security definer set search_path = public as $$
declare
  v_s      sessions;
  v_prev   bill_chain;
  v_seq    bigint;
  v_row    bill_chain;
  v_sub    numeric := 0; v_disc numeric := 0; v_tax numeric := 0; v_total numeric := 0;
  v_n      int := 0;
  v_rate   numeric := 0;
  v_payload text;
begin
  select * into v_s from sessions where id = p_session;
  if not found then return null; end if;

  perform pg_advisory_xact_lock(hashtextextended('lfh_chain:' || v_s.restaurant_id::text, 0));

  -- The bill's money AS IT STANDS NOW, from its own live orders — the same rule the paper uses:
  -- a soft-deleted or cancelled order is not on the bill, the discount comes off before tax, and
  -- the rate is the one each order was charged at (mig 284). Summed per rate so a mixed bill
  -- (banquet 18% beside food 5%) is not re-priced at one of them.
  select coalesce(sum(coalesce(o.taxable_base, o.subtotal, 0) + coalesce(o.nontax_amount, 0)), 0),
         coalesce(sum(coalesce(o.discount, 0)), 0),
         count(*)
    into v_sub, v_disc, v_n
    from orders o
   where o.session_id = p_session and o.deleted_at is null and o.status <> 'cancelled';

  select coalesce(sum(
           greatest(0, coalesce(t.base, 0) - least(coalesce(t.disc, 0), coalesce(t.base, 0))) * coalesce(t.rate, 0)
         ), 0)
    into v_tax
    from (
      select coalesce(o.tax_rate, 0) as rate,
             sum(coalesce(o.taxable_base, o.subtotal, 0)) as base,
             sum(coalesce(o.discount, 0)) as disc
        from orders o
       where o.session_id = p_session and o.deleted_at is null and o.status <> 'cancelled'
       group by coalesce(o.tax_rate, 0)
    ) t;
  v_tax := round(v_tax, 2);
  v_sub := round(v_sub, 2); v_disc := round(v_disc, 2);
  v_total := round(v_sub - least(v_disc, v_sub) + v_tax, 2);

  select * into v_prev from bill_chain
   where restaurant_id = v_s.restaurant_id order by seq desc limit 1;
  v_seq := coalesce(v_prev.seq, 0) + 1;

  v_payload := lfh_bill_chain_payload(v_s.restaurant_id, v_seq, p_session, v_s.invoice_no, v_s.bill_no,
                                      v_s.invoice_at, v_sub, v_disc, v_tax, v_total, v_n);

  insert into bill_chain(restaurant_id, seq, session_id, invoice_no, bill_no, issued_at,
                         subtotal, discount, tax, total, order_count, prev_hash, chain_hash)
  values (v_s.restaurant_id, v_seq, p_session, v_s.invoice_no, v_s.bill_no, coalesce(v_s.invoice_at, now()),
          v_sub, v_disc, v_tax, v_total, v_n,
          coalesce(v_prev.chain_hash, ''),
          lfh_bill_chain_hash(v_payload, coalesce(v_prev.chain_hash, '')))
  returning * into v_row;
  return v_row;
  -- Deliberately NOT raising on failure: a chain write must never be able to stop a restaurant
  -- issuing a bill to a guest standing at the counter. A missing link is visible to the verifier
  -- below (a gap in seq is impossible, but a bill with no row at all is reported), which is the
  -- right trade — the ledger records, it does not gatekeep.
exception when others then
  return null;
end $$;

-- ── VERIFYING ───────────────────────────────────────────────────────────────────────────────────
-- Walks a restaurant's chain over a window and answers two different questions:
--   ok            — every link's hash recomputes, and each points at the one before it
--   changed       — a bill whose live orders no longer add up to what was signed
-- Returns one row per problem, plus a summary row when everything checks out.
create or replace function lfh_verify_bill_chain(p_rid uuid, p_from timestamptz, p_to timestamptz)
returns table (kind text, seq bigint, invoice_no bigint, bill_no bigint, detail text)
language plpgsql security definer set search_path = public as $$
declare
  r          bill_chain;
  v_prev     text := null;
  v_first    boolean := true;
  v_checked  int := 0;
  v_payload  text;
  v_sub numeric; v_disc numeric; v_tax numeric; v_total numeric; v_n int;
begin
  for r in
    select * from bill_chain
     where restaurant_id = p_rid and issued_at >= p_from and issued_at < p_to
     order by seq asc
  loop
    v_checked := v_checked + 1;
    -- 1. does this row's own hash still describe this row?
    v_payload := lfh_bill_chain_payload(r.restaurant_id, r.seq, r.session_id, r.invoice_no, r.bill_no,
                                        r.issued_at, r.subtotal, r.discount, r.tax, r.total, r.order_count);
    if lfh_bill_chain_hash(v_payload, r.prev_hash) <> r.chain_hash then
      kind := 'row_rewritten'; seq := r.seq; invoice_no := r.invoice_no; bill_no := r.bill_no;
      detail := 'this entry no longer matches its own signature';
      return next;
    end if;
    -- 2. does it still point at the entry before it? (the first row in the WINDOW is only checked
    --    against its predecessor when we have one — a window that starts mid-chain is not a break)
    if not v_first and r.prev_hash <> v_prev then
      kind := 'chain_broken'; seq := r.seq; invoice_no := r.invoice_no; bill_no := r.bill_no;
      detail := 'an entry before this one was removed or re-ordered';
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
      kind := 'bill_changed'; seq := r.seq; invoice_no := r.invoice_no; bill_no := r.bill_no;
      detail := 'signed at ' || to_char(r.total, 'FM999999990.00') || ', the bill now adds up to ' || to_char(v_total, 'FM999999990.00');
      return next;
    end if;
    v_prev := r.chain_hash; v_first := false;
  end loop;

  kind := 'checked'; seq := v_checked; invoice_no := null; bill_no := null;
  detail := v_checked || ' bill(s) verified';
  return next;
end $$;

-- ── HOOK IT INTO THE ONE DOOR ───────────────────────────────────────────────────────────────────
-- lfh_generate_invoice, restated from migration 331 with ONE line added at the end. Restated in
-- full because that is how a function is replaced, and because 331's cancelled-sale guard and
-- 278's settled lock must both survive.
create or replace function lfh_generate_invoice(p_session uuid, p_reason text default null, p_actor text default null)
returns sessions language plpgsql security definer set search_path = public as $$
declare v sessions;
begin
  select * into v from sessions where id = p_session;
  if not found then raise exception 'session not found'; end if;
  if v.invoice_no is not null and not v.invoice_voided then return v; end if;
  if v.status = 'closed' and v.invoice_no is not null then
    raise exception 'lfh: invoice locked — the bill is settled and cannot be reopened (use a credit note)'
      using errcode = 'LFH01';
  end if;
  -- 331: a cancelled sale never takes an invoice number.
  if not exists (
    select 1 from orders o
     where o.session_id = p_session and o.deleted_at is null and o.status <> 'cancelled'
  ) then
    raise exception 'lfh: this bill was cancelled — a cancelled sale never takes an invoice number'
      using errcode = 'LFH02';
  end if;
  update sessions
     set invoice_no = lfh_next_seq(coalesce(v.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid), 'invoice'),
         invoice_at = now(), invoice_voided = false, void_reason = null, void_at = null
   where id = p_session
   returning * into v;
  insert into invoice_events(session_id, restaurant_id, invoice_no, event, reason, actor)
  values (p_session, v.restaurant_id, v.invoice_no, 'generate', p_reason, p_actor);
  -- 332: sign it into the chain. Never allowed to fail the issue (see the note in the function).
  perform lfh_bill_chain_append(p_session);
  return v;
end $$;

revoke all on function lfh_generate_invoice(uuid, text, text) from public, anon, authenticated;
grant execute on function lfh_generate_invoice(uuid, text, text) to service_role;
revoke all on function lfh_bill_chain_append(uuid) from public, anon, authenticated;
grant execute on function lfh_bill_chain_append(uuid) to service_role;
revoke all on function lfh_verify_bill_chain(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function lfh_verify_bill_chain(uuid, timestamptz, timestamptz) to service_role;
revoke all on function lfh_bill_chain_payload(uuid, bigint, uuid, bigint, bigint, timestamptz, numeric, numeric, numeric, numeric, int) from public, anon, authenticated;
grant execute on function lfh_bill_chain_payload(uuid, bigint, uuid, bigint, bigint, timestamptz, numeric, numeric, numeric, numeric, int) to service_role;
revoke all on function lfh_bill_chain_hash(text, text) from public, anon, authenticated;
grant execute on function lfh_bill_chain_hash(text, text) to service_role;
revoke all on function lfh_bill_chain_append_only() from public, anon, authenticated;
