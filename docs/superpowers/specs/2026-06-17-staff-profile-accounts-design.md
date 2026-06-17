# Staff profile / account polish — design (2026-06-17)

## Problem (owner's words)
1. After creating a staff user **with a name**, the panels still nag "please add your name and phone to continue" on every login — it should remember and auto-fill.
2. The setup notification looks **cheap**; UI/UX must be polished.
3. There are **two name-ish fields** (a `username` AND a separate `name`) — confusing. The owner wants **one Name + a Password**, no "username".
4. Name/phone/password must **sync** across all panels (it's one account — SaaS model). Owner reports sync "wasn't there"; must be tested by logging in.
5. A staff member's **profile edits go into the manager's operational log**; an **admin's** edits to a user do **not**.
6. Login behaviour stays: admin master-login → "Menu live" view; staff login → their Settings. (Unchanged — owner is happy with it.)

## Decisions
- **One identity field "Name".** Keep the proven `username` column as the unique login key, but: (a) remove the separate "Name (optional)" input from the admin create form, (b) relabel "Username" → "Name" everywhere, (c) on create/edit set `name` = the Name as typed (display) and `username` = a normalized form (lowercased, trimmed, single-spaced) used only for unique matching. The word "username" disappears from all UI. Low risk: login matching path keeps using `username`.
  - **Uniqueness:** existing `lower(username)` unique index stays. Duplicate Name → friendly "that name is taken, pick another".
  - **Self-rename:** staff may edit their own Name in their profile (uniqueness-checked). Safe because the auth cookie is keyed by user `id`, not name — renaming never breaks the live session; next login uses the new Name.
- **Show-once setup, not nag-forever.** New `staff_users.profile_confirmed boolean default false`. The first-login card shows until the staff confirms **once**, then never again — even if the admin pre-filled everything (they still confirm once). Replaces the old `!name || !phone` rule that re-nagged whenever a field was blank. Backfill existing users who already have name+phone to `true` so no one in service gets re-prompted.
- **Phone required once** (name is always set by the admin now), captured/confirmed in the one-time card; pre-filled with whatever the admin already entered.
- **Polished profile drawer** (the staff ⚙️ button): clean header (Name + role, no `@username`), "Your details" (Name + Phone), Password (if allowed), PIN, Guest-menu toggle, Log out. The first-login state is a warm welcome card, not the old thin green strip.
- **Logging:** `panel-profile` POST logs staff-initiated changes (`profile_update`, `password_change`, `pin_set`) with `actor` = the staff Name and the panel = their role. Admin's `edit` action in `/api/admin/users` stays **unlogged** (already is). Broader "hide ALL admin actions from the log" is noted as a separate decision (keeps the audit trail for now).

## Files
- `supabase/migrations/064_staff_profile_confirmed.sql` — add column + backfill.
- `lib/userAuth.ts` — `profile_confirmed` on `StaffUser`; export `normalizeLoginName()`; use it in `loginUser`.
- `app/api/panel-login/route.ts` — `needsProfile = !u.profile_confirmed`.
- `app/api/panel-profile/route.ts` — `needsProfile = !confirmed`; POST syncs name→username (uniqueness), sets `profile_confirmed` when name+phone present, logs staff actions.
- `app/api/admin/users/route.ts` — create: one Name → name+username, relaxed validation; `edit`: when name changes, update username too (uniqueness). Still unlogged.
- `app/aevinite/users/page.tsx` — one "Name" field; relabel; list/badge use Name.
- `app/login/LoginForm.tsx` — relabel "Username" → "Name".
- `public/panels/maint.js` — polished drawer + one-time welcome card; drop `@username`; require phone once; set confirmed on save.

## Out of scope
- Hiding all admin actions from the manager log (separate decision).
- Renaming the DB `username` column (kept as the internal key).

## Done = 
Type-check passes; logging in as real test staff (diagtablet / diagmanager) shows: setup card once then never; name/phone/password edited in one place appear everywhere; staff edits show in the manager log, admin edits don't.
