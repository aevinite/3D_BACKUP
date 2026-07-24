# ACCESS REDESIGN — PLAN v2 (owner 2026-07-24, "plan like crazy, tiny phases, loop")

Supersedes the C–F sections of ACCESS-REDESIGN-PLAN.md. A/B (restaurant-detail cleanup +
access look) are DONE + live on dev. This v2 fixes the ARCHITECTURE flaws the owner caught
and adds the owner-side user management. Rule: tiny phases, dependency-ordered so a later
step never breaks an earlier one; ship to DEV per stage; MAIN later; verify each.

════════════════════════════════════════════════════════════════════════════════
## THE TWO ARCHITECTURE FLAWS THE OWNER CAUGHT (must fix before anything else)

### FLAW 1 — "ratings" (and friends) live in TWO unlinked places.
Today the panel has BOTH:
  • area "Reports & insights" → capability "Guest ratings & feedback" (the delegatable power)
  • area "Owner panel sections" → "Ratings page" toggle (does the owner panel show ratings)
They're separate + unlinked, so turning one off doesn't affect the other. Same overlap for
Reports/Dashboard, Staff, Settings. Owner's rule: "if the owner has it, the manager showing
it must follow; one linked thing, not two."

FIX = ONE capability drives everything. A capability's REACH (Off / Owner / +Manager / +Tablet)
is the single control; the owner-panel PAGE for it shows iff reach≥Owner, the manager sees it
iff reach≥Manager. Kill the separate "Owner panel sections" area. Map each old owner-section to
its capability and write BOTH backend columns from the one control:
  • Reports page      ↔ view_dashboard   (owner_entitlements.reports  + power_view_dashboard + manager_permissions.view_dashboard)
  • Ratings page      ↔ view_ratings     (owner_entitlements.ratings  + power_view_ratings   + manager_permissions.view_ratings)
  • Staff & powers    ↔ manage_staff     (owner_entitlements.staff    + power_manage_staff   + manager_permissions.manage_staff)
  • Settings page     ↔ edit_settings    (owner_entitlements.settings + power_edit_settings  + manager_permissions.edit_settings)
  • Issues page       ↔ handle_issues    (owner_entitlements.issues)  — owner-level; manager rung optional
  • Customers page    ↔ view_customers   (owner_entitlements.customers) — owner-level
So owner-reach ON writes the owner_entitlements SECTION key = true (page exists) AND the
power_<flag> = true (admin allows); manager-reach writes manager_permissions[flag] = true.
ONE toggle → both columns → linked. No duplicate area.

### FLAW 2 — owner cannot manage their own users/permissions.
NEW feature: the OWNER panel gets an access-management screen (mirror of the admin panel, but
CAPPED). The owner can: create/delete staff users; set each user's permissions; BUT only within
the ceiling the admin granted the owner, AND role-relevant (e.g. banquet is not a tablet cap →
it must be ABSENT/greyed for a tablet user, never a dead option). "Only set the permissions I
[admin] allowed for the owner." This is the owner-side of the ladder + is F (per-restaurant
privacy) realised as a real screen.

════════════════════════════════════════════════════════════════════════════════
## DEPENDENCY-ORDERED STAGES (do in order; each = many micro-steps; verify before next)

### STAGE 0 — FREEZE THE MODEL (no code-break risk; pure data/design)
0.1 In lib/accessModel.ts, add `section?: string` link + role-reach semantics to the
    capabilities that ARE owner sections (view_dashboard→reports, view_ratings→ratings,
    manage_staff→staff, edit_settings→settings).
0.2 Add two owner-level capabilities: handle_issues (issues), view_customers (customers),
    reach = owner-only (no manager/tablet), each mapping to its owner_entitlements section.
0.3 REMOVE the standalone "ownersections" GROUP + its sec_* switch permissions from the model.
0.4 Decide reach ceilings per capability (which can reach manager / tablet) — table it.
0.5 Unit-reason the mapping on paper in this file (below) so nothing is ambiguous.

### STAGE 1 — READ/WRITE ROUTE reflects the unified model (additive, safe)
1.1 access2 route GET: derive each section-capability's owner-reach from owner_entitlements
    section key; manager-reach from manager_permissions; keep returning everything else.
1.2 access2 route POST: when a section-capability's owner-reach changes, write BOTH the
    owner_entitlements SECTION key AND power_<flag>; manager-reach writes manager_permissions.
1.3 Keep backward-compat: absent keys behave as today. Verify no live behaviour changes
    for an untouched restaurant.
1.4 Add handle_issues/view_customers read+write to owner_entitlements (issues/customers).
1.5 Live test on dev: toggling ratings reach reflects in BOTH the owner Ratings page AND the
    manager ratings power (read back both columns).

