// Admin "Repair Kit" — emergency data surgery during live service. The owner (no coding) uses
// these to calm a problem in seconds (delete a stuck bill, re-fire an order to the kitchen,
// unstick a jammed table, fix a wrong time) while Claude works the permanent fix.
//
// GET  ?restaurant_id=… → that restaurant's open sessions + recent orders, so the admin can pick
//                          a target. NO money is returned (admin sees no earnings, hard rule).
// POST { op, restaurant_id, reason, … } → performs ONE repair. Every op REQUIRES a reason and
//                          writes a loud warn-level diary line (repair_*) so the surgery is
//                          always traceable — that footprint is what tells Claude what happened.
//
// Reuses the SAME service-role primitives the panels use (lfh_void_invoice, lfh_staff_place_order,
// closeSession) so the rules can't drift. Admin-gated; restaurant_id UUID-validated; idempotent.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";
import { logAction } from "@/lib/oplog";
import { withIdempotency } from "@/lib/idempotency";
import { closeSession, clearTableSignals } from "@/lib/sessionClose";
import { softDeleteOrders } from "@/lib/softDelete";
import { recordRemoval } from "@/lib/removalAudit";
import { invalidateFloor } from "@/lib/floorSummary";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const nowIso = () => new Date().toISOString();

async function requireAdmin(req: NextRequest): Promise<true | NextResponse> {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return true;
}

// GET — targets the admin can choose from. Scoped + limited + no earnings.
export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req); if (gate !== true) return gate;
  const rid = new URL(req.url).searchParams.get("restaurant_id") || "";
  if (!UUID.test(rid)) return err("invalid restaurant_id");

  const [sessRes, ordRes] = await Promise.all([
    sb.from("sessions")
      .select("id, table_number, status, bill_no, invoice_no, invoice_voided")
      .eq("restaurant_id", rid).in("status", ["open", "pending"])
      .order("table_number", { ascending: true }).limit(300),
    sb.from("orders")
      .select("id, table_number, kot_no, status, payment_status, created_at, session_id")
      .eq("restaurant_id", rid).eq("archived", false)
      .order("created_at", { ascending: false }).limit(60),
  ]);
  if (sessRes.error) return adminFail("the repair list", sessRes.error, { action: "load" });
  if (ordRes.error) return adminFail("the repair list", ordRes.error, { action: "load" });
  return NextResponse.json({ sessions: sessRes.data ?? [], orders: ordRes.data ?? [] });
}

// Which restaurant this request is repairing, so the after-write floor drop below knows what to
// clear. Keyed by the request object exactly like the panel routes do it.
const writeRid = new WeakMap<NextRequest, string>();

