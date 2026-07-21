"use client";
// Shared bits for the admin pages: types, formatting, the live-floor grid, the
// activity feed, and a tiny polling hook. Keeps Overview/Floor/Logs DRY.
import { useEffect, useRef } from "react";
import { useRealtime } from "@/lib/useRealtime";

export type Tile = {
  table_number: string;
  state: "free" | "seated" | "new" | "preparing" | "served" | "cleared";
  open: boolean; members: number; pending_members: number;
  has_new: boolean; has_call: boolean; due: number; pay: "" | "red" | "green";
};
export type Overview = {
  maintenance: boolean; sessionsEnabled: boolean; tableCount: number;
  features: Record<string, boolean>;
  openTables: number; activeOrders: number; unpaidOrders: number;
  ordersToday: number;
};
export type Action = { id: string; panel: string; action: string; table_number?: string | null; detail?: string | null; actor?: string | null; created_at: string; restaurant_id?: string | null; restaurant_name?: string | null; restaurant_slug?: string | null; level?: "info" | "warn" | "error" };

export const STATE_LABEL: Record<Tile["state"], string> = {
  free: "Free", seated: "Seated", new: "New order", preparing: "Preparing", served: "Served", cleared: "Cleared",
};
// Vivid status colours (white text) — read clearly on both light & dark themes.
export const STATE_COLOR: Record<Tile["state"], string> = {
  free: "", seated: "#2563eb", new: "#ea580c", preparing: "#7c3aed", served: "#ca8a04", cleared: "#15803d",
};
export const PANEL_COLOR: Record<string, string> = { editor: "#d4a574", manager: "#d4a574", kitchen: "#7ec88a", tablet: "#60a5fa", admin: "#e8a13c", owner: "#c084fc", db: "#94a3b8", guest: "#38bdf8", menu: "#38bdf8" };
export const ACT_LABEL: Record<string, string> = {
  order_accept: "Accepted order", order_serve: "Served order", order_ready: "Marked ready",
  order_discount: "Applied discount", table_open: "Opened table", table_close: "Closed table",
  table_shift: "Shifted table", transfer_head: "Transferred head", order_place: "Placed order",
  call_attend: "Attended call", member_approve: "Approved guest", sold_out_on: "Marked sold-out", sold_out_off: "Back in stock",
  login: "Signed in", logout: "Signed out", profile_setup: "Completed profile", profile_update: "Updated profile",
  pin_set: "Set PIN", password_change: "Changed password",
  user_create: "Created user", user_delete: "Deleted user", user_reset_password: "Reset password",
  user_enable: "Enabled user", user_disable: "Disabled user", user_set_role: "Changed role", user_set_access: "Changed access",
  order_add_item: "Added a dish", order_item_qty: "Changed quantity", order_item_note: "Edited a note",
  order_item_delete: "Removed a dish", order_delete: "Deleted order", order_move: "Moved order",
  order_allergies: "Set allergies", order_item_removed: "Removed allergen", item_status: "Updated dish status",
  bill_paid: "Marked paid", close_unpaid: "Closed unpaid", payment_revert: "Reverted payment",
  member_remove: "Removed guest", member_ban: "Banned guest", auto_approve: "Auto-approve", table_restart: "Restarted table",
  billing_set_plan: "Set billing plan", billing_add_payment: "Recorded a payment", billing_delete_payment: "Deleted a payment",
  // Everything Log (mig 159) + runtime-support tooling.
  route_error: "Server error", client_error: "Screen error", ui_taps: "Button taps", row_change: "Manual DB edit",
  alert_sent: "Alert sent",
  repair_void_bill: "Repair · voided bill", repair_delete_order: "Repair · deleted order",
  repair_refire_order: "Repair · re-fired order", repair_unstick_table: "Repair · unstuck table",
  repair_edit_time: "Repair · edited time", fix_request: "Sent to Claude",
};

export const inr = (n: number) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-US");

