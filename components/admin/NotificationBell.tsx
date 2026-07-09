"use client";
// NotificationBell — the top-bar bell on every admin page. Shows a red count of
// things needing attention (OPEN tickets + system-health alerts) and, on click, a
// right-side drawer listing them. Tickets can be resolved inline; a restaurant name
// jumps to that restaurant's detail. Polls /api/admin/notifications every 60s (only
// while the tab is active — useActiveAutoRefresh), one cheap call.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useActiveAutoRefresh } from "@/components/admin/shared";
import { useAdminModal } from "@/components/admin/useAdminModal";
import TicketCard, { type TicketLike } from "@/components/admin/TicketCard";

type Alert = { restaurant_id: string; restaurantName: string; restaurantSlug: string; kind: "suspended" | "dormant"; detail: string };
type Feed = { tickets: TicketLike[]; openTicketCount: number; alerts: Alert[]; alertCount: number };

export default function NotificationBell() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    fetch("/api/admin/notifications", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!j.error) setFeed({ tickets: j.tickets || [], openTicketCount: j.openTicketCount || 0, alerts: j.alerts || [], alertCount: j.alertCount || 0 }); })
      .catch(() => { /* keep last-known feed; the badge just won't update this tick */ });
  }, []);
  useEffect(() => { load(); }, [load]);
  useActiveAutoRefresh(load, 60000);

  const count = (feed?.openTicketCount || 0) + (feed?.alertCount || 0);

  return (
    <>
      <button className="adm-icnbtn" onClick={() => setOpen(true)} title="Notifications" aria-label={`Notifications${count ? ` (${count})` : ""}`}
        style={{ position: "relative" }}>
        <i className="fas fa-bell" aria-hidden="true" />
        {count > 0 && (
          <span aria-hidden="true" style={{
            position: "absolute", top: -3, right: -3, minWidth: 16, height: 16, padding: "0 4px",
            borderRadius: 9, background: "var(--adm-danger, #e5484d)", color: "#fff", fontSize: 10, fontWeight: 800,
            display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
          }}>{count > 99 ? "99+" : count}</span>
        )}
      </button>
      {open && <BellDrawer feed={feed} onClose={() => setOpen(false)} onChanged={load} />}
    </>
  );
}

function BellDrawer({ feed, onClose, onChanged }: { feed: Feed | null; onClose: () => void; onChanged: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  useAdminModal(ref, "notif-bell", onClose);

  // Local copy so a resolve disappears instantly; re-synced from the server via onChanged.
  const [tickets, setTickets] = useState<TicketLike[]>(feed?.tickets || []);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { setTickets(feed?.tickets || []); }, [feed]);

  const alerts = feed?.alerts || [];

  const openRestaurant = (slug: string) => {
    onClose();
    router.push(`/aevinite/restaurants?focus=${encodeURIComponent(slug)}`);
    window.dispatchEvent(new CustomEvent("adm:focus-restaurant", { detail: slug }));
  };

  const resolve = async (id: string) => {
    setBusy(id);
    setTickets((prev) => prev.filter((t) => t.id !== id)); // optimistic remove
    try {
      const r = await fetch("/api/owner/issues?scope=all", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "resolved" }),
      });
      if (!r.ok) onChanged(); // revert to server truth on failure
    } catch { onChanged(); }
    finally { setBusy(null); onChanged(); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9000 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.4)" }} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-label="Notifications"
        style={{
          position: "absolute", top: 0, right: 0, height: "100%", width: "min(420px, 92vw)",
          background: "var(--panel, var(--bg))", borderLeft: "1px solid var(--line)",
          boxShadow: "-12px 0 40px rgba(0,0,0,.25)", display: "flex", flexDirection: "column", outline: "none",
        }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "15px 16px", borderBottom: "1px solid var(--line)" }}>
          <i className="fas fa-bell" aria-hidden="true" style={{ opacity: 0.8 }} />
          <b style={{ fontSize: 15 }}>Notifications</b>
          <button className="adm-icnbtn" onClick={onClose} title="Close" aria-label="Close" style={{ marginLeft: "auto" }}>
            <i className="fas fa-xmark" aria-hidden="true" />
          </button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 14, paddingBottom: "calc(14px + env(safe-area-inset-bottom, 0px))", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* System-health alerts */}
          <section>
            <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 8 }}>
              System health {alerts.length > 0 && <span>· {alerts.length}</span>}
            </div>
            {alerts.length === 0 ? (
              <div className="adm-empty" style={{ padding: "14px 12px", fontSize: 13 }}>All restaurants look healthy. 🎉</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {alerts.map((a) => (
                  <div key={a.restaurant_id + a.kind} className="adm-card" style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px" }}>
                    <i className={`fas ${a.kind === "suspended" ? "fa-ban" : "fa-moon"}`} aria-hidden="true"
                      style={{ color: a.kind === "suspended" ? "var(--adm-danger, #e5484d)" : "#d4a574", fontSize: 15 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <button type="button" onClick={() => a.restaurantSlug && openRestaurant(a.restaurantSlug)}
                        style={{ fontWeight: 700, fontSize: 13.5, background: "none", border: 0, padding: 0, cursor: a.restaurantSlug ? "pointer" : "default", color: "var(--text)" }}>
                        {a.restaurantName}
                      </button>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>{a.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Open tickets */}
          <section>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--muted)" }}>
                Open tickets {(feed?.openTicketCount || 0) > 0 && <span>· {feed?.openTicketCount}</span>}
              </div>
              <a href="/aevinite/issues" onClick={onClose} style={{ marginLeft: "auto", fontSize: 12, color: "var(--accent)", fontWeight: 700 }}>View all →</a>
            </div>
            {tickets.length === 0 ? (
              <div className="adm-empty" style={{ padding: "14px 12px", fontSize: 13 }}>No open tickets right now. 🎉</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {tickets.map((t) => (
                  <TicketCard key={t.id} issue={t} showRestaurant onOpenRestaurant={openRestaurant}
                    onSetStatus={(id) => resolve(id)} busy={busy === t.id} />
                ))}
              </div>
            )}
            {(feed?.openTicketCount || 0) > tickets.length && tickets.length > 0 && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, textAlign: "center" }}>
                Showing the {tickets.length} newest · <a href="/aevinite/issues" onClick={onClose} style={{ color: "var(--accent)" }}>see all {feed?.openTicketCount}</a>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
