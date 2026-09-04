"use client";
// RemovalDetail — ONE shape for "what exactly was removed", used by the admin's Audit
// (/aevinite/logs), the owner's Audit · removals (/owner/activity) and — via the same field
// order and wording — the manager panel's Audit tab.
//
// WHY (owner, 2026-08-04): "Make it audit that you can be able to click and view the full — how it
// was and what he changed, which KOT he deleted and what was the item, with time, day, everything,
// who has done it, with restaurant also. For owner do all that. They can't change, only admin
// change, they can only see."
//
// The Audit recorded a deleted bill's VALUE and its table and nothing about what was ON it. So a
// line reading "Bill deleted · Table 6 · ₹1,150" could not be checked or argued with: the one
// question a person actually asks — "what did they take off?" — had no answer anywhere in the
// product. lib/removalAudit.ts now snapshots the order as it removes it, and this renders it.
//
// ONE COMPONENT, TWO ROLES. The owner and the admin see exactly the same evidence — deliberately,
// because an owner arguing with a manager about a deleted bill needs the whole picture. The only
// difference is `canRestore`, which the OWNER route always returns false for and never offers a
// write path to. Putting a bill back is the admin's alone.
import AUDITSORT from "@/public/panels/auditsort.js";
import { useEffect, useRef, useState, useCallback } from "react";
import { useBackClose } from "@/lib/backStack";
import { inr } from "@/components/admin/shared";

export type RemovalSnapshotItem = {
  title?: string | null; qty?: number | string | null; price?: number | string | null;
  options?: { label?: string | null; price?: number | string | null }[] | string[] | null;
  removed?: string[] | null; note?: string | null;
};
export type RemovalSnapshot = {
  kot_no?: number | null; table_number?: string | null; bill_no?: number | null;
  invoice_no?: number | string | null; customer?: string | null; customer_phone?: string | null;
  ordered_at?: string | null; status?: string | null; payment_status?: string | null;
  payment_method?: string | null; subtotal?: number | null; discount?: number | null;
  discount_note?: string | null; tax?: number | null; total?: number | null;
  allergies?: string[] | null; item_count?: number | null;
  items?: RemovalSnapshotItem[] | null; items_truncated?: boolean | null;
};
export type RemovalFull = {
  id: number; at: string; kind: string;
  reason_code?: string | null; reason_note?: string | null;
  actor?: string | null; actor_role?: string | null; device_id?: string | null;
  table_number?: string | null; bill_no?: number | null; invoice_no?: string | number | null;
  kot_no?: number | null; item_title?: string | null; qty?: number | null; amount?: number | string | null;
  order_id?: string | null; session_id?: string | null;
  restaurant_name?: string | null;
  meta?: Record<string, unknown> | null;
};

// ONE name per removal event, for every screen that shows one.
//
// There used to be three maps: this one, the owner list's REMOVAL_KIND, and ACT_LABEL. The owner
// tapped a row reading "KOT cancelled" and the card that opened said "Kitchen ticket cancelled" —
// six of the nine kinds changed name inside a single click (T15 sweep, 2026-08-05). This set won
// because it is the plainest: no KOT jargon, and "Bill reopened" rather than "Invoice voided".
// The owner list now imports it; do NOT add a fourth map.
// THE WORDS AND THE GLYPHS COME FROM ONE PLACE (T7 pass 2, 2026-08-12).
// These used to be written out here, again in app/aevinite/logs/page.tsx and a third time in
// public/panels/editor/app.js — and SIX of the eleven types ended up with a different name in each,
// so one database row had three names on three screens. They live in /panels/auditsort.js now (a
// plain-JS module the manager panel can load as a bare <script>, which is why they are not in lib/),
// and all three panels read them. Re-exported under the old names so every existing importer is
// untouched. See that file's own note for WHICH word won each type, and why.
export const KIND_LABEL: Record<string, string> = AUDITSORT.KIND_LABEL;
/** The little glyph each kind wears in a list. Kept beside the words so the two can't drift. */
export const KIND_ICON: Record<string, string> = AUDITSORT.KIND_ICON;
// Same one-place rule for the reasons: the search matches the WORDS a screen shows, so a second
// spelling of "By mistake" would find rows on one panel and nothing on another.
const REASON_LABEL: Record<string, string> = AUDITSORT.REASON_LABEL;
const ROLE_LABEL: Record<string, string> = {
  admin: "Aevidine admin", owner: "Owner", manager: "Manager", tablet: "Waiter", kitchen: "Kitchen",
};

