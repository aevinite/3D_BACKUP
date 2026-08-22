// scripts/sweep/tickets.mjs — retire the KITCHEN TICKETS a test's own orders queued.
//
// WHY (sweep #6 / T28, 2026-08-22). Since migration 335 every order queues one print job. The queue is
// drained by whatever is watching it — a kitchen screen, the tablet, or the print helper — and
// lib/printQueue.ts is careful about the dead ones: a job whose order has been deleted or cancelled is
// closed as `dismissed` with a sentence saying which. But that only happens WHEN SOMETHING READS THE
// QUEUE. On a dev stack with no kitchen screen and no helper open, nothing does.
//
// So a guard that places a real order and then cancels it leaves a `queued` ticket behind, and the
// manager's floor carries a red banner for each one:
//
//     A reprint (KOT #192 · T11) hasn't printed in the kitchen — is the kitchen screen open?
//     [ 🖨 Print here instead ]  [ ✓ Resolved ]
//
// Measured and screenshotted on 2026-08-22 at 1280x800 and 360x780 dpr3: FIVE of them stacked above
// the floor at once, every one of them from a sweep's own fixtures, each needing a real tap to clear.
// The product is behaving correctly — the litter is ours, so it is ours to sweep up.
//
// BY ORDER ID, ALWAYS. Never "every queued job on this restaurant": another lane, or the owner's own
// tab, may have a real ticket waiting for a printer that is about to come back. Only the ids this run
// created are its business — the same rule as every other row a guard makes.
//
//   import { dismissTicketsFor } from "./sweep/tickets.mjs";
//   await dismissTicketsFor(svc, RID, createdOrderIds);          // supabase-js client
//   await dismissTicketsFor(restFn, RID, ids, { rest: true });    // or a REST helper

/** The exact sentence lib/printQueue.ts writes, so a row we retire reads like one the app retired. */
export const CANCELLED_BEFORE_PRINT = "the order was cancelled before this ticket printed";

/**
 * Dismiss every still-queued print job belonging to `orderIds`.
 * `svc` is a supabase-js client. Returns how many it closed; never throws — a teardown that dies
 * halfway is worse than one that reports what it could not do.
 */
export async function dismissTicketsFor(svc, rid, orderIds, log = console.log) {
  const ids = [...new Set((orderIds || []).filter(Boolean))];
  if (!ids.length) return 0;
  try {
    const q = await svc.from("print_jobs").select("id, kind, order_id")
      .eq("restaurant_id", rid).eq("status", "queued").in("order_id", ids).limit(200);
    if (q.error) { log(`   tickets: could not read the print basket — ${q.error.message}`); return 0; }
    const rows = q.data || [];
    if (!rows.length) return 0;
    const r = await svc.from("print_jobs")
      .update({ status: "dismissed", done_at: new Date().toISOString(), error: CANCELLED_BEFORE_PRINT })
      .eq("restaurant_id", rid).in("id", rows.map((x) => x.id));
    if (r.error) { log(`   tickets: ${rows.length} queued ticket(s) would not go — ${r.error.message}`); return 0; }
    log(`   tickets: dismissed ${rows.length} queued kitchen ticket(s) this run had queued`);
    return rows.length;
  } catch (e) {
    log(`   tickets: could not clear the print basket — ${e.message}`);
    return 0;
  }
}

/**
 * The same thing for a guard that talks to the Management API by SQL (`q(sql)` returning rows).
 * Kept separate rather than clever: these two shapes are the only two in this folder, and a helper
 * that guesses which one it was handed is a helper that fails silently on the third.
 */
export async function dismissTicketsForSql(q, rid, tableNumbers, log = console.log) {
  const tables = [...new Set((tableNumbers || []).map(String).filter(Boolean))];
  if (!tables.length) return 0;
  const list = tables.map((t) => `'${t.replace(/'/g, "''")}'`).join(",");
  try {
    const rows = await q(`update print_jobs j set status='dismissed', done_at=now(),
        error='${CANCELLED_BEFORE_PRINT}'
      where j.restaurant_id='${rid}' and j.status='queued'
        and exists (select 1 from orders o where o.id=j.order_id
                    and o.restaurant_id='${rid}' and o.table_number in (${list}))
      returning j.id`);
    const n = Array.isArray(rows) ? rows.length : 0;
    if (n) log(`   tickets: dismissed ${n} queued kitchen ticket(s) from ${tables.join("/")}`);
    return n;
  } catch (e) {
    log(`   tickets: could not clear the print basket — ${String(e.message).slice(0, 140)}`);
    return 0;
  }
}