### STAGE 2 — PANEL UI reflects the unified model (the visible fix)
2.1 Remove the "Owner panel sections" area from the rail + body.
2.2 Move ratings/dashboard/staff/settings/issues/customers into their functional areas as
    single laddered capabilities (Reports: dashboard, ratings, export, logs, customers;
    Staff & settings: manage_staff, edit_settings, issues?).
2.3 For owner-only capabilities (issues, customers), the reach control shows just Owner (no
    +Manager) — or Owner/+Manager where it makes sense.
2.4 Verify: no capability appears twice anywhere; the ratings confusion is gone.
2.5 Deploy dev + screenshot; confirm each area's counts still add up.

### STAGE 3 — SYNC / SINGLE SOURCE (C from v1)
3.1 access2 POST busts the features cache + panels cache (so live panels pick up changes).
3.2 Verify auto-print / panel toggle in Access reflects in manager/kitchen without stale.
3.3 Confirm the restaurant-detail page has NO remaining toggles (done in A) + no dead code.

### STAGE 4 — ROLE-RELEVANCE HARD RULE (no invalid options anywhere)
4.1 Central map: capability → roles it can apply to (owner/manager/tablet). Single source.
4.2 Per-person tab: a capability irrelevant to a role is ABSENT (already mostly done) — audit.
4.3 The coming owner screen uses the SAME map so banquet never shows for a tablet user, etc.

### STAGE 5 — OWNER-PANEL ACCESS SCREEN, read-only first (F groundwork)
5.1 New owner-panel route/section "Access" (owner panel). Server route scoped to the owner's
    OWNED restaurant(s) only; refuses others (per-restaurant privacy).
5.2 Read the owner's CEILING = what the admin granted this owner for this restaurant
    (owner_entitlements). Show only capabilities within the ceiling; others greyed "not
    enabled by admin".
5.3 List the restaurant's staff (reuse /api/owner/staff), sorted by role.
5.4 Show each user's current effective permissions (read-only) — verify correctness first.

### STAGE 6 — OWNER-PANEL ACCESS SCREEN, write (capped delegation)
6.1 Owner can set a user's permission (on/off/pin) — ONLY within the owner's ceiling +
    role-relevant; server REJECTS anything outside (grant-only-what-you-hold rule).
6.2 Owner can create a user (staff) for their restaurant (reuse create-user, scoped).
6.3 Owner can delete/deactivate a user of their restaurant.
6.4 Server enforcement: every owner write re-checks ceiling + ownership + role-relevance.
6.5 Verify cross-tenant: owner of A cannot touch B; ungranted capability is refused, not just hidden.

### STAGE 7 — OWNER-PANEL PER-RESTAURANT PRIVACY across the whole owner panel (F full)
7.1 For a multi-restaurant owner: each section greys out + shows ZERO data for restaurants
    where the admin didn't grant it (the bill-section example).
7.2 Reconcile admin-set vs owner-set: one source of truth per rung; no clash.
7.3 Verify with a 2-restaurant owner (grant X on A, not on B).

### STAGE 8 — GRANULAR ENFORCEMENT (E) — server reads the new sub-options
8.1 Design the check points (editor route menu sub-options; tablet route; dashboard/logs).
8.2 edit_menu sub-options enforced. 8.3 dashboard/log picks. 8.4 discount caps clamped.
8.5 void/revert tablet rungs. 8.6 per-person keys align. 8.7 verify hidden AND server-refused per role.

### STAGE 9 — BULLETPROOF + SHIP
9.1 Full suite (sub-agent functional tests, safe-audit wording) across roles + both tenants.
9.2 Desktop + 390px. 9.3 0 console errors. 9.4 deploy dev + verify live. 9.5 update owner.
(MAIN only on owner's explicit go — later.)

════════════════════════════════════════════════════════════════════════════════
## THE CAPABILITY ↔ COLUMN MAP (single source of truth — fill as Stage 0 lands)
capability            | area      | owner-reach writes            | mgr-reach writes           | tablet
view_dashboard        | reports   | owner_ent.reports + power_view_dashboard | mgr_perm.view_dashboard | —
view_ratings          | reports   | owner_ent.ratings + power_view_ratings   | mgr_perm.view_ratings   | —
export_reports        | reports   | power_export_reports (new)               | mgr_perm.export_reports | —
view_logs             | reports   | power_view_logs (new)                    | mgr_perm.view_logs      | —
view_customers (new)  | reports   | owner_ent.customers                      | (owner-only)            | —
handle_issues (new)   | reports   | owner_ent.issues                         | (owner-only or mgr)     | —
manage_staff          | staff     | owner_ent.staff + power_manage_staff     | mgr_perm.manage_staff   | —
edit_settings         | staff     | owner_ent.settings + power_edit_settings | mgr_perm.edit_settings  | —
(… all other capabilities unchanged from v1 …)

STATUS: v2 created 2026-07-24. Next: Stage 0.1.
