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

  // noBar goes to billDocHtml (the DOCUMENT), not to billData (the FIGURES) — they are two different
  // shapes and the compiler said so, which is the third time today a type has caught a real mistake.
  return BILLDOC.billDocHtml({ ...BILLDOC.billData({
    settings, restaurant: (restQ.data || {}) as Record<string, unknown>,
    orders, session, tableDisp, parcel: !!opts?.parcel,
    // The helper prints it with the machine's own print command — there is no window to fire a
    // dialog in, so the document must not try to print itself.
    autoPrint: false,
  }),
    // NO TOOLBAR AND NO SCRIPT for a document nobody is looking at. The bar and the zoom controls are
    // screen-only and would never reach the paper, but they are dead weight in a headless render, and
    // `noBar` is the flag the Audit card already uses for the same reason (a bill being READ, not
    // issued). Fewer moving parts in the one path that must not stall.
    noBar: true,
  });
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

/**
 * Stamp the page size on a document that is about to be turned into a PDF by the helper.
 *
 * WHY THIS EXISTS, and why it is NOT the mistake it looks like. billdoc.js deliberately declares no
 * @page size for a thermal ticket, and verify:print-format guards that — because in the BROWSER
 * chain the page size comes from the printer queue itself, and declaring a different one is what
 * printed the owner's bill sideways at half size on 2026-08-19.
 *
 * The helper's chain is not that chain. It renders with headless Chrome, which has no queue to take
 * a size from and will happily produce a US-Letter page with a 66mm strip floating on it — and THAT
 * mismatch is the same rotation fault by another road. So here, and only here, the document is told
 * exactly the size of the paper the target printer is loaded with (from the machine's own report, or
 * the admin's per-route answer — never a guess). Page and media then agree to the millimetre.
 *
 * A document that already declares its own size — the A4/A5 banquet sheet does — is left alone: its
 * size IS the answer, and overriding it would be this same fault a third time.
 */
export function withPaper(html: string, paper: { wMm: number; hMm: number } | null): string {
  if (!paper) return html;
  if (/@page\s*\{[^}]*\bsize\s*:/.test(html)) return html;
  // ── AND THE INK MUST FIT THE ROLL (found by the printing sweep, 2026-08-26) ─────────────────
  // The document's column is 66mm, which is right for the 80mm roll it was designed on. On a 58mm
  // roll the sweep measured ink reaching 52.9mm against about 52mm of printable width — so the
  // right-hand edge of every bill would have been shaved off at any restaurant using narrow rolls,
  // and nothing on screen would have shown it.
  //
  // So a narrow roll narrows the column: the paper minus ~8mm for the two unprintable edges, and
  // never WIDER than the 66mm the layout was drawn for (a 3-inch roll keeps today's paper exactly).
  // Big paper is untouched — a banquet sheet declares its own size and returns above.
  // The head cannot reach the paper's edges. The ZJ-80's own driver file says how far: an 79.7mm sheet
  // has an imageable area of 4.9–74.8mm, i.e. ~4.9mm unreachable on EACH side. So the widest ink a roll
  // can take is its width minus 9.8mm — 48mm on a 58mm roll — and 66mm stays 66mm on an 80mm roll,
  // which is the paper he already approved. Measured, not guessed: with `- 8` instead the sweep still
  // put ink 1.4mm past where the head stops.
  const EDGE = 4.9;
  const ink = Math.min(66, Math.max(30, Math.round((paper.wMm - EDGE * 2) * 10) / 10));
  const narrow = ink < 66
    // CENTRED, and measured rather than reasoned. The head's imageable area starts ~4.9mm in from the
    // paper edge and is `ink` wide, so a column centred in the page lands exactly on it: 4.9–52.9mm of
    // a 57.8mm roll. Anchoring it LEFT instead (which I tried first, reasoning that the chain crops
    // from the left) pushed 4.9mm of every line off the head — the sweep measured 43.0mm of ink where
    // the document laid out 48mm. Centred, all 48mm arrives.
    ? `html body{width:${ink}mm !important;margin:0 auto !important}` +
      // A table laid out for a wider column will otherwise push its last figure out of view.
      `table{width:100% !important}` +
      // 12.5px in a 50mm column is about 26 characters a line; a dish name wraps rather than clips.
      `body,td,.t,.kv,.sub{word-break:break-word}` +
      // …but a COLUMN HEADING must never wrap: on a 58mm roll "AMT" broke into "AM / T" over two lines
      // (seen on the virtual printer's paper). A heading is three or four letters — it is allowed to be
      // a point smaller and it is not allowed to break.
      `thead td,thead th{font-size:10px !important;white-space:nowrap !important;letter-spacing:0 !important}`
    : "";
  const rule = `<style>@page{size:${paper.wMm}mm ${paper.hMm}mm;margin:0}` +
    (narrow ? `@media print{${narrow}}` : "") + `</style>`;
  // ── IT MUST GO LAST, NOT FIRST ────────────────────────────────────────────────────────────────
  // billdoc's documents have NO `</head>` — the old line fell through to `rule + html`, which put this
  // BEFORE the document's own `body{width:66mm !important}`. Equal specificity, both !important, so the
  // later one wins: the 66mm column won, and a 58mm roll printed a bill laid out for 80mm and CHOPPED
  // — "LITTLE FRENCH HOUS", the amounts column gone. The virtual printer's picture is what showed it;
  // the ink measurement alone said "fits", because clipped ink always fits.
  // So it is appended at the very END, after every stylesheet the document carries.
  if (html.includes("</body>")) return html.replace("</body>", rule + "</body>");
  return html + rule;
}

/**
 * A banquet sheet — the A4/A5 event bill (mig 237). Every figure is read from the bill row, which was
 * frozen when the bill was issued, so a reprint years later is identical to the original; nothing
 * here recalculates a rupee.
 */
export async function banquetHtmlForBill(rid: string, billId: string): Promise<string | null> {
  const [billQ, setQ, restQ] = await Promise.all([
    sb.from("banquet_bills").select("*").eq("id", billId).eq("restaurant_id", rid).maybeSingle(),
    sb.from("settings").select(`${TAX_SETTINGS_COLUMNS}, ${IDENTITY_COLUMNS}`).eq("restaurant_id", rid).maybeSingle(),
    sb.from("restaurants").select("*").eq("id", rid).maybeSingle(),
  ]);
  const bill = billQ.data as Record<string, unknown> | null;
  if (!bill) return null;
  // THE LINES COME FROM THE LINKED ORDER, which is where the panel reads them too (its Banquet
  // ledger does `r.order.items` → {title, qty, price}). My first version looked for a `lines` column
  // on the bill; there is none, and it would have printed an event sheet with no items on it.
  const ord = bill.order_id
    ? (await sb.from("orders").select("items").eq("id", String(bill.order_id)).eq("restaurant_id", rid).maybeSingle()).data as { items?: unknown } | null
    : null;
  const lines = (Array.isArray(ord?.items) ? ord!.items as Record<string, unknown>[] : []).map((i) => ({
    title: String(i.title ?? ""), qty: Number(i.qty) || 1, price: parseFloat(String(i.price)) || 0,
  }));
  return BILLDOC.banquetDocHtml({
    bill, lines,
    settings: (setQ.data || {}) as Record<string, unknown>,
    restaurant: (restQ.data || {}) as Record<string, unknown>,
  });
}
