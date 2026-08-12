"use client";
// LogDetailModal — the ONE organized "what is this log entry?" popup, shared by every
// panel that shows a log (admin Logs + Overview activity feed, owner Activity). Click any
// row → this opens with everything about that action laid out in tidy sections:
//   • When   — the exact date + time (not just "2h ago")
//   • Who    — the person/panel/device that did it
//   • What   — a plain-English description, the table, the order
//   • Manager PIN — shown ONLY when a manager's PIN actually authorised the action
//                   (a tablet row with an `actor`); hidden entirely otherwise
//   • Status — for error rows: severity + resolved/reopened state
//   • Reference — the raw ids, for support (muted, at the bottom)
//
// Self-contained on purpose (does NOT use useAdminModal, whose scroll-lock targets the
// admin scrollports): it registers its own phone-Back close, Escape close and body lock so
// it behaves identically in the admin AND owner shells. Every field renders only when it has
// a value, so a row is never "empty" — but the important ones (When, Who, What) are always
// there because every log row carries them.
import { useEffect, useRef } from "react";
import { useBackClose } from "@/lib/backStack";
import { ADMIN_VIEW_ACTOR_ID } from "@/lib/logMarks";
import { actLabel, PANEL_COLOR, formatActionDetail, fullWhen, timeAgo, isManagerPinRow, type Action } from "@/components/admin/shared";
import { trailOf } from "@/lib/logTrail";

// One "label : value" line. Renders nothing when the value is empty, so no blank rows.
function Field({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  if (children == null || children === "" || children === false) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "116px 1fr", gap: 10, padding: "7px 0", alignItems: "baseline", borderTop: "1px solid rgba(148,163,184,0.14)" }}>
      <div style={{ fontSize: 12, color: "var(--muted, #93a1b0)", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 13.5, color: "var(--text, #e7edf3)", wordBreak: "break-word", fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : undefined }}>{children}</div>
    </div>
  );
}

