// lib/printQueue.ts — ONE server-side implementation of the kitchen-ticket print queue.
//
// mig 269 built the queue (print_jobs: an atomic claim, retries, a manager alert when a job
// sticks). mig 335 made EVERY new order queue its own ticket, which turned "the kitchen tab that
// happened to be looking" into "whichever screen is awake claims the row" — and that is exactly
// the moment this logic stopped belonging to one route. The kitchen route had it inline; the
// manager route now needs the same three steps (what is waiting · claim it · say what happened),
// and two hand-kept copies of a claim is how a ticket eventually prints twice.
//
// So both routes call these. The claim is still ONE filtered UPDATE — that single statement IS the
// lock, so with the kitchen screen and the manager screen and (later) a print agent all polling,
// the second claimant matches zero rows and prints nothing.
//
// Server-only: it imports the service-role client, and every function takes the restaurant id and
// scopes every statement by it.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

// A claim older than this with nothing to show for it is offered again: the tab that took it died
// (closed, crashed, power cut, PC asleep mid-print). Same 2 minutes mig 269 chose.
export const STALE_CLAIM_MS = 120000;

export type KotJobRow = {
  id: string;
  order_id: string | null;
  reprint: boolean;
  attempts: number;
  status: string;
  created_at: string;
};
export type KotJob = KotJobRow & {
  order: Record<string, unknown> | null;
  items: Record<string, unknown>[];
};

// The `or(...)` filter shared by the read and the claim, so "what is offered" and "what can be
// won" can never drift apart — a job is live when it is queued, or when someone claimed it and
// never reported back.
const liveFilter = () =>
  `status.eq.queued,and(status.eq.printing,claimed_at.lt.${new Date(Date.now() - STALE_CLAIM_MS).toISOString()})`;

/**
 * HOW FAR BEHIND IS THE PRINTER — the number a cook at a dead printer actually needs.
 *
 * Owner, 2026-08-27: *"'the printer is off' and 'the printer is off and eleven orders are stacked up'
 * stop looking the same. The second one means somebody should be reading the screen instead of
 * waiting for paper."*
 *
 * Every printing screen already says whether printing is on, which screen prints, and who is
 * printing right now. None of them said HOW MUCH had piled up — and the one case where it matters
 * most is the one where the screen is handed nothing at all: when a helper owns the paper, the
 * kitchen's own job read is deliberately empty, so the board could not have counted them itself.
 *
 * TWO NUMBERS, ONE ROUND TRIP. The count is exact and transfers no rows; the single row that does
 * come back is the OLDEST one, which is what turns a number into a sentence. Four tickets waiting is
 * normal for two seconds and an emergency after ten minutes, and the count alone cannot tell those
 * apart — so nothing anywhere is allowed to shout on the count by itself.
 *
 * `kind` defaults to kitchen slips because that is the paper with a person standing over it.
 */
export async function waitingToPrint(
  rid: string,
  kind: "kot" | "bill" | "banquet" | null = "kot",
): Promise<{ n: number; oldestMs: number | null }> {
  let q = sb.from("print_jobs")
    .select("created_at", { count: "exact" })
    .eq("restaurant_id", rid)
    // "Stuck" is queued OR claimed-and-never-reported. Deliberately NOT liveFilter()'s stale window:
    // that window exists so another screen may STEAL a job, and a ticket claimed nine seconds ago by
    // a machine that has since died is still a ticket nobody has. It counts from the first second.
    .in("status", ["queued", "printing"]);
  if (kind) q = q.eq("kind", kind);
  const r = await q.order("created_at", { ascending: true }).limit(1);
  const n = r.count || 0;
  const first = (r.data || [])[0] as { created_at?: string } | undefined;
  return { n, oldestMs: n && first?.created_at ? Date.now() - new Date(first.created_at).getTime() : null };
}

/** Long enough that a working printer is never called stuck. A helper polls every 2s and a screen
 *  every 20s at worst, so a minute of silence is not a slow moment — it is nothing happening. */
