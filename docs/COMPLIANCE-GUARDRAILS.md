# Compliance & Legal Guardrails — Aevidine (restaurant billing / POS)

**Read this before building, gating, or changing anything that touches bills, invoices, totals,
deletes, the audit log, tax lines, service charge, discounts, or customer data.** The always-on
short version is the "BILLING-COMPLIANCE GUARDRAIL" block in `CLAUDE.md`; this is the full detail.

Last reviewed **2026-07-25** (research incl. the PetPooja/GST raids, CCPA service-charge crackdown,
DPDP Act 2023). Not legal advice — get a lawyer for the Terms of Service and anything ambiguous.

---

## 1. The one idea everything hangs on

We are a **tool-maker, not the taxpayer.** We are safe as long as the software is **physically
incapable of secretly hiding a real sale.** The instant a feature lets a restaurant make a real sale
vanish without a trace, the tool becomes a **"sales-suppression / phantomware device"** and the law
(India CGST §132 — abetting evasion, non-bailable above ₹5 cr) reaches the **makers personally**, not
just the restaurant. Canada and ~33 US states criminalise *making/selling* such software directly.

This is not hypothetical: **PetPooja** — same city (Ahmedabad), same market — is being torn open right
now. ~100 restaurants raided across 45 cities, **60 TB of cloud data seized**, founders summoned; the
mechanism was a backend login that let restaurants **bulk-delete 30–50% of cash bills at month-end**.
Our positioning is the opposite: **"tamper-proof, verifiable, audit-ready — the safe one."**

## 2. ❌ Features to REFUSE (STOP the owner, name the risk, offer the compliant path)

Clients *will* ask for these — it's normal in the market. Do not silently build any of them:

| Requested feature | Why it's the illegal button | Build instead |
|---|---|---|
| Hard/permanent delete of an issued bill or invoice | Erases a real sale with no trace | **Soft-delete** — tombstone + reason + restore (mig 188). Since 2026-08-16 not even a soft delete is offered to the restaurant: **cancel is the only route** (§3.0). |
| **Bulk-delete by date range / "clear cash bills" / month-end wipe** | The exact PetPooja mechanism — the #1 smoking gun | Nothing. This never exists. |
| Edit totals/items on an issued bill; reprint a different total | Silent downward revision of a sale | **Void-with-reason** → new corrected bill, or a **credit note** |
| Parallel / duplicate / "test-mode" bill series that prints real-looking bills | Off-the-books second set of books | One real series only |
| A switch that disables the audit log or invoice history | Removes the trail | Log/history is **non-disableable** |
| Reset / reuse bill or invoice numbers | Gaps are fine; **reuse** hides deletions | Retire numbers, never reuse |
| Hide orders/sales from the Z-report | Under-reports the day | Z-report includes voids/deletes |
| **Revenue-share pricing for Aevidine** | Pulls us into CGST §122(1A) "retains the benefit" liability | Flat **setup fee + recurring** (already the model) |

**Rehearsed refusal:** *"I can't build that — it's the exact feature that put PetPooja's founders
under summons. It puts you in jail, and me with you."* Saying no is the whole game.

## 3. ✅ Correctness rules the software must KEEP (guard when touching billing)

### 3.0 THE CANCELLATION RULE (owner, 2026-08-16) — the one everything else hangs off

> **A sale can be cancelled. A sale can never disappear.**
>
> 1. A bill cancelled **before** a tax invoice exists never draws an invoice number. The invoice
>    series contains real sales only. (Migration 331 refuses it in `lfh_generate_invoice`, so all
>    three doors — manager, tablet, admin — obey it; the panel simply stops offering the button.)
> 2. A tax invoice, once issued, is never deleted, never edited, never renumbered. If the sale is
>    undone, the number **stays, retired and marked CANCELLED** (mig 073, and the "— voided" line
>    `billdoc.js` prints). After the tax period the correction is a **credit note**, never an edit.
> 3. Cancelling always records **who, when and why**, and the cancelled bill stays in the Z-report,
>    the GST report and the day book at ₹0.
> 4. **No one at the restaurant — the owner included — has a button that removes a bill.** Cancel is
>    the only route. Removal from the recycle bin is Aevidine's alone, is still a soft delete, and
>    the sale still counts in every tax figure either way.
> 5. Cancellations are **reported, not just recorded**: the day-close sheet states their count *and
>    their value*, and the Bills record names them beside the money collected.
> 6. **Every issued invoice is signed into an append-only chain** (mig 332) — each link holds the
>    money it was signed at plus the hash of the link before it, so a removed, re-ordered or
>    rewritten entry, and a bill edited after signing, are all *provable* rather than merely
>    forbidden. The day-close report verifies the day and prints the result.

