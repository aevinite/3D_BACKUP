// Operation-log helper. Route handlers call logAction(...) after a staff action
// so the "Operation log" shows who-did-what. Fire-and-forget: a logging failure
// must never break the actual action, so it's wrapped in try/catch.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

// Redact currency from a free-text `detail` string for ADMIN-facing feeds only. The admin
// must never see food money (hard rule: "admin sees NO earnings"), but some staff actions
// embed amounts in `detail` — a discount ("₹500"), a closed-unpaid table ("…₹1800 owed"),
// a banquet order ("total 2450"), an edited dish ('"Paneer Tikka" ₹350'). We mask ₹-amounts
// and "total <n>"; plain counts like "2 unpaid orders" are left alone. (The manager's own
// log keeps the money — it's that restaurant's own data.)
export function redactMoney<T>(detail: T): T | string {
  if (typeof detail !== "string") return detail;
  return detail
    .replace(/₹\s?\d[\d,]*(?:\.\d+)?/g, "₹•••")
    .replace(/\btotal\s+\d[\d,]*(?:\.\d+)?/gi, "total •••");
}

// "manager" is the new name for the old "editor" panel (rename is a later task);
// both are accepted so login/audit rows tag correctly during the transition.
type Panel = "editor" | "manager" | "kitchen" | "tablet" | "admin" | "owner";
type Fields = {
  table_number?: string | null;
  order_id?: string | null;
  detail?: string | null;
  // WHICH device did it (the per-device cookie id). Read from the request by the
  // route handler and passed in, so the Operation log can name the exact tablet.
  device_id?: string | null;
  // WHO did it — the staff member's name/id. Empty for now (no per-staff login
  // yet). When the owner wires up login, pass the logged-in user's name here and
  // it shows up in the Operation log automatically. See migration 053 (the
  // staff_actions.actor column) — this is the ready "who" slot.
  actor?: string | null;
  // WHO did it, as a STABLE id (the acting staff user's uuid). Preferred over `actor`
  // (a display name) for reliable attribution — the admin owner-activity feed matches on it.
  actor_id?: string | null;
  // WHICH restaurant the action belongs to (multi-tenant). OMIT it and the row keeps the
  // table's DEFAULT (#1); pass a value on multi-restaurant actions; pass an explicit `null`
  // for platform-level actions (e.g. creating/renaming an owner) so they don't pollute #1's log.
  restaurant_id?: string | null;
  // SEVERITY (mig 159). Defaults to 'info' at the DB level, so existing callers are unchanged.
  // 'warn' = notable but not broken (a repair action, a manual DB edit); 'error' = something
  // failed. Error rows show red in the admin log and drive the alert / nightly-fix tooling.
  level?: "info" | "warn" | "error";
};

export async function logAction(panel: Panel, action: string, fields: Fields = {}): Promise<void> {
  try {
    await sb.from("staff_actions").insert({
      panel,
      action,
      table_number: fields.table_number ?? null,
      order_id: fields.order_id ?? null,
      detail: fields.detail ?? null,
      device_id: fields.device_id ?? null,
      actor: fields.actor ?? null,
      actor_id: fields.actor_id ?? null,
      // restaurant_id: omit (or pass undefined) → column DEFAULT (#1), unchanged for the many
      // single-restaurant callers; a value scopes it; an explicit `null` records a platform-level
      // action (mig 156 made the column nullable). Using !== undefined (not `in`) so a stray
      // undefined keeps the old default-#1 behaviour instead of flipping to null.
      ...(fields.restaurant_id !== undefined ? { restaurant_id: fields.restaurant_id } : {}),
      ...(fields.level ? { level: fields.level } : {}),
    });
  } catch {
    /* never let logging break the real action */
  }
}

// logError — record an ERROR-level diary line (level='error') when something in the app
// throws or fails. Same fire-and-forget contract as logAction: it must NEVER itself throw or
// block the real request, so it swallows everything. The message is truncated (a stack/PostgREST
// error can be huge and we only need the gist to know where to look). Call it from the top-level
// catch of a route handler, or any place a real failure is swallowed.
//
// After writing the row it fires an optional owner alert (Phase 3, lib/alerts.ts) — imported
// lazily so this module has no hard dependency on the alert layer.
export async function logError(
  panel: Panel | "db" | "guest",
  action: string,
  err: unknown,
  fields: Omit<Fields, "level"> = {},
): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err ?? "unknown error");
  const detail = `${fields.detail ? fields.detail + " — " : ""}${msg}`.slice(0, 500);
  try {
    await sb.from("staff_actions").insert({
      // panel is a free-text column; 'db'/'guest' are valid tags for non-staff origins.
      panel,
      action,
      table_number: fields.table_number ?? null,
      order_id: fields.order_id ?? null,
      detail,
      device_id: fields.device_id ?? null,
      actor: fields.actor ?? null,
      actor_id: fields.actor_id ?? null,
      level: "error",
      ...(fields.restaurant_id !== undefined ? { restaurant_id: fields.restaurant_id } : {}),
    });
  } catch {
    /* never let error-logging break the request */
  }
  // Best-effort outbound alert (grouped, non-blocking). Wrapped so a missing/errored alert
  // layer can't affect the request.
  try {
    const { sendOwnerAlert, alertText } = await import("@/lib/alerts");
    // Structured like every other alert (owner 2026-07-29) — headline, then labelled facts.
    // No extra DB read here on purpose: an error can arrive in bursts, so the restaurant NAME is
    // left to the bell / Everything Log rather than paid for on every error.
    const body = alertText([
      ["Action", String(action).replace(/_/g, " ")],
      ["Problem", msg.slice(0, 160)],
      ["Who", fields.actor ?? null],
    ], "Open admin → Logs to see the full detail.");
    await sendOwnerAlert(body, `${panel}:${action}`, { title: `Something went wrong in ${panel}`, tags: "warning" });
  } catch {
    /* alert layer optional / best-effort */
  }
}

// deviceIdFrom: pull the per-device id out of the request's cookies (set by
// /panels/maint.js on every staff panel). Returns null when absent.
// NB: the cookie is "lfh_panel_device" — deliberately NOT "lfh_device_id",
// which lib/device.ts already uses (localStorage) for the guest rating brake.
export function deviceIdFrom(req: { cookies: { get(name: string): { value: string } | undefined } }): string | null {
  return req.cookies.get("lfh_panel_device")?.value ?? null;
}

// deviceBlocked: true if this staff device has been blocked (a blocklist row
// carries its device_id). Used by the tablet/kitchen APIs to refuse a blocked
// device. Fail-open (returns false on error) so a transient DB hiccup never
// locks every device out.
export async function deviceBlocked(deviceId: string | null): Promise<boolean> {
  if (!deviceId) return false;
  try {
    const { data } = await sb.from("blocklist").select("id").eq("device_id", deviceId).limit(1);
    return !!(data && data.length);
  } catch {
    return false;
  }
}
