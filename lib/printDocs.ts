// lib/printDocs.ts — the paper a helper is handed.
//
// A print job carries IDS, never a rendered document (mig 341). When a helper claims one it asks
// for the paper, and this is where the paper is built — from public/panels/billdoc.js, the SAME
// file the manager panel and the kitchen board print from. That is the whole point: ONE bill, ONE
// ticket, one file (owner, 2026-08-02: "both should be sync"). A helper that rendered its own
// ESC/POS text would be a second layout, and a second layout drifts the moment either side is
// touched — which is the fault this file exists to make impossible.
//
// It also means a job cannot print a stale bill: the document is built at the moment of printing,
// from the rows as they are then.
import BILLDOC from "@/public/panels/billdoc.js";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { TAX_SETTINGS_COLUMNS } from "@/lib/tax";

const IDENTITY_COLUMNS = "restaurant_name, restaurant_address, restaurant_phone, gstin, invoice_prefix, bill_footer, tax_label, table_names";

/**
 * The table as the FLOOR knows it — the table's NAME when the owner set one, else "T7", and "T?"
 * when a row has no table at all (a banquet bill with the table left blank).
 *
 * "T7", NEVER "Table 7" (owner, 2026-08-05: "it should always be T7"). ONE short form everywhere —
 * panels, tickets and the printed bill — which is why this mirrors `tlong()` in the kitchen panel
 * exactly rather than inventing a longer wording for paper.
 *
 * AND THERE IS DELIBERATELY NO PARCEL BRANCH. My first version read `order.platform`, which does
 * not exist: `orders` has no platform/source/channel column, and a parcel is not an orders row at
 * all — it lives in `aggregator_orders` and is drawn by the panel's own platTicketHtml(). The T4
 * sweep already deleted exactly that branch from the kitchen panel on 2026-08-06 for exactly that
 * reason ("keeping an unreachable branch that reads a non-existent column is worse than not having
 * one: it reads as handled"), and reading a column that isn't there made the whole document come
 * back empty, so the job was dismissed and nothing printed. Twice-learned; do not add it back.
 *
 * ⚠️ THE KITCHEN PANEL HOLDS THE OTHER COPY (`tlong()` in public/panels/kitchen/app.js), because
 * there it also labels the board on screen, not only the paper. Two copies of a rule is what this
 * codebase refuses — so they are held together by a PARITY TEST
 * (scripts/verify-print-helper.mjs): both are driven over the same tables and must agree, the same
 * tactic verify-summary-parity.mjs uses for its SQL/TS pair. Change one and the guard fails.
 */
export function kotTableLabel(order: Record<string, unknown>, tableNames: Record<string, string> | null | undefined): string {
  const t = order.table_number == null ? "" : String(order.table_number).trim();
  if (!t) return "T?";
  const named = tableNames && typeof tableNames === "object" ? tableNames[t] : null;
  return named && String(named).trim() ? String(named).trim() : "T" + t;
}

const restName = (settings: Record<string, unknown>, restaurant: Record<string, unknown>) =>
  String(settings.restaurant_name || restaurant.name || "Kitchen").replace(/\*/g, "").trim() || "Kitchen";

/** A kitchen ticket for one order — what mig 335's trigger queues, and by far the commonest job. */
export async function kotHtmlForOrder(rid: string, orderId: string, reprint: boolean): Promise<string | null> {
  const [ordQ, setQ, restQ] = await Promise.all([
    sb.from("orders").select("id, kot_no, table_number, items, allergies, created_at, status, deleted_at")
      .eq("id", orderId).eq("restaurant_id", rid).maybeSingle(),
    sb.from("settings").select(IDENTITY_COLUMNS).eq("restaurant_id", rid).maybeSingle(),
    sb.from("restaurants").select("id, name").eq("id", rid).maybeSingle(),
  ]);
  const order = ordQ.data as Record<string, unknown> | null;
  // The order went away, or was cancelled, between queueing and printing. Printing it anyway puts
  // food on a rail that nobody ordered — the queue retires such jobs (lib/printQueue), and this is
  // the second door on the same rule.
  if (!order || order.deleted_at || order.status === "cancelled") return null;
  const settings = (setQ.data || {}) as Record<string, unknown>;
  const restaurant = (restQ.data || {}) as Record<string, unknown>;
  const items = Array.isArray(order.items) ? order.items as Record<string, unknown>[] : [];

  return BILLDOC.kotDocHtml({
    title: "KOT " + String(order.kot_no ?? "—"),
    rname: restName(settings, restaurant),
    head: "KITCHEN TICKET",
    kot: (order.kot_no as number | null) ?? "—",
    tableLabel: kotTableLabel(order, settings.table_names as Record<string, string> | undefined),
    when: BILLDOC.kotWhen(order.created_at as string),
    lines: items,
    allergies: Array.isArray(order.allergies) ? order.allergies : [],
    reprint: !!reprint,
  });
}