async function handler(req: NextRequest) {
  const gate = await requireAdmin(req); if (gate !== true) return gate;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }

  const op = String(body.op || "");
  const rid = String(body.restaurant_id || "");
  const reason = String(body.reason || "").trim().slice(0, 200);
  if (!UUID.test(rid)) return err("invalid restaurant_id");
  if (!reason) return err("A reason is required for every repair.");

  // Shared logger: every repair is a warn-level admin diary line, tagged repair_<op>.
  const logRepair = (action: string, fields: { order_id?: string | null; table_number?: string | null; detail?: string }) =>
    logAction("admin", action, { restaurant_id: rid, level: "warn", detail: reason + (fields.detail ? ` — ${fields.detail}` : ""), order_id: fields.order_id ?? null, table_number: fields.table_number ?? null });

  // EVERY op here changes what a floor tile says — void a bill, delete or re-fire an order,
  // force-close a jammed table, move an order's time. The manager and waiter panels share ONE
  // whole-floor read for 1.5s (lib/floorSummary.ts), so without this the admin does the surgery and
  // every device polling in that window is still handed the floor from before it, showing the
  // cancelled order or the stuck table as if nothing happened. Dropped BEFORE the write, and again
  // AFTER it lands: another device's poll can land in the gap and re-share the pre-write floor,
  // which is the half the panel routes learned to close on 2026-08-04.
  //
  // Found by the T10 sweep, 2026-08-06: this route had no invalidation at all, and verify:floor's
  // hardcoded three-route list did not know it existed, so the guard printed 24/24 the whole time.
  // That list is now derived from the code — see scripts/verify-floor-share.mjs.
  invalidateFloor(rid);
  writeRid.set(req, rid);

  try {
    // ── Void a bill (reopen an invoiced bill; number kept in the record) ──────────
    if (op === "void_bill") {
      const sessionId = String(body.session_id || "");
      if (!UUID.test(sessionId)) return err("invalid session_id");
      const owns = (await sb.from("sessions").select("id, table_number, invoice_no, bill_no").eq("id", sessionId).eq("restaurant_id", rid).maybeSingle()).data as { table_number?: string; invoice_no?: number | null; bill_no?: number | null } | null;
      if (!owns) return err("That table isn't for this restaurant.", 404);
      if (!owns.invoice_no) return err("This bill has no invoice to void.", 409);
      // What the bill stood at BEFORE it was reopened, so the audit row can say what changed —
      // the same figures the manager's own void records (editor route, invoice_void).
      // ── THE AUDIT'S AMOUNT IS THE POINT OF THE AUDIT ROW (T20 sweep #7, 2026-08-27) ──────────────
      // `.error` was never inspected, so a failed read summed to 0 — and that 0 went straight into
      // `recordRemoval({ amount: wasTotal })`. The Removals record would then show a reopened invoice
      // worth ₹0, which is not "we don't know", it is a wrong figure on the screen the owner and the
      // manager open to answer "what came off my bills, and how much?". Refuse before touching the
      // invoice: reopening a bill is not urgent enough to record it wrongly, and the same request
      // succeeds a second later.
      // `.limit(2000)` is a runaway guard, not a business bound — the same shape and the same reason as
      // the khata balance read in /api/owner/customers. One sitting with 2000 orders on it is a
      // different conversation; leaving it unbounded meant PostgREST's own cap decided the sum instead.
      const beforeQ = await sb.from("orders").select("total, discount").eq("session_id", sessionId).eq("restaurant_id", rid).limit(2000);
      if (beforeQ.error) return adminFail("this bill's figures before reopening it", beforeQ.error, { action: "load" });
      const beforeVoid = beforeQ.data as { total: number | null; discount: number | null }[] | null;
      const wasTotal = (beforeVoid || []).reduce((s, o) => s + (Number(o.total) || 0), 0);
      // p_actor was missing, so the append-only invoice history recorded a void with NO actor —
      // the one field whose whole job is answering "who did this?".
      const { error } = await sb.rpc("lfh_void_invoice", { p_session: sessionId, p_reason: reason, p_actor: "Admin (repair)" });
      if (error) throw new Error(error.message);
      await logRepair("repair_void_bill", { table_number: owns.table_number ?? null, detail: `session ${sessionId}` });
      // …AND into the Audit (Removals), which is where the OWNER and the MANAGER look. The
      // Repair Kit was the last money path that recorded only to the activity log, so an admin
      // reopening someone's bill was invisible on the one screen built to answer "what was taken
      // off my bills, and why?" (2026-08-04). The manager's twin has done this since 2026-08-02.
      await recordRemoval({
        rid, kind: "invoice_voided", reason: { note: reason }, user: null,
        sessionId, tableNumber: owns.table_number != null ? String(owns.table_number) : null,
        amount: wasTotal,
        meta: { from: "admin repair kit", total_at_reopen: wasTotal, invoice_no: owns.invoice_no ?? null, bill_no: owns.bill_no ?? null },
      });
      return NextResponse.json({ ok: true });
    }

    // ── Delete an order/bill (admin override) — SOFT delete only. Even god-mode can't
    //    ERASE a real sale (mig 188/190): this tombstones it (restorable), never a hard
    //    DELETE — a hard delete of an issued bill is refused at the database level.
    if (op === "delete_order") {
      const orderId = String(body.order_id || "");
      if (!UUID.test(orderId)) return err("invalid order_id");
      const cur = (await sb.from("orders").select("id, table_number, payment_status, status, total, session_id").eq("id", orderId).eq("restaurant_id", rid).maybeSingle()).data as
        { table_number?: string; payment_status?: string; status?: string; total?: number | null; session_id?: string | null } | null;
      if (!cur) return err("That order isn't for this restaurant.", 404);
      await softDeleteOrders(rid, [orderId], { actor: "Admin (repair)", actorId: null, reason: reason || "admin repair delete" });
      await logRepair("repair_delete_order", { order_id: orderId, table_number: cur.table_number ?? null, detail: (cur.payment_status === "paid" ? "was PAID — " : "") + "soft-deleted (tombstoned)" });
      // Same reason as the void above: a removal has to reach the Audit, not just the log.
      await recordRemoval({
        rid, kind: "order_deleted", reason: { note: reason || "admin repair delete" }, user: null,
        orderId, sessionId: cur.session_id ?? null,
        tableNumber: cur.table_number != null ? String(cur.table_number) : null,
        amount: Number(cur.total) || 0,
        meta: { from: "admin repair kit", was_paid: cur.payment_status === "paid" },
      });
      return NextResponse.json({ ok: true });
    }

    // ── Re-fire an order: clone its dishes into a fresh order (new KOT, re-priced) ──
    if (op === "refire_order") {
      const orderId = String(body.order_id || "");
      if (!UUID.test(orderId)) return err("invalid order_id");
      const src = (await sb.from("orders").select("id, table_number, items, allergies").eq("id", orderId).eq("restaurant_id", rid).maybeSingle()).data as { table_number?: string; items?: unknown[]; allergies?: unknown } | null;
      if (!src) return err("That order isn't for this restaurant.", 404);
      const table = String(src.table_number || "").trim();
      if (!/^\d+$/.test(table)) return err("The original order has no valid table to re-fire onto.");
      const items = Array.isArray(src.items) ? src.items : [];
      if (!items.length) return err("That order has no dishes to re-fire.");
      // lfh_staff_place_order re-prices from each line's id/qty/options — extra stored fields
      // (price/status) are ignored — so we can hand it the stored lines directly.
      const { data, error } = await sb.rpc("lfh_staff_place_order", {
        p_table: table, p_items: items, p_allergies: Array.isArray(src.allergies) ? src.allergies : [], p_note: `re-fired by admin: ${reason}`.slice(0, 200), p_restaurant_id: rid,
      });
      if (error) throw new Error(error.message);
      // Optionally cancel the broken original so it doesn't linger.
      // ── NEVER RECORD A CHANGE THAT DIDN'T HAPPEN (T20 sweep #7, 2026-08-27) ──────────────────────
      // This write's error was dropped and the diary line said "· old cancelled" regardless — so a
      // failed cancel left the broken original LIVE on the kitchen board while the permanent record
      // claimed it had been cancelled. The re-fire itself has already succeeded (a new KOT is on the
      // paper), so this must not fail the request; it tells the truth in the line instead, and says
      // so in the reply so the admin knows the old ticket still needs dealing with.
      let oldCancelled: boolean | null = null;
      if (body.cancel_old === true) {
        const c = await sb.from("orders").update({ status: "cancelled", archived: true, archived_at: nowIso(), cancelled_at: nowIso() }).eq("id", orderId).eq("restaurant_id", rid);
        oldCancelled = !c.error;
        if (c.error) console.error("[admin/repair] re-fired but could not cancel the original:", c.error.message);
      }
      await logRepair("repair_refire_order", { order_id: orderId, table_number: table, detail: `new KOT ${(data as { kot_no?: number })?.kot_no ?? "?"}${oldCancelled === true ? " · old cancelled" : oldCancelled === false ? " · THE OLD ORDER IS STILL LIVE (the cancel failed)" : ""}` });
      return NextResponse.json({ ok: true, kot_no: (data as { kot_no?: number })?.kot_no ?? null,
        ...(oldCancelled === false ? { oldCancelFailed: true } : {}) });
    }

    // ── Unstick a jammed table: force-close an open/pending session ────────────────
    if (op === "unstick_table") {
      const sessionId = String(body.session_id || "");
      if (!UUID.test(sessionId)) return err("invalid session_id");
      const owns = (await sb.from("sessions").select("id, table_number").eq("id", sessionId).eq("restaurant_id", rid).maybeSingle()).data as { table_number?: string } | null;
      if (!owns) return err("That table isn't for this restaurant.", 404);
      const res = await closeSession(sessionId, { force: true }, { panel: "admin", restaurantId: rid });
      if (!res.ok) return err(res.message, res.status);
      await clearTableSignals(rid, owns.table_number ?? null);
      await logRepair("repair_unstick_table", { table_number: owns.table_number ?? null, detail: `session ${sessionId}` });
      return NextResponse.json({ ok: true });
    }

    // ── Edit an order's time/date (moves it across report/day boundaries) ──────────
    if (op === "edit_time") {
      const orderId = String(body.order_id || "");
      if (!UUID.test(orderId)) return err("invalid order_id");
      const when = String(body.created_at || "");
      const d = new Date(when);
      if (isNaN(d.getTime())) return err("Pick a valid date and time.");
      // Guard against a fat-fingered far-future/past time.
      const yr = d.getUTCFullYear();
      if (yr < 2020 || yr > 2100) return err("That date looks wrong — check the year.");
      const cur = (await sb.from("orders").select("id, table_number, created_at").eq("id", orderId).eq("restaurant_id", rid).maybeSingle()).data as { table_number?: string; created_at?: string } | null;
      if (!cur) return err("That order isn't for this restaurant.", 404);
      const { error } = await sb.from("orders").update({ created_at: d.toISOString() }).eq("id", orderId).eq("restaurant_id", rid);
      if (error) throw new Error(error.message);
      await logRepair("repair_edit_time", { order_id: orderId, table_number: cur.table_number ?? null, detail: `${cur.created_at} → ${d.toISOString()}` });
      return NextResponse.json({ ok: true });
    }

    return err("unknown repair op");
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// The after-write drop (see the note inside handler()). Same shape as the panel routes'
// invalidateFloorAfter(): the rid rides on the REQUEST, never on a module-level variable. A `let`
// here would be shared by every concurrent request, so two admins repairing two restaurants at
// once would drop each other's snapshot and leave their own stale — the opposite of the fix.
async function dropFloorAfter(req: NextRequest): Promise<NextResponse> {
  const res = await handler(req);
  const rid = writeRid.get(req);
  if (rid) invalidateFloor(rid);
  return res;
}

export const POST = withIdempotency(dropFloorAfter, "admin");
