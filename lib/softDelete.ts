// lib/softDelete.ts — the ONE way a bill is ever "deleted" in this app.
//
// A billing tool must be physically incapable of making a real sale silently
// vanish (the sales-suppression / CGST-132 risk that put PetPooja under summons).
// So a "delete" NEVER runs a SQL DELETE on an issued order — it STAMPS the
// deleted_* columns (mig 188) and keeps every row forever. A deleted bill stays
// fully visible (tombstoned) to the admin, is retained for tax/audit, and can be
// restored. All three delete entry points (tablet orders/:id/delete, editor bulk
// clear, editor single order_delete) funnel through here so the rule can't drift.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { readInChunks } from "@/lib/inChunks";

const nowIso = () => new Date().toISOString();

export type SoftDeleteActor = {
  actor?: string | null;      // staff/admin display name recorded on the row
  actorId?: string | null;    // stable staff uuid, when known
  reason?: string | null;     // why — surfaced on the tombstone + in the log
};

// Soft-delete the given order rows (scoped to one restaurant). Returns the number
// actually stamped (already-deleted rows are skipped so a double-tap is a no-op).
// If a session is left with NO live (non-deleted) orders, the session itself is
// tombstoned too, so the admin ledger shows the whole bill as one deleted unit.
export async function softDeleteOrders(
  rid: string,
  ids: string[],
  meta: SoftDeleteActor,
): Promise<{ deleted: number }> {
  if (!ids.length) return { deleted: 0 };
  const now = nowIso();
  // THE TOMBSTONE, split in two — because `sessions` HAS NO `archived` COLUMN (2026-08-04).
  //
  // One `stamp` object used to be sent to BOTH tables. `orders` has archived/archived_at;
  // `sessions` does not, so every session UPDATE was rejected by PostgREST — and its result was
  // never checked, so it failed in silence. The session tombstone has therefore NEVER worked:
  // found by driving the live site, which turned up 138 bills whose every order is deleted while
  // the session still reads alive. The admin ledger papered over it by ALSO deriving "deleted"
  // from `orders.every(deleted)` in JS, so it looked fine on screen while the column that the
  // 90-day retention and every index depend on stayed null.
  const orderStamp = {
    deleted_at: now,
    deleted_by: meta.actor ?? null,
    deleted_by_id: meta.actorId ?? null,
    delete_reason: (meta.reason || "").trim().slice(0, 200) || null,
    // Also mark archived: a deleted order is definitionally NOT live, so this reuses the
    // `NOT archived` exclusion every live surface already applies (lfh_floor_state, the
    // kitchen/tablet liveBoard) — the order drops off every operational board at once with
    // no RPC/query change. archived_at doubles as the deletion time for already-live rows.
    archived: true,
    archived_at: now,
  };
  // Only the columns `sessions` actually has.
  const sessionStamp = {
    deleted_at: now,
    deleted_by: meta.actor ?? null,
    deleted_by_id: meta.actorId ?? null,
    delete_reason: (meta.reason || "").trim().slice(0, 200) || null,
  };
  // Only stamp rows not already deleted (idempotent). Grab their sessions to know
  // which tabs might now be fully deleted.
  //
  // ── AND THIS READ'S ERROR COUNTS TOO (T25, sweep #7, 2026-08-28) ─────────────────────────────
  // The long note further down fixed the "who is still busy" read and left THIS one — the very
  // first statement — reading `.data` with the error thrown away. A failed read gives `null`, so
  // `targetIds` is empty and the function returns `{ deleted: 0 }`: the caller is told "nothing to
  // delete", which is what an ALREADY-deleted bill looks like, and the person is shown a success
  // for a delete that never happened. Every other write in this file throws on its error and says
  // in as many words why ("NOT swallowed… an unchecked error meant the column stayed null while the
  // screen looked right"); this read is the last one that did not.
  //
  // Chunked for the same reason the read below is: an `.in()` list of 800 ids is 29.6 KB of URL and
  // PostgREST answers "Bad Request" (measured — lib/inChunks.ts). One bill's orders is a short list
  // today, but a delete path must be right on its own terms, not because its biggest caller happens
  // to be small.
  const liveRead = await readInChunks<{ id: string; session_id: string | null }>(ids, (chunk) =>
    sb.from("orders").select("id, session_id")
      .eq("restaurant_id", rid).in("id", chunk).is("deleted_at", null).limit(chunk.length));
  if (liveRead.error) {
    throw new Error(`soft-delete could not read those bills: ${(liveRead.error as { message?: string })?.message ?? String(liveRead.error)}`);
  }
  const live = liveRead.rows || [];
  const targetIds = live.map((o) => o.id);
  if (!targetIds.length) return { deleted: 0 };

  const ordUpd = await sb.from("orders").update(orderStamp).eq("restaurant_id", rid).in("id", targetIds);
  if (ordUpd.error) throw new Error(`soft-delete failed: ${ordUpd.error.message}`);

  // Tombstone any session whose orders are now ALL deleted (a whole-bill delete).
  const sessionIds = [...new Set(live.map((o) => o.session_id).filter(Boolean))] as string[];
  // TWO QUERIES, NOT TWO PER SESSION (2026-08-04). This was a count query AND an update for every
  // session touched — so "clear all freed records" on a busy restaurant fired hundreds of
  // sequential round-trips inside one request and could die part-way, leaving orders deleted while
  // their bills still read as running. One read finds the sessions that still have live orders;
  // everything else in the batch is tombstoned in a single update.
  if (sessionIds.length) {
    // ── THE "WHO IS STILL BUSY" READ MUST NOT COME BACK SHORT (T25 sweep, 2026-08-21) ─────────────
    //
    // This decides which bills get tombstoned, and it FAILS IN THE DANGEROUS DIRECTION: a session
    // that is missing from `busy` is treated as having no live orders left, so it is marked deleted
    // while its orders are still alive. That is exactly the half-state the note above this function
    // says silently persisted for months — the ledger showing a bill as deleted while the floor
    // shows its food live.
    //
    // Two ways it could come back short, both MEASURED on this stack (see lib/inChunks.ts):
    //   · an `.in()` list of 800 ids is 29.6 KB of URL and PostgREST answers "Bad Request";
    //   · a select with no `.limit()` is silently capped at 1,000 rows — and this read returns ONE
    //     ROW PER LIVE ORDER, not per session, so a few hundred sessions with a handful of live
    //     orders each is enough to cross it.
    //
    // So it is chunked, every chunk is limited, and a failed chunk is an ERROR that aborts the
    // tombstone rather than a shorter list. `.limit(1000)` per chunk, not `chunk.length`: the rows
    // are orders, so there are legitimately more of them than there are ids.
    //
    // (The bulk clear that made this large was removed from the manager panel on the same day —
    // owner, 2026-08-21 — but this function is still reachable from the ADMIN bill ledger with a
    // long selection, and a delete path must be right on its own terms, not because its biggest
    // caller happens to have gone away.)
    // Named `stillBusy`, not `live`: the read above now binds `live` too, and one name meaning two
    // things in one function is the drift this codebase keeps consolidating away.
    const stillBusy = await readInChunks<{ session_id: string | null }>(sessionIds, (chunk) =>
      sb.from("orders").select("session_id")
        .in("session_id", chunk).is("deleted_at", null).eq("restaurant_id", rid).limit(1000));
    if (stillBusy.error) {
      throw new Error(`bill tombstone check failed: ${(stillBusy.error as { message?: string })?.message ?? String(stillBusy.error)}`);
    }
    const busy = new Set((stillBusy.rows || []).map((o) => o.session_id).filter(Boolean) as string[]);
    const toTombstone = sessionIds.filter((sid) => !busy.has(sid));
    if (toTombstone.length) {
      const sUpd = await sb.from("sessions").update(sessionStamp)
        .in("id", toTombstone).eq("restaurant_id", rid).is("deleted_at", null);
      // NOT swallowed. This is the write that silently failed for months: the ledger's "you can
      // restore them" promise and the 90-day retention both hang off sessions.deleted_at, and an
      // unchecked error meant the column stayed null while the screen looked right.
      if (sUpd.error) throw new Error(`bill tombstone failed: ${sUpd.error.message}`);
    }
  }
  return { deleted: targetIds.length };
}

