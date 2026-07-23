# OVERNIGHT AUTONOMOUS BUILD — access panel (owner asleep 2026-07-24)

Owner: "make a loop, wake every ~30-40 min, complete all phases till I'm back;
full access; everything done when I wake." Spec = memory `access-panel-BUILD.md`
(the corrected model + 10 phases). This file = execution log. Resume from here each wake.

## Rules while owner sleeps
- DEV stack ONLY (Supabase wnsfc… / Vercel 3-d-backup). NEVER touch MAIN. Migrations on dev DB only.
- Work in THIS worktree (`.claude/worktrees/access-panel-designs`, branch worktree-access-panel-designs).
- Commit after every phase. Verify with headless Playwright + sub-agent functional tests (safe-audit wording).
- If genuinely blocked on a decision → make the safe assumption, log it here, keep going. Do NOT stop.
- Keep `npm run lint`/build green before each commit.

## Decisions taken without owner (safe defaults, flag on wake)
- `reorder_menu`: no drag-reorder UI found in editor → REMOVED that sub-option. (Owner questioned it.)
- Banquet reach = Owner + Manager (no tablet rung). Owner didn't add tablet for banquet.
- New toggle interaction (master toggle → auto-Owner → reach control) implemented per my reading of the prompt; owner to confirm look on wake.

## Phase status
- [x] P1 — Lock corrected model in prototype #1 (rail+accordion). DONE + verified (0 console errors).
      Applied: master-toggle header (on→Owner, off→collapse+reset) replacing the 3-seg stepper;
      reach control Owner/+Manager/+Tablet (tablet only on money+floor powers, maxReach); waiter
      rung = On / On-with-PIN only (no Off); removed scrollspy toggle, discount-one-dish, table-tag
      add/rename + on-house sub, reorder_menu, admin-actions log; un-admin-tagged guest 3D; auto-print
      now an admin-only switch; take_orders now a normal ladder (manager toggleable); void copy
      clarified; per-person Default/On/Off (+On-with-PIN for tablet people); FIXED "Who has this" →
      lists ALL relevant people with live holder count (was 1, now matches). Verified both tenants +
      390px, no h-scroll. Commit: (see git log).
- [ ] P2 — DB migrations + backfill + settingsClone defaults
- [ ] P3 — Read layer: merged real access page + breadcrumb/back + button from restaurant detail
- [ ] P4 — Write layer + server enforcement (cascade, mgr⊆owner, tablet⊆mgr, grant-only-what-you-hold)
- [ ] P5 — Per-person overrides (Default/On/Off/On-with-PIN) + General→Person cross-link + fixed "Who has this" list
- [ ] P6 — Owner panel per-restaurant privacy (grey-out + zero data for ungranted; no admin/owner clash)
- [ ] P7 — Admin-only settings (auto-print / banquet gate / 3D) grouped + enforced
- [ ] P8 — Guest features cleanup (drop scrollspy toggle, un-admin-tag 3D) + X-ray parity
- [ ] P9 — Theme pass to match /aevinite admin panel + fix minor UI
- [ ] P10 — Bulletproof: sub-agent functional tests all panels/roles/tenants, desktop+390px, hidden AND server-refused

## Log
- (start) plan saved to memory; MEMORY.md compacted; prod dev deploy READY; loop armed.
