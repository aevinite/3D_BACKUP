"use client";
// Shared bits for the admin pages: types, formatting, the live-floor grid, the
// activity feed, and a tiny polling hook. Keeps Overview/Floor/Logs DRY.
import { useEffect, useRef, useState } from "react";
import { useRealtime } from "@/lib/useRealtime";
import { LogDetailModal } from "@/components/admin/LogDetailModal";

export type Tile = {
  table_number: string;
  state: "free" | "seated" | "new" | "preparing" | "served" | "cleared";
  open: boolean; members: number; pending_members: number;
  has_new: boolean; has_call: boolean; due: number; pay: "" | "red" | "green";
  tag?: "" | "vip" | "family" | "guest"; // special table type (mig 166)
};
// Special table types (mig 166): badge shown on the admin tile — still money-free.
export const TILE_TAG: Record<string, { emoji: string; color: string; label: string }> = {
  vip: { emoji: "👑", color: "#8b5cf6", label: "VIP" },
  family: { emoji: "🏠", color: "#e11d48", label: "Family" },
  guest: { emoji: "🤝", color: "#aab4c4", label: "Owner's guest" },
};
export type Overview = {
  maintenance: boolean; sessionsEnabled: boolean; tableCount: number;
  features: Record<string, boolean>;
  openTables: number; activeOrders: number; unpaidOrders: number;
  ordersToday: number;
};
export type Action = { id: string; panel: string; action: string; table_number?: string | null; detail?: string | null; actor?: string | null; actor_id?: string | null; device_id?: string | null; order_id?: string | null; created_at: string; restaurant_id?: string | null; restaurant_name?: string | null; restaurant_slug?: string | null; level?: "info" | "warn" | "error"; seen_at?: string | null; resolved_at?: string | null };

export const STATE_LABEL: Record<Tile["state"], string> = {
  free: "Free", seated: "Seated", new: "New order", preparing: "Preparing", served: "Served", cleared: "Cleared",
};
// Vivid status colours (white text) — read clearly on both light & dark themes.
export const STATE_COLOR: Record<Tile["state"], string> = {
  free: "", seated: "#2563eb", new: "#ea580c", preparing: "#7c3aed", served: "#ca8a04", cleared: "#15803d",
};
export const PANEL_COLOR: Record<string, string> = { editor: "#d4a574", manager: "#d4a574", kitchen: "#7ec88a", tablet: "#60a5fa", admin: "#e8a13c", owner: "#c084fc", db: "#94a3b8", guest: "#38bdf8", menu: "#38bdf8" };

// What a PERSON calls each panel. The manager panel's internal name is still "editor", so the
// raw column rendered two chips — EDITOR and MANAGER — for the SAME panel, in the same list, in
// the same colour, and "editor" is a word that names nothing a person can open (T15 sweep).
// `db` and `menu` had a colour here but no name anywhere; LogDetailModal already had the right
// words for `db`, so they are reused.
export const PANEL_LABEL: Record<string, string> = {
  editor: "Manager", manager: "Manager", kitchen: "Kitchen", tablet: "Tablet",
  admin: "Admin", owner: "Owner", guest: "Guest", menu: "Menu", db: "Database",
};
/** The chip's text: always the human name, never the raw column. */
export function panelLabel(panel: string | null | undefined): string {
  const k = String(panel || "").trim();
  if (!k) return "—";
  return PANEL_LABEL[k] || (k.charAt(0).toUpperCase() + k.slice(1));
}
/** The tinted "which panel did this" pill. One helper because three screens drew it
 *  identically (owner Activity, admin Logs, the shared log row).
 *
 *  The pill's TEXT is the panel colour mixed toward the CURRENT skin's text colour.
 *  Those colours were all chosen against a dark console, so on the owner panel's LIGHT
 *  skin the pale ones sat at ~2:1 contrast on white — "kitchen" was barely legible
 *  (both-skins readability sweep, 2026-07-31). Mixing toward `--text` keeps every hue
 *  recognisable while making it readable in whichever skin is on; on the dark console
 *  it mixes toward light grey, so nothing there looks different. */
