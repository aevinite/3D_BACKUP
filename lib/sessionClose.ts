// lib/sessionClose.ts — the ONE table-close used by BOTH the manager (editor) and
// tablet routes, so the rule is genuinely identical instead of copy-pasted in two
// places (the tablet copy also used to swallow its cleanup errors — fixed here).
//
// Rule: a table can't be closed while any live order is still COOKING
// (received/preparing) OR has an UNPAID bill — unless force=true ("close anyway").
// On a clear/forced close: mark the session closed, LOG any money still owed (so
// it's never silently erased), CANCEL un-served unpaid work (the meal's over), and
// ARCHIVE everything else as the bill record. Every write is error-checked.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { logAction } from "@/lib/oplog";

const nowIso = () => new Date().toISOString();
const must = (r: { error: { message: string } | null; data: unknown }) => {
  if (r.error) throw new Error(r.error.message);
  return r.data as any[];
};

export type CloseResult =
  | { ok: false; status: number; message: string; reason: "unpaid" | "cooking" | "both" }
  | { ok: true; session: any };

export type OrderLite = { status?: string | null; payment_status?: string | null };

// Pure decision: given the session's live (non-archived, non-cancelled) orders,
// can it be closed? Blocked when any order is still COOKING (received/preparing)
// OR UNPAID — unless force=true. Exported so the rule can be unit-tested directly.
export function closeBlock(orders: OrderLite[], force: boolean):
  | null
  | { reason: "unpaid" | "cooking" | "both"; status: number; message: string } {
  if (force) return null;
  const cooking = orders.some((o) => o.status === "received" || o.status === "preparing");
  const unpaid = orders.some((o) => o.payment_status !== "paid");
  if (!cooking && !unpaid) return null;
  const reason = unpaid && cooking ? "both" : unpaid ? "unpaid" : "cooking";
  const message =
    reason === "both" ? "This table still owes money and has orders still cooking — settle and serve, or close anyway."
    : reason === "unpaid" ? "This table still owes money — settle the bill, or close anyway."
    : "This table still has orders cooking — serve them, or close anyway.";
  return { reason, status: 409, message };
}

export async function closeSession(
  sessionId: string,
  opts: { force?: boolean },
  ctx: { panel: "editor" | "tablet"; deviceId?: string | null },
): Promise<CloseResult> {
  const force = opts.force === true;

  // Live orders that would block a close: not archived, not cancelled, and either
  // still cooking OR not yet paid. Decision lives in the pure closeBlock() helper.
  const blockers = must(await sb.from("orders").select("id,status,payment_status")
    .eq("session_id", sessionId).eq("archived", false).neq("status", "cancelled"));
  const block = closeBlock(blockers, force);
  if (block) return { ok: false, status: block.status, message: block.message, reason: block.reason };

  const row = must(await sb.from("sessions").update({ status: "closed", closed_at: nowIso() }).eq("id", sessionId).select());
  const sess = row[0];
  if (sess) {
    // Scope cleanup to THIS session (not the bare table number, which could hit a
    // different party that later sat at the same table).
    const owedRows = must(await sb.from("orders").select("total,discount")
      .eq("session_id", sessionId).eq("archived", false).neq("status", "cancelled").neq("payment_status", "paid"));
    if (owedRows.length) {
      const owed = owedRows.reduce((s: number, o: any) => s + (Number(o.total) || 0) - (Number(o.discount) || 0), 0);
      await logAction(ctx.panel, "close_unpaid", { table_number: sess.table_number ?? null, detail: `closed with ${owedRows.length} unpaid order(s), ₹${owed} owed`, device_id: ctx.deviceId ?? undefined });
    }
    must(await sb.from("orders").update({ status: "cancelled", archived: true })
      .eq("session_id", sessionId).eq("archived", false).neq("payment_status", "paid").in("status", ["received", "preparing"]).select());
    must(await sb.from("orders").update({ archived: true })
      .eq("session_id", sessionId).eq("archived", false).select());
    // The round is over — RELEASE the head + every partner from this session, so the
    // table isn't left "connected" to the last party. A new party re-joins fresh on
    // the next open/scan. (owner, 2026-06-18)
    must(await sb.from("session_members").update({ removed: true })
      .eq("session_id", sessionId).eq("removed", false).select());
  }
  await logAction(ctx.panel, "table_close", { table_number: sess?.table_number ?? null, device_id: ctx.deviceId ?? undefined });
  return { ok: true, session: sess || null };
}
