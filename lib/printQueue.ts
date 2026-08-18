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
  const jobs = ((await q.order("created_at").limit(opts?.limit ?? 10)).data || []) as KotJobRow[];
  if (!jobs.length) return [];

  const oids = [...new Set(jobs.map((j) => j.order_id).filter(Boolean))] as string[];
  const [jo, ji] = await Promise.all([
    // `.is("deleted_at", null)` — A TICKET REMOVED FROM THE BOOKS IS NOT PRINTED (T7 finding F11,
    // 2026-08-11). A soft delete leaves the row in place, so filtering it out here is the only way
    // the join can come back empty and the job be dropped below.
    sb.from("orders").select("id, kot_no, table_number, created_at, allergies, items")
      .in("id", oids).eq("restaurant_id", rid).is("deleted_at", null),
    sb.from("order_items").select("id, order_id, title, qty, note, options, removed")
      .in("order_id", oids).eq("restaurant_id", rid).order("created_at"),
  ]);
  const byId = new Map(((jo.data || []) as { id: string }[]).map((o) => [o.id, o]));
  const items = (ji.data || []) as { order_id: string }[];
  return jobs
    .map((j) => ({
      ...j,
      order: (byId.get(j.order_id as string) || null) as Record<string, unknown> | null,
      items: items.filter((r) => r.order_id === j.order_id) as Record<string, unknown>[],
    }))
    .filter((j) => j.order); // deleted or gone since the read → nothing to print
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
    await sb.from("printer_events").update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("restaurant_id", rid).eq("status", "open");
    return { found: true, orderId: job.order_id ?? null, reprint: job.reprint !== false, attempts: job.attempts || 0, parked: false, kotNo: ord?.kot_no ?? null, tableNumber: ord?.table_number ?? null };
  }

  const attempts = (job.attempts || 0) + 1;
  const parked = attempts >= 5;
  await sb.from("print_jobs").update({
    status: parked ? "failed" : "queued",
    attempts, claimed_at: null,
    error: String(error || "print failed").slice(0, 300),
  }).eq("id", id).eq("restaurant_id", rid);
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