const money = (v: unknown) => inr(parseFloat(String(v ?? 0)) || 0);
// Time AND day in words, because "when exactly" is half the question. Long form on purpose:
// a bare "2 hours ago" is useless a week later, which is when these get read.
const whenFull = (iso?: string | null) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
      + " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return iso; }
};
const optLabels = (o: RemovalSnapshotItem["options"]) =>
  Array.isArray(o) ? o.map((x) => (typeof x === "string" ? x : x?.label || "")).filter(Boolean) : [];

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "3px 0", fontSize: 12.5, alignItems: "baseline" }}>
      <span className="adm-muted" style={{ minWidth: 132, flex: "0 0 auto" }}>{k}</span>
      <span style={{ minWidth: 0, wordBreak: "break-word" }}>{v}</span>
    </div>
  );
}
function Head({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".7px", fontWeight: 700, opacity: 0.65, margin: "14px 0 5px" }}>
      {children}
    </div>
  );
}

/** One side of the BEFORE / AFTER pair. Same shape both sides, so the two boxes line up row for row
 *  and the eye can do the comparing — which is the whole point of showing two. */
type SideFigures = {
  state?: "live" | "cancelled" | "removed";
  kot_no?: number | null; table_number?: string | null;
  status?: string | null; payment_status?: string | null;
  item_count?: number | null;
  items?: { title?: string | null; qty?: number | null; price?: number | null; note?: string | null }[] | null;
  subtotal?: number | null; discount?: number | null; tax?: number | null; total?: number | null;
} | null;

/* BEFORE AND AFTER, SIDE BY SIDE (owner, 2026-08-12: "there should be two box like if you have
   changed any KOT or edit any KOT — so before how it was looking and after how it was looking").

   BEFORE is the snapshot stored at the moment of the change; AFTER is the order read LIVE, so the
   right-hand box always answers "and how does it stand now?" rather than freezing at a moment that
   has since passed (see lib/auditDetail.ts for why that choice).

   A figure that CHANGED is marked. Nothing else is — a card where everything is highlighted has told
   you nothing, and the one number that moved is the reason someone opened this. */