// formatActionDetail — turn a raw stored `detail` into a plain-English phrase for the
// activity feed. Today only "ui_taps" needs it: the black-box logger (public/panels/errlog.js)
// stores a batch of button taps as JSON like `[{"t":12,"l":"Add dish"}]`, which is unreadable
// on screen. We parse it into the button LABELS that were tapped, deduped with a "×N" count and
// in first-seen order — e.g. `Add dish, Send order ×2, Close`. Connection-signal-light taps are
// dropped as noise (people tap that pill constantly just to check their signal). Anything we
// can't parse falls back to the raw string, so a future detail shape is never hidden.
export function formatActionDetail(action: string, detail: string | null | undefined): string {
  if (!detail) return "";
  if (action !== "ui_taps") return detail;
  let arr: unknown;
  try { arr = JSON.parse(detail); } catch { return detail; }
  if (!Array.isArray(arr)) return detail;
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const l = String((item as { l?: unknown }).l ?? "").trim();
    if (!l) continue;
    if (/^connection\b/i.test(l)) continue; // signal-light checks are noise, not an action
    if (!counts.has(l)) order.push(l);
    counts.set(l, (counts.get(l) || 0) + 1);
  }
  if (order.length === 0) return "checked the screen";
  return order.map((l) => (counts.get(l)! > 1 ? `${l} ×${counts.get(l)}` : l)).join(", ");
}

// openRestaurantPanel — the admin "act-as" pattern, shared by the home command
// table and the Restaurants detail page. Opens the tab SYNCHRONOUSLY on the
// /api/admin/act-as/go redirect, which sets the act-as cookie and 302s to the
// panel in one round trip: the tab appears the instant the admin clicks (owner
// 2026-07-04 — the old await-POST-then-open flow felt slow and risked popup
// blockers). The ?rid= pin keeps THAT tab on the restaurant even if the
// browser-wide cookie later changes (owner 2026-07-03).
export async function openRestaurantPanel(restaurantId: string, path: string): Promise<Window | null> {
  // Open WITHOUT the "noopener" feature so we still get a window handle back (with it,
  // window.open always returns null, making a blocked popup undetectable). We null `opener`
  // ourselves to keep the same safety. Returns null if the popup was blocked, so callers
  // can tell the admin instead of falsely claiming "now viewing" (audit 2026-07-08).
  const w = window.open(`/api/admin/act-as/go?rid=${encodeURIComponent(restaurantId)}&to=${encodeURIComponent(path)}`, "_blank");
  if (w) { try { w.opener = null; } catch {} }
  return w;
}
export const timeAgo = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
};

// Live refetch (replaced the old fixed-interval usePoll): refetches on mount, on
// every ops/menu breadcrumb
// (instant push), on tab wake, and on useRealtime's own 60s safety net — no fast
// per-second polling. Use ONE per page (pass a fn that runs all of that page's
// fetches) so the page opens a single websocket.
export function useLivePoll(fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useRealtime({ ops: () => ref.current(), menu: () => ref.current() });
}

// useActiveAutoRefresh — gentle periodic refresh for the HEAVY dashboards (owner +
// admin), instead of redrawing on every realtime event. Calls fn() every intervalMs
// ONLY when the tab is VISIBLE and the user interacted within idleMs — interaction
// counts a click, key, scroll, wheel or touch. When the tab is hidden or the user
// goes idle (walked away), it stops fetching entirely (protects the DB / connection
// budget); the next click/scroll resumes it. Pair with a manual ↻ Refresh button.
// (owner 2026-06-26: "auto-refresh ~60s while it's on + being used, incl scroll;
// stop when not used.")
export function useActiveAutoRefresh(fn: () => void, intervalMs = 60000, idleMs = 120000) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let last = Date.now();
    let wasIdle = false; // were we paused (walked away) before this interaction?
    const bump = () => {
      const now = Date.now();
      // WAKE-ON-RETURN (owner 2026-06-26): if the user comes back — moves the cursor,
      // scrolls, taps — AFTER we'd gone idle, refresh IMMEDIATELY instead of making them
      // wait up to a full interval for fresh data. Normal in-session moves don't refetch
      // (we weren't idle), so this adds no extra egress while they're actively using it.
      if (wasIdle && !document.hidden) { wasIdle = false; ref.current(); }
      last = now;
    };
    const evs: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "scroll", "wheel", "touchstart", "pointermove"];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true, capture: true }));
    const id = setInterval(() => {
      if (document.hidden) return;                 // hidden tab → don't fetch
      if (Date.now() - last > idleMs) { wasIdle = true; return; } // user walked away → stop, arm wake-on-return
      ref.current();
    }, intervalMs);
    return () => {
      clearInterval(id);
      evs.forEach((e) => window.removeEventListener(e, bump, { capture: true } as EventListenerOptions));
    };
  }, [intervalMs, idleMs]);
}