export function panelChipStyle(panel: string | null | undefined): React.CSSProperties {
  const c = PANEL_COLOR[panel || ""] || "#888";
  // No inline `color`: an inline colour beats the stylesheet, and the per-skin mix has to be
  // decided in CSS (see the .adm-chip rules in app/globals.css). Mixing 78% with var(--text)
  // lightens nicely on dark but left "Kitchen"/"Manager" at 2.62-2.85:1 on the light console.
  return {
    background: `color-mix(in srgb, ${c} 22%, transparent)`,
    ["--hue" as string]: c,
  };
}
// EVERY action code the app can write needs a line here (2026-08-03). The Activity log used to
// print the raw code for anything missing — a manager reading their own Audit & logs tab saw
// `order_item_qty`, `invoice_void`, `order_delete`, `menu_delete` sitting between "Placed order"
// and "Signed in". Half a screen of database column names is not a record anyone can read, and it
// is the screen the owner opens to answer "who did this?".
//
// Two rules keep it that way:
//   • add a `logAction(...)`/`log(...)` code → add its label here AND in the manager panel's copy
//     (public/panels/editor/app.js → OP_ACTION_LABELS). `npm run verify:audit` fails otherwise.
//   • never render `ACT_LABEL[x] || x` — call actLabel(x), which prettifies an unknown code into
//     "Order item qty" rather than leaking `order_item_qty` onto a person's screen.
export const ACT_LABEL: Record<string, string> = {
  // Added by the T15 wording sweep (2026-08-05). All twelve are written from a TERNARY call site
  // (`active ? "staff_enable" : "staff_disable"`), which verify-audit-coverage.mjs could not see —
  // so half of each pair had a label and half printed as a prettified database key next to real
  // sentences. The guard now reads both branches; these are the codes it was missing.
  payroll_add: "Put on the payroll", payroll_remove: "Took off the payroll",
  staff_enable: "Enabled a staff member",
  issue_resolved: "Resolved a complaint", issue_reopened: "Reopened a complaint",
  restaurant_reactivate: "Reactivated a restaurant", restaurant_suspend: "Suspended a restaurant",
  error_reopened: "Reopened a problem",
  owner_restore: "Restored an owner", owner_suspend: "Suspended an owner",
  maintenance_on: "Turned Service Mode on", maintenance_off: "Turned Service Mode off",
  // Not from this PR — the printing feature (80a39a5f) added these three codes without labels, so
  // `npm run verify:audit` was already red on main and they were printing as raw keys on the
  // Activity screens. Three lines, same class of gap as the nine this PR fixed.
  kot_reprint_sent: "Reprinted a KOT", printer_problem: "Printer problem",
  printer_problem_resolved: "Printer problem fixed",
  // Added by the 2026-08-04 API sweep, which gave nine previously-unrecorded writes an audit row.
  // A code with no label here prints as a raw database key on a person's screen (verify:audit
  // catches it), so the label lands in the SAME commit as the logAction call.
  access_change: "Changed access & permissions", retention_change: "Changed log retention",
  feature_flip: "Changed a guest feature", staff_feature: "Changed a staff feature",
  google_review: "Changed the Google review link", module_toggle: "Turned a module on/off",
  customer_erase: "Erased a guest's record", issue_raised: "Raised a complaint",
  rating_handled: "Handled a rating",
  order_accept: "Accepted order", order_serve: "Served order", order_ready: "Marked ready",
  order_discount: "Applied discount", table_open: "Opened table", table_close: "Closed table",
  table_shift: "Shifted table", transfer_head: "Transferred head", order_place: "Placed order",
  call_attend: "Attended call", member_approve: "Approved guest", sold_out_on: "Marked sold-out", sold_out_off: "Back in stock",
  login: "Signed in", logout: "Signed out", profile_setup: "Completed profile", profile_update: "Updated profile",
  pin_set: "Set PIN", password_change: "Changed password",
  user_create: "Created user", user_delete: "Deleted user", user_reset_password: "Reset password",
  user_enable: "Enabled user", user_disable: "Disabled user", user_set_role: "Changed role", user_set_access: "Changed access",
  order_add_item: "Added a dish", order_item_qty: "Changed quantity", order_item_note: "Edited a note",
  order_item_delete: "Removed a dish", order_delete: "Deleted a bill", order_move: "Moved order",
  order_allergies: "Set allergies", order_item_removed: "Removed allergen", item_status: "Updated dish status",
  bill_paid: "Marked paid", close_unpaid: "Closed a table that still owed money", payment_revert: "Reverted payment",
  member_remove: "Removed guest", member_ban: "Banned guest", auto_approve: "Auto-approve", table_restart: "Restarted table",
  billing_set_plan: "Set billing plan", billing_add_payment: "Recorded a payment", billing_delete_payment: "Deleted a payment",
  // Everything Log (mig 159) + runtime-support tooling.
  route_error: "Server error", client_error: "Screen error", ui_taps: "Button taps", row_change: "Direct database edit",
  alert_sent: "Alert sent",
  repair_void_bill: "Repair · voided bill", repair_delete_order: "Repair · deleted order",
  repair_refire_order: "Repair · re-fired order", repair_unstick_table: "Repair · unstuck table",
  repair_edit_time: "Repair · edited time", fix_request: "Sent for overnight repair", error_resolved: "Marked resolved",
  // ── the bill: printing it, reopening it, settling it ──────────────────────
  invoice_generate: "Printed the bill", invoice_void: "Reopened the bill (invoice voided)", credit_note: "Issued a credit note",
  bill_discount: "Discounted the whole bill", bill_split: "Split the bill", bill_restore: "Restored a bill",
  payment_legs_reversed: "Reversed the split payment record",
  on_the_house: "Settled on the house", orders_delete: "Deleted bills",
  order_cancel: "Cancelled the KOT", order_uncancel: "Un-cancelled the KOT", order_tip: "Recorded a tip",
  order_item_move: "Moved a dish to another bill", customer_saved: "Saved the customer",
  khata_park: "Parked the bill on khata", khata_collect: "Collected a khata payment",
  audit_record_failed: "Audit record FAILED",
  // ── the floor ─────────────────────────────────────────────────────────────
  table_merge: "Merged tables", table_unmerge: "Split merged tables",
  table_open_all: "Opened every table", table_close_all: "Closed every table",
  table_tag_set: "Marked the table", table_tag_clear: "Cleared the table mark",
  table_sections_set: "Set waiter sections", table_qr_regen: "Made a new QR code",
  // ── the menu ──────────────────────────────────────────────────────────────
  menu_create: "Added to the menu", menu_edit: "Edited the menu", menu_delete: "Deleted from the menu",
  quick_feature: "Changed a feature switch",
  // ── parcel, banquet and the delivery platforms ────────────────────────────
  parcel_place: "Took a parcel order", parcel_collect: "Parcel collected", parcel_print: "Printed a parcel bill",
  banquet_place: "Took a banquet order", banquet_bill: "Banquet bill",
  banquet_item_save: "Saved a banquet item", banquet_item_delete: "Deleted a banquet item",
  platform_toggle: "Turned a platform on/off", platform_channel: "Changed a platform channel",
  platform_status: "Platform order status", platform_test_order: "Platform test order",
  // ── stock and money out ───────────────────────────────────────────────────
  inv_purchase: "Recorded a purchase", inv_purchase_void: "Voided a purchase", inv_waste: "Recorded waste",
  inv_count_submit: "Submitted a stock count", inv_production: "Recorded production", inv_recipe_save: "Saved a recipe",
  expense_add: "Recorded an expense", expense_void: "Voided an expense",
  // ── people ────────────────────────────────────────────────────────────────
  staff_create: "Added a staff member", staff_delete: "Deleted a staff member", staff_disable: "Disabled a staff member",
  staff_reset_password: "Reset a staff password", staff_set_role: "Changed a staff role",
  staff_set_permissions: "Changed permissions", staff_profile_edit: "Edited a staff profile",
  staff_job_edit: "Edited job details", staff_payment: "Recorded a staff payment",
  staff_payment_void: "Voided a staff payment", staff_own_pay_visibility: "Changed pay visibility",
  manager_permissions: "Changed manager powers",
  user_set_job: "Changed job details", user_set_permissions: "Changed permissions",
  user_set_photo: "Changed the photo", user_set_pin: "Set the PIN",
  // ── sign-in safety ────────────────────────────────────────────────────────
  login_failed: "Wrong password", login_blocked: "Sign-in blocked", login_denied: "Sign-in refused",
  rate_limited: "Limit reached", rate_limit_edit: "Edited a limit rule", rate_limit_allow: "Allowed through a limit",
  admin_block: "Blocked a device", admin_unblock: "Unblocked a device", admin_lockout_clear: "Cleared a lockout",
  blocklist_add: "Added to the blocklist", blocklist_remove: "Removed from the blocklist",
  // ── the admin console ─────────────────────────────────────────────────────
  restaurant_create: "Created a restaurant", restaurant_settings: "Changed settings",
  restaurant_branding: "Changed branding", restaurant_logo: "Changed the logo",
  restaurant_export: "Exported a restaurant", restaurant_set_owner: "Changed the owner",
  restaurant_soft_delete: "Moved a restaurant to the bin", restaurant_restore: "Restored a restaurant",
  restaurant_purge: "Permanently removed a restaurant",
  owner_create: "Created an owner", owner_rename: "Renamed an owner", owner_reset_password: "Reset an owner's password",
  owner_attach_restaurant: "Gave an owner a restaurant", owner_detach_restaurant: "Took a restaurant off an owner",
  owner_set_primary: "Made primary owner", owner_soft_delete: "Moved an owner to the bin",
  owner_restore_from_bin: "Restored an owner", owner_purge: "Permanently removed an owner",
  logs_cleanup: "Cleaned up old logs", error_memory_cleared: "Cleared the error memory",
};

