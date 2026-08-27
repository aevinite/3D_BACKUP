# The security checklist — what "check the security" means here

**The owner sent a 20-point list on 2026-08-16 and asked for it to be kept, so that whenever he
says "check the securities" / "check security", this is the list that gets checked** — plus the
extra points in §2, which are the ones this app needs and the list does not mention.

> ⚠️ **WORDING FIRST.** Read `CLAUDE.md` → "AVOID THE CYBER-SAFEGUARD HALT" before doing any of
> this. Describe every item in **product-correctness** language ("does each restaurant only see
> its own numbers?"), never as attack-and-defence. **Verify by READING code and observing normal
> use — never by trickery.** If reading suggests a gap, REPORT it; do not tamper to prove it.
> Data-separation, login and permission checks are done INLINE, never handed to a sub-agent.

**How to use this file:** work down §1 then §2. Most rows have a command; run it. Rows marked
👁 need a person to read code or look at a screen — they cannot be automated honestly. Record the
date and the result in §4 each time.

---

## 1 · The owner's 20-point list

| # | Point | Status | How to check it |
|---|---|---|---|
| 1 | Hide API keys | ✅ | Only `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` may reach the browser. `grep -rho "process\.env\.NEXT_PUBLIC_[A-Z_]*" app lib components \| sort -u` — anything new in that list is a decision, not a default. The service-role key must appear only in `lib/supabaseAdmin.ts` + `lib/passwordVault.ts`. |
| 2 | Purge Git secrets | ✅ | `git log --all --diff-filter=A --name-only --pretty=format: -- "*.env*"` must print nothing, and `git ls-files \| grep -i env` must be empty. |
| 3 | Use public DB key | ✅ | Guest reads go through `lib/menu.ts` on the anon key; the service key never leaves the server. |
| 4 | Row-level security | ✅ | Every table has RLS. `npm run verify:grants` (needs `.env.local`). |
| 5 | Encrypt sensitive data | ✅ | `lib/passwordVault.ts` — AES-256-GCM, fresh IV per row (mig 330). Bills are signed + hash-chained (mig 332); `lfh_verify_bill_chain` is run by the Z-report. |
| 6 | Server-side auth | ✅ | `find app/api/admin -name route.ts \| wc -l` must equal the number that grep `tokenIsValid`. Panel APIs use `requireRole()`, owner APIs `ownerScope()`. |
| 7 | Lock record access | ✅ | Every tenant row carries `restaurant_id`, scoped in the query **and** enforced by RLS underneath. `npm run verify:access`. |
| 8 | Block field tampering | ✅ | Write allow-lists refuse unknown keys (`lib/accessTree.ts` `TAB_ALLOWED`, `lib/staffCaps.ts`). Plus first-save-wins (`npm run verify:clash-coverage`). |
| 9 | Secure session cookies | ✅ | Every cookie set in `app/api/*-login` + `act-as` must have `httpOnly` + `sameSite` + `secure` in production. `grep -rn "cookies.set" app/api app/r` and read each one. |
| 10 | Hash passwords | ✅ | PBKDF2-SHA256 ×120,000, per-row salt (`lib/userAuth.ts`). Sign-in reads `password_hash` ALONE — the readable vault copy must never become a second way in. |
| 11 | Rate limit login | ✅ | `lib/loginThrottle.ts` (mig 151) + per-account lockout (mig 055) + `lib/rateLimit.ts` (mig 205). Admin console → Rate limits. |
| 12 | Bot protection | ⚠️ weak tier | `lib/botCheck.ts` + `components/BotTrap.tsx`. **Turnstile is wired but OFF** — set `TURNSTILE_SECRET_KEY` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` to reach the strong tier, no code change. See §3. |
| 13 | Parameterize queries | ✅ | No hand-written SQL runs from Node — everything is supabase-js or an RPC. 👁 Any `.or(\`…\`)` that interpolates TYPED TEXT must go through `safeSearch()` (`lib/searchText.ts`); interpolating a **validated UUID** is fine. `grep -rn '\.or(`' app lib`. |
| 14 | Validate all input | ⚠️ partial | No schema library. Each route hand-checks (`isUuid`, `instanceof File`, size caps). 👁 Works, but nothing forces a NEW route to do it — read new routes. |
| 15 | Escape user content | ✅ | React escapes by default. 👁 Every `dangerouslySetInnerHTML` must be our own generated string with `esc()` on each value — `grep -rn "dangerouslySetInnerHTML" app components`. 👁 **Not yet fully audited:** `innerHTML` use inside `public/panels/*.js`. |
| 16 | Restrict file uploads | ✅ | PNG/JPG/WEBP only, **SVG deliberately refused** (it can carry script), size-capped, UUID-checked path before Storage is touched. |
| 17 | Trim API responses | ✅ | Explicit column lists + `.limit()`. `npm run verify:panel-secrets` keeps the settings row stripped for panels. |
| 18 | Security headers | ✅ | `next.config.ts`. Check live: `curl -sD - -o /dev/null <url>/staff-login`. |
| 19 | Force HTTPS | ✅ | HSTS, production only, no preload. Absent in dev on purpose. |
| 20 | Scan dependencies | ✅ | `npm run verify:deps` — fails only on a NEW high/critical. Dependabot raises the PRs weekly. |

## 2 · What this app also needs, that the 20-point list never mentions

These matter more here than several of the twenty, because they are about **one restaurant seeing
another's data** and **money that must not vanish** — the two things that actually hurt this business.

| # | Point | How to check it |
|---|---|---|
| 21 | **Each restaurant sees only its own numbers** | The pool model: `restaurant_id` on every row + RLS. `npm run verify:access`, `npm run verify:allergy-isolation`, `npm run verify:guest-read`. 👁 Read any new query for a missing scope. |
| 22 | **A sale can be cancelled, never deleted** | `docs/COMPLIANCE-GUARDRAILS.md` §3.0. There is NO delete-a-bill permission for anyone at the restaurant (R27). `npm run verify:audit`, `npm run verify:one-number`. |
| 23 | **The bill ledger is intact** | Signed + hash-chained (mig 332). `lfh_verify_bill_chain(rid, from, to)` — the Z-report runs it and prints the result. |
| 24 | **New DB functions are not public by default** | Postgres grants EXECUTE to everyone unless revoked. `npm run verify:grants` — this has drifted before. |
| 25 | **A permission that LOOKS off is off on the server** | Hiding is never the only guard. `npm run verify:manager-gates`, `npm run verify:manager-hidden`. |
| 26 | **The admin console is reachable only with the password** | `/aevinite` layout + all admin routes check `tokenIsValid` before any DB call. |
| 27 | **Our own tests can't trip the app's limits or alert the owner** | `npm run verify:test-safety`. |
| 28 | **Nothing points at AV LIVE** | No script, seed or dev server may use the client stack's keys. `npm run verify:test-safety` covers the scripts; 👁 check by eye for anything new. |

## 3 · Open, deliberately

1. **Turnstile keys not set** (point 12) — the bot layer is at the weak tier: it stops untargeted
   fill-everything traffic, not somebody scripting our specific form. Free to fix; owner parked it
   on 2026-08-16 ("do 1, 2 — leave 3, 4 for later").
2. **The content policy is REPORT-ONLY** (`Content-Security-Policy-Report-Only` in
   `next.config.ts`) — it watches, it does not block. Measured clean on 15 real screens on the live
   site, but the app has 57 page routes. **Do not flip it blind**; sweep every route first. Owner
   parked it the same day.
3. **`innerHTML` inside `public/panels/*.js` is not fully audited** (point 15).
4. **Input validation is per-route discipline** with no guard behind it (point 14).

## 4 · Log — every time the check is run

| date | what was run | result |
|---|---|---|
| 2026-08-16 | Full 20-point review against the code, then the 5 gaps built (PR #995) | 14 already true · 4 partial · 2 missing → all closed except the two parked in §3 |
| 2026-08-16 | Dependency updates merged (PRs #996/#997/#998, Next 16.3.0) | advisories 15 → 7; high 9 → 4 |
| 2026-08-22 | **The automatable rows re-run** (T29 sweep, read-only, no trickery): #1 keys in the browser, #2 no env file tracked, #6 server-side auth, #17 trimmed responses, #20 dependencies, #21 tenant isolation, #24 function grants, #27 test safety, #28 nothing points at the client stack. Plus the response headers checked on a real request (`curl -sD -`) for #18/#19. | **all pass except #24.** #6 recounted handler by handler: 50 `/api/admin/*` route files, 50 check the gate — and the rulebooks all said 48, which is now fixed and guarded by `node .github/scripts/verify-doc-counts.mjs`. The Security-gate list in `docs/CLAUDE-DETAIL.md` named no gate for `/api/maintenance`, `/api/issue-media` or `/api/print-agent`; all three ARE gated, the list was incomplete, and completeness is now guarded too. §3's two parked items are still parked, as he chose. Rows marked 👁 were not re-run — they need a person reading new code, and no new route landed.<br>**#24 is RED on the dev database and it is not a grant problem:** `verify:grants` reports that `lfh_request_verification()` is created by `supabase/migrations/296_database_layer_a_sweep_fixes.sql`, is retired by no later migration, and is **absent from the dev database** — so either 296 never applied there or it was dropped by hand. The grant rules themselves are intact; a function that is not there cannot be over-granted. It needs either a migration that DROPs it on purpose (so the intent is written down) or a re-apply of 296, and it needs someone who owns `supabase/migrations/` — the T29 sweep could only report it. Nothing about it reaches a restaurant's screen. |
