# THE PERSON PROFILE — one shape for everybody (owner, 2026-08-01)

Every human in this product — **owner, manager, waiter, kitchen** — has ONE profile panel,
and it always looks the same. The owner chose it ("design 1 · Dossier") on 2026-08-01 and
asked for it to be the permanent structure: *"whenever Claude does something, he should see
this and arrange in this structure only."*

**Code:** `components/admin/StaffProfile.tsx` · **rows:** `lib/staffCaps.ts` ·
**data:** `GET/PATCH /api/admin/users` (+ `POST /api/admin/users/photo`)
**Opened from:** `/aevinite → Users` (tap a person) and `/aevinite → Owners → Full profile`.

---

## The shape — do not invent a second one

| | |
|---|---|
| **Left rail** | photo (optional) · name · role/active/PIN chips · “record complete X of 14” · the buttons you press daily (password, PIN, open their panel, Access & permissions, disable) · last seen / joined / login created / restaurant |
| **Right column** | ① **Permissions** ② who they are ③ emergency contact ④ the job ⑤ pay + what has been paid ⑥ papers ⑦ signing in ⑧ what they did lately ⑨ your private note ⑩ danger zone |

A new thing about a person goes **inside one of those cards**. A new card goes at the end of
the right column, above the danger zone. Nothing about a person gets its own separate screen.

## Permissions — the rule

- **A person's rows are exactly the rows Access & permissions has for their role.** Nothing
  else exists for them. One list feeds three screens (`lib/staffCaps.ts`): this profile, the
  Access screen's Per-person tab, and the admin write route's allow-list. A key that isn't in
  that list is **refused** by the server, because a stored permission no enforcer reads looks
  granted and isn't.
- **One dropdown per row, three states:** `Default (On)` · `On` · `Off`. The bracket shows
  what the *restaurant* gives that role, so a row says both things at once. Waiter money rows
  add a fourth, `On + manager PIN`.
- **Every new person starts on Default for everything** (`permissions: {}` at create). A
  stored value only ever exists where somebody deliberately set one; clearing it back to
  Default deletes the key.
- **Blocks per role:**
  - **manager** → two: **Permissions** (their menus/tabs) and **What … may manage** (money & floor actions).
  - **owner** → one: **Owner's menu**. An owner runs a whole separate panel, so they have no
    "what they may manage" list. Their rows are **read-only** here: `owner_entitlements` is a
    restaurant setting, not a per-person one, and a dropdown that saved nothing is exactly the
    dead switch the 2026-07-31 access rebuild removed.
  - **waiter** → one: what they may do on the tablet.
  - **kitchen** → none, and it says so in a line instead of showing empty controls.
- Saving is **per row, immediately**, and it takes effect on the person's next tap — no
  re-login. If the server refuses, the row snaps back and says so.

## The photo

Optional, always. No photo = their initial on a role-coloured circle. PNG/JPG/WEBP ≤ 2 MB,
stored in the public `branding` bucket under `staff/<user id>/`, URL kept in
`staff_users.profile.photo_url`. Uploading replaces the old object (storage never piles up);
"Remove photo" clears both.

## Where each field lives (migration 220/221)

- `staff_users.profile` (jsonb) — full name, alt phone, email, dob, blood group, languages,
  address/city/pincode, emergency name/relation/phone, ID type + last 4 + verified, UPI,
  bank last 4, private note, photo_url. Adding a soft field needs **no migration**.
- Real columns — `joined_on`, `left_on`, `designation`, `employment_type`, `shift_label`,
  `weekly_off`, `pay_type`, `pay_amount`, `pay_day`, `pay_mode`, `pay_extras`, `in_payroll`,
  `can_see_own_pay`. Anything a report filters or sums is a column, never jsonb.
- Pay ledger — `staff_payments`, append-only (a wrong entry is cancelled with a reason, never
  deleted). The pay card only appears when the **payroll module is on** for that restaurant,
  and only when the person is **on the pay list**.

## Rules that must stay true

1. **The profile opens for every person, in every restaurant** — including when the payroll
   module is off (the pay card simply isn't there). Do not route it through the owner panel's
   `/api/owner/staff?staff=` detail, which refuses in both those cases.
2. **Owners:** their profile is editable like anyone's, but the *account* — role, login name,
   which restaurants, primary/co-owner, suspend, delete — stays on the Owners page.
3. **Only the last four digits** of any ID or bank account are ever stored.
4. Everything on this screen is **admin-gated** and scoped to the one person being opened.
