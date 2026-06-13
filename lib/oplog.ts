// Operation-log helper. Route handlers call logAction(...) after a staff action
// so the "Operation log" shows who-did-what. Fire-and-forget: a logging failure
// must never break the actual action, so it's wrapped in try/catch.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

type Panel = "editor" | "kitchen" | "tablet" | "admin";
type Fields = {
  table_number?: string | null;
  order_id?: string | null;
  detail?: string | null;
  // WHICH device did it (the per-device cookie id). Read from the request by the
  // route handler and passed in, so the Operation log can name the exact tablet.
  device_id?: string | null;
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
    });
  } catch {
    /* never let logging break the real action */
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
