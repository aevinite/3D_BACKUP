# Print reliability — kitchen printer problems reach the manager, reprints are branded, nothing is ever lost

**Owner request (2026-08-04):** a bulletproof printer system. If anything goes wrong with the
kitchen's thermal printer (paper out, half print, roll finished, any error), the MANAGER is
notified — and the owner sees the same notification inside Manager mode. Every reprint carries
a big REPRINT / DUPLICATE banner on top. The manager's KOT menu offers two choices: **Print KOT**
(prints at the manager's own machine) and **Reprint KOT** (sends the job to the KITCHEN's
printer — nothing prints in the manager panel). Internet problems must self-heal: the ticket
prints the moment the connection is back. Problems auto-resolve when printing works again.

## What is honestly detectable (stated up front)

A browser cannot see inside a thermal printer. `window.print()` on a hidden iframe gives no
paper-out / half-print / jam feedback. So detection is two-layered:

- **Automatic** — everything software CAN see: a print call that throws, a job the kitchen
  screen never picked up (screen closed / offline / device dead), repeated failures. These
  raise a manager notification with no human involved.
- **Human, one tap** — hardware-only faults (paper out, half print, jam): a `🖨 Printer
  problem?` button on the kitchen board; one tap on the reason notifies the manager.

Both layers auto-resolve: the next successful print proves the printer works and closes every
open problem for that restaurant.

## Architecture — a durable print-job queue (the only new moving part)

Printing today is fire-and-forget inside one browser tab (`kitchen/app.js printKot`). Per the
mig-256 principle ("printed can't live on the device that printed"), anything that must survive
a dead tab or a dead connection becomes a **row**:

### New table `print_jobs` (mig 269)
`id uuid pk · restaurant_id · kind ('kot') · order_id · reprint bool · status
('queued'|'printing'|'done'|'failed'|'dismissed') · attempts · requested_by · error ·
created_at / claimed_at / done_at` — index `(restaurant_id, status, created_at)`.

Flow: manager taps *Reprint KOT* → `POST /api/editor/print-jobs` (through the panel `api()`,
so it is offline-queued + idempotent) → row inserted → `lfh_rt_emit` breadcrumb (ops topic) →
kitchen board reloads (existing 200ms-debounced realtime, 60s backstop, catchUp while degraded)
→ `/api/kitchen/board` response piggybacks pending jobs **with their order + item rows joined
server-side** (a job's order may no longer be on the board) → kitchen **claims** the jobs
(single-statement `UPDATE … SET status='printing' WHERE id IN … AND status='queued' RETURNING id`
— atomic, so two open kitchen tabs never both print) → prints via the one shared document with
the reprint banner → `POST done` (or `failed`, which re-queues up to 5 attempts with the job's
`attempts` counter).

Bulletproofing baked into the states:
- **Kitchen offline / tab closed:** the row just waits. Reconnect → board reload → claim →
  print. That is the "internet comes back, it prints" requirement, server-side, zero new polls.
- **Tab dies mid-print:** a `printing` row older than 2 minutes is reclaimable.
- **Claim/done calls bypass the outbox** (plain fetch): a replayed stale claim could print a
  ticket hours late behind everyone's back. If a claim fails, the next board load retries —
  catchUp's backoff already paces that.
- **Nobody ever picks it up:** a `queued`/`printing` row older than ~90s, or a `failed` row,
  surfaces as a manager notification (below) with a **Print here instead** fallback that prints
  it at the manager's machine and dismisses the job.

### New table `printer_events` (same migration)
`id · restaurant_id · kind ('paper_out'|'half_print'|'jam'|'other'|'auto_fail') · note · count ·
status ('open'|'resolved') · reported_by · created_at / last_at / resolved_at` — index
`(restaurant_id, status)`. Also on the `lfh_rt_emit` breadcrumb.

Writers: the kitchen problem button (one tap per reason); the kitchen's existing failure path
(`logKotPrintFailure` / `notePrintTrouble`) additionally posts an `auto_fail` event, throttled
server-side (an existing open `auto_fail` gets `count+1, last_at=now()`, never a flood of rows).
Resolvers: a manager tap, or **any successful print** (`done` handler resolves all open events
for the restaurant — the auto-solve the owner asked for).

## The manager sees it (and therefore the owner in Manager mode)

The manager floor poll (`/api/editor/tables` response) piggybacks a tiny `printer` block: open
`printer_events` + stuck/failed `print_jobs` (one indexed count-plus-few-rows query; no new
poll, no new endpoint on a hot path). The panel renders a **red/amber strip above the floor**:
"🖨 Kitchen printer problem — Paper out · reported by Ramesh · 3 min ago" or "A reprint sent to
the kitchen hasn't printed (is the kitchen screen open?)", with `✓ Resolved` and, for stuck
jobs, `🖨 Print here instead`. A toast fires when a new problem arrives. Owner Manager mode
embeds this exact panel (`/panels/editor/index.html?ownermode=1`), so the notification appears
there with zero extra work.

## The two-option KOT flow (manager)

Inside the existing KOT ▾ menu, the reprint entry becomes **Print / Reprint a KOT** → pick the
KOT (existing picker, desktop columns + phone sheet) → two buttons:
- **🖨 Print here** — prints at the manager's machine, exactly today's local path.
- **👨‍🍳 Reprint in kitchen** — enqueues the job; NOTHING prints locally; toast "Sent to the
  kitchen printer". Marked as a duplicate on paper.

## The REPRINT · DUPLICATE banner (one place only)

`billdoc.js kotDocHtml` gains a `reprint` flag → a big bordered, uppercase `*** REPRINT ·
DUPLICATE ***` block at the very top of the ticket. Rendered by the ONE shared document, so
kitchen, manager and every preview agree. Used by: every kitchen-queue reprint job; the
kitchen's per-ticket 🖨 button **when that ticket already printed successfully** (`printedIds`);
the manager's "Print here instead" fallback. A first print (auto-print, or 🖨 in a restaurant
with no auto-print) stays clean — a banner on a first print would be a lie.
`scripts/verify-print-format.mjs` gains assertions for the banner (and that no second copy of
it appears anywhere).

## Deliberate scope/decision calls

- **No new access switch.** Access model v2: a toggle exists only where the owner listed one.
  Reprint + problem reporting are core reliability, permanently on (like the kitchen 🖨 button,
  owner 2026-07-21 "it should be for everyone"). Restaurants without a kitchen screen get the
  honest "nobody picked it up" notification with the print-here fallback.
- **Bills are out of scope.** The owner asked about KOTs/kitchen; bill printing already has the
  reusable window + Print again bar. `kind` column leaves the door open.
- **No printer hardware protocol (ESC/POS, WebUSB).** Would give true paper-out detection but
  is a per-printer-model driver project; the two-layer detection above is the honest 95%.
- **No new poll.** Everything rides existing breadcrumbs + the 60s backstop + catchUp.
- Costs: one small table read piggybacked on the manager floor poll; one rt_emit trigger insert
  per job/event (rare); kitchen board response grows only when jobs are pending.
