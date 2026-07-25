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
  const stamp = {
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
  // Only stamp rows not already deleted (idempotent). Grab their sessions to know
  // which tabs might now be fully deleted.
  const live = (await sb.from("orders").select("id, session_id")
    .eq("restaurant_id", rid).in("id", ids).is("deleted_at", null)).data as
    { id: string; session_id: string | null }[] | null;
  const targetIds = (live || []).map((o) => o.id);
  if (!targetIds.length) return { deleted: 0 };

  await sb.from("orders").update(stamp).eq("restaurant_id", rid).in("id", targetIds);

  // Tombstone any session whose orders are now ALL deleted (a whole-bill delete).
  const sessionIds = [...new Set((live || []).map((o) => o.session_id).filter(Boolean))] as string[];
  for (const sid of sessionIds) {
    const remaining = await sb.from("orders").select("id", { count: "exact", head: true })
      .eq("session_id", sid).is("deleted_at", null);
    if ((remaining.count || 0) === 0) {
      await sb.from("sessions").update(stamp).eq("id", sid).eq("restaurant_id", rid).is("deleted_at", null);
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
  const gone = (await sb.from("orders").select("id, session_id")
    .eq("restaurant_id", rid).in("id", ids).not("deleted_at", "is", null)).data as
    { id: string; session_id: string | null }[] | null;
  const targetIds = (gone || []).map((o) => o.id);
  if (!targetIds.length) return { restored: 0 };
  await sb.from("orders").update(clear).eq("restaurant_id", rid).in("id", targetIds);
  const sessionIds = [...new Set((gone || []).map((o) => o.session_id).filter(Boolean))] as string[];
  if (sessionIds.length) {
    await sb.from("sessions").update(clear).eq("restaurant_id", rid).in("id", sessionIds);
  }
  return { restored: targetIds.length };
}
