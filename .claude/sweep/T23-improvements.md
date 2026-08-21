# T23 improvements — the database, migrations 231 → the newest

Working machinery for the merge terminal. Two 🟢 built (both inside this territory, comment/grant only,
no behaviour change on any existing database). Everything else that came up is a 🟡 or was already a
decision the owner has taken.

---

## 🟢 I1 — BUILT: migrations 345 and 346 state only half the grant pair they promise

**Where it lives:** backend only, nothing on screen — but it decides whether Admin console →
Restaurants → Recycle bin → "Remove permanently" works on a rebuilt database.

**What it was.** Every migration that has ever touched `admin_purge_restaurant` writes the REVOKE and
the GRANT as a pair — 128, 190, 309, 321, 342 all do. Migrations 345 and 346 wrote only:

```sql
REVOKE ALL ON FUNCTION admin_purge_restaurant(uuid) FROM public, anon, authenticated;
```

…directly under a comment that says *"state them anyway so a future recreate from this file alone
cannot quietly hand the purge to anon"*. Half a pair cannot stand alone. On every existing database
nothing is wrong — `CREATE OR REPLACE` keeps what 342 granted, and `verify:grants`' "no route can be
locked out of its own RPC" check is green. But rebuilt from 346 alone on a database that did not
already have the function, the REVOKE would land on a brand-new object and `service_role` would be
left with no EXECUTE at all: the admin's "Remove permanently" would answer *permission denied for
function admin_purge_restaurant*.

**What I built.** Both lines, in both files, plus the note explaining why the pair is not optional and
a `NOTIFY pgrst, 'reload schema'` to match every sibling. Zero behaviour change on any live database —
`verify:grants` is green before and after.

**Effort:** 10 minutes. **Risk:** none — it re-asserts a grant the database already holds.

---

## 🟢 I2 — BUILT: two migration headers name a number that is not theirs

**Where it lives:** backend only, nothing on screen. It costs the next reader, which is who these files
are written for.

**What it was.** Both files were written under one number and renumbered on merge, and the first line
never followed:

| file | first line said | which points at |
|---|---|---|
| `294_document_dates_follow_the_business_day.sql` | `-- 290: an inventory report for "Yesterday"…` | `290_the_blocked_guest_must_be_told.sql` |
| `313_the_setup_script_cannot_hurt_a_live_table.sql` | `-- 311_the_setup_script_cannot_hurt_a_live_table.sql` | `311_the_audit_is_kept_for_years_not_days.sql` |

In a folder where every other file's header carries the reasoning a reader needs, a header pointing at
an unrelated migration is a small trap with a long fuse — six other files in this range carry an
explicit "RENUMBERED x → y on merge" note precisely because it matters.

**What I built.** Corrected both headers, each with a one-line note saying what moved and when. In 313
the note also records the thing that must NOT move: the ledger key stays spelled
`311_require_otp_backfill`, because it is already recorded in `lfh_applied_once` on every live database
and renaming it would make the guard stop matching — i.e. run the backfill again.

Scanned all 115 files afterwards: every header in 231 → 350 now names its own file.

**Effort:** 10 minutes. **Risk:** none — comments only.

---

## 🟡 J1 — the bill-chain verifier cannot tell a binned bill from an altered one

Full write-up in `T23-findings.md` → 🟡 D1. Needs one new branch in `lfh_verify_bill_chain`, one
migration, and a decision about what the report should SAY. Not built: it is compliance-facing, and the
shape of the answer is his.

## 🟡 J2 — replace the hand-typed one-time-rewrite list with the invariant itself

`scripts/verify-db-grants.mjs` protects 2 of the folder's 12 one-time data rewrites, by name. The
invariant it is reaching for is checkable directly: *every `lfh_already_applied('<key>')` in the folder
must have a matching row inserted somewhere in the folder, and vice versa.* That version cannot rot as
the folder grows, and it passes today (12 used, 12 recorded). It lives in `scripts/`, so it is
🔗 HANDOFF H1 rather than something this terminal could build.

## Ideas considered and deliberately NOT written down as improvements

* Moving `settings.banquet_bill_next` onto `lfh_next_seq` like every other series. Migration 328
  considered and rejected this in writing, with two concrete reasons (it is an admin control with its
  own API guard, and `lfh_banquet_bill_create`'s live body was last written through dynamic SQL, so
  recreating it from 239's text would revert 284's banquet-tax fix). Re-opening it would be exactly the
  "suggesting something he has already decided" failure.
* Tightening `lfh_banquet_tax_lines` so a banquet tax component with a blank label or a zero rate cannot
  print the whole tax under an empty label. Reachable only if the admin saves a half-typed component
  row; it needs a migration and a look at whether the admin screen already prunes empty rows before
  saving, which is another terminal's file. Left alone rather than guessed at.
* Renumbering the remaining historical duplicate pairs. `verify:grants` has checked all 18 object-by-
  object and they touch nothing in common; renaming a shipped migration for tidiness is churn with a
  real risk (a script or a doc that names the file) and no reader benefit.
* Dropping `lfh_request_verification`, the surviving half of a retired stub. Migration 297 already says
  it is "safe to drop when someone decides to" and that `verify:families` asserts it answers 'disabled'.
  That is a decision, not an improvement.
