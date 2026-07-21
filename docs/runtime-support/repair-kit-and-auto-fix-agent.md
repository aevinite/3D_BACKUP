# Repair Kit + Auto-Fix Agent (owner's addition, 2026-07-20)

*(Doc only — nothing built yet. Extends the Black Box / Watchtower plan.)*

The owner's live "temporary fix" is NOT code — it's data surgery from the admin
panel: permanently delete a broken bill/KOT, re-create the same order fresh,
change a time/date, unstick a table. Then Claude fixes the root cause
permanently. Two pieces make that real:

---

## Part A — The Repair Kit (buttons in admin, zero coding needed)

A "Fix It" section in the admin panel, per restaurant. Each tool is one button
with a confirm step:

1. **Delete a bill / KOT permanently** (with a required one-line reason).
2. **Re-fire an order** — clones a broken order into a fresh one and sends it
   to the kitchen again (same dishes, new KOT number).
3. **Unstick a table** — force-closes a session that's wedged (e.g. the
   head-left-pending case) so the table is usable again.
4. **Edit time/date** on an order or bill (for when a re-made order must carry
   the original dinner time so reports stay right).
5. **Kill switches** — already exist (`settings.features`); linked from here.
6. **Maintenance mode** — already exists; linked from here.

**Guardrails (non-negotiable, protects the owner from himself at 8pm):**
- Every Repair Kit action writes a loud line into the Everything Log
  ("ADMIN REPAIR: deleted bill #142, reason: stuck at print"). That line is
  what tells Claude later exactly what surgery was done — and what the
  permanent fix must handle.
- Deletes are **soft** with an undo window (the 30-min bill-undo pattern
  already in the app) wherever possible; "permanent" happens after the window.
- Admin-only, confirm dialog, and the reason field is mandatory. Trade-off:
  one extra tap when you're stressed — worth it, because these buttons can
  genuinely wreck a night's numbers if fat-fingered.

## Part B — The agent workflow (how Claude gets the permanent fix, 3 levels)

**Level 1 — "Send to Claude" button (build first).**
Next to every red error row in the Everything Log: one button that bundles the
error + the last ~20 log lines around it + device/panel info into a report file
(a row in a `fix_requests` table, or a GitHub issue). You tap it, done. Next
Claude session starts by reading open reports — no describing, no screenshots
needed (screenshots still welcome). This is the cheapest piece and removes the
whole "you explaining the bug" step.

**Level 2 — Scheduled repair agent (semi-automatic, recommended).**
Same pattern as the existing 4am nightly audit: a scheduled Claude Code run
(local LaunchAgent or a cloud routine) that, every night:
1. reads new fix-requests + error log lines,
2. reproduces the problem,
3. writes the fix on a branch in an isolated worktree,
4. verifies it, opens a PR, and leaves a plain-language note for the owner.
The overnight-autonomous-loop pattern already proved this works in this repo.
The owner wakes up to "3 errors from last night are fixed, PRs ready" —
merge is one click (or auto-merge once verified, same as the overnight loop).

**Level 3 — Instant auto-fix (agent ships code the moment an error appears).**
DELIBERATELY NOT RECOMMENDED. Code written and shipped in panic-minutes with
nobody glancing at it can turn one broken button into a broken panel during
service. The honest division of labour: the **Repair Kit handles the next 10
minutes** (owner), the **night agent handles the permanent fix by morning**
(Claude). Revisit only if a real gap shows up after months of Level 2.

## Build order (when owner says go)

1. Everything Log (Structure 1) — the foundation everything above reads/writes.
2. Repair Kit tools (each one small; re-fire order + unstick table first, they
   cover the most common live incidents).
3. Phone alerts (Structure 2).
4. "Send to Claude" button (Level 1).
5. Nightly repair agent (Level 2) — extend the existing 4am audit machinery.

Cost: all of it ₹0 (inside Vercel+Supabase + existing local scheduling; the
nightly agent uses Claude usage the same way the current audits do).
