# Sweep 6 · T24 improvements — the money and safety libraries

## 🟢 BUILT in this branch (all inside my own territory, no migration, no screen, no permission)

### 1 · A new action code can no longer read "System › Other" without anyone noticing
`scripts/verify-t24-money-rules.mjs` (new) + its `verify:t24-money-rules` entry.
T20 had to hand-add eight action codes to `lib/logTrail.ts` — `cancel_classified`,
`cancel_classify_failed` (mig 340) and six `print_helper_*` (mig 341) — because they had a LABEL on
the admin screens and no PLACE here, so every row read "System › Other" in the Activity log's detail
card. `verify:audit` proves a label exists; nothing proved a place did. The guard now scans every
`logAction` / `log` call site in `app/` and `lib/` (including the ternary shape that hid twelve codes
for months) and fails on any code that has no home. 161 codes checked, all placed.
**Why it matters:** the ninth code would have shipped the same way. The rule that every row says
where it happened (owner, 2026-08-12) now has something holding it up.

### 2 · A guard that ran 249 real checks instead of reading the code
Same file. It loads `lib/tax.ts`, `lib/taxFiling.ts`, `lib/paySplit.ts`, `lib/clashCompare.ts`,
`lib/idempotencyRule.ts`, `lib/logTrail.ts` and `public/panels/billdoc.js` through a tiny `@/`
resolver and CALLS them — so it checks the rule that ships rather than a copy of it. `--db` compares
`lib/tax.ts` against `lfh_effective_tax_rate` / `lfh_split_items_tax` / `lfh_order_discount_base` on
the dev database, and reads the INSTALLED `admin_purge_restaurant` to prove the compliance promise.
It refuses to run against any project but the dev one.

### 3 · Two restaurants can no longer share one login wall by accident
`lib/rateLimit.ts`. `rate_limit_events` and `rate_limit_counters` are unique on
`(restaurant_id, key, subject)` — mig 205 — but the TypeScript side read and cleared them on
`(key, subject)` alone. Every subject a caller sends today already names its own restaurant
(`rid:name`, `rid:device`, or a globally-unique user id), so nothing moves. But the guest limits
already use a bare `table:5` subject in SQL, so the first TypeScript caller to copy that shape would
have had one restaurant's admin reading another restaurant's staff on the Limits page — and one
restaurant's successful sign-in clearing another's wall. `openEventStats` is now scoped, and
`rateResetOnSuccess` takes an optional restaurant that narrows it. Zero behaviour change today.
**Trade-off:** the callers still have to pass the restaurant to get the benefit (handoff 3), so this
closes the trap rather than changing anything a person sees.

### 4 · One typed name can no longer become an unbounded read and an unbounded slow-hash loop
`lib/userAuth.ts`. A username is unique only per restaurant (mig 091), so the login lookup fetches
every match — with no `.limit()` at all — and every LIVE match then costs one PBKDF2 verify at
120,000 iterations. So both the read and the CPU per login attempt grew with the number of tenants
sharing a common name ("admin", "manager", "raj"). `docs/SAAS-EFFICIENCY-PLAYBOOK.md` has carried
"cap the userAuth candidate loop" as owed work since 2026-06-26; it is capped at 50 now — far above
anything real, so it is a ceiling on pathology rather than a rule anybody meets — and it says so in
the logs if it is ever reached, because a login that quietly stopped matching would be the worst way
to find out.
**Trade-off:** at 50+ accounts sharing one name a real account could go unconsidered. That is why the
cap warns instead of failing silently, and why the number is 50 and not 5.

---

## 🟡 NOT BUILT — these are the owner's call

### A · A walled sign-in waits for the phone ping before it says "too many attempts"
**Where:** any login door — manager, kitchen, tablet, owner — the moment someone hits the wall.
Backend only otherwise. **What it is:** when a limit is reached, `rateAllowed` awaits the owner
alert (two channels in parallel, 4s timeout each, plus a dedupe read and a log insert) before
returning the refusal. So a waiter who mistyped their password can watch a spinner for ~4–5 seconds
before being told to wait. **If yes:** the refusal appears at once; the alert is raced against a
short deadline. **If no:** nothing breaks — the wall works and the alert always arrives; the person
just waits a few seconds for a message that is already decided. **Effort:** ~15 minutes.
**Risk:** real either way. Making it fire-and-forget means the alert can be cut short when the
request ends, which on a serverless platform is how a limit ping goes missing — and a missing
security ping is worse than a slow refusal. That trade is the owner's to make, not mine.

### B · The two writes of a split settle are not one transaction
**Where:** manager panel and waiter tablet → Settle the bill → pay in parts. Backend otherwise.
**What it is:** the parts land in `session_payments`, then the orders are stamped paid. Problem 1
above now REVERSES the parts if the stamp fails, which closes the visible damage — but the real fix
is a single database function that does both or neither. **If yes:** a settle can never be half-done
at all. **If no:** nothing breaks; the compensating reversal handles it, and a failure still tells
the person. **Effort:** 2–3 hours. **Risk:** medium — it needs a new migration and moves the one
path that takes money, so it belongs in its own change with its own verification, not in a sweep.

---

## Looked at and deliberately left alone

- `lib/taxFiling.ts`'s `splitTax` does not filter out a 0% component the way `billdoc.js`'s does.
  Every caller's components come from a list that already drops non-positive rates, so no 0% line can
  reach it — pure tidying nobody would notice, and §6 says leave it.
- `lib/clash.ts` compares at most 8 fields per expectation. The busiest call site sends five and its
  own comment names the server's cap, and the editor panel's dynamic builder sorts by priority and
  breaks at 8 to match. Nothing is silently dropped.
- The wrong-password counter ticks on every restaurant that shares a typed name at the plain
  `/login` door. That is deliberate ("don't let a colliding name dodge it") and the tenant door is
  already scoped.
- The 5% fallback when a restaurant has configured no rate at all: `lib/tax.ts` and
  `lfh_effective_tax_rate` agree exactly, including treating a stored 0 as "not set". Changing it is
  a product decision, not a fault.