### 3.0b THE KOT RULE, AND WHAT AN INVOICE LOCKS (owner, 2026-08-26)

Asked directly whether the app should gain a "cancel this whole bill" button — with the research
above in front of him — he decided the opposite way, and these are his rules. They are recorded
here because all four are now enforced in code (rule 11 was the last one outstanding; it shipped in
`supabase/migrations/365_reopen_puts_the_table_back_not_the_bill.sql` — a migration file — on
2026-08-26).

> 7. **A BILL IS NEVER CANCELLED AS AN ACT. Only a KOT is cancelled.** *"there will not be bill
>    cancellation. Only there will be only KOT cancellation and which will be going on audit
>    section."* A bill BECOMES cancelled when every KOT on it is cancelled — a derived state, not a
>    button (`billState()` in the manager panel, `deriveBillState` in `lib/billLedger.ts`). Do not
>    add a bill-level cancel, a bill-level cancel reason, or a session-level `cancelled_at`.
>    Recorded as **R47** in `docs/REJECTED-IDEAS.md`.
> 8. **NO INVOICE, NO BILL NUMBER — anywhere a removal is reported.** *"whenever the print … is not
>    clicked, the invoice has not been generated, so the KOT will not know which bill number it is
>    cut from. It will only [show] table and the time."* `bill_no` is an internal daily counter a
>    table takes the moment it opens; it is not a document anyone has seen. Printing it beside a
>    cancelled KOT makes a manager read "Bill #1074 was cancelled" when no bill was ever issued.
>    It is shown only once a tax invoice exists to carry it.
> 9. **THE RECORD SAYS WHAT THE REMOVAL DID TO THE BILL, IN MONEY, EVERY TIME.** *"previously the
>    whole bill was this much and after cutting, this has been removed and the bill is this much."*
>    Bill was → taken out → bill is now. Both ends come from the server
>    (`lib/auditDetail.ts` → `auditBillSides`): AFTER is the live orders on the session summed now,
>    REMOVED is the snapshot the audit row already stores, BEFORE is the two added. No bill history
>    is kept for this and none is guessed.
> 10. **ONCE THE INVOICE IS PRINTED, NOTHING COMES OFF THE BILL.** *"whenever the invoice has been
>     printed — like you have clicked the print button — after [that] you won't be able to delete the
>     thing."* A live invoice number locks every KOT and every dish under it: the paper the guest is
>     holding and the record must not be able to disagree, and a number must never carry a total that
>     exists nowhere. Enforced in the route (`invoiceLockedByOrder`), which is the same helper that
>     already locks the per-dish delete, the quantity stepper and the discount. A **voided** invoice
>     does not lock — that bill was reopened on purpose, and the reopen retired its number.
> 11. **REOPEN RE-OPENS THE TABLE, NOT THE BILL — and only onto a FREE table.** ✅ **BUILT** —
>     `supabase/migrations/365_reopen_puts_the_table_back_not_the_bill.sql` (a migration file).
>     His ruling, 2026-08-26: *"You should reopen table not the bill … if the table has already taken
>     the order, it shouldn't be able to reopen. If the table is free, then only it should be able to
>     reopen, and after reopen you can add the order to that particular bill — you can't delete."*
>     So: a settled bill may be reopened onto its own table **only while that table has no other live
>     party**, because reopening onto an occupied table would merge two parties' money. After the
>     reopen the bill is **add-only** — new KOTs may go on, nothing already on it may come off, and
>     re-printing retires the old invoice number and draws a new one (rule 2).
>
>     **How it was built, checked against the function that is actually installed — not against the
>     plan.** Migration 365 did NOT loosen `lfh_void_invoice`. That function (mig 189, restated by
>     278) still refuses the moment the session is closed — `'the bill is settled and cannot be
>     reopened'`, errcode LFH01 — and that is correct: voiding a LIVE bill's invoice and putting a
>     SETTLED party back on its table are two different acts and must stay two different doors.
>     365 added a **new** function, `lfh_reopen_table(p_session, p_reason, p_actor)`, which:
>       · returns unchanged if the session is already open (idempotent — a replayed offline write or
>         a double tap must not be an error);
>       · refuses (LFH04) when every order on the bill was cancelled — there is no sale to come back
>         to, and reopening would put an empty party on the floor;
>       · refuses (LFH03) when another party is already open on that table number, naming the table.
>         `idx_one_open_session_per_table` (mig 082) already made that impossible; what this adds is
>         a SENTENCE instead of a raw unique-index error;
>       · retires a LIVE invoice number into the append-only `invoice_events` trail with its reason,
>         and never reuses it (CGST Rule 46(b)). A bill that drew no number, or whose number is
>         already voided, simply skips that step;
>       · sets the session back to `open` and clears `closed_at`, and touches `deleted_at` never.
>     Nothing is un-paid and no order is altered. Add-only afterwards needed no new rule: every order
>     on the bill is `payment_status = 'paid'`, and the editor route has always refused to cancel a
>     paid order. Staff-only, per the mig-038 rule (REVOKE from public/anon/authenticated, GRANT to
>     service_role — `npm run verify:grants`). The act reads in the Activity log as **Orders & bills
>     › Reopen the table** (`table_reopened` in `lib/logTrail.ts`), deliberately a different sentence
>     from **Reopen the bill**, which is still what voiding a live invoice says.

