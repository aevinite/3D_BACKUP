# Phase 1 — Auth / Users / Roles + editor→manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** Give the three staff panels real per-user logins with roles (manager/tablet/kitchen) managed by the admin, gate the panels + their APIs, and rename editor→manager — without changing the open guest menu.

**Architecture:** A `staff_users` table (service-role only) holds username, hashed password, role, hashed self-set PIN, name, phone, active. `/login` verifies credentials server-side and sets a tamper-checked role cookie; a re-introduced `middleware.ts` gates `/manager /kitchen /tablet` (+ their APIs), with the existing admin cookie as a super-access bypass. First login captures name+phone. Admin gets a Users page.

**Tech Stack:** Next 16 App Router, Supabase (service-role via `lib/supabaseAdmin`), Web-Crypto `sha256hex` (already in `lib/staffAuth.ts`), vanilla-JS panels.

**Verification model (this codebase has no unit-test runner for UI):** each task verifies with `npx tsc --noEmit`, `npx next build` where relevant, `curl` for APIs, and Chrome MCP for UI. Commit after each task.

---

### Task 1: `staff_users` table (migration 053)

**Files:**
- Create: `supabase/migrations/053_staff_users.sql`

- [ ] **Step 1: Write the migration**
```sql
-- 053_staff_users.sql — per-user staff logins with roles. Service-role only;
-- never exposed to the guest anon key. Passwords/PINs stored as sha256 hex.
CREATE TABLE IF NOT EXISTS staff_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('manager','tablet','kitchen')),
  pin_hash      text,
  name          text,
  phone         text,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_users_username ON staff_users (lower(username));
ALTER TABLE staff_users ENABLE ROW LEVEL SECURITY; -- no policy ⇒ anon/authenticated denied; service-role bypasses
NOTIFY pgrst, 'reload schema';
```
- [ ] **Step 2: Apply + verify** — `node scripts/apply-migration.mjs supabase/migrations/053_staff_users.sql` → expect `✓ applied`. Then confirm anon can't read it: a `curl` GET on `/rest/v1/staff_users` with the anon key returns `[]`/401 (RLS denies).
- [ ] **Step 3: Commit** — `git add supabase/migrations/053_staff_users.sql && git commit -m "feat(auth): staff_users table (roles, hashed pw/pin) — service-role only"`

---

### Task 2: User-auth helpers (`lib/userAuth.ts`) + constant-time compare in staffAuth

**Files:**
- Modify: `lib/staffAuth.ts` (export `sha256hex` if not exported; add `safeEqual`)
- Create: `lib/userAuth.ts`

- [ ] **Step 1:** In `lib/staffAuth.ts`, ensure `sha256hex` is exported and add a constant-time compare:
```ts
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
```
- [ ] **Step 2:** Create `lib/userAuth.ts`:
```ts
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { sha256hex, safeEqual } from "@/lib/staffAuth";

export const USER_COOKIE = "lfh_user";
export type Role = "manager" | "tablet" | "kitchen";
const SECRET = process.env.STAFF_PASSWORD || "lfh-dev-secret";

// cookie value = "<id>.<sig>" where sig = sha256hex(id:role:SECRET). Tamper-checked.
async function sign(id: string, role: string) { return `${id}.${await sha256hex(`${id}:${role}:${SECRET}`)}`; }

export type StaffUser = { id: string; username: string; role: Role; name: string|null; phone: string|null; active: boolean; pin_hash: string|null };

export async function loginUser(username: string, password: string): Promise<{ ok: true; user: StaffUser; cookie: string } | { ok: false }> {
  const u = (await sb.from("staff_users").select("*").eq("username", username.trim().toLowerCase()).eq("active", true).limit(1)).data?.[0];
  if (!u) return { ok: false };
  if (!safeEqual(await sha256hex(password), u.password_hash)) return { ok: false };
  await sb.from("staff_users").update({ last_seen_at: new Date().toISOString() }).eq("id", u.id);
  return { ok: true, user: u as StaffUser, cookie: await sign(u.id, u.role) };
}

// Returns the user for a valid cookie, else null. Verifies the signature + active.
export async function userFromCookie(value: string | undefined): Promise<StaffUser | null> {
  if (!value) return null;
  const [id, sig] = value.split(".");
  if (!id || !sig) return null;
  const u = (await sb.from("staff_users").select("*").eq("id", id).eq("active", true).limit(1)).data?.[0];
  if (!u) return null;
  if (!safeEqual(sig, await sha256hex(`${id}:${u.role}:${SECRET}`))) return null;
  return u as StaffUser;
}
export async function makeCookie(id: string, role: string) { return sign(id, role); }
```
- [ ] **Step 3:** `npx tsc --noEmit` → 0 errors.
- [ ] **Step 4:** Commit — `git commit -am "feat(auth): userAuth helpers (login, cookie sign/verify, safeEqual)"`

