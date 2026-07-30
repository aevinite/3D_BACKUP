// billCustomer.ts — the customer a bill is made out to (owner, 2026-07-30).
//
// "Bill can't be generated without name and phone number." That rule is enforced HERE,
// on the server, so both the manager panel and the waiter tablet obey it and a stale
// page or a direct call can't slip past the UI. Whether those details then PRINT on the
// paper is a SEPARATE per-restaurant switch (settings.bill_customer_print) read by the
// panels — capturing and printing are deliberately not the same decision.
//
// Storage + normalisation live in migration 227 (lfh_bill_customer_save / lfh_phone10):
// the pair is written onto the session (so an issued invoice keeps its own copy forever),
// the customer directory is upserted so the NEXT bill for that number auto-fills the name,
// and one visit per bill is recorded.
import type { SupabaseClient } from "@supabase/supabase-js";

export type BillCustomerOutcome =
  | { ok: true; saved: boolean; visits?: number }
  | { ok: false; message: string };

type SettingsRow = { bill_customer_required?: boolean | null; bill_customer_print?: boolean | null };

/** Does this restaurant refuse to issue a bill without the customer's mobile + name? */
export async function billCustomerRequired(sb: SupabaseClient, rid: string): Promise<boolean> {
  const { data } = await sb
    .from("settings")
    .select("bill_customer_required")
    .eq("restaurant_id", rid)
    .maybeSingle();
  // No settings row at all = an unconfigured restaurant. Fail OPEN: a missing config row
  // must never be the reason a restaurant cannot bill a table.
  if (!data) return false;
  return (data as SettingsRow).bill_customer_required !== false;
}

/**
 * Validate + store the customer for one bill. Called on the invoice-generation path
 * BEFORE the number is assigned, so an invoice never exists without its customer.
 * Returns a plain message the panel can show as-is.
 */
export async function saveBillCustomer(
  sb: SupabaseClient,
  rid: string,
  sessionId: string,
  body: unknown,
): Promise<BillCustomerOutcome> {
  const b = (body || {}) as Record<string, unknown>;
  const phone = String(b.cust_phone ?? "").replace(/\D/g, "").slice(0, 15);
  const name = String(b.cust_name ?? "").trim().slice(0, 80);
  const required = await billCustomerRequired(sb, rid);

  if (!phone && !name) {
    if (required) return { ok: false, message: "Add the customer's mobile number and name before generating this bill." };
    return { ok: true, saved: false };
  }
  if (!phone) return { ok: false, message: "The customer's mobile number is missing." };
  if (phone.length < 10) return { ok: false, message: "That mobile number is too short — 10 digits, please." };
  if (!name) return { ok: false, message: "The customer's name is missing." };

  const { data, error } = await sb.rpc("lfh_bill_customer_save", {
    p_restaurant_id: rid,
    p_session: sessionId,
    p_phone: phone,
    p_name: name,
  });
  if (error) {
    // Required → the bill must wait rather than be issued to nobody. Not required → the
    // save is a nicety, so a database hiccup shouldn't hold up a table's bill.
    if (required) return { ok: false, message: "Couldn't save the customer: " + error.message };
    return { ok: true, saved: false };
  }
  const res = (data || {}) as { ok?: boolean; reason?: string; visits?: number };
  if (!res.ok) {
    const msg = res.reason === "session_not_found"
      ? "That table's bill couldn't be found."
      : "The customer's mobile number and name are both needed.";
    return required ? { ok: false, message: msg } : { ok: true, saved: false };
  }
  return { ok: true, saved: true, visits: res.visits };
}