/** The label to SHOW for an action code. Never returns a raw snake_case key: an unknown code is
 *  prettified ("order_item_qty" → "Order item qty") so a new action added tomorrow reads like
 *  English on every screen until someone writes it a proper line above. */
export function actLabel(code: string | null | undefined): string {
  const k = String(code || "").trim();
  if (!k) return "—";
  if (ACT_LABEL[k]) return ACT_LABEL[k];
  const words = k.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// en-IN, not en-US: an Indian owner reads ₹85,62,929 (lakh grouping), and the Reports page put
// this number directly above a chart axis labelled in lakhs (₹6.7L) — two groupings for one
// figure on one card. Every other formatter in the product already uses en-IN; these were the
// three that did not (T15 sweep, 2026-08-05).
export const inr = (n: number) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");

// Paise-precise money — for lines that must ADD UP exactly (e.g. the CGST/SGST halves of
// an odd total tax: ₹162,739 → ₹81,369.50 + ₹81,369.50, not ₹81,370 + ₹81,369 which reads
// as "why are two equal 2.5% rates different?"). Shows decimals only when there ARE paise,
// so whole-rupee amounts still read cleanly (owner 2026-07-26).
export const inrP = (n: number) => {
  const v = Number(n) || 0;
  const hasPaise = Math.abs(Math.round(v) - v) > 0.005;
  return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: hasPaise ? 2 : 0, maximumFractionDigits: 2 });
};