**Why number-keeping is not negotiable (point 2).** CGST Rule 46(b) wants a serial that is
consecutive and unique for the financial year, and a cancelled invoice retained *with its own
number, marked cancelled*, so the gap in the sequence is explainable to an officer. Freeing the
number for reuse would put two documents under one number — the pattern an audit reads as
suppression. The owner asked on 2026-08-16 whether this should change; it should not, and this
paragraph is why.

**Where the delete power went.** `canDeleteBill()` (`app/api/editor/[...path]/route.ts`) answers
true only when there is no staff cookie — the Aevidine admin console. The grantable "Delete a bill"
rows left `lib/accessTree.ts` and `lib/accessModel.ts` the same day; stored values are left in the
database, unread. See `docs/REJECTED-IDEAS.md` R27 before ever re-adding it.


- **Append-only bills.** No hard delete of an issued bill anywhere — deletes are soft (mig 188,
  `lib/softDelete.ts`): stamp `deleted_at`/by/reason, keep the row, show a tombstone, allow restore.
- **Non-disableable audit + invoice history.** `staff_actions` log and the append-only
  `invoice_events` table (mig 189) have no "off" switch. Never add one.
- **Invoice lifecycle (owner rule 2026-07-25):** a *bill* never reopens; only the *invoice* can be
  voided/re-issued, and **only while the table is not settled** (session open). Once closed it locks
  — corrections go via a **credit note**, not an edit. **Void requires a reason**; a re-issue records
  its reason. Numbers retire on void, never reuse. (Enforced in `lfh_void_invoice` /
  `lfh_generate_invoice`, mig 189.)
- **Service charge is NEVER default or mandatory** in a bill. CCPA guideline (4 Jul 2022) + Delhi HC
  (Mar 2025): it must be voluntary. **Chaayos was fined ₹50,000 because its billing software defaulted
  it** — a direct software-liability precedent. If service charge is ever added: opt-in, clearly
  voluntary, one-tap removable, never pre-ticked, never under another name.
- **Composition-scheme restaurant (turnover ≤ ₹1.5 cr, flat 5%): the diner bill must show NO GST
  line** — they cannot legally pass the tax to the customer. Suppress the tax line for such a tenant.
- **Never hardcode a tax rate** — always `lib/tax.ts` / `lfh_effective_tax_rate`. Standard dine-in is
  5% (no ITC); **18% only** for restaurants inside hotels with room tariff ≥ ₹7,500/night; alcohol
  ⇒ 18% and composition scheme unavailable.
- **Real GSTIN on any tax invoice** — remove the placeholder GSTIN before any tenant files a real bill.
- **e-invoice / IRN is B2B only, turnover > ₹5 cr** — never stamp it on an ordinary diner bill.
- **Reconcile to the rupee** — Z-report / dashboards must include voids and deleted bills (our past
  revenue-mismatch bugs prove this is fragile; keep it exact).
- **Records retention 6–8 years** — even a tenant purged from the recycle bin must retain bills. The
  recycle bin no longer imposes a waiting period before a permanent removal (owner, 2026-08-20,
  migration 342), so this rule now stands entirely on its own: a purge deletes the menu, staff,
  settings, saved customers, the activity log and the printing setup, and **keeps** orders,
  order_items, sessions, payments, session_payments, credit_notes, invoice_events, deletion_audit
  and the numbering counters — the restaurants row survives, marked `purged_at`, so those bills have
  a parent. `bill_chain` cannot be removed even deliberately: migration 332's append-only trigger
  refuses a DELETE to every role, service role included.

  **Check the LIVE purge, not one migration.** `admin_purge_restaurant` has been rewritten six times
  (migs 128 → 309 → 321 → 342 → 345 → 346, the last two adding operational and printing tables), so
  a check that reads one migration's text stops guarding the moment the next one lands.
  `npm run verify:t24-money-rules` asserts that **every** migration defining that function deletes
  no money table; `npm run verify:admin-restaurants` still reads migration 342 only and should be
  pointed at the newest definition.

