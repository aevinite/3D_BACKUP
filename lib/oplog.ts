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
// /panels/maint.js on every panel). Returns null when absent.
export function deviceIdFrom(req: { cookies: { get(name: string): { value: string } | undefined } }): string | null {
  return req.cookies.get("lfh_device_id")?.value ?? null;
}
