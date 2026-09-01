// lib/auditDetail.ts — WHAT A REMOVAL LOOKED LIKE BEFORE, WHAT IT LOOKS LIKE NOW, AND THE BILL.
//
// WHY (owner, 2026-08-12): "there should be two box like if you have changed any KOT or edit any KOT
// — so before, how it was looking, and after, how it was looking … whenever you click a particular
// audit it will show all this in the audit detail, that previously it was this and he has changed
// this. He has deleted this bill — the bill photo and all that details of the bill will be listed
// there, so bill number and all that."
//
// ── WHERE "BEFORE" AND "AFTER" COME FROM ─────────────────────────────────────────────────────────
// BEFORE is already stored: `deletion_audit.meta.was` is a snapshot taken at the moment of the change
// (lib/removalAudit.ts → snapshotOrder) — the KOT number, the table, the bill number, every line with
// its qty and price, and the money. It has been written on every removal since mig 251 and nothing
// but the detail card ever read it.
//
// AFTER is NOT stored, and deliberately is not: it is read LIVE from the order here. That is both
// cheaper (nothing extra written on the hot path of a removal) and MORE truthful — a stored "after"
// would freeze at the moment of the change and go stale the next time the order was touched, so a
// card could show an "after" that stopped being true hours ago. Read live, the right-hand box always
// answers "and how does it stand now?", which is the question a person actually has.
//   · the order is gone from the books (soft-deleted) → `state: "removed"`, and there is no box to draw
//   · the order was cancelled                          → `state: "cancelled"`
//   · the order still exists                           → `state: "live"` + its current figures
//   · there was never an order (a dish off the MENU)    → null, and the card shows only the before
//
// ── THE "BILL PHOTO" IS THE REAL BILL, NOT A PICTURE OF ONE ──────────────────────────────────────
// He asked for an image, and said he did not know how. An image would mean generating, storing and
// serving a PNG per removal — storage, egress, and a picture that goes blurry when you zoom. There is
// a better answer sitting in the repo: `public/panels/billdoc.js` IS the bill. Feeding it the stored
// snapshot produces the actual document, the same one the printer produces, as sharp as the screen
// allows, with nothing stored anywhere. So the card can show the bill as it stood when it was
// removed — bill number, invoice number, every line, the tax and the total.
//
// It is rendered from the SNAPSHOT, never from the live order: the point is what was taken away.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import BILLDOC from "@/public/panels/billdoc.js";
import { TAX_SETTINGS_COLUMNS } from "@/lib/tax";

/** The figures a person compares between the two boxes. Same shape both sides, so the card can diff
 *  them without knowing which kind of removal it is looking at. */
export type AuditSide = {
  state: "live" | "cancelled" | "removed";
  kot_no: number | null;
  table_number: string | null;
  status: string | null;
  payment_status: string | null;
  item_count: number;
  items: { title: string | null; qty: number | null; price: number | null; note?: string | null }[];
  subtotal: number | null;
  discount: number | null;
  tax: number | null;
  total: number | null;
};

const ORDER_COLS =
  "id, kot_no, table_number, items, subtotal, discount, tax, total, status, payment_status, deleted_at";

/**
 * The order AS IT STANDS NOW. `null` when this removal was never about an order (a dish taken off the
 * menu), or when the row has genuinely gone.
 *
 * Scoped to the restaurant and column-listed — one row, read only when someone opens a card.
 */
export async function auditAfter(rid: string, orderId: string | null | undefined): Promise<AuditSide | null> {
  if (!orderId) return null;
  const o = (await sb.from("orders").select(ORDER_COLS).eq("id", orderId).eq("restaurant_id", rid).maybeSingle()).data as
    Record<string, unknown> | null;
  if (!o) return null;
  const items = Array.isArray(o.items) ? (o.items as Record<string, unknown>[]) : [];
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    // A tombstoned order still HAS its row (that is the whole point of lib/softDelete.ts), so
    // "removed" has to be read off deleted_at rather than inferred from the row being missing.
    state: o.deleted_at ? "removed" : o.status === "cancelled" ? "cancelled" : "live",
    kot_no: n(o.kot_no),
    table_number: o.table_number == null ? null : String(o.table_number),
    status: (o.status as string) ?? null,
    payment_status: (o.payment_status as string) ?? null,
    item_count: items.length,
    // Capped exactly as the snapshot is (60), so the two boxes are always comparable line for line.
    items: items.slice(0, 60).map((it) => ({
      title: (it.title as string) ?? null,
      qty: n(it.qty),
      price: n(it.price),
      note: (it.note as string) ?? null,
    })),
    subtotal: n(o.subtotal),
    discount: n(o.discount),
    tax: n(o.tax),
    total: n(o.total),
  };
}

