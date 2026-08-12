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
      sb.from("settings").select(`${TAX_SETTINGS_COLUMNS}, restaurant_name, restaurant_address, restaurant_phone, gstin, invoice_prefix, bill_footer, tax_label`).eq("restaurant_id", rid).maybeSingle(),
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
      tableDisp: was.table_number != null ? String(was.table_number) : "—",
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
      // Screen only, and never a print dialog: this is evidence being read, not a bill being issued.
      autoPrint: false,
    });
  } catch {
    // The removal record must open even if its picture cannot be drawn — the words and the money
    // rows are the record; the bill is the illustration.
    return null;
  }
}