---

### Task 3: Login / logout / profile APIs

**Files:**
- Create: `app/api/panel-login/route.ts`, `app/api/panel-logout/route.ts`, `app/api/panel-profile/route.ts`

- [ ] **Step 1:** `panel-login/route.ts` — POST `{username,password}` → on success set `USER_COOKIE` (HttpOnly, SameSite=Lax, 7d) and return `{ ok:true, role, needsProfile:boolean }` (`needsProfile` = name or phone null). On failure return 401.
- [ ] **Step 2:** `panel-logout/route.ts` — GET/POST clears `USER_COOKIE`, returns/redirects to `/login`.
- [ ] **Step 3:** `panel-profile/route.ts` — GET returns `{name,phone,role,username,hasPin}` for the cookie's user (401 if none); POST accepts `{name,phone}` and/or `{pin}` (hash the pin via `sha256hex`) and updates the user row (only their own, by cookie id).
- [ ] **Step 4:** Verify with curl: bad creds → 401; good creds (after Task 8 seeds a test user, or create via admin in Task 7) → cookie + role. (Until a user exists, assert 401.) `npx tsc --noEmit` → 0.
- [ ] **Step 5:** Commit — `git commit -am "feat(auth): /api/panel-login|logout|profile"`

---

### Task 4: `middleware.ts` — gate the three panels + their APIs

**Files:**
- Create: `middleware.ts` (repo root)

- [ ] **Step 1:** Gate `/manager`, `/kitchen`, `/tablet` and `/api/manager`, `/api/kitchen`, `/api/tablet`. Logic:
  - If the **admin** cookie (existing `AUTH_COOKIE` from staffAuth, validated) is present → allow (super-access).
  - Else read `USER_COOKIE`, verify via `userFromCookie`, and require `user.role` matches the panel of the path. NB: middleware can't use the service-role DB client easily on the edge — run middleware on the Node runtime (`export const config = { matcher: [...] }` + `runtime` via route segment) OR do a lightweight signature-only check in middleware and a full DB check in the route handlers. **Chosen:** middleware does the signature check (no DB) to redirect unauthenticated users fast; the API route handlers do the authoritative `userFromCookie` (DB) check + role enforcement.
  - On fail: pages → 307 redirect to `/login?next=<path>`; APIs → 401 JSON.
- [ ] **Step 2:** Add a shared `requireRole(req, role)` helper (in `lib/userAuth.ts`) that the manager/kitchen/tablet route handlers call at the top (admin cookie OR matching-role user cookie), returning 401 otherwise.
- [ ] **Step 3:** Wire `requireRole` into `app/api/manager|kitchen|tablet/[...path]/route.ts` GET/POST/PATCH/DELETE entrypoints.
- [ ] **Step 4:** Verify: `curl /api/tablet/state` with no cookie → 401 (closes the open-API hole); with admin cookie → 200. `npx tsc --noEmit`; `npx next build` → exit 0.
- [ ] **Step 5:** Commit — `git commit -am "feat(auth): middleware + requireRole gate on the three panels + APIs"`

---

### Task 5: `/login` page with role redirect

**Files:**
- Create: `app/login/page.tsx`

- [ ] **Step 1:** A client form (username + password) → POST `/api/panel-login`. On success, redirect by returned role (`/manager` | `/tablet` | `/kitchen`); if `needsProfile`, the panel handles capture (Task 6). On mount, if already authed (call `/api/panel-profile` → 200), redirect to the role panel immediately. Style to match the brand (frosted, dark/light).
- [ ] **Step 2:** Verify in Chrome: visiting `/login` shows the form; bad creds show an error; visiting while authed redirects.
- [ ] **Step 3:** Commit — `git commit -am "feat(auth): /login page with role-based redirect"`

---

### Task 6: First-login name+phone capture + profile/PIN UI (shared)