/**
 * WHAT THE WHOLE BILL WAS WORTH BEFORE THIS, AND WHAT IT IS WORTH NOW (owner, 2026-08-26).
 *
 * His words: *"the before and after in the audit section should be shown like actual … previously
 * the whole bill was this much and after cutting, this has been removed and the bill is this much."*
 *
 * The two boxes above this one compare the KOT with ITSELF, which answers "what was on the ticket"
 * but never "what did this do to the table's bill" — and that second question is the one a manager
 * and an officer both actually ask.
 *
 * HOW THE TWO NUMBERS ARE GOT, and why neither is invented:
 *   · AFTER  = the live (non-cancelled, non-tombstoned) orders on this session, summed NOW.
 *   · REMOVED = what this record took out, from the snapshot the audit row already stores.
 *   · BEFORE = AFTER + REMOVED. No bill history is needed and none is guessed: the bill before the
 *     removal is, by definition, the bill after it plus the thing that came out.
 *
 * Returns null when the removal was never about a table's bill (a dish taken off the MENU has no
 * session), so the card simply does not draw the row — an older server that sends nothing leaves
 * the card exactly as it was.
 *
 * Scoped to the restaurant, column-listed, capped, and read only when someone opens a card.
 */
export async function auditBillSides(
  rid: string,
  sessionId: string | null | undefined,
  was: Record<string, unknown> | null | undefined,
  removedOrderId: string | null | undefined,
): Promise<{ before: number; after: number; removed: number; lines_before: number; lines_after: number } | null> {
  if (!sessionId) return null;
  const rows = (await sb.from("orders")
    .select("id, total, status, deleted_at, items")
    .eq("session_id", sessionId).eq("restaurant_id", rid).limit(200)).data as Record<string, unknown>[] | null;
  if (!rows) return null;
  const live = rows.filter((o) => !o.deleted_at && o.status !== "cancelled");
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const after = r2(live.reduce((a, o) => a + (Number(o.total) || 0), 0));
  const linesAfter = live.reduce((a, o) => a + (Array.isArray(o.items) ? (o.items as unknown[]).length : 0), 0);
  // What came out. The snapshot is the honest source — the row itself may since have been read
  // again, and on a tombstoned order it may not be readable at all.
  const removed = r2(Number((was && was.total) ?? 0) || 0);
  const linesRemoved = Array.isArray(was && was.items) ? (was!.items as unknown[]).length : 0;
  // A guard against double-counting: if the removed order is somehow STILL live (a restore, or a
  // record about something that was never actually taken out), `after` already contains it and
  // adding it again would invent money. Then before === after, which is the truth.
  const stillLive = !!removedOrderId && live.some((o) => String(o.id) === String(removedOrderId));
  return {
    before: stillLive ? after : r2(after + removed),
    after,
    removed: stillLive ? 0 : removed,
    lines_before: stillLive ? linesAfter : linesAfter + linesRemoved,
    lines_after: linesAfter,
  };
}

/**
 * THE BILL AS IT STOOD WHEN IT WAS REMOVED — real HTML from the real document builder.
 *
 * Returns null when there is no bill to draw (no snapshot, or a snapshot with no lines — a dish off
 * the menu has no bill). The caller hands the HTML to an `<iframe srcdoc>`: the bill carries print
 * CSS of its own, and an iframe is what keeps that off the surrounding screen.
 */