export const STUCK_AFTER_MS = 60_000;

/**
 * Tickets waiting to print for this restaurant, with the order + item rows joined on so the
 * caller can print without trusting its own board (a reprint is usually for a KOT that has long
 * left it).
 *
 * `minAgeMs` is the BACKUP-PRINTER window: a screen set to "print only if the kitchen doesn't"
 * asks for jobs at least N ms old, so the kitchen printer always gets first refusal.
 * `autoOnly`/`includeAuto` exist for the panel-version rollout — see the kitchen route.
 */
export async function pendingKotJobs(
  rid: string,
  opts?: { includeAuto?: boolean; minAgeMs?: number; limit?: number },
): Promise<KotJob[]> {
  const includeAuto = opts?.includeAuto !== false;
  let q = sb.from("print_jobs")
    .select("id, order_id, reprint, attempts, status, created_at")
    .eq("restaurant_id", rid).eq("kind", "kot")
    .or(liveFilter());
  // A panel that predates mig 335 auto-prints from its own board diff, so handing it the new auto
  // rows as well would print every ticket TWICE (once from the diff, once from the queue). Old
  // panels simply never ask for them: `includeAuto` is opt-in from the caller's query string.
  if (!includeAuto) q = q.eq("reprint", true);
  if (opts?.minAgeMs) q = q.lt("created_at", new Date(Date.now() - opts.minAgeMs).toISOString());
  const jobs = ((await q.order("created_at").limit(opts?.limit ?? 20)).data || []) as KotJobRow[];
  if (!jobs.length) return [];

  const oids = [...new Set(jobs.map((j) => j.order_id).filter(Boolean))] as string[];
  const [jo, ji] = await Promise.all([
    // `.is("deleted_at", null)` — A TICKET REMOVED FROM THE BOOKS IS NOT PRINTED (T7 finding F11,
    // 2026-08-11). A soft delete leaves the row in place, so filtering it out here is the only way
    // the join can come back empty and the job be dropped below.
    // `status` rides along so a CANCELLED order can be told apart from a live one below.
    sb.from("orders").select("id, kot_no, table_number, created_at, allergies, items, status")
      .in("id", oids).eq("restaurant_id", rid).is("deleted_at", null),
    sb.from("order_items").select("id, order_id, title, qty, note, options, removed")
      .in("order_id", oids).eq("restaurant_id", rid).order("created_at"),
  ]);
  const byId = new Map(((jo.data || []) as { id: string }[]).map((o) => [o.id, o]));
  const items = (ji.data || []) as { order_id: string }[];
  const withOrder = jobs.map((j) => ({
    ...j,
    order: (byId.get(j.order_id as string) || null) as Record<string, unknown> | null,
    items: items.filter((r) => r.order_id === j.order_id) as Record<string, unknown>[],
  }));

  // ── A JOB WHOSE ORDER IS GONE IS RETIRED, NOT SKIPPED (found 2026-08-18, and it is serious) ────
  // This used to end `.filter((j) => j.order)` — a silent skip. That was fine while the only jobs
  // were the manager's occasional manual reprints. Since mig 335 EVERY order queues one, and a
  // deleted bill (lib/softDelete.ts) leaves its ticket queued for an order this read is right to
  // refuse. The read takes the OLDEST ten, so ten dead jobs sit at the head of the queue for ever
  // and NOTHING PRINTS AGAIN — the tickets behind them are never even looked at. Measured exactly
  // that on the dev stack: fourteen orphaned jobs, a fresh order queued and printed by nobody, and
  // no error anywhere, because every layer was working as written.
  //
  // So they are closed as 'dismissed' — the state mig 269 already uses for "the manager handled this
  // another way" — which takes them off both the kitchen's read and the manager's stuck-job strip. It
  // is one small UPDATE, only on a pass that actually found an orphan.
  //
  // A CANCELLED order counts as gone too, and that is not a detail: an order can be cancelled in the
  // seconds AFTER its ticket queued (a guest changes their mind, a waiter mis-rings a table), and
  // nothing downstream was checking — so the kitchen would have printed a ticket for food nobody
  // ordered and cooked it. The manual-reprint endpoint has refused a cancelled KOT since 2026-08-11
  // ("that KOT was cancelled — there is nothing to reprint"); the automatic path had no such guard
  // because until mig 335 it had no rows to guard.
  const dead = (j: { order: Record<string, unknown> | null }) =>
    !j.order || String((j.order as { status?: string }).status || "") === "cancelled";
  const orphans = withOrder.filter(dead);
  if (orphans.length) {
    const gone = orphans.filter((j) => !j.order).map((j) => j.id);
    const cancelled = orphans.filter((j) => j.order).map((j) => j.id);
    if (gone.length) {
      await sb.from("print_jobs")
        .update({ status: "dismissed", done_at: new Date().toISOString(), error: "the order was deleted before this ticket printed" })
        .in("id", gone).eq("restaurant_id", rid);
    }
    if (cancelled.length) {
      await sb.from("print_jobs")
        .update({ status: "dismissed", done_at: new Date().toISOString(), error: "the order was cancelled before this ticket printed" })
        .in("id", cancelled).eq("restaurant_id", rid);
    }
  }
  return withOrder.filter((j) => !dead(j));
}