// Restore soft-deleted orders (admin oversight, or a within-reason undo). Clears
// the deleted_* stamp on the orders AND un-tombstones their sessions. `archived` is
// intentionally LEFT set — a restore recovers the bill as a RECORD (back in the
// ledger/history, not thrown onto the live cooking line); staff re-add a dish if a
// genuinely live order was removed by mistake. Logged by the caller.
export async function restoreOrders(
  rid: string,
  ids: string[],
): Promise<{ restored: number }> {
  if (!ids.length) return { restored: 0 };
  const clear = { deleted_at: null, deleted_by: null, deleted_by_id: null, delete_reason: null };
  // Same rule as the delete half above (T25, sweep #7, 2026-08-28): a failed READ used to answer
  // `{ restored: 0 }`, which the ledger renders as "nothing needed restoring" — the very shape the
  // note below this line says was fixed for the WRITES and not for the read that feeds them.
  const goneRead = await readInChunks<{ id: string; session_id: string | null }>(ids, (chunk) =>
    sb.from("orders").select("id, session_id")
      .eq("restaurant_id", rid).in("id", chunk).not("deleted_at", "is", null).limit(chunk.length));
  if (goneRead.error) {
    throw new Error(`restore could not read those bills: ${(goneRead.error as { message?: string })?.message ?? String(goneRead.error)}`);
  }
  const gone = goneRead.rows || [];
  const targetIds = gone.map((o) => o.id);
  if (!targetIds.length) return { restored: 0 };
  // NEITHER WRITE WAS CHECKED, AND THE COUNT WAS THE INTENTION (fixed 2026-08-11, T7 finding F3).
  // Both updates fired blind and the function returned `targetIds.length` — the number of rows it
  // MEANT to clear — so a refused write answered "restored 3" while all three stayed deleted. That
  // is the exact failure softDeleteOrders() above was fixed for, and its comment says why: "This is
  // the write that silently failed for months… an unchecked error meant the column stayed null
  // while the screen looked right." The delete half was repaired; the restore half was not, on the
  // one screen that carries the "you can restore them" promise (app/api/admin/bills/route.ts).
  const ordUpd = await sb.from("orders").update(clear).eq("restaurant_id", rid).in("id", targetIds);
  if (ordUpd.error) throw new Error(`restore failed: ${ordUpd.error.message}`);
  const sessionIds = [...new Set(gone.map((o) => o.session_id).filter(Boolean))] as string[];
  if (sessionIds.length) {
    const sUpd = await sb.from("sessions").update(clear).eq("restaurant_id", rid).in("id", sessionIds);
    // The bill would stay tombstoned in the ledger while its orders read alive — the same
    // half-restored state, just the other way round.
    if (sUpd.error) throw new Error(`bill un-tombstone failed: ${sUpd.error.message}`);
  }
  return { restored: targetIds.length };
}