// isManagerPinRow — a TABLET row's `actor` normally names the manager whose PIN authorised
// the action (the tablet has no per-person login). BUT a person's OWN identity actions —
// signing in/out, setting up their profile, changing their password/PIN — also stamp `actor`
// with that person's name, and those are NOT a manager-PIN authorisation. So we exclude them:
// a login row must show "Done by <name>", never a "Manager PIN" block (owner 2026-07-25:
// "if there is not manager PIN involved, the manager PIN part should not be there").
const SELF_ACTOR_ACTIONS = new Set(["login", "logout", "profile_setup", "profile_update", "password_change", "pin_set"]);
export function isManagerPinRow(row: { panel?: string; action?: string; actor?: string | null }): boolean {
  return row.panel === "tablet" && !!row.actor && !SELF_ACTOR_ACTIONS.has(row.action || "");
}

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
export async function openRestaurantPanel(restaurantId: string, path: string, ownerUid?: string): Promise<Window | null> {
  // Open WITHOUT the "noopener" feature so we still get a window handle back (with it,
  // window.open always returns null, making a blocked popup undetectable). We null `opener`
  // ourselves to keep the same safety. Returns null if the popup was blocked, so callers
  // can tell the admin instead of falsely claiming "now viewing" (audit 2026-07-08).
  // ownerUid (owner panel only): pin to a SPECIFIC owner when a restaurant has several
  // (the "which owner?" chooser, owner 2026-07-25) — act-as/go forwards it as ?as=.
  const uidQ = ownerUid ? `&uid=${encodeURIComponent(ownerUid)}` : "";
  const w = window.open(`/api/admin/act-as/go?rid=${encodeURIComponent(restaurantId)}&to=${encodeURIComponent(path)}${uidQ}`, "_blank");
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

// fullWhen — the exact, human date + time for a log-detail popup (e.g. "Fri, 25 Jul
// 2026, 3:42 PM"). timeAgo answers "how long ago" for the list; this answers "exactly
// when" once a row is opened. Falls back to the raw string if the date is unparseable.
export const fullWhen = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
};