// NO revenue anywhere in the admin panel (owner 2026-07-03: the admin sees no earnings —
// no ₹ at all, including table "due" amounts).
export function StatCards({ ov }: { ov: Overview | null }) {
  const cells: [string, string | number][] = [
    ["Open tables", ov ? ov.openTables : "…"],
    ["Active orders", ov ? ov.activeOrders : "…"],
    ["Unpaid bills", ov ? ov.unpaidOrders : "…"],
    ["Orders today", ov ? ov.ordersToday : "…"],
  ];
  return (
    <div className="adm-stats">
      {cells.map(([k, v]) => (
        <div key={k} className="adm-stat"><div className="k">{k}</div><div className="v">{v}</div></div>
      ))}
    </div>
  );
}

export function FloorGrid({ tiles, err }: { tiles: Tile[]; err: string | null }) {
  if (err) return <p style={{ color: "var(--adm-danger, #d14b48)" }}>Couldn&apos;t load the floor: {err}</p>;
  if (tiles.length === 0) return <div className="adm-empty">No tables yet.</div>;
  return (
    <div className="adm-floor">
      {tiles.map((t) => (
        <div key={t.table_number}
          className={`adm-tile ${t.state === "free" ? "free" : ""}`}
          style={{
            background: t.state === "free" ? undefined : STATE_COLOR[t.state],
            borderColor: t.pay === "red" ? "#f87171" : t.pay === "green" ? "#34d399" : "transparent",
          }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="tnum">Table {t.table_number}</span>
            <span style={{ fontSize: 16 }}>{t.has_call ? "🔔" : ""}{t.has_new ? "🆕" : ""}</span>
          </div>
          <div className="tstate">{STATE_LABEL[t.state]}</div>
          <div className="tsub">{t.open ? `${t.members} seated` : "—"}</div>
        </div>
      ))}
    </div>
  );
}

export function ActivityFeed({ rows }: { rows: Action[] }) {
  if (rows.length === 0) return <p className="adm-muted" style={{ fontSize: 13, margin: 0 }}>No staff actions yet.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", maxHeight: 340, overflowY: "auto" }}>
      {rows.map((a) => {
        const det = formatActionDetail(a.action, a.detail);
        return (
        <div key={a.id} style={{ display: "grid", gridTemplateColumns: "84px 1fr auto", gap: 10, alignItems: "center", fontSize: 13, padding: "8px 0", borderBottom: "var(--border)" }}>
          <span className="adm-chip" style={{ background: "color-mix(in srgb, " + (PANEL_COLOR[a.panel] || "#888") + " 22%, transparent)", color: PANEL_COLOR[a.panel] || "var(--muted)" }}>{a.panel}</span>
          <span style={{ minWidth: 0 }}>
            {ACT_LABEL[a.action] || a.action}{a.actor ? ` · ${a.actor}` : a.table_number ? ` · Table ${a.table_number}` : det ? ` · ${det}` : ""}
            {a.restaurant_name ? <span className="adm-muted" style={{ display: "block", fontSize: 11.5, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><i className="fas fa-store" style={{ fontSize: 9, marginRight: 4, opacity: 0.7 }} aria-hidden="true" />{a.restaurant_name}</span> : null}
          </span>
          <span className="adm-when">{timeAgo(a.created_at)}</span>
        </div>
        );
      })}
    </div>
  );
}
