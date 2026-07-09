"use client";
// TicketCard — ONE way to show a staff-raised issue everywhere in the admin panel
// (the Tickets page, a restaurant's detail view, and the notification-bell drawer).
// Shows the subject/details, WHO raised it and from WHICH panel (raised_by + a
// role chip), any attached PHOTO (thumbnail → opens full) and VOICE NOTE (inline
// player), and a Resolve / Reopen button when onSetStatus is provided.
import { useState } from "react";

export type TicketLike = {
  id: string;
  restaurant_id: string;
  restaurantName?: string;
  restaurantSlug?: string;
  subject: string;
  body?: string | null;
  status?: string;
  raised_by?: string | null;
  raised_role?: string | null;
  created_at: string;
  resolved_at?: string | null;
  resolved_by?: string | null;
  image_url?: string | null;
  audio_url?: string | null;
};

// Turn the stored raised_role into a friendly "from which panel" label + icon.
const ROLE: Record<string, { label: string; icon: string }> = {
  manager: { label: "Manager panel", icon: "fa-user-tie" },
  kitchen: { label: "Kitchen", icon: "fa-utensils" },
  tablet: { label: "Waiter tablet", icon: "fa-tablet-screen-button" },
  owner: { label: "Owner", icon: "fa-crown" },
  admin: { label: "Aevidine admin", icon: "fa-diamond" },
};

function whoLine(i: TicketLike): { name: string; role: { label: string; icon: string } | null } {
  const role = i.raised_role ? ROLE[i.raised_role] || { label: i.raised_role, icon: "fa-user" } : null;
  // raised_by is a name for staff; for owner/admin it's an id, so fall back to the role label.
  const name = i.raised_by && i.raised_by !== "admin" && i.raised_by !== "owner" ? i.raised_by : (role?.label || "—");
  return { name, role };
}

export default function TicketCard({
  issue, onSetStatus, busy, showRestaurant, onOpenRestaurant,
}: {
  issue: TicketLike;
  onSetStatus?: (id: string, status: "resolved" | "open") => void;
  busy?: boolean;
  showRestaurant?: boolean;
  onOpenRestaurant?: (slug: string) => void;
}) {
  const [imgOpen, setImgOpen] = useState(false);
  const resolved = issue.status === "resolved";
  const who = whoLine(issue);

  return (
    <div className="adm-card" style={{ display: "flex", alignItems: "flex-start", gap: 12, opacity: resolved ? 0.72 : 1 }}>
      <i className={`fas ${resolved ? "fa-circle-check" : "fa-triangle-exclamation"}`}
        style={{ color: resolved ? "var(--adm-ok, #2e9e6b)" : "var(--adm-danger, #e5484d)", fontSize: 17, marginTop: 2 }} aria-hidden="true" />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 14.5 }}>{issue.subject}</div>
        {issue.body && <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 3, whiteSpace: "pre-wrap" }}>{issue.body}</div>}

        {/* Attachments: photo thumbnail (click to enlarge) + voice-note player. */}
        {(issue.image_url || issue.audio_url) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 9, alignItems: "center" }}>
            {issue.image_url && (
              <button type="button" onClick={() => setImgOpen(true)} title="View photo"
                style={{ padding: 0, border: "1px solid var(--line)", borderRadius: 9, overflow: "hidden", cursor: "zoom-in", background: "none", lineHeight: 0 }}>
                <img src={issue.image_url} alt="attached photo" width={64} height={64} style={{ width: 64, height: 64, objectFit: "cover", display: "block" }} />
              </button>
            )}
            {issue.audio_url && (
              // preload="none" — don't pull the audio bytes until the admin presses play (egress).
              <audio controls preload="none" src={issue.audio_url} style={{ height: 36, maxWidth: 240 }} />
            )}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, fontSize: 11.5, color: "var(--muted)", alignItems: "center" }}>
          {showRestaurant && issue.restaurantName && (
            onOpenRestaurant && issue.restaurantSlug ? (
              <button type="button" onClick={() => onOpenRestaurant(issue.restaurantSlug!)}
                style={{ color: "var(--accent)", fontWeight: 700, background: "none", border: 0, padding: 0, cursor: "pointer" }}>
                <i className="fas fa-store" style={{ marginRight: 4, opacity: 0.8 }} aria-hidden="true" />{issue.restaurantName}
              </button>
            ) : (
              <span style={{ color: "var(--accent)", fontWeight: 700 }}><i className="fas fa-store" style={{ marginRight: 4, opacity: 0.8 }} aria-hidden="true" />{issue.restaurantName}</span>
            )
          )}
          {/* WHO + WHICH PANEL raised it. */}
          <span title={who.role ? `Raised from the ${who.role.label}` : undefined}>
            <i className="fas fa-user" style={{ marginRight: 4, opacity: 0.7 }} aria-hidden="true" />{who.name}
          </span>
          {who.role && (
            <span className="adm-chip" style={{ fontSize: 10.5, padding: "1px 7px", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <i className={`fas ${who.role.icon}`} aria-hidden="true" />{who.role.label}
            </span>
          )}
          <span>· {new Date(issue.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          {resolved && issue.resolved_by && <span>· resolved by {issue.resolved_by === "admin" ? "Aevidine" : issue.resolved_by}</span>}
        </div>
      </div>

      {onSetStatus && (
        <button className={`adm-btn ${resolved ? "" : "ok"}`} disabled={busy}
          style={{ flexShrink: 0, padding: "8px 13px", fontSize: 12.5 }}
          onClick={() => onSetStatus(issue.id, resolved ? "open" : "resolved")}>
          {busy ? "…" : resolved ? "Reopen" : "Resolve"}
        </button>
      )}

      {/* Simple full-size photo lightbox. */}
      {imgOpen && issue.image_url && (
        <div onClick={() => setImgOpen(false)} role="dialog" aria-label="Photo"
          style={{ position: "fixed", inset: 0, zIndex: 100000, background: "rgba(0,0,0,.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, cursor: "zoom-out" }}>
          <img src={issue.image_url} alt="attached photo" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 10 }} />
        </div>
      )}
    </div>
  );
}