**Files:**
- Modify: `public/panels/maint.js` (shared by all panels) — add a profile/first-login module.

- [ ] **Step 1:** In `maint.js`, on load fetch `/api/panel-profile`. If 200 and (`!name || !phone`) → show a one-time blocking modal "Your name + phone" → POST `/api/panel-profile {name,phone}`. Add a small profile control (name + role, **Log out** → `/api/panel-logout`, **Set/Change PIN** → prompt → POST `{pin}`). If 401 (admin super-access, no panel user) → skip silently.
- [ ] **Step 2:** Verify in Chrome on each panel: first login shows capture; after, shows profile; logout clears.
- [ ] **Step 3:** Commit — `git commit -am "feat(auth): first-login name/phone capture + profile/PIN control (shared maint.js)"`

---

### Task 7: Admin Users page + `/api/admin/users`

**Files:**
- Modify: `app/api/admin/[...path]/route.ts` (add `users` endpoints), admin UI (`app/admin/page.tsx` or a `components/AdminUsers.tsx`)

- [ ] **Step 1:** API (admin-gated, service-role): `GET users` (list: id, username, role, name, active, last_seen_at — no hashes), `POST users` (create: username+password+role), `PATCH users/:id` (role/name/phone/active, optional new password, optional reset pin→null), `DELETE users/:id`. Hash passwords/pins server-side via `sha256hex`.
- [ ] **Step 2:** Admin UI: a "Users" section — table with role chip + active + last-seen, Add/Edit/Disable/Delete, set/reset password, reset PIN. Match admin styling.
- [ ] **Step 3:** Verify: create a manager user via the UI → it appears; then `/login` with it works and lands on `/manager`; disable it → login refused.
- [ ] **Step 4:** Commit — `git commit -am "feat(admin): Users management page + /api/admin/users"`

---

### Task 8: editor → manager rename + back-compat

**Files:**
- Rename: `app/editor/` → `app/manager/`; `app/api/editor/[...path]/` → `app/api/manager/[...path]/`; `public/panels/editor/` → `public/panels/manager/` (use `git mv`).
- Modify: `public/panels/manager/app.js` (and index.html) fetch base `/api/editor` → `/api/manager`; `components/AdminSwitcher.tsx` labels/links.
- Create (back-compat): `app/editor/page.tsx` (redirect→`/manager`); `app/api/editor/[...path]/route.ts` (re-export the manager handler).

- [ ] **Step 1:** `git mv` the three folders; update internal fetch base + switcher labels.
- [ ] **Step 2:** Back-compat: `app/editor/page.tsx` = `redirect("/manager")`; `app/api/editor/[...path]/route.ts` re-exports `GET/POST/PATCH/DELETE` from `../../manager/[...path]/route`.
- [ ] **Step 3:** Verify: `/manager` loads the panel; `/editor` redirects; `/api/editor/orders` still returns data; the admin switcher opens "Manager". `npx tsc --noEmit`; `npx next build` → exit 0.
- [ ] **Step 4:** Commit — `git commit -am "refactor: rename editor→manager (folder/route/api) with /editor back-compat redirects"`

---

### Task 9: Full verification + push

- [ ] **Step 1:** `npx tsc --noEmit` (0), `npx next build` (exit 0).
- [ ] **Step 2:** Browser E2E (Chrome MCP): create users in admin → each role logs into only its panel → wrong-role refused → direct panel w/o auth redirects to /login → admin opens all → first-login capture once → profile logout/PIN works → menu still fully open.
- [ ] **Step 3:** `curl` the three panel APIs with no cookie → all 401 (open-hole closed); with admin cookie → 200.
- [ ] **Step 4:** Commit any fixups; report to owner. Push only when owner says.

---

## Self-review notes
- Spec coverage: staff_users(T1) · helpers(T2) · login/logout/profile(T3) · middleware gate(T4) · /login redirect(T5) · first-login+profile+PIN(T6) · admin Users(T7) · rename+back-compat(T8) · verify(T9). All spec sections mapped.
- Middleware can't run the service-role DB client on the edge runtime → resolved: middleware does signature-only fast-reject; route handlers do the authoritative DB role check (`requireRole`). This is explicit in T4.
- No seed (admin bootstraps via super-access) — consistent with spec.
- PIN stored now (T3/T6/T7), enforced on money actions in Phase 3 (out of scope here).
