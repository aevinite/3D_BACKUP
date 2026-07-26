// Server-side rate limiting (migration 205). One call → lfh_rate_check counts a fixed window in
// the DB and returns whether this attempt is allowed. When a limit is reached it also records an
// event that surfaces in the admin Problems section (Fix / Change-limit / Allow).
//
// FAIL-OPEN by design: a limiter glitch (DB blip, missing rule) must NEVER lock out real users —
// same principle as the offline idempotency guard. Enforcement RPCs (guest orders) call
// lfh_rate_check directly in SQL; route handlers use rateAllowed() below.
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type RateKey =
  | "guest_order" | "staff_login" | "admin_login" | "manager_pin"
  | "waiter_call" | "join_session" | "otp_request";

/** True = allowed, false = blocked (an "open" event was recorded). Never throws. */
export async function rateAllowed(
  key: RateKey,
  subject: string,
  opts?: { restaurantId?: string | null; label?: string | null },
): Promise<boolean> {
  const subj = (subject || "").trim();
  if (!subj) return true;
  try {
    const { data, error } = await supabaseAdmin.rpc("lfh_rate_check", {
      p_rid: opts?.restaurantId ?? null,
      p_key: key,
      p_subject: subj.slice(0, 200),
      p_label: opts?.label ? opts.label.slice(0, 200) : null,
    });
    if (error) return true; // fail-open
    return data !== false;
  } catch {
    return true; // fail-open
  }
}

/** Normalise a login name so "  Ravi " and "ravi" share one counter. */
export function subjectFor(name: string): string {
  return (name || "").trim().toLowerCase().slice(0, 120);
}