function SideBySide({ before, after }: { before: SideFigures; after: SideFigures }) {
  const gone = !after || after.state === "removed" || after.state === "cancelled";
  const rows: [string, unknown, unknown][] = [
    ["Kitchen ticket", before?.kot_no != null ? `KOT #${before.kot_no}` : null, after?.kot_no != null ? `KOT #${after.kot_no}` : null],
    ["Table", before?.table_number ? `Table ${before.table_number}` : null, after?.table_number ? `Table ${after.table_number}` : null],
    ["Lines", before?.item_count ?? (before?.items?.length ?? null), after?.item_count ?? (after?.items?.length ?? null)],
    ["Subtotal", before?.subtotal, after?.subtotal],
    ["Discount", before?.discount, after?.discount],
    ["Tax", before?.tax, after?.tax],
    ["Total", before?.total, after?.total],
    ["Status", before?.status, after?.status],
  ];
  const isMoney = (k: string) => ["Subtotal", "Discount", "Tax", "Total"].includes(k);
  const show = (k: string, v: unknown) => (v == null || v === "" ? "—" : isMoney(k) ? money(v) : String(v));
  // Only compare where BOTH sides have something to compare; "—" versus a number on a removed order
  // is not a change, it is the removal itself, and the band above already says so.
  const changed = (a: unknown, b: unknown) => !gone && a != null && b != null && String(a) !== String(b);

  return (
    <>
      <Head>Before and after</Head>
      {gone ? (
        <div style={{ border: "var(--border)", borderRadius: 10, padding: "9px 11px", marginBottom: 8, fontSize: 12.5,
                      background: "color-mix(in srgb, var(--adm-danger) 10%, transparent)" }}>
          {after?.state === "cancelled"
            ? "This ticket was cancelled — nothing was charged for it. The left column is what it held."
            : "This is off the books now. The left column is what it held when it was removed — the row itself is kept, which is why you can still read it."}
        </div>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10 }}>
        {[["Before", before] as const, [gone ? "After · removed" : "After · as it stands now", after] as const].map(([label], i) => (
          <div key={label} style={{
            border: "var(--border)", borderRadius: 10, overflow: "hidden",
            opacity: i === 1 && gone ? 0.72 : 1,
          }}>
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".7px", fontWeight: 700,
                          padding: "6px 10px", background: "color-mix(in srgb, var(--accent) 8%, transparent)" }}>
              {label}
            </div>
            <div style={{ padding: "4px 10px 8px" }}>
              {rows.map(([k, a, b]) => {
                const v = i === 0 ? a : b;
                const moved = changed(a, b);
                return (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "3px 0", fontSize: 12.5 }}>
                    <span className="adm-muted" style={{ fontSize: 11.5 }}>{k}</span>
                    <b style={{
                      fontWeight: moved ? 700 : 400, textAlign: "right",
                      color: moved ? "var(--adm-warn)" : undefined,
                    }}>{show(k, v)}</b>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {/* Named rather than left to the colour alone — a highlight nobody can read is decoration. */}
      {!gone && rows.some(([, a, b]) => changed(a, b)) ? (
        <div className="adm-muted" style={{ fontSize: 11.5, marginTop: 6 }}>
          What moved is marked in amber: {rows.filter(([, a, b]) => changed(a, b)).map(([k]) => k.toLowerCase()).join(", ")}.
        </div>
      ) : null}
    </>
  );
}

/* THE BILL ITSELF — the real document, not a picture of one.
   He asked for an image and said he did not know how. An image would mean generating and storing a
   PNG per removal, and it would go blurry the moment anyone zoomed. public/panels/billdoc.js IS the
   bill, so the server feeds it the stored snapshot and hands back the same HTML the printer gets
   (lib/auditDetail.ts). It goes in an iframe because the bill carries print CSS of its own and that
   must not leak onto the screen around it. `sandbox` with nothing enabled: it is evidence being read,
   so it needs no scripts and must not be able to navigate anywhere. */
function BillFrame({ html }: { html: string }) {
  const [tall, setTall] = useState(560);
  return (
    <>
      <Head>The bill as it stood</Head>
      <div style={{ border: "var(--border)", borderRadius: 10, overflow: "hidden", background: "#fff" }}>
        <iframe
          title="The bill as it was when this happened"
          srcDoc={html}
          // allow-same-origin ONLY: it lets the height below be measured. Scripts stay blocked
          // (no allow-scripts), so the bill's own auto-print and measuring code cannot run — which is
          // why the document is asked for with noBar and does not need them.
          sandbox="allow-same-origin"
          onLoad={(e) => {
            // Grow to the document so there is no inner scrollbar on a short bill. Cross-document
            // reads are allowed here because srcDoc with an empty sandbox is same-origin-ish in every
            // browser we support; wrapped anyway, since a failure just means the default height.
            try {
              const d = (e.currentTarget as HTMLIFrameElement).contentDocument;
              if (d?.body) setTall(Math.min(1400, Math.max(320, d.body.scrollHeight + 24)));
            } catch { /* keep the default */ }
          }}
          style={{ width: "100%", height: tall, border: 0, display: "block", background: "#fff" }}
        />
      </div>
      <div className="adm-muted" style={{ fontSize: 11.5, marginTop: 5 }}>
        Rebuilt from what was recorded at the time — the same document the printer produces, not a photo.
      </div>
    </>
  );
}

export function RemovalDetail({ r, after, billHtml, canRestore, onRestore, restoring }: {
  r: RemovalFull;
  /** The order AS IT STANDS NOW, for the right-hand box. Absent for a removal that was never about
   *  an order (a dish taken off the menu), in which case no comparison is drawn. */
  after?: SideFigures;
  /** The bill as it stood, as real HTML from billdoc.js. Absent when there is no bill to draw. */
  billHtml?: string | null;
  canRestore?: boolean;
  onRestore?: () => void;
  restoring?: boolean;
}) {
  const meta = (r.meta || {}) as Record<string, unknown>;
  const was = (meta.was || null) as RemovalSnapshot | null;
  const items = Array.isArray(was?.items) ? was!.items! : [];
  // Anything the call site put in meta that is not the snapshot — "cleared_all", "from",
  // "total_at_reopen", "was_method"… Shown rather than hidden: it is the rest of the story.
  const extra = Object.entries(meta).filter(([k]) => k !== "was");
  const reason = [
    r.reason_code ? REASON_LABEL[r.reason_code] || r.reason_code : "",
    r.reason_note || "",
  ].filter(Boolean).join(" — ") || "no reason recorded";

  return (
    <div style={{ padding: "4px 2px 10px" }}>
      <Head>What happened</Head>
      <Row k="What" v={<b>{KIND_LABEL[r.kind] || r.kind}</b>} />
      <Row k="When" v={whenFull(r.at)} />
      <Row k="Who" v={<>
        <b>{r.actor || "—"}</b>
        {r.actor_role ? <span className="adm-muted"> · {ROLE_LABEL[r.actor_role] || r.actor_role}</span> : null}
      </>} />
      {r.restaurant_name ? <Row k="Restaurant" v={r.restaurant_name} /> : null}
      <Row k="Reason" v={reason} />
      {/* A restore PUTS money back, so calling its amount "removed" would read as a second removal. */}
      {r.amount != null ? <Row k={r.kind === "order_restored" ? "Value put back" : "Value removed"} v={<b>{money(r.amount)}</b>} /> : null}
      {r.device_id ? <Row k="From device" v={<span className="adm-muted" style={{ fontSize: 11.5 }}>{r.device_id}</span>} /> : null}

      <Head>Which ticket / bill</Head>
      <Row k="Kitchen ticket" v={(was?.kot_no ?? r.kot_no) != null ? <b>KOT #{was?.kot_no ?? r.kot_no}</b> : "—"} />
      <Row k="Bill number" v={(was?.bill_no ?? r.bill_no) != null ? `#${was?.bill_no ?? r.bill_no}` : "—"} />
      <Row k="Invoice" v={(was?.invoice_no ?? r.invoice_no) ? String(was?.invoice_no ?? r.invoice_no) : "not invoiced"} />
      <Row k="Table" v={(was?.table_number ?? r.table_number) ? `Table ${was?.table_number ?? r.table_number}` : "no table (walk-in / parcel)"} />
      {was?.ordered_at ? <Row k="Ordered at" v={whenFull(was.ordered_at)} /> : null}
      {was?.customer ? <Row k="Customer" v={<>{was.customer}{was.customer_phone ? <span className="adm-muted"> · {was.customer_phone}</span> : null}</>} /> : null}

      {/* THE ITEMS. This is the part that did not exist — the answer to "what was on it". */}
      {items.length > 0 ? (
        <>
          <Head>What was on it{was?.item_count != null ? ` · ${was.item_count} line${was.item_count === 1 ? "" : "s"}` : ""}</Head>
          <div style={{ border: "var(--border)", borderRadius: 10, overflow: "hidden" }}>
            {items.map((it, i) => {
              const opts = optLabels(it.options);
              const qty = parseInt(String(it.qty ?? 1), 10) || 1;
              const unit = parseFloat(String(it.price ?? 0)) || 0;
              return (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 44px 88px", gap: 10, padding: "7px 11px", fontSize: 12.5, borderTop: i ? "1px solid var(--adm-line, rgba(255,255,255,0.06))" : undefined }}>
                  <span style={{ minWidth: 0 }}>
                    {it.title || "—"}
                    {opts.length ? <span className="adm-muted" style={{ display: "block", fontSize: 11.5 }}>+ {opts.join(", ")}</span> : null}
                    {it.removed && it.removed.length ? <span style={{ display: "block", fontSize: 11.5, color: "var(--adm-danger, #ef4444)" }}>no {it.removed.join(", ")}</span> : null}
                    {it.note ? <span className="adm-muted" style={{ display: "block", fontSize: 11.5, fontStyle: "italic" }}>“{it.note}”</span> : null}
                  </span>
                  <span className="adm-muted" style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>×{qty}</span>
                  <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(unit * qty)}</span>
                </div>
              );
            })}
          </div>
          {was?.items_truncated ? <div className="adm-muted" style={{ fontSize: 11.5, marginTop: 5 }}>Only the first 60 lines were kept on this record.</div> : null}
        </>
      ) : r.item_title ? (
        <>
          <Head>What was removed</Head>
          <Row k="Dish" v={<>{r.item_title}{(r.qty || 0) > 1 ? <span className="adm-muted"> ×{r.qty}</span> : null}</>} />
        </>
      ) : (
        <>
          <Head>What was on it</Head>
          <div className="adm-muted" style={{ fontSize: 12.5 }}>
            No item list was kept for this record — it was made before the Audit started snapshotting
            what it removes. Newer removals carry the full list.
          </div>
        </>
      )}

      {was && (was.subtotal != null || was.total != null) ? (
        <>
          <Head>What the bill said</Head>
          {was.subtotal != null ? <Row k="Subtotal" v={money(was.subtotal)} /> : null}
          {Number(was.discount) > 0 ? <Row k="Discount" v={<>− {money(was.discount)}{was.discount_note ? <span className="adm-muted"> · {was.discount_note}</span> : null}</>} /> : null}
          {was.tax != null ? <Row k="Tax" v={money(was.tax)} /> : null}
          {was.total != null ? <Row k="Total" v={<b>{money(was.total)}</b>} /> : null}
          <Row k="State when removed" v={<>
            {was.status || "—"}
            {was.payment_status ? <span className="adm-muted"> · {was.payment_status === "paid" ? "was PAID" : "unpaid"}</span> : null}
            {was.payment_method ? <span className="adm-muted"> · {was.payment_method}</span> : null}
          </>} />
          {was.allergies && was.allergies.length ? <Row k="Allergies" v={was.allergies.join(", ")} /> : null}
        </>
      ) : null}

      {/* The comparison, then the bill. Both only when there is something real to show — an empty
          pair of boxes would be worse than none. */}
      {was ? <SideBySide before={was as SideFigures} after={after ?? null} /> : null}
      {billHtml ? <BillFrame html={billHtml} /> : null}

      {extra.length ? (
        <>
          <Head>Other details recorded</Head>
          {extra.map(([k, v]) => (
            <Row key={k} k={k.replace(/_/g, " ")} v={typeof v === "object" ? JSON.stringify(v) : String(v)} />
          ))}
        </>
      ) : null}

      {/* Only the admin is ever handed this. The owner's route returns canRestore:false and has no
          write path, so their copy of this panel simply says who to ask.

          AND IT IS ONLY OFFERED WHEN THERE IS A BILL TO PUT BACK (T20 sweep #8, 2026-09-04).
          `canRestore` is decided server-side from the KIND and whether the order row is still
          tombstoned — it says nothing about a session. But putting a bill back goes through
          /api/admin/bills, which works on a SESSION id, and `deletion_audit.session_id` is the
          order's own session: nullable at birth (a walk-in or parcel order that never sat at a
          table) and nulled later by `ON DELETE SET NULL` when the session row goes. On any of
          those the button rendered, enabled, and its handler returned on `!row?.session_id`
          without a word — pressed, nothing, no message, no spinner. Measured on the dev database
          on 2026-09-04: 19 order_deleted records, none of them null-session yet, against 29,649
          orders that have no session at all. So it had not bitten; it was waiting to.
          A control that cannot work is not offered, and the reason is written where the button was. */}
      {canRestore && onRestore && r.session_id ? (
        <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="adm-btn" disabled={restoring} onClick={onRestore}>
            {restoring ? "Putting it back…" : "Put this bill back"}
          </button>
          <span className="adm-muted" style={{ fontSize: 11.5 }}>
            Restoring returns it as a record, not onto the live floor. The removal stays on this list either way.
          </span>
        </div>
      ) : canRestore && onRestore ? (
        <div className="adm-muted" style={{ marginTop: 14, fontSize: 11.5 }}>
          This order was never part of a table bill — a walk-in or a parcel — so there is no bill here to put
          back. The record above stays exactly as it is either way.
        </div>
      ) : (
        <div className="adm-muted" style={{ marginTop: 14, fontSize: 11.5 }}>
          This is a record — nothing here can be changed. Only an Aevidine admin can put a deleted bill back.
        </div>
      )}
    </div>
  );
}

/** RemovalDetailModal — click a removal row, get the whole story.
 *
 * Fetches the ONE record lazily (the list never carries the snapshot — 200 of them would be a
 * heavy payload for rows nobody opened) from whichever endpoint the caller belongs to:
 *   admin   → /api/admin/audit?detail=<id>    (canRestore can be true)
 *   owner   → /api/owner/audit?detail=<id>    (canRestore is always false, no write path exists)
 * Same chrome as LogDetailModal, including the phone hardware-Back registration every overlay in
 * this product owes (CLAUDE.md), so Back closes this instead of leaving the page.
 */
export function RemovalDetailModal({ id, base, onClose, onRestored }: {
  id: number;
  /** "/api/admin/audit" or "/api/owner/audit" — decides both the data and who may restore. */
  base: string;
  onClose: () => void;
  onRestored?: () => void;
}) {
  const [row, setRow] = useState<RemovalFull | null>(null);
  // The right-hand box and the bill, both built server-side (lib/auditDetail.ts) and both lazy —
  // they ride along with the ONE record this modal already fetches, so opening a card is still a
  // single request and the LIST still carries neither.
  const [after, setAfter] = useState<SideFigures>(null);
  const [billHtml, setBillHtml] = useState<string | null>(null);
  const [canRestore, setCanRestore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useBackClose("removal-detail", true, onClose);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    ref.current?.focus?.();
    const prevBody = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prevBody; };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${base}?detail=${id}`, { cache: "no-store" });
        const j = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(j.error || "Couldn't load this record.");
        setRow(j.removal as RemovalFull);
        setAfter((j.after ?? null) as SideFigures);
        setBillHtml(typeof j.billHtml === "string" ? j.billHtml : null);
        setCanRestore(j.canRestore === true);
      } catch (e) { if (alive) setErr(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { alive = false; };
  }, [base, id]);

  // Restoring goes through the admin BILL ledger, which is the one audited write path for it —
  // never a second one bolted onto the audit view. Only reachable when canRestore came back true,
  // which the owner route never does.
  const restore = useCallback(async () => {
    if (restoring) return;
    // Belt and braces: the button above is not rendered without a session, but a handler that
    // returns on a missing value with nothing said is the exact shape that makes a control look
    // dead — so if this is ever reached, it says why rather than doing nothing.
    if (!row?.session_id) { setErr("This removal has no bill attached to it, so there is nothing to put back."); return; }
    setRestoring(true);
    try {
      const res = await fetch("/api/admin/bills", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", sessionId: row.session_id }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Couldn't put it back.");
      setCanRestore(false);
      onRestored?.();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setRestoring(false); }
  }, [row, restoring, onRestored]);

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,16,0.66)", backdropFilter: "blur(2px)", zIndex: 4000 }} />
      <div role="dialog" aria-modal="true" aria-label="What exactly was removed" style={{ position: "fixed", inset: 0, zIndex: 4001, display: "grid", placeItems: "center", padding: 16, pointerEvents: "none" }}>
        <div
          ref={ref} tabIndex={-1}
          style={{
            pointerEvents: "auto", width: "min(620px, 100%)", maxHeight: "86vh", overflow: "auto",
            background: "var(--adm-surface, #0f1622)", color: "var(--text, #e7edf3)",
            border: "var(--border, 1px solid rgba(148,163,184,0.22))", borderRadius: 14,
            padding: "16px 18px 18px", boxShadow: "0 24px 70px rgba(0,0,0,0.5)", outline: "none",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 4 }}>
            <h3 style={{ margin: 0, fontSize: 15.5, flex: 1 }}>What exactly was removed</h3>
            <button className="adm-btn" onClick={onClose} aria-label="Close" style={{ padding: "5px 11px" }}>✕</button>
          </div>
          {err ? <p style={{ color: "var(--adm-danger, #ef4444)", fontSize: 13 }}>{err}</p> : null}
          {!row && !err ? <p className="adm-muted" style={{ fontSize: 13 }}>Loading…</p> : null}
          {row ? <RemovalDetail r={row} after={after} billHtml={billHtml} canRestore={canRestore} onRestore={restore} restoring={restoring} /> : null}
        </div>
      </div>
    </>
  );
}