/**
 * Take these jobs. Answers the ids actually WON — the caller prints those and nothing else.
 *
 * The single UPDATE with a status filter is the whole lock. `minAgeMs` is enforced HERE and not
 * only in the read, so a backup screen cannot jump the kitchen's queue because of a bug (or a
 * stale tab) on the client side: the server decides whether a job is old enough to be stolen.
 */
export async function claimKotJobs(
  rid: string,
  ids: string[],
  opts?: { minAgeMs?: number },
): Promise<string[]> {
  const list = (Array.isArray(ids) ? ids : []).map(String).slice(0, 20);
  if (!list.length) return [];
  let q = sb.from("print_jobs")
    .update({ status: "printing", claimed_at: new Date().toISOString() })
    .in("id", list).eq("restaurant_id", rid)
    .or(liveFilter());
  if (opts?.minAgeMs) q = q.lt("created_at", new Date(Date.now() - opts.minAgeMs).toISOString());
  const won = (await q.select("id")).data as { id: string }[] | null;
  return (won || []).map((r) => r.id);
}

/**
 * The printed / didn't-print report that closes the loop.
 *
 * ok  → done, and EVERY open printer problem for this restaurant is resolved: a sheet of paper
 *       coming out is the one proof the printer works (the auto-solve, owner 2026-08-04).
 * !ok → attempts+1 and back in the queue; at 5 it parks as 'failed', which is what the manager's
 *       floor strip surfaces.
 *
 * Returns what was on the paper so the caller can write a diary line naming the KOT and the table
 * instead of a job uuid nobody can look up.
 */
