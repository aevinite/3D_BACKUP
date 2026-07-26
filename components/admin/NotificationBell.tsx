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
type ErrRow = { id: string; panel: string; action: string; detail: string | null; restaurant_id: string | null; restaurantName: string; created_at: string };
type RlNotif = { id: string; key: string; subject: string; hit_count: number; max_count: number; last_at: string; restaurantName: string };
type Feed = { tickets: TicketLike[]; openTicketCount: number; alerts: Alert[]; alertCount: number; errors: ErrRow[]; errorCount: number; rateLimits: RlNotif[]; rateLimitCount: number };

export default function NotificationBell() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    fetch("/api/admin/notifications", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!j.error) setFeed({ tickets: j.tickets || [], openTicketCount: j.openTicketCount || 0, alerts: j.alerts || [], alertCount: j.alertCount || 0, errors: j.errors || [], errorCount: j.errorCount || 0, rateLimits: j.rateLimits || [], rateLimitCount: j.rateLimitCount || 0 }); })
      .catch(() => { /* keep last-known feed; the badge just won't update this tick */ });
  }, []);
  useEffect(() => { load(); }, [load]);
  useActiveAutoRefresh(load, 60000);

  const count = (feed?.openTicketCount || 0) + (feed?.alertCount || 0) + (feed?.errorCount || 0) + (feed?.rateLimitCount || 0);

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

  // Errors: snapshot ONCE when the drawer opens so they stay readable on screen even though
  // opening the bell marks them SEEN — which empties the live feed and clears the red badge
  // (owner 2026-07-24: "stop showing in the notification when it has been seen"). A per-row
  // "Mark unread" re-raises the badge for that one error so it shows again on purpose.
  const [errs, setErrs] = useState<ErrRow[]>(feed?.errors || []);
  const [unread, setUnread] = useState<Set<string>>(new Set());
  const seenOnce = useRef(false);
  const rand = () => (crypto as { randomUUID?: () => string }).randomUUID?.() || String(Date.now());
  useEffect(() => {
    if (seenOnce.current || !feed) return;
    seenOnce.current = true;
    setErrs(feed.errors || []);
    if ((feed.errorCount || 0) === 0) return;
    // Mark ALL unseen errors seen (not just the ≤10 shown) so the badge fully clears in one open
    // even during a burst — otherwise it stayed lit with the remainder (audit 2026-07-24).
    fetch("/api/admin/oplog/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-LFH-Action-Id": rand() },
      body: JSON.stringify({ all: true, seen: true }),
    }).then(() => onChanged()).catch(() => { /* badge just won't clear this tick */ });
  }, [feed, onChanged]);

  // Toggle one error's seen state from the drawer. Marking unread re-raises the badge; the row
  // stays visible in this session either way, just flagged.
  const setSeen = async (id: string, seen: boolean) => {
    setUnread((prev) => { const n = new Set(prev); if (seen) n.delete(id); else n.add(id); return n; });
    try {
      await fetch("/api/admin/oplog/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-LFH-Action-Id": rand() },
        body: JSON.stringify({ action_ids: [id], seen }),
      });
    } catch { /* best-effort */ }
    onChanged();
  };

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

        <div style={{ flex: 1, overflow: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* App errors (last 24h) — jumps into the Everything Log filtered to errors. */}
          <section>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--muted)" }}>
                App errors (24h) {errs.length > 0 && <span>· {errs.length}</span>}
              </div>
              <a href="/aevinite/logs?level=error" onClick={onClose} style={{ marginLeft: "auto", fontSize: 12, color: "var(--accent)", fontWeight: 700 }}>View log →</a>
            </div>
            {errs.length === 0 ? (
              <div className="adm-empty" style={{ padding: "14px 12px", fontSize: 13 }}>No new errors. 🎉</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {errs.map((e) => {
                  const isUnread = unread.has(e.id);
                  return (
                    <div key={e.id} className="adm-card" style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "10px 12px", borderLeft: "3px solid var(--adm-danger, #e5484d)", opacity: isUnread ? 1 : 0.72 }}>
                      <i className="fas fa-triangle-exclamation" aria-hidden="true" style={{ color: "var(--adm-danger, #e5484d)", fontSize: 15, marginTop: 1 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.panel} · {e.detail || e.action}</div>
                        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{e.restaurantName} · {new Date(e.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                        <button
                          onClick={() => setSeen(e.id, isUnread)}
                          style={{ marginTop: 6, fontSize: 11, fontWeight: 700, background: "none", border: 0, padding: 0, cursor: "pointer", color: "var(--accent)" }}
                        >
                          <i className={`fas ${isUnread ? "fa-envelope-open" : "fa-envelope"}`} aria-hidden="true" style={{ marginRight: 5 }} />
                          {isUnread ? "Mark read" : "Mark unread"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Rate-limit hits (mig 205) */}
          <section>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--muted)" }}>
                Rate limits reached {(feed?.rateLimitCount || 0) > 0 && <span>· {feed?.rateLimitCount}</span>}
              </div>
              <a href="/aevinite/repair#rate-limits" onClick={onClose} style={{ marginLeft: "auto", fontSize: 12, color: "var(--accent)", fontWeight: 700 }}>Manage →</a>
            </div>
            {(feed?.rateLimits || []).length === 0 ? (
              <div className="adm-empty" style={{ padding: "14px 12px", fontSize: 13 }}>No limits reached. 🎉</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(feed?.rateLimits || []).map((h) => (
                  <a key={h.id} href="/aevinite/repair#rate-limits" onClick={onClose} className="adm-card" style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "10px 12px", borderLeft: "3px solid var(--adm-danger, #e5484d)", textDecoration: "none", color: "inherit" }}>
                    <i className="fas fa-gauge-high" aria-hidden="true" style={{ color: "var(--adm-danger, #e5484d)", fontSize: 15, marginTop: 1 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.key.replace(/_/g, " ")} · {h.subject}</div>
                      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{h.restaurantName} · {h.hit_count}/{h.max_count} · {new Date(h.last_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </section>

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
              <a href="/aevinite/repair#complaints" onClick={onClose} style={{ marginLeft: "auto", fontSize: 12, color: "var(--accent)", fontWeight: 700 }}>View all →</a>
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
                Showing the {tickets.length} newest · <a href="/aevinite/repair#complaints" onClick={onClose} style={{ color: "var(--accent)" }}>see all {feed?.openTicketCount}</a>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
