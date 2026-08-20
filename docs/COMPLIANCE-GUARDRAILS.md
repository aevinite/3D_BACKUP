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
  settings, saved customers and activity log, and **keeps** orders, order_items, sessions, payments,
  session_payments, credit_notes, invoice_events, deletion_audit and the numbering counters — the
  restaurants row survives, marked `purged_at`, so those bills have a parent. Guarded by
  `npm run verify:admin-restaurants`, which fails if migration 342 ever deletes a money table.

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