export async function finishKotJob(
  rid: string,
  id: string,
  okPrint: boolean,
  error?: string,
  /** WHICH printer put paper out, when the caller knows (a helper always does — mig 341/342). The
   *  auto-close below is narrowed to it: paper from the KITCHEN printer is no proof at all that the
   *  BILL printer has been refilled. Left undefined by a screen that prints to "the default printer"
   *  and cannot name it, and then the old behaviour stands. */
  printer?: string | null,
): Promise<{ found: boolean; orderId: string | null; reprint: boolean; attempts: number; parked: boolean; kotNo: number | null; tableNumber: string | null }> {
  const job = (await sb.from("print_jobs").select("order_id, reprint, attempts")
    .eq("id", id).eq("restaurant_id", rid).maybeSingle()).data as
    { order_id?: string | null; reprint?: boolean; attempts?: number } | null;
  if (!job) return { found: false, orderId: null, reprint: false, attempts: 0, parked: false, kotNo: null, tableNumber: null };

  const ord = job.order_id
    ? (await sb.from("orders").select("kot_no, table_number").eq("id", job.order_id).eq("restaurant_id", rid).maybeSingle()).data as
      { kot_no?: number | null; table_number?: string | null } | null
    : null;

  if (okPrint) {
    await sb.from("print_jobs").update({ status: "done", done_at: new Date().toISOString(), error: null })
      .eq("id", id).eq("restaurant_id", rid);
    // A SUCCESSFUL PRINT CLOSES THE COMPLAINTS IT ACTUALLY DISPROVES, and no others (mig 351).
    // Before this, ANY print resolved EVERY open row for the restaurant — right with one printer,
    // wrong the moment a computer owns three: "bill printer out of paper" vanished off the manager's
    // floor because a kitchen ticket printed in the kitchen, with the bill printer still empty.
    // Rows with no printer on them (everything written before mig 351, and any report from a screen
    // that cannot name its printer) keep the old behaviour, so this can only ever close FEWER
    // complaints — it can never leave one stuck open.
    // TWO PARAMETERISED UPDATES, NOT ONE BUILT STRING (security review, 2026-08-21). This was
    // `q.or(`printer.is.null,printer.eq.${printer}`)` — and a printer NAME is not our text: a helper
    // reports the names of its own printers, so a name containing a comma or a bracket would have
    // rewritten the filter it was pasted into. It could not cross restaurants (every statement here
    // is `.eq("restaurant_id", rid)`), but it could have resolved complaints it had no business
    // touching. There is no sanitising to get right if the value never reaches a filter STRING:
    // `.eq()` and `.is()` send it as a parameter.
    const resolved = { status: "resolved", resolved_at: new Date().toISOString() };
    if (printer) {
      // Complaints about the printer that just printed — the paper IS the proof — and the
      // unknown-printer rows, which keep the pre-mig-351 behaviour so none can stick open.
      await sb.from("printer_events").update(resolved).eq("restaurant_id", rid).eq("status", "open").eq("printer", printer);
      await sb.from("printer_events").update(resolved).eq("restaurant_id", rid).eq("status", "open").is("printer", null);
    } else {
      await sb.from("printer_events").update(resolved).eq("restaurant_id", rid).eq("status", "open");
    }
    return { found: true, orderId: job.order_id ?? null, reprint: job.reprint !== false, attempts: job.attempts || 0, parked: false, kotNo: ord?.kot_no ?? null, tableNumber: ord?.table_number ?? null };
  }

  const attempts = (job.attempts || 0) + 1;
  const parked = attempts >= 5;
  await sb.from("print_jobs").update({
    status: parked ? "failed" : "queued",
    attempts, claimed_at: null,
    error: String(error || "print failed").slice(0, 300),
  }).eq("id", id).eq("restaurant_id", rid);

  // ── A TICKET THAT CANNOT PRINT TELLS SOMEBODY (owner, 2026-08-30) ──────────────────────────
  // This is what REPLACED the backup printer. His words: "we don't even need the backup printer —
  // if anything fails it should show me or the person, manager, owner, everyone should get a
  // notification that this has failed, and if you want to reprint it."
  //
  // A silent second attempt on another machine was the old answer, and it was the wrong shape: paper
  // in a room nobody is standing in, and a restaurant that never learns its printer is broken. So
  // when a ticket gives up after five tries, a printer problem is FILED against the printer that
  // failed — which is what puts it on the manager's floor strip and in the kitchen's 🖨 sheet, both
  // of which already read this table — and the owner gets a ping.
  //
  // Only on the FIFTH failure, not on every retry: four quiet retries are the queue doing its job,
  // and a notification per attempt is how an alert becomes something people switch off.
  if (parked) {
    try {
      await sb.from("printer_events").insert({
        restaurant_id: rid,
        // `auto_fail` is the kind that already means this (mig 269's CHECK allows exactly five).
        // Inventing "print_failed" would have been refused by the constraint at run time, and the
        // insert is in a try/catch — so the report would have vanished silently.
        kind: "auto_fail",
        printer: printer ?? null,
        reported_by: "the printing queue",
        note: ord?.kot_no
          ? `Kitchen ticket #${ord.kot_no}${ord.table_number ? ` · ${ord.table_number}` : ""} gave up after ${attempts} tries`
          : `A ticket gave up after ${attempts} tries`,
      });
    } catch { /* the ticket is already parked and visible; a missing row must not break the report */ }
    try {
      const { sendOwnerAlert } = await import("@/lib/alerts");
      await sendOwnerAlert(
        `🖨 A kitchen ticket could not be printed${printer ? ` on ${printer}` : ""} — it gave up after ${attempts} tries and is waiting to be reprinted.`,
        `print-failed:${rid}:${printer || "any"}`,
      );
    } catch { /* an alert is best-effort and must never break a print report */ }
  }
  return { found: true, orderId: job.order_id ?? null, reprint: job.reprint !== false, attempts, parked, kotNo: ord?.kot_no ?? null, tableNumber: ord?.table_number ?? null };
}