// Small section heading inside the card.
function Section({ title, accent, children }: { title: string; accent?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", fontWeight: 800, color: accent || "var(--muted, #93a1b0)", marginBottom: 2 }}>{title}</div>
      {children}
    </div>
  );
}

export function LogDetailModal({ row, onClose, showRestaurant = true }: { row: Action; onClose: () => void; showRestaurant?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // Phone hardware Back closes it (CLAUDE.md rule — every overlay registers with the back-stack).
  useBackClose("log-detail", true, onClose);

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

  const panel = row.panel || "";
  const isErr = row.level === "error";
  const isWarn = row.level === "warn";
  const isResolved = isErr && !!row.resolved_at;
  // On a TABLET row, a non-empty `actor` is the manager whose PIN unlocked the action (the
  // tablet has no per-person login) — except for the person's own login/profile actions.
  // " / " in the name = one PIN shared by several managers → genuinely ambiguous who tapped it.
  const isPin = isManagerPinRow(row);
  const pinShared = isPin && String(row.actor).includes(" / ");
  // Errors keep their raw text (the stack / where matters); everything else is shown in plain
  // English (esp. the button-tap batches, which are unreadable JSON otherwise).
  const detail = isErr ? (row.detail || "") : formatActionDetail(row.action, row.detail);
  const actionLabel = actLabel(row.action);
  const panelColor = PANEL_COLOR[panel] || "#94a3b8";
  // The full path this action happened at. Computed here rather than trusted from the API, so the
  // card is right even when it is opened from a screen whose endpoint does not attach one yet.
  const trail = trailOf({
    panel: row.panel, action: row.action, table_number: row.table_number,
    order_id: row.order_id, detail: row.detail,
    restaurant_name: showRestaurant ? row.restaurant_name : null,
  });
  const sevColor = isErr && !isResolved ? "var(--adm-danger, #ef4444)" : isWarn ? "var(--adm-warn, #f59e0b)" : undefined;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,16,0.66)", backdropFilter: "blur(2px)", zIndex: 4000 }} />
      <div role="dialog" aria-modal="true" aria-label="Log entry detail" style={{ position: "fixed", inset: 0, zIndex: 4001, display: "grid", placeItems: "center", padding: 16, pointerEvents: "none" }}>
        <div
          ref={ref}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          style={{
            pointerEvents: "auto", width: "min(94vw, 480px)", maxHeight: "88vh", overflowY: "auto",
            background: "var(--card, #12161c)", color: "var(--text, #e7edf3)",
            border: "1px solid rgba(148,163,184,0.22)", borderRadius: 16,
            boxShadow: "0 24px 60px rgba(0,0,0,0.5)", padding: 18, outline: "none",
          }}
        >
          {/* Header: the action + severity + panel + a close X */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: sevColor || "var(--text, #e7edf3)", lineHeight: 1.25 }}>{actionLabel}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
                {/* The chip used to print the raw column value — "editor" for what everybody calls
                    the manager panel. `trail.panel` is the human name (lib/logTrail). */}
                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "color-mix(in srgb, " + panelColor + " 22%, transparent)", color: panelColor }}>{trail.panel}</span>
                {/* The AREA, so the header alone already answers "roughly where did this happen?" */}
                <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: "rgba(148,163,184,0.14)", color: "var(--muted, #93a1b0)" }}>{trail.area}</span>
                {isErr && <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "color-mix(in srgb, var(--adm-danger, #ef4444) 20%, transparent)", color: "var(--adm-danger, #ef4444)" }}>⚠️ Error</span>}
                {isWarn && <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "color-mix(in srgb, var(--adm-warn, #f59e0b) 20%, transparent)", color: "var(--adm-warn, #f59e0b)" }}>Notable</span>}
                {isResolved && <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "color-mix(in srgb, #16a34a 22%, transparent)", color: "#22c55e" }}>✓ Resolved</span>}
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" style={{ flex: "0 0 auto", width: 30, height: 30, borderRadius: 8, border: "1px solid rgba(148,163,184,0.25)", background: "transparent", color: "var(--muted, #93a1b0)", cursor: "pointer", fontSize: 15, lineHeight: 1 }}>✕</button>
          </div>

          {/* ── WHERE — the whole path, which is what this card was missing ────────────────────
              (owner, 2026-08-12: "there should be restaurant name, which panel, inside panel
              which menu, inside menu … he clicked take order but from where, table detail")

              The card already said WHEN, WHO and WHAT. It never said where in the app the person
              actually was, so "Placed order" left you to guess whether it came off the floor, the
              waiter's tablet or the parcel counter — and for which table. The trail is derived from
              the row itself (lib/logTrail.ts), so every one of the 30,000 rows already recorded
              gets one, not just the ones written from today. */}
          <Section title="Where" accent="#7dd3fc">
            <Field label="Path">
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, lineHeight: 1.5 }}>
                {trail.crumbs.map((c, i) => (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {i > 0 && <span style={{ color: "var(--muted, #93a1b0)", opacity: 0.7 }}>›</span>}
                    <span style={{
                      fontWeight: i === trail.crumbs.length - 1 ? 700 : 500,
                      color: i === trail.crumbs.length - 1 ? "var(--text, #e7edf3)" : "var(--muted, #93a1b0)",
                    }}>{c}</span>
                  </span>
                ))}
              </div>
            </Field>
            {/* The thing it was done TO — the table, the bill, the dish. This is the "from where"
                half of the owner's question, and it is the field he would look at first. */}
            <Field label="On">{trail.target ? <span style={{ fontWeight: 700 }}>{trail.target}</span> : null}</Field>
          </Section>

          {/* WHEN */}
          <Section title="When">
            <Field label="Date &amp; time">{fullWhen(row.created_at)}</Field>
            <Field label="How long ago">{timeAgo(row.created_at)}</Field>
          </Section>

          {/* WHO */}
          <Section title="Who">
            {isPin
              ? <Field label="Panel">Waiter tablet</Field>
              : row.actor_id === ADMIN_VIEW_ACTOR_ID
              ? <Field label="Done by"><span style={{ fontWeight: 700 }}>🛡 Admin (via panel view — staff &amp; owner logs see a plain panel action)</span></Field>
              : <Field label="Done by">{row.actor || <span style={{ color: "var(--muted, #93a1b0)" }}>{panel === "db" ? "Direct database edit (no staff login)" : "Panel action (no staff login yet)"}</span>}</Field>}
            <Field label="Device">{row.device_id ? "📱 #" + row.device_id : null}</Field>
            {showRestaurant && <Field label="Restaurant">{row.restaurant_name || null}</Field>}
          </Section>

          {/* MANAGER PIN — ONLY when a manager PIN actually authorised this action. */}
          {isPin && (
            <Section title="Manager PIN" accent="#d4af37">
              <Field label={pinShared ? "Shared PIN of" : "Authorised by"}>
                <span className="hue-ink" style={{ fontWeight: 700, ["--hue" as string]: pinShared ? "var(--adm-warn)" : "#d4af37" }}>🔑 {row.actor}</span>
              </Field>
              {pinShared && <Field label="Note">This PIN belongs to more than one manager — any of them could have entered it.</Field>}
            </Section>
          )}

          {/* WHAT & WHERE */}
          {(detail || row.table_number || row.order_id) && (
            <Section title="What happened">
              <Field label="Details">{detail || null}</Field>
              <Field label="Table">{row.table_number ? "Table " + row.table_number : null}</Field>
              <Field label="Order" mono>{row.order_id || null}</Field>
            </Section>
          )}

          {/* STATUS — reopen / resolve trail for error rows only. */}
          {isErr && (
            <Section title="Status" accent={sevColor}>
              <Field label="State">{isResolved ? "Resolved" : "Open — needs attention"}</Field>
              <Field label="Resolved at">{isResolved && row.resolved_at ? fullWhen(row.resolved_at) : null}</Field>
              <Field label="Seen at">{row.seen_at ? fullWhen(row.seen_at) : null}</Field>
            </Section>
          )}

          {/* REFERENCE — raw ids for support, muted at the foot. */}
          <Section title="Reference">
            <Field label="Action code" mono>{row.action}</Field>
            <Field label="Log id" mono>{row.id}</Field>
          </Section>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 9, border: "1px solid rgba(148,163,184,0.28)", background: "transparent", color: "var(--text, #e7edf3)", cursor: "pointer", fontSize: 13.5, fontWeight: 600 }}>Close</button>
          </div>
        </div>
      </div>
    </>
  );
}