/**
 * A bill for one table session — the same document the manager panel opens in its print window,
 * assembled the same way (BILLDOC.billData does the money, the rows and the tax; nothing here
 * re-derives a figure).
 */
export async function billHtmlForSession(rid: string, sessionId: string, opts?: { parcel?: boolean }): Promise<string | null> {
  const [sessQ, setQ, restQ] = await Promise.all([
    sb.from("sessions").select("*").eq("id", sessionId).eq("restaurant_id", rid).maybeSingle(),
    sb.from("settings").select(`${TAX_SETTINGS_COLUMNS}, ${IDENTITY_COLUMNS}`).eq("restaurant_id", rid).maybeSingle(),
    sb.from("restaurants").select("*").eq("id", rid).maybeSingle(),
  ]);
  const session = sessQ.data as Record<string, unknown> | null;
  if (!session) return null;
  const orders = ((await sb.from("orders").select("*").eq("session_id", sessionId).eq("restaurant_id", rid)).data || []) as Record<string, unknown>[];
  if (!orders.length) return null;
  const settings = (setQ.data || {}) as Record<string, unknown>;
  const tnum = session.table_number == null ? "" : String(session.table_number);
  const names = settings.table_names as Record<string, string> | undefined;
  const tableDisp = (names && tnum && names[tnum]) || (tnum ? (/^\d+$/.test(tnum) ? "T" + tnum : tnum) : "—");

  return BILLDOC.billDocHtml(BILLDOC.billData({
    settings, restaurant: (restQ.data || {}) as Record<string, unknown>,
    orders, session, tableDisp, parcel: !!opts?.parcel,
    // The helper prints it with the machine's own print command — there is no window to fire a
    // dialog in, so the document must not try to print itself.
    autoPrint: false,
  }));
}

/**
 * The admin's "send one page to that printer" button.
 *
 * It is a REAL job on the real road (mig 341 widened `kind` for it) rather than a special case,
 * because a test that takes a different path can pass while the path that matters is broken. It is
 * deliberately NOT a fake bill: nothing that looks like a sale should ever come out of a printer
 * without being one.
 */
export function testHtml(o: { restaurant: string; printer: string; agent: string; when: string }): string {
  const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  return `<!doctype html><html><head><meta charset="utf-8"><title>Printer test</title><style>
    @page{margin:0}
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;width:66mm;margin:0 auto;padding:2mm 0;
         color:#000;font-size:12.5px;line-height:1.55;font-weight:400}
    h1{font-size:17px;text-align:center;letter-spacing:.04em;margin:0 0 8px}
    .r{display:flex;justify-content:space-between;padding:3.5px 0}
    .l{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase}
    .d{border-top:1px solid #000;margin:11px 0}
    .f{text-align:center;font-size:11px;margin-top:11px}
  </style></head><body>
    <h1>PRINTER TEST</h1>
    <div class="d"></div>
    <div class="r"><span class="l">Restaurant</span><span>${esc(o.restaurant)}</span></div>
    <div class="r"><span class="l">Printer</span><span>${esc(o.printer)}</span></div>
    <div class="r"><span class="l">Computer</span><span>${esc(o.agent)}</span></div>
    <div class="r"><span class="l">Time</span><span>${esc(o.when)}</span></div>
    <div class="d"></div>
    <div class="f">If you can read this, this printer is ready.<br/>Nothing was charged and nothing was recorded as a sale.</div>
  </body></html>`;
}
