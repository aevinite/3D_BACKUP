# ACCESS & PERMISSIONS — MASTER PLAN (definitive, 2026-07-24)

The SINGLE source of truth. Supersedes ACCESS-REDESIGN-PLAN.md + ACCESS-REDESIGN-PLAN-V2.md
(kept only as history). Built from EVERY requirement the owner gave in this chat. Rule:
tiny phases, strict dependency order (a later phase never breaks an earlier one), build +
deploy to DEV (3-d-backup) per stage, verify live as admin (headless, 0 console errors),
commit per phase, tick here. MAIN only on the owner's explicit "go" (he said: later).
Design work → apply the ui-ux-pro-max system already loaded. Loop restarts ~60s after each turn.

═══════════════════════════════════════════════════════════════════════════════
## 1. FULL REQUIREMENT CHECKLIST — every ask in this chat, with status
(✅ done+live · 🟡 done in model/panel, not enforced/verified · ⬜ not started · 💤 deferred by owner)

### Prototype / model corrections (owner msg #2)
- ✅ 5 bold prototypes → owner picked #1 (rail+accordion)
- ✅ take_orders: on/off for manager too (not permanently locked)
- ✅ sticky category bar (scrollspy): removed as a toggle — always on
- ✅ master TOGGLE (on→Owner, off→collapse+reset) replaces the 3-seg stepper
- ✅ edit-menu "reorder dishes" removed (feature doesn't exist)
- ✅ discount "discount one dish" removed (feature doesn't exist)
- 💤 per-dish discount FEATURE (editor: cut price + strikethrough shown to guest) → build LATER, then re-add "discount one dish". Memory: per-dish-discount-feature-idea. REMIND owner.
- ✅ "Who has this" lists ALL holders, count matches
- ✅ void bill copy clarified (void=cancel-keep-record / delete / close-unpaid)
- ✅ money actions get a Tablet rung: discount, on-the-house, void/delete/close-unpaid, undo-payment, mark-paid, invoice, khata, table-ops, take-orders; tablet never standalone
- ✅ default = the General toggle; per-person overrides it; "change the default → " cross-link to per-person
- ✅ waiter rung = On / On-with-PIN only (no Off; off = lower the reach)
- ✅ per-person tablet person = Default / On / Off / On-with-PIN
- ✅ table & ticket operations reaches owner+manager+tablet
- 💤 settle owner's-guest table "on the house" mechanism → LATER
- ✅ table types collapsed to ONE "Mark / remove a table's type"
- ✅ auto-print KOT = admin-only switch (not laddered)
- ✅ banquet = admin-allows gate + delegation; 3D admin-only kept
- ✅ guest "3D dish viewer" NOT tagged admin-only (only edit_3d is)
- ✅ admin-actions log option removed
- 🟡 grant-powers-to-others: only grant what the granter holds → ENFORCE (Stage 8)
- ✅ restaurant settings delegation exists, defaults OFF for new restaurant

### Info system (owner msg #2)
- ⬜ (i) on every permission + sub-option → description + REAL HD screenshot of where it is in the
      real panel (button circled), stored in public/admin-help/, LAZY-load on click, enlargeable
      (lightbox). Prototype has a text placeholder only — real shots must be captured. (Stage 9)

### Merge / navigation / restaurant-detail (owner msgs #6–#8)
- ✅ new panel IS /aevinite/access (old page replaced); sidebar renamed "Access & permissions"
- ✅ reached by a button from the restaurant detail; ?rid preselect; breadcrumb + Back-to-origin
- ⬜ A3: verify the "Full report" view has a working Back to the restaurant detail
- ✅ restaurant detail no longer leads with a loud orange Access button
- ✅ access panel LOOK fixed (light + dark): area icons, tighter sections, styled counts
- ✅ Tickets: slim "No open issues" line (no big empty box)
- ✅ "Take menu offline" wording improved
- ✅ Google-review card shows ON/OFF + clearer copy
- ✅ "View & manage" redesigned; "Stop viewing" only shows when actually viewing
- ✅ removed duplicate Panels / Guest-features / Staff-features toggle cards (single source = Access)
- ✅ suspend moved to bottom danger zone; delete gated behind suspend-first
- ✅ removing duplicates also killed the stale scroll-spy/search still showing

### Sync (owner msg #9)
- 🟡 C: toggling in Access must reflect live in the panels (the "close KOT here → closes there").
      Duplicates removed (single source); still to do: cache-bust on save + verify. (Stage 3)

### Architecture flaws (owner msg #12 — the ratings one)
- ⬜ FLAW 1: ratings/reports/staff/settings appear as BOTH an "Owner panel section" AND a power,
      unlinked. FIX: one laddered capability drives both; kill the "Owner panel sections" area. (Stage 1-2)
- ⬜ FLAW 2: owner can't manage their own users. Build owner-panel Access screen: create/delete
      users + set permissions, CAPPED by admin grant, role-relevant (no banquet for a tablet user). (Stage 5-6)

### Enforcement + privacy (owner msgs #2, #12)
- 🟡/⬜ E: granular sub-options SAVE but aren't server-enforced yet (edit-menu split, discount caps,
      void/revert tablet rungs, dashboard/log picks, new powers). (Stage 8)
- ⬜ F: owner-panel per-restaurant privacy — grey + ZERO data for sections the admin didn't grant
      that owner for that restaurant (the bill-section example). (Stage 7)
- ✅ new-restaurant defaults reasoning captured; verify settingsClone matches corrected defaults (Stage 3)

### Process
- ✅ plan saved to memory (access-panel-BUILD.md); this master plan on the branch
- 🟡 test 3× / bulletproof across roles + both tenants + desktop&390px + 0 errors (Stage 9)

═══════════════════════════════════════════════════════════════════════════════
## 2. CORRECTED ARCHITECTURE
- ONE laddered capability per thing. Reach = Off / Owner / +Manager / +Tablet.
  Owner-panel page for a capability shows iff reach≥Owner; manager sees it iff reach≥Manager;
  tablet iff reach≥Tablet (+ per-waiter tri-state). NO separate "Owner panel sections" area.
- Section-linked capabilities write BOTH columns from one control:
  view_dashboard↔owner_ent.reports+power+mgr_perm · view_ratings↔owner_ent.ratings+power+mgr_perm ·
  manage_staff↔owner_ent.staff+power+mgr_perm · edit_settings↔owner_ent.settings+power+mgr_perm ·
  handle_issues↔owner_ent.issues (owner-level) · view_customers↔owner_ent.customers (owner-level).
- Existing enforced columns stay the storage (owner_entitlements / manager_permissions /
  settings module-ladders + tablet tri-states / staff_users.permissions / access_config for new granular).
- Role-relevance is ONE central map used by the panel, the per-person tab, and the owner screen.
- grant-only-what-you-hold enforced server-side everywhere delegation happens.

═══════════════════════════════════════════════════════════════════════════════
## 3. DEPENDENCY-ORDERED STAGES (execute in order; each ships to dev + verified)

STAGE 1 — Unify sections↔powers (kill duplication)  [flaw 1]
  1.1 accessModel: add section link to view_dashboard/view_ratings/manage_staff/edit_settings.
  1.2 accessModel: add owner-level caps handle_issues(issues), view_customers(customers).
  1.3 accessModel: remove the "ownersections" group + sec_* switch perms.
  1.4 access2 route GET: derive section-cap owner-reach from owner_ent section; mgr from mgr_perm.
  1.5 access2 route POST: section-cap owner-reach writes owner_ent.section + power_flag; mgr writes mgr_perm.
  1.6 panel setReach: for a section-cap, write owner:{section:true,power_flag:true} on owner-reach.
  1.7 build + deploy + verify: ratings toggled once reflects owner page AND manager power; no dup.

STAGE 2 — Panel polish of the unified areas
  2.1 reports area shows dashboard/ratings/export/logs/customers; staff area shows manage_staff/edit_settings/issues.
  2.2 owner-only caps show reach = Owner (no +Manager) or Owner/+Manager where sensible.
  2.3 verify counts + no capability appears twice; deploy + screenshot.

STAGE 3 — Sync / single source
  3.1 access2 POST busts features + panels caches; 3.2 verify auto-print/panel reflect live; 3.3 confirm no dead toggles/code on detail page; 3.4 verify settingsClone defaults match corrected model.

STAGE 4 — Role-relevance hard rule
  4.1 central capability→roles map; 4.2 per-person hides irrelevant caps (audit); 4.3 exported for the owner screen.

STAGE 5 — Owner-panel Access screen (READ-only first)  [flaw 2 groundwork / F]
  5.1 new owner-panel Access section, server route scoped to OWNED restaurant(s) only.
  5.2 read owner ceiling (owner_entitlements); show only within-ceiling caps, rest greyed "admin hasn't enabled".
  5.3 list staff (role-sorted); 5.4 show each user's effective perms read-only; verify correct.

STAGE 6 — Owner-panel Access screen (WRITE, capped)
  6.1 owner sets a user perm (on/off/pin) within ceiling + role-relevant; server REJECTS outside.
  6.2 owner creates a user (scoped); 6.3 owner deletes/deactivates a user of their restaurant.
  6.4 server re-checks ceiling+ownership+role every write; 6.5 verify cross-tenant + grant-only-what-you-hold.

STAGE 7 — Owner-panel per-restaurant privacy (F full)
  7.1 each owner-panel section greys + ZERO data where not granted for that restaurant.
  7.2 reconcile admin-set vs owner-set (no clash); 7.3 verify with a 2-restaurant owner.

STAGE 8 — Granular enforcement (E) + grant-only-what-you-hold
  8.1 map check points; 8.2 edit_menu sub-options; 8.3 dashboard/log picks; 8.4 discount caps clamp;
  8.5 void/revert tablet rungs; 8.6 grant-only-what-you-hold; 8.7 per-person keys align;
  8.8 verify each hidden AND server-refused per role, both tenants.

STAGE 9 — Info screenshots + bulletproof + ship
  9.1 capture REAL HD panel screenshots (button circled) → public/admin-help/; wire (i) lazy + lightbox.
  9.2 A3 Full-report back; 9.3 sub-agent functional tests all roles/tenants; 9.4 desktop+390px, 0 errors;
  9.5 deploy dev + verify; 9.6 update owner. (MAIN later on his go.)

═══════════════════════════════════════════════════════════════════════════════
## 4. VERIFY PROTOCOL (each stage): build green → deploy dev → headless admin login →
   exercise the changed controls (read→change→verify→revert) → 0 console errors → screenshot → tick.
## 5. DEFERRED (owner-approved, later): per-dish discount feature; owner's-guest on-the-house settle.
## FINDINGS (2026-07-24, Stage 5-6 investigation — build against these)
- Owner /api/owner/staff already: creates/deletes/edits users + sets manager_permissions (togglePerm),
  scoped to owned restaurants. So Stage 6.2/6.3 (create/delete) largely EXIST.
- GAP-A (BUG): set_permissions PERM_KEYS = only [tablet_discount,tablet_mark_paid,tablet_invoice,tablet_banquet].
  The admin Per-person tab writes permissions:{[capabilityId]:v} (e.g. "mark_paid","give_discounts") — the
  route REJECTS those as "Unknown permission", so per-person overrides silently fail. MUST align the key space:
  decide ONE canonical per-user key (recommend the accessModel capability id) used by the panel write, the
  owner route validation, AND the server enforcement read. (Stage 8.7 / do early — it's a live bug.)
- GAP-B: set_permissions has NO CEILING check — an owner could grant a capability the ADMIN didn't allow them.
  Add: on/pin grant allowed only if within owner_entitlements ceiling for that restaurant AND role-relevant
  for the target user's role (banquet not for tablet, etc.). Reject otherwise. (Stage 6.4 — security-critical.)
- GAP-C: owner panel has NO per-user override UI yet (only manager-wide grants). Stage 5 = add a capped,
  role-relevant per-user editor (reuse accessModel + role-relevance map). Cap to owner_entitlements ceiling;
  greyed/absent for out-of-ceiling or role-irrelevant caps.
- Stage 5-6 home: extend app/owner/staff/page.tsx (+ /api/owner/staff). Reuse lib/accessModel for the model.

## 6. STATUS LOG:
- Stage 7 IN PROGRESS: entitledSubset per-restaurant gating already covers reports/customers/issues/ratings. ADDED it to analytics (revenue = the 'bill' section the owner flagged). analytics gate VERIFIED live (reports off → analytics rid+group 403). ADDED overview gate: revenue zeroed + reportsOff flag for ungranted restaurants (build green). settings section NOW gated (GET filters restaurants to settings-entitled; PATCH refuses ungranted; admin unrestricted). Build green. STAGE 7 COMPLETE (reports/analytics/overview/customers/issues/ratings/settings all per-restaurant private).
- GAP-A DONE+VERIFIED live (override stores under tablet_mark_paid, reverts clean).
- GAP-B DONE (build): owner set_permissions now ceiling+role-gated (owner grants on/pin only if target is a waiter AND the cap's module is effective; admin unrestricted). Owner-side live test with Stage 5.
- Stage 5 (GAP-C) BUILT: owner Staff page now shows per-user Default/On/PIN/Off overrides for waiter accounts (tablet_* caps), greying caps whose admin module isn't effective; route GET returns module-effective per restaurant; writes via set_permissions. Build green.
- Stage 5 + GAP-B VERIFIED LIVE as owner diago1 (7/7): owner grants non-gated cap OK; banquet grant when module off → 403; owner Staff page shows per-user Default/On/PIN/Off with gated caps greyed '· not enabled'; 0 console errors.
- 2026-07-24 master plan created; A/B live.
- Stage 1 DONE+VERIFIED live (10/10: ratings unified, owner-sections area gone, writes both columns, 0 errors).
- Stage 2 (owner-only caps show just Owner step) code done.
- (was) Stage 1 (unify sections↔powers) code DONE: accessModel section links + handle_issues/view_customers + removed ownersections group/sec_* + maxReach/allowed for section+ownerOnly; panel setReach writes the section; route already carries section keys. Build green. Loop to deploy+verify (1.7) + Stage 2.
