# T8 improvements — printing, the bill document & the numbers on it

Sweep #6, phases P03501–P04000. Ideas only; the two marked BUILT are already in this branch.

## 🟢 BUILT (inside my territory, small, no migration, no new screen)

### I1 — `docs/NUMBERING.md` names the signed chain (mig 332)
The page is the one place that answers "where did that bill number go?", and it sent people to the
Audit and the admin bill ledger only. Since migration 332 there is a stronger answer — the
hash-chained ledger written the moment a bill becomes a tax document, which makes a removed or
re-ordered row visible rather than merely forbidden. Added as a third bullet, pointing at the
migration rather than restating it. Also added the "find these by CONTENT, not by the number in the
filename" line, because 18 migration numbers are already duplicated on `main`.

### I2 — the customer-suggestion rows are a real tap target (44px)
Measured 29px on a 360px phone. Tapping one of these rows puts a NAMED PERSON on a tax invoice, so a
mis-tap does not merely annoy — it bills the wrong customer. `min-height:44px` with the content
centred, so a two-line name grows instead of being squeezed.

## ✅/🔗 1 and 2 — the owner said do both. The DOCUMENT half is built; the data plumbing is handed off
(see `T8-findings.md` → I3, I4 and handoffs 3–4). The notes below are kept as the original reasoning.

### 1. Mark a reprinted BILL as a reprint — ✅ PAPER BUILT 2026-08-17 (owner: "do both 11 and 12")
The kitchen ticket has carried a big bordered DUPLICATE banner since 2026-08-04 (owner's own ask).
The bill has nothing — a second copy is indistinguishable from the original. The document could
carry it off a single `reprint` flag, exactly as the ticket does, but the flag has to be threaded
from each panel's reprint path (`editor/app.js`, `tablet/app.js`), which are not mine. And it is a
genuine product decision: a DUPLICATE band on a guest's copy is reassuring to some restaurants and
unwelcome noise to others. **If yes:** a re-issued bill can never be passed off as a first issue.
**If no:** nothing breaks; the numbers already tie a reprint back to its original.

### 2. Print the bill's chain reference (mig 332) — ✅ PAPER BUILT 2026-08-17 (owner: "do both 11 and 12")
Germany's KassenSichV prints the signature on the receipt, which is what lets whoever holds the
paper check it rather than take the software's word. The chain exists in the database; nothing
exposes it to the panels. **If yes:** the compliance argument becomes checkable from the paper.
**If no:** nothing breaks — the chain still detects tampering, it just cannot be verified from a
guest's copy. Needs a migration, so it is out of a sweep's scope.

### 3. `grossTaxed` / `netIncl` still conflate "not exempt" with "in the taxable base"
F5 is fixed at the point that matters (an MRP line held outside its order's taxable base is no
longer counted as a taxed row). The underlying shape is still loose: `netIncl` is apportioned
against `taxableBase` and clamped to 1, which is a clamp hiding an assumption rather than an
identity. Nothing reaches it today and every printed figure now foots. Rewriting `billMoney` to
carry the taxable/untaxed split per line would be the clean answer — a real piece of work on the
file that decides every bill's money, and not something to do at the end of a sweep.

### 4. The Audit's evidence bill should resolve a renamed table
Written up as HANDOFF 2 in `T8-findings.md` — the file is another terminal's.