export async function auditBillHtml(rid: string, was: Record<string, unknown> | null | undefined): Promise<string | null> {
  try {
    if (!was) return null;
    const lines = Array.isArray(was.items) ? (was.items as Record<string, unknown>[]) : [];
    if (!lines.length) return null;

    const [setQ, restQ] = await Promise.all([
      sb.from("settings").select(`${TAX_SETTINGS_COLUMNS}, restaurant_name, restaurant_address, restaurant_phone, gstin, invoice_prefix, bill_footer, tax_label, table_names`).eq("restaurant_id", rid).maybeSingle(),
      sb.from("restaurants").select("id, slug, name, logo_text").eq("id", rid).maybeSingle(),
    ]);
    const settings = (setQ.data || {}) as Record<string, unknown>;
    const restaurant = (restQ.data || {}) as Record<string, unknown>;
    const bi = BILLDOC.billIdentity(settings, restaurant);

    const num = (v: unknown) => Number(v) || 0;
    const subtotal = num(was.subtotal);
    const discount = num(was.discount);
    const tax = num(was.tax);
    const total = num(was.total);

    // The tax split the SAME way the printer splits it: the restaurant's own components, else the
    // historical CGST/SGST halves, with the last line taking the remainder so the rows foot.
    const tm = BILLDOC.taxModel(settings);
    const pct = tm.components.length
      ? tm.pct
      : (subtotal - discount > 0 ? Math.round((tax / (subtotal - discount)) * 10000) / 100 : tm.pct);
    const comps = tm.components.length ? tm.components : [{ label: "CGST", rate: pct / 2 }, { label: "SGST", rate: pct / 2 }];
    const taxWhole = Math.round(tax);
    const taxRows = taxWhole > 0 ? BILLDOC.splitTax(taxWhole, comps) : [];

    return BILLDOC.billDocHtml({
      name: bi.name, addr: bi.address, phone: bi.phone, gstin: bi.gstin, footer: bi.footer,
      invNo: was.invoice_no != null && was.invoice_no !== ""
        ? BILLDOC.invFmt(Number(was.invoice_no), (was.ordered_at as string) || null, bi.prefix)
        : "",
      billNo: was.bill_no != null ? String(was.bill_no) : "",
      /* THE RECORD NAMES THE TABLE THE WAY THE RESTAURANT DOES (owner, 2026-08-28 — item 22).
         Every other document in this product resolves a renamed table before printing it: the bill
         and the KOT through tableDisp / tablePrintLabel, the banquet sheet inside banquetDocHtml
         itself. This card printed the bare digit, so a restaurant that renamed T5 to "Terrace 2"
         saw "Terrace 2" on the paper the guest was handed and "5" on the record of that bill being
         removed — the two documents that most need to match, not matching.
         `settings.table_names` is already fetched three lines above for the identity, so this costs
         no extra read. A table with no name still shows its number, which is what it is called. */
      tableDisp: (() => {
        const t = String(was.table_number ?? "").trim();
        if (!t) return "—";
        const names = (settings.table_names as Record<string, string> | undefined) || {};
        return (names[t] || "").trim() || t;
      })(),
      dateStr: was.ordered_at
        ? new Date(String(was.ordered_at)).toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })
        : "",
      cust: (was.customer as string) || "",
      custPhone: (was.customer_phone as string) || "",
      lines: lines.map((it) => ({
        title: (it.title as string) || "",
        qty: Number(it.qty) || 1,
        price: Number(it.price) || 0,
        options: Array.isArray(it.options) ? (it.options as { label?: string; price?: number }[]) : [],
      })),
      subtotal, discount, discLabel: BILLDOC.discPct(subtotal, discount),
      taxable: Math.round((subtotal - discount) * 100) / 100,
      taxRows, total,
      // A composition tenant's paper is a Bill of Supply, and this must say the same thing the
      // printer said (T7 F9) — otherwise the card shows a document the guest never received.
      composition: tm.composition,
      // Evidence being read, not a bill being issued: no print dialog, and no toolbar either — the
      // frame runs no scripts, so a Print button in there could not print and a Close button could
      // not close. Dead controls on a document are worse than none.
      autoPrint: false,
      noBar: true,
    });
  } catch {
    // The removal record must open even if its picture cannot be drawn — the words and the money
    // rows are the record; the bill is the illustration.
    return null;
  }
}
