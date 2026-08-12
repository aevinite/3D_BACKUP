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

export function RemovalDetail({ r, canRestore, onRestore, restoring }: {
  r: RemovalFull;
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

      {extra.length ? (
        <>
          <Head>Other details recorded</Head>
          {extra.map(([k, v]) => (
            <Row key={k} k={k.replace(/_/g, " ")} v={typeof v === "object" ? JSON.stringify(v) : String(v)} />
          ))}
        </>
      ) : null}

      {/* Only the admin is ever handed this. The owner's route returns canRestore:false and has no
          write path, so their copy of this panel simply says who to ask. */}
      {canRestore && onRestore ? (
        <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="adm-btn" disabled={restoring} onClick={onRestore}>
            {restoring ? "Putting it back…" : "Put this bill back"}
          </button>
          <span className="adm-muted" style={{ fontSize: 11.5 }}>
            Restoring returns it as a record, not onto the live floor. The removal stays on this list either way.
          </span>
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
        setCanRestore(j.canRestore === true);
      } catch (e) { if (alive) setErr(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { alive = false; };
  }, [base, id]);

  // Restoring goes through the admin BILL ledger, which is the one audited write path for it —
  // never a second one bolted onto the audit view. Only reachable when canRestore came back true,
  // which the owner route never does.
  const restore = useCallback(async () => {
    if (!row?.session_id || restoring) return;
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
          {row ? <RemovalDetail r={row} canRestore={canRestore} onRestore={restore} restoring={restoring} /> : null}
        </div>
      </div>
    </>
  );
}
