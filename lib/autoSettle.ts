// lib/autoSettle.ts — the "auto close / auto restart table" rule.
//
// When the GLOBAL setting `settings.auto_table_action` is 'close' or 'restart',
// a table is automatically settled the moment its bill is FULLY PAID and every
// dish is SERVED. 'off' (default) = no-op (today's behaviour). Called best-effort
// AFTER a pay/serve action in the tablet + editor routes — it must NEVER throw, so
// a failure here can't break the underlying action.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { logAction } from "@/lib/oplog";
import { closeSession, clearTableSignals } from "@/lib/sessionClose";

export async function maybeAutoSettle(
  sessionId: string | null | undefined,
  ctx: { panel: "editor" | "tablet"; deviceId?: string | null },
): Promise<void> {
  if (!sessionId) return;
  try {
    // The session's LIVE orders (not archived, not cancelled). The order's coarse
    // status already rolls up its dishes (served only when every dish is served).
    // We fetch these FIRST so we can read the session's restaurant_id off a real
    // order row, then scope the settings lookup to THAT restaurant (multi-tenant:
    // settings has one row per restaurant_id; the legacy `id='site'` row only ever
    // matched restaurant #1, so other tenants used to read #1's auto-settle mode).
    const res = await sb.from("orders").select("payment_status,status,restaurant_id,table_number")
      .eq("session_id", sessionId).eq("archived", false).neq("status", "cancelled");
    const orders = (res.data || []) as { payment_status?: string; status?: string; restaurant_id?: string | null; table_number?: string | number | null }[];
    if (!orders.length) return;                                          // nothing to settle
    const rid = orders[0]?.restaurant_id;
    if (!rid) return;                                                    // can't scope settings without it → bail safely

    const s = await sb.from("settings").select("auto_table_action,sessions_enabled").eq("restaurant_id", rid).maybeSingle();
    const cfg = s.data as { auto_table_action?: string; sessions_enabled?: boolean } | null;
    // A SETTLED TABLE ALWAYS CLEARS ITSELF (owner, 2026-07-31). Staff have no way to open,
    // close or free a table by hand any more, so "do nothing" is no longer one of the choices:
    // it would leave every finished table sitting on the floor with no way out but cancelling a
    // paid order. The only real question left is WHICH kind of clearing, and it only matters
    // when dining sessions are on:
    // ONE BEHAVIOUR, FOR EVERY TABLE AND EVERY RESTAURANT (owner, 2026-08-01: "we don't even have
    // table open and close … if it is in the back end also, then all the tables — twenty nine is
    // not there, so it's a bug. If it happens then it happens for all, if not then not for all —
    // that is the rule"). The old 'restart' mode cleared the round but kept the party OPEN with
    // nobody on it: a state no screen can show since open/close was removed, and it was sitting on
    // exactly one table out of thirty. So `settings.auto_table_action` no longer changes anything
    // here — a paid + served table CLOSES, which is what every panel already draws. Nothing is
    // deleted: the close path archives the round exactly as before (mig 232).
    if (!orders.every((o) => o.payment_status === "paid")) return;        // bill not fully paid
    if (!orders.every((o) => o.status === "served")) return;             // something not served

    const r = await closeSession(sessionId, { force: true }, ctx); // paid+served → never blocked
    if (r.ok) {
      await logAction(ctx.panel, "table_auto_close", {
        restaurant_id: rid,
        table_number: r.session?.table_number ?? null,
        detail: "auto-closed: bill paid + all served",
        device_id: ctx.deviceId ?? undefined,
      });
    }
  } catch { /* best-effort — auto-settle must never break the pay/serve that triggered it */ }
}