/**
 * Which of these orders already have a print job — in ANY state, including one another screen is
 * printing right now.
 *
 * This is what lets the kitchen panel tell "the queue has this in hand" from "nothing queued this
 * at all", and only print the second kind itself. It is the self-healing net for a database where
 * mig 335's trigger is missing (a stack that hasn't had the release yet): without it, a panel that
 * has given up its own board-diff printing would go quiet and nobody would know why.
 * One indexed read (print_jobs_order_idx, mig 335), and only asked for when auto-print is on.
 */
export async function ordersAlreadyQueued(rid: string, orderIds: string[]): Promise<string[]> {
  const ids = [...new Set((orderIds || []).map(String))].slice(0, 200);
  if (!ids.length) return [];
  const rows = (await sb.from("print_jobs").select("order_id")
    .eq("restaurant_id", rid).eq("kind", "kot").in("order_id", ids).limit(400)).data as { order_id: string | null }[] | null;
  return [...new Set((rows || []).map((r) => r.order_id).filter(Boolean))] as string[];
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// WHICH ONE SCREEN IS THE PRINTER (mig 338)
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// mig 335 made a ticket a row; mig 336 said which ROOM may claim it; this says which DEVICE. Without
// it, two entitled screens both claimed and the winner was a coin flip — printing once, but on
// whichever machine happened to be quicker, with nothing on screen saying where the paper went.
//
// One active station per restaurant, enforced by a partial unique index in the database. Taking over
// is deliberate (one tap on the other screen) EXCEPT when the holder has gone quiet, because a shut
// kitchen screen must not take printing with it.

/** How long a station may go unheard-of before any entitled screen may take it without asking. */
export const STATION_STALE_MS = 3 * 60 * 1000;

export type PrintStation = {
  device_id: string;
  label: string | null;
  panel: string;
  claimed_by: string | null;
  last_seen_at: string;
};
export type StationView = {
  /** The screen currently printing, if any is still being heard from. */
  active: PrintStation | null;
  /** Is that me? */
  mine: boolean;
  /** The holder exists but has gone quiet — anyone entitled may take over without asking. */
  stale: boolean;
};

/** Who is printing for this restaurant, and is it this device? */
export async function stationView(rid: string, deviceId: string | null): Promise<StationView> {
  const row = (await sb.from("print_stations")
    .select("device_id, label, panel, claimed_by, last_seen_at")
    .eq("restaurant_id", rid).eq("active", true).maybeSingle()).data as PrintStation | null;
  if (!row) return { active: null, mine: false, stale: false };
  const stale = Date.now() - Date.parse(row.last_seen_at) > STATION_STALE_MS;
  return { active: row, mine: !!deviceId && row.device_id === deviceId, stale };
}

/**
 * Make THIS device the one that prints. Hands the station over from whoever had it — that is the
 * point: a person standing at the right printer taps once and the paper moves to them.
 *
 * Two statements, in this order, because the partial unique index allows exactly one active row:
 * stand everyone else down, then stand up (or wake) mine. Doing it the other way round would
 * momentarily need two, and the database would refuse the whole thing.
 */
export async function takeStation(
  rid: string,
  device: { deviceId: string; label: string; panel: "kitchen" | "editor"; by?: string | null },
): Promise<StationView> {
  await sb.from("print_stations").update({ active: false })
    .eq("restaurant_id", rid).eq("active", true).neq("device_id", device.deviceId);
  await sb.from("print_stations").upsert({
    restaurant_id: rid, device_id: device.deviceId, label: device.label.slice(0, 60),
    panel: device.panel, active: true, claimed_by: (device.by || null), last_seen_at: new Date().toISOString(),
  }, { onConflict: "restaurant_id,device_id" });
  return stationView(rid, device.deviceId);
}

/** This screen stops being the printer. Nobody takes over until a screen asks — a restaurant that
 *  turned its printer off should not have tickets quietly coming out somewhere else. */
export async function releaseStation(rid: string, deviceId: string): Promise<void> {
  await sb.from("print_stations").update({ active: false })
    .eq("restaurant_id", rid).eq("device_id", deviceId);
}

/** "I am still here." Written on the reads a printing screen already makes, so a screen that closes
 *  goes quiet by itself and, after STATION_STALE_MS, stops holding printing hostage. */
export async function touchStation(rid: string, deviceId: string): Promise<void> {
  await sb.from("print_stations").update({ last_seen_at: new Date().toISOString() })
    .eq("restaurant_id", rid).eq("device_id", deviceId).eq("active", true);
}

/**
 * THE ONE GATE every print path goes through: may this device claim a ticket right now?
 *
 * `auto` — is automatic printing on for the restaurant (both mig-107 rungs).
 * `roomAllowed` — is this panel's room allowed to print at all. The CALLER answers it now, from the
 *   Kitchen slips route through screenMayPrint (mig 369); it used to be re-derived here from mig 336's
 *   kot_print_target, and two derivations of one rule is how they drift.
 * Then the station: mine → yes · nobody's → yes, and it becomes mine · someone else's and gone quiet
 * → yes, and it becomes mine · someone else's and alive → NO, and the caller is told where it is.
 *
 * `autoTake` is false for a REPRINT the manager sent to a specific room: that ticket is aimed at a
 * printer on purpose and must not quietly move the whole restaurant's printing to another screen.
 */
export async function mayClaim(
  rid: string,
  opts: { deviceId: string | null; panel: "kitchen" | "editor"; label: string; auto: boolean; roomAllowed: boolean; by?: string | null; autoTake?: boolean },
): Promise<{ ok: boolean; reason?: "off" | "wrong_room" | "no_device" | "other_station"; station: StationView }> {
  const view = await stationView(rid, opts.deviceId);
  if (!opts.auto) return { ok: false, reason: "off", station: view };
  if (!opts.roomAllowed) return { ok: false, reason: "wrong_room", station: view };
  // No device cookie at all (a stripped browser, a script): it can never be "the" printer, because
  // there would be nothing to hand over from later.
  if (!opts.deviceId) return { ok: false, reason: "no_device", station: view };
  if (view.mine) { await touchStation(rid, opts.deviceId); return { ok: true, station: view }; }
  if (view.active && !view.stale) return { ok: false, reason: "other_station", station: view };
  if (opts.autoTake === false) return { ok: false, reason: "other_station", station: view };
  const taken = await takeStation(rid, { deviceId: opts.deviceId, label: opts.label, panel: opts.panel, by: opts.by });
  return { ok: true, station: taken };
}