## 4. Customer data — DPDP Act 2023 (we collect phone / khata book / feedback)

Take **consent** for collecting personal data, state the purpose, don't over-retain, secure it, and
support breach-notification (72 h). Penalties are severe (₹250 cr ceiling for a security-safeguard
failure). Full enforcement is expected ~May 2027 — build consent in cheaply now rather than retrofit.

## 5. Tenant OPERATING compliance (not our code — but every client needs it; a sales point: "we help you stay clean")

- **Licences:** FSSAI food licence (mandatory, no exceptions) · GST registration (turnover > ₹20 L;
  day-one for aggregator/inter-state) · Trade/Health licence (municipal — some states now let FSSAI
  cover it) · Fire NOC · Shops & Establishments registration · Eating House licence (police
  commissioner) · Liquor/Excise licence if alcohol · Legal Metrology approval for weighing scales ·
  Pollution Control NOC (larger kitchens) · signage; music (PPL/IPRS) if playing recorded music.
- **Labour:** Shops & Est registers/hours · PF (20+ workers, wage ≤ ₹15k) · ESI (10+ employees, wage
  ≤ ₹21k) · state minimum wages · gratuity (5 yr; new labour codes live Nov 2025) · professional tax.
- **GST rates quick ref:** register ≥ ₹20 L · composition ≤ ₹1.5 cr = flat 5%, no ITC, no diner tax
  line, no alcohol · standard 5% no ITC · 18% + ITC only for hotel-restaurants (room ≥ ₹7,500/night) ·
  aggregator (Zomato/Swiggy) sales: platform pays the 5% under CGST §9(5).

## 6. To-do (cheap now, real shield)

- **Lawyer** → Aevidine Terms of Service: sole-responsibility, no-tax-advice, no-misuse, indemnity,
  audit-trail acknowledgement. (ToS is half the shield; architecture is the other half.)
- ~~Aim for the **European bar** (every sale signed / hash-chained / tamper-evident)~~ → **BUILT
  2026-08-16, migration 332.** Every issued invoice is signed into an append-only `bill_chain`: each
  link carries the bill's identity, the money it was signed at, and the hash of the link before it.
  Written inside `lfh_generate_invoice` (the one door all three panels use, so it cannot be skipped)
  and protected by a trigger that refuses UPDATE and DELETE to every role, service role included.
  `lfh_verify_bill_chain(rid, from, to)` answers both questions an inspector has — was the LEDGER
  touched (a link rewritten, or one removed so the chain no longer joins), and was a BILL touched
  after signing (its live orders no longer add up to what was signed). The **day-close Z-report runs
  it automatically** and prints the result beside the money, which is where those regimes want the
  proof. This is the property France's NF525 calls *inalterability* and Germany's KassenSichV
  enforces with a certified module; we are not claiming their certification, only the behaviour.

**Done since (do not re-add as to-dos):**

- **A discount is grossed at the rate it was CHARGED, everywhere.** Was a real gap: the owner
  dashboard/reports grossed a discount at the rate configured *now* while the bill, the Z-report and
  pay-in-parts used `orders.tax_rate` (mig 284), so a discounted bill whose rate later changed — or a
  banquet at its own rate — made the two disagree by `discount × (rate_now − rate_charged)`. Closed by
  **migration 301**: `orders.disc_gross` is computed at write time from the order's own rate, and all
  nine owner money functions plus both rollups subtract it. Guarded by 4 checks in `verify:audit`.

- **Placeholder GSTIN — gone.** `billIdentity()` (`public/panels/billdoc.js`) never invents a GSTIN,
  address or phone; an unconfigured restaurant prints no such line at all, and the dead constant that
  held the invented values was deleted 2026-08-05. Guarded by `verify:print-format`.
- **Credit notes — built.** A `credit_notes` table (`credit_no`, `amount`, `reason`, `actor`), the
  `lfh_issue_credit_note(p_session, p_amount, p_reason, p_actor)` RPC, an admin route
  (`app/api/admin/bills/route.ts`) that refuses a zero/negative amount and requires a reason, and a
  `credit_note` audit line naming the bill and the amount.

---

*Sources (2026-07-25 research): Taxmann/TaxGuru/Inc42 on the PetPooja POS controversy & GST raids;
CleverTax/IndiaFilings on restaurant GST & composition scheme; SCC Online / CCPA on the Chaayos
service-charge penalty & Delhi HC 2025 ruling; EY/Seclore on DPDP Act 2023; estartindia/gofrugal on
restaurant licences & labour compliance. Verify specifics with a professional before relying on them.*
