# Loyalty plan — costed, phased, and mostly free

> Owner decision, 2026-09-13: **build the NON-guest-mode version first.** Most restaurants will
> not take guest mode, so loyalty must work with nothing but the counter tablet and the printed
> bill. The guest-mode version is PARKED in §3 — not rejected, deferred until a restaurant runs
> guest mode. Research behind the numbers: §4.

Related: `docs/COMPLIANCE-GUARDRAILS.md` (a discount is still a money change → audit row),
`docs/NUMBERING.md`, `docs/PRINT-HELPER.md`, `docs/SAAS-EFFICIENCY-PLAYBOOK.md`.

---

## 1. The foundation already exists — loyalty is not a new system

Shipped 2026-07-27 (PR #495, mig 212, live on backup-1 AND AV live), extended by migs 227 / 228 /
229 / 233. **Do not rebuild any of this:**

| Piece | Where it lives | Status |
|---|---|---|
| Phone + name captured at bill time (consent-gated) | Tablet + Manager panel → pay sheet → consent box | LIVE |
| `customers.visits`, `customers.consent` | mig 212 | LIVE |
| `customer_visits` ledger (session_id UNIQUE → idempotent, reversible on unpay) | mig 212 / 233 | LIVE |
| "✨ Repeat customer · visit #N" chip + name prefill | Tablet + Manager pay sheet | LIVE |
| Customer list, visits column, consent ✓, DPDP erase | Owner panel → Customers | LIVE |

**The identity layer is done.** Loyalty = points on top of a row that already counts visits.

---

## 2. PHASE 1 — non-guest-mode loyalty. Running cost: ₹0

> ✅ **BUILT 2026-09-19** (branch `feat/loyalty-points`, mig 401). The admin switch is
> **Access & permissions → Extra features → Loyalty points**, OFF for every restaurant. Driven in
> Chrome end to end: the switch saves and reads back; with it OFF the endpoint answers `{on:false}`,
> the pay-sheet row hides and empties, the bill carries no points block and a redeem is refused in
> plain words; with it ON a ₹1,000 bill earns 50, 268 points become ₹268 off (order net 768.60 =
> the tax-correct gross-up), the ledger and the `deletion_audit` row are both written. 24 SQL
> behaviour checks + 5 rendered-paper checks. Every test row was deleted and the restaurant put
> back to OFF. **Not yet built:** the owner-facing screen for editing the earn rate (the defaults
> below are what every restaurant gets), and the hand-correction route for `kind='adjust'`.

Three touchpoints exist without guest mode: the **counter tablet**, the **printed bill**, and the
**cashier's mouth**. That is enough for a complete programme.

### 2.1 Earning — backend only, nothing on screen
- A `points` column on `customers` + an earn rule per restaurant (default: 1 point per ₹10 net of tax).
- Stamped on the SAME settle that already writes the `customer_visits` row — no new write path,
  no new query, no extra egress. Reversed by the existing unpay path.
- Points must be a **ledger, not a counter** — one row per earn/redeem, so a cancelled bill can
  reverse exactly what it granted. A bare integer cannot be audited and cannot be undone. This is
  the same reason `customer_visits` is a ledger.

### 2.2 Showing — printed on the thermal bill
Two lines appended to the bill template:

```
  ⭐ Points earned today:  42
     Your total:          268
     32 more → free dessert
```

- Delivered 100% of the time (they are holding it), costs nothing, needs no phone, no app, no network.
- Respect the paper-geometry traps already documented in `docs/PRINT-HELPER.md`.
- Only prints when the bill has a captured customer AND the module is on.

### 2.3 Redeeming — the cashier does it
- Tablet + Manager panel → pay sheet → beside the existing repeat-customer chip:
  `· 268 ⭐ · [Redeem 250 → ₹100 off]`
- Applies through the EXISTING discount path (discount before tax, grossed at the rate charged —
  do not invent a second discount route; see `docs/CLAUDE-DETAIL.md` "A new way replaces the old one").
- Redemption writes an audit row like every other money change (R-compliance).

### 2.4 Known trade-offs — state these to the owner, do not hide them
1. **You cannot reach a guest between visits.** No win-back, no birthday offer. That is the price
   of ₹0, and it is how a paper punch-card works too.
2. **The cashier types the number, so a typo credits a stranger.** Mitigation: the matched NAME
   must be large on the pay sheet so the cashier reads it back ("Rahul ji?"). Name only — never
   show the phone number on a screen a guest can see (DPDP, already the rule for the greeter).
3. **Unverified numbers.** Fine for earning; it becomes a problem only if Phase 2/3 ever messages
   them. Do not paper over it now.

### 2.5 Module checklist (the 11 points) — non-negotiable
Admin entitlement default OFF · admin-controlled not owner · permission-scoped · rules in the RPC
scoped by `restaurant_id` · surfaced on tablet + manager + owner · renders nothing when off ·
beginner-simple UI · any new drawer registered with the back-button manager · egress-safe (no new
poll — ride the settle write) · works offline (earn queues through the panel `api()` like every
other write) · `expect:` clash guard on redeem so two tills cannot spend the same points twice.

**⚠️ `redeem` is the one that can double-spend.** First save wins, the loser is told. Do not ship
redeem without it.

---

## 3. PHASE 2 — PARKED: the guest-mode version (owner, 2026-09-13: "maybe we will use it later")

Only switch this on for a restaurant that already runs guest mode. It is additive — Phase 1 keeps
working underneath.

### 3.1 Points on the guest's own menu screen — ₹0
- A "Your points: 268 ⭐" strip under the header on the guest menu.
- **Must hold on all THREE guest doors** — `/menu`, `/r/<slug>/menu`, `/q/<code>` (PR #761's lesson).
- Identified by the existing `customer_devices` / `lfh_greet_device` anon path — the same one the
  "Welcome back {name} 👋" toast uses. **Name and points only, never the phone number.**
- Costs nothing: it is a page render on a screen the guest already opened.

### 3.2 "Get your bill + points on WhatsApp" — ₹0, and NOT dependent on guest mode
The free-window trick, written down so it is not re-derived:

> Meta charges when the BUSINESS opens the conversation. It charges **nothing** when the CUSTOMER
> opens it — that opens a **24-hour customer service window** in which replies are free.

- Print a QR on the bill → `https://wa.me/<number>?text=Bill%204471` → guest taps send.
- Their message opens the window; your reply (bill PDF + points balance) is a **free service message**.
- **It also replaces the paid OTP**: the message arrives FROM their number, so the number is proven
  by the act of sending. No authentication template, no ₹0.1357. See §4.3 — this supersedes the
  OTP design on branch `worktree-whatsapp-phone-verify`.
- Works with or without guest mode. It only needs a printed QR.

### 3.3 Win-back — the ONLY thing that genuinely costs money
- Reaching someone who has not visited in weeks means the window is shut. That is a paid
  **marketing** template, ~₹1.02/head inc. GST. There is no free or legal way around it.
- Build it as an off-by-default module with a **hard spend cap** and the price shown on the button
  BEFORE sending. Lands in Owner panel → Marketing & offers (today a `ComingSoon` placeholder).
- Word the template carefully — see the re-categorisation trap in §4.2.

---

## 4. The research behind the numbers (2026-09-13)

### 4.1 Costed over 3 years — one restaurant, 1,500 bills/month, ~600 active members

| Route | 3-year cost | Verdict |
|---|---|---|
| **Phase 1 (bill-printed, no messages)** | **₹0** | **BUILD THIS** |
| Phase 2 guest-initiated WhatsApp | ₹0 | free, add later |
| Phase 2 + quarterly win-back to top 200 | ₹2,444 | optional, capped |
| WhatsApp message-heavy (the PetPooja shape) | ₹25,416 | 87% of it is marketing templates |
| SMS via DLT | ₹10,490 **+ ₹6,962 one-time per restaurant** | dead on arrival for a SaaS |
| PetPooja loyalty module + WhatsApp connector | ₹36,750 – ₹90,750 | the thing we are replacing |

### 4.2 Meta rates, India, per message (July 2026 card, **+18% GST**)
- Authentication ₹0.1150 → **₹0.1357**
- Utility ₹0.1150 → **₹0.1357**
- Marketing ₹0.8631 → **₹1.0185**
- Service reply inside an open window → **₹0**

**⚠️ The re-categorisation trap.** "You have 268 points" is a *utility* template (₹0.14). Add
"**redeem now**", "**offer**", "**exclusive**" or any new-purchase nudge and Meta silently
reclassifies it as **marketing — 7.5× the price**, same message. Never write a CTA into a utility
template.

### 4.3 Dated facts that will go stale — recheck before building Phase 2/3
- **1 Oct 2026:** service messages become billable past **1,000/month per phone number** (free
  allowance, resets monthly, no rollover). At ~600/month one restaurant stays free.
- **30 Sep 2026:** a payment method must be on file with Meta or delivery of service messages
  STOPS from 1 Oct. Applies the moment a restaurant goes live on the API.
- The 1,000 allowance is **per number**, so one shared "Aevidine" number splits one allowance
  across all tenants; a number per restaurant gets 1,000 each (needs Meta Tech Provider +
  Embedded Signup). Decide before the first paying tenant, not after.

### 4.4 Ruled out, with the reason
- **SMS/DLT** — ₹5,900+GST entity registration **per restaurant** before message one. You cannot
  onboard a client by sending them to the telecom regulator.
- **RCS** — ₹0.30/promo is 3.4× cheaper than WhatsApp marketing, but needs a verified bot per
  brand and has no regulated tariff (rates already rose Sept 2026). Revisit only if promo volume
  ever becomes real.
- **Email** — Brevo 300/day free forever, genuinely ₹0, but Indian restaurant guests do not give
  an email address. Keep as a silent backup, never the main line.
- **Web Push (VAPID, self-hosted)** — genuinely free and unlimited, but iOS needs the page added
  to the Home Screen, which a walk-in guest will never do. **Right answer for STAFF panels**
  (`public/sw.js` already runs a service worker), wrong one for guests.
- **Free WhatsApp Business App** — ₹0 but manual, 256-contact broadcast cap, recipient must have
  saved the number, and it cannot share a number with the API. Fine for a one-owner café, not a
  SaaS feature.

---

## 5. Why this is a real advantage, not a compromise

PetPooja's POS sits behind the counter, so the only way it can tell a guest anything is to **pay
for a message**. Their pricing follows from that constraint.

Aevidine prints the bill and (optionally) owns the guest's screen. The guest is told their balance
at the exact moment they are paying, for free, on paper they are already holding. **Messaging is
optional for us and mandatory for them.** That is the whole ₹36,750 gap.
