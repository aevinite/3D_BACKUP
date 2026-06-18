// lib/autoSettle.ts — the "auto close / auto restart table" rule.
//
// When the GLOBAL setting `settings.auto_table_action` is 'close' or 'restart',
// a table is automatically settled the moment its bill is FULLY PAID and every
// dish is SERVED. 'off' (default) = no-op (today's behaviour). Called best-effort
// AFTER a pay/serve action in the tablet + editor routes — it must NEVER throw, so
// a failure here can't break the underlying action.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { logAction } from "@/lib/oplog";
import { closeSession } from "@/lib/sessionClose";

export async function maybeAutoSettle(
  sessionId: string | null | undefined,
  ctx: { panel: "editor" | "tablet"; deviceId?: string | null },
): Promise<void> {
  if (!sessionId) return;
  try {
    const s = await sb.from("settings").select("auto_table_action").eq("id", "site").maybeSingle();
    const mode = (s.data as { auto_table_action?: string } | null)?.auto_table_action;
    if (mode !== "close" && mode !== "restart") return; // 'off' / unset → never act

    // The session's LIVE orders (not archived, not cancelled). The order's coarse
    // status already rolls up its dishes (served only when every dish is served).
    const res = await sb.from("orders").select("payment_status,status")
      .eq("session_id", sessionId).eq("archived", false).neq("status", "cancelled");
    const orders = (res.data || []) as { payment_status?: string; status?: string }[];
    if (!orders.length) return;                                          // nothing to settle
    if (!orders.every((o) => o.payment_status === "paid")) return;        // bill not fully paid
    if (!orders.every((o) => o.status === "served")) return;             // something not served

    if (mode === "close") {
      const r = await closeSession(sessionId, { force: true }, ctx); // paid+served → never blocked
      if (r.ok) await logAction(ctx.panel, "table_auto_close", { table_number: r.session?.table_number ?? null, detail: "auto-closed: bill paid + all served", device_id: ctx.deviceId ?? undefined });
    } else {
      // restart: clear the round but KEEP the session open (mirror /tables/:t/restart) —
      // every live order becomes a served + archived bill record; the table stays open.
      await sb.from("orders").update({ status: "served", archived: true })
        .eq("session_id", sessionId).eq("archived", false).neq("status", "cancelled");
      // …and RELEASE the party, exactly like the manual restart does (fresh round →
      // fresh party; the next guest re-joins). Without this, auto-restart left the old
      // party still "connected" — a parity gap vs /tables/:t/restart. (owner, 2026-06-18)
      await sb.from("session_members").update({ removed: true })
        .eq("session_id", sessionId).eq("removed", false);
      await logAction(ctx.panel, "table_auto_restart", { detail: "auto-restarted: bill paid + all served", device_id: ctx.deviceId ?? undefined });
    }
  } catch { /* best-effort — auto-settle must never break the pay/serve that triggered it */ }
}
