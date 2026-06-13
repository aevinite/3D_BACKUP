// Operation-log helper. Route handlers call logAction(...) after a staff action
// so the "Operation log" shows who-did-what. Fire-and-forget: a logging failure
// must never break the actual action, so it's wrapped in try/catch.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

type Panel = "editor" | "kitchen" | "tablet" | "admin";
type Fields = { table_number?: string | null; order_id?: string | null; detail?: string | null };

export async function logAction(panel: Panel, action: string, fields: Fields = {}): Promise<void> {
  try {
    await sb.from("staff_actions").insert({
      panel,
      action,
      table_number: fields.table_number ?? null,
      order_id: fields.order_id ?? null,
      detail: fields.detail ?? null,
    });
  } catch {
    /* never let logging break the real action */
  }
}