// Live refetch (replaced the old fixed-interval usePoll): refetches on mount, on
// every ops/menu breadcrumb
// (instant push), on tab wake, and on useRealtime's own 60s safety net — no fast
// per-second polling. Use ONE per page (pass a fn that runs all of that page's
// fetches) so the page opens a single websocket.
export function useLivePoll(fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  // `audit` is the admin's own topic for staff_actions (mig 267 / sweep F3). The activity
  // feed still updates the instant a row is logged; the staff panels no longer reload their
  // whole floor for it, because they don't subscribe to this topic.
  useRealtime({ ops: () => ref.current(), menu: () => ref.current(), audit: () => ref.current() });
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
    // JITTER, not a metronome. Every device that opened its screen around the same time (a
    // shift starting, a rush) would otherwise refresh on the SAME beat forever, so the database
    // sees synchronised spikes instead of a steady trickle — and a spike is what pushes an
    // already-busy instance over. ±20% per tick spreads the same number of requests out. The
    // cost is that "60s" means 48-72s, which no screen depends on (realtime does the instant
    // updating; this is only the safety net).
    const spread = (ms: number) => Math.round(ms * (0.8 + Math.random() * 0.4));
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      id = setTimeout(() => {
        if (!document.hidden) {
          if (Date.now() - last > idleMs) { wasIdle = true; } // user walked away → stop, arm wake-on-return
          else ref.current();
        }
        tick();
      }, spread(intervalMs));
    };
    tick();
    return () => {
      clearTimeout(id);
      evs.forEach((e) => window.removeEventListener(e, bump, { capture: true } as EventListenerOptions));
    };
  }, [intervalMs, idleMs]);
}

// NO food/earnings revenue in these stat cards (owner 2026-07-03: the admin sees no restaurant
// earnings — no ₹ at all here, including table "due" amounts). Platform SUBSCRIPTION income
// (what restaurants pay us) is a separate thing and does show on Billing/Revenue by design.
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
      {tiles.map((t) => {
        const tg = t.tag ? TILE_TAG[t.tag] : undefined;
        return (
        <div key={t.table_number}
          className={`adm-tile ${t.state === "free" ? "free" : ""}`}
          style={{
            background: t.state === "free" ? undefined : STATE_COLOR[t.state],
            // Money state (unpaid red / paid green) beats the tag ring.
            borderColor: t.pay === "red" ? "#f87171" : t.pay === "green" ? "#34d399" : tg ? tg.color : "transparent",
          }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="tnum">Table {t.table_number}</span>
            <span style={{ fontSize: 16 }}>{tg ? tg.emoji : ""}{t.has_call ? "🔔" : ""}{t.has_new ? "🆕" : ""}</span>
          </div>
          <div className="tstate">{STATE_LABEL[t.state]}{tg ? ` · ${tg.label}` : ""}</div>
          <div className="tsub">{t.open ? `${t.members} seated` : "—"}</div>
        </div>
        );
      })}
    </div>
  );
}

export function ActivityFeed({ rows }: { rows: Action[] }) {
  // Every row is clickable → the same organized detail popup the Logs page uses, so the
  // Overview feed is never a dead-end (owner 2026-07-25: "everything should be clickable").
  const [detailRow, setDetailRow] = useState<Action | null>(null);
  if (rows.length === 0) return <p className="adm-muted" style={{ fontSize: 13, margin: 0 }}>No staff actions yet.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", maxHeight: 340, overflowY: "auto" }}>
      {rows.map((a) => {
        const det = formatActionDetail(a.action, a.detail);
        return (
        <div key={a.id} role="button" tabIndex={0} onClick={() => setDetailRow(a)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetailRow(a); } }}
          style={{ display: "grid", gridTemplateColumns: "84px 1fr auto", gap: 10, alignItems: "center", fontSize: 13, padding: "8px 0", borderBottom: "var(--border)", cursor: "pointer" }}>
          <span className="adm-chip" style={panelChipStyle(a.panel)}>{panelLabel(a.panel)}</span>
          <span style={{ minWidth: 0 }}>
            {actLabel(a.action)}{a.actor ? ` · ${a.actor}` : a.table_number ? ` · Table ${a.table_number}` : det ? ` · ${det}` : ""}
            {a.restaurant_name ? <span className="adm-muted" style={{ display: "block", fontSize: 11.5, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><i className="fas fa-store" style={{ fontSize: 9, marginRight: 4, opacity: 0.7 }} aria-hidden="true" />{a.restaurant_name}</span> : null}
          </span>
          <span className="adm-when">{timeAgo(a.created_at)}</span>
        </div>
        );
      })}
      {detailRow && <LogDetailModal row={detailRow} onClose={() => setDetailRow(null)} />}
    </div>
  );
}
