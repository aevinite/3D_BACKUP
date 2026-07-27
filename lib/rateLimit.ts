// Server-side rate limiting (migration 205). One call → lfh_rate_check counts a fixed window in
// the DB and returns whether this attempt is allowed. When a limit is reached it also records an
// event that surfaces in the admin Problems section (Fix / Change-limit / Allow).
//
// FAIL-OPEN by design: a limiter glitch (DB blip, missing rule) must NEVER lock out real users —
// same principle as the offline idempotency guard. Enforcement RPCs (guest orders) call
// lfh_rate_check directly in SQL; route handlers use rateAllowed() below.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendOwnerAlert } from "@/lib/alerts";

export type RateKey =
  | "guest_order" | "staff_login" | "admin_login" | "manager_pin"
  | "waiter_call" | "join_session" | "otp_request";

// Friendly names for the phone ping (the DB rule labels aren't loaded here).
const RATE_LABELS: Record<string, string> = {
  guest_order: "Guest orders", staff_login: "Staff / owner login", admin_login: "Admin login",
  manager_pin: "Manager PIN", waiter_call: "Waiter calls", join_session: "Join table", otp_request: "OTP requests",
};

// Phone ping (ntfy/Telegram) when a rate limit is reached — same channel as complaints. The owner
// only got a bell entry before, no phone alert (2026-07-27). Dedupe rides on sendOwnerAlert's 15-min
// grouping keyed per (limit, subject), so the same person hitting the same wall pings once, not
// fifty times. Silent when no alert channel is configured. Best-effort — never throws, never blocks.
async function notifyRateHit(key: string, subject: string, label: string | null, hits?: number): Promise<void> {
  try {
    const friendly = RATE_LABELS[key] || key.replace(/_/g, " ");
    const who = label || subject;
    const tail = hits && hits > 0 ? ` (${hits} tries)` : "";
    await sendOwnerAlert(`🚦 Limit reached: ${friendly} · ${who}${tail}`, `ratelimit:${key}:${subject}`);
  } catch { /* alerts are best-effort */ }
}

// Guest SQL-inline path (guest_order / waiter_call / join_session): the limit is enforced entirely
// in Postgres and no TS caller sees the hit, so the guest client fires a lightweight beacon. Here we
// confirm a REAL open event exists (service role) before pinging, and the ping's content comes only
// from that DB row — so a client beacon can never fabricate an alert for a limit that wasn't hit.
export async function pingLatestGuestLimit(key: RateKey, rid: string | null): Promise<void> {
  try {
    const RID0 = "00000000-0000-0000-0000-000000000000";
    let q = supabaseAdmin.from("rate_limit_events")
      .select("key, subject, subject_label, hit_count")
      .eq("key", key).eq("status", "open")
      .gte("last_at", new Date(Date.now() - 2 * 60 * 1000).toISOString())
      .order("last_at", { ascending: false }).limit(1);
    if (rid && rid !== RID0) q = q.eq("restaurant_id", rid);
    const { data } = await q;
    const e = data?.[0];
    if (!e) return; // no genuine recent event → no ping
    await notifyRateHit(e.key, e.subject, e.subject_label ?? null, e.hit_count);
  } catch { /* best-effort */ }
}

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
    const allowed = data !== false;
    if (!allowed) await notifyRateHit(key, subj.slice(0, 200), opts?.label ?? null); // a wall was hit → ping the phone
    return allowed;
  } catch {
    return true; // fail-open
  }
}

/** Normalise a login name so "  Ravi " and "ravi" share one counter. */
export function subjectFor(name: string): string {
  return (name || "").trim().toLowerCase().slice(0, 120);
}

// Record a WARN-ONLY security event (no counter, no block) — used by the admin-login "N wrong
// tries" alert so the admin gets a notification + Problems entry without ever being locked out.
// Surfaces in the bell + Problems (both already read rate_limit_events). Best-effort.
export async function recordAlert(key: string, subject: string, label: string, hitCount: number): Promise<void> {
  try {
    await supabaseAdmin.rpc("lfh_rate_alert", { p_key: key, p_subject: subject.slice(0, 200), p_label: label.slice(0, 200), p_hit: hitCount });
    await notifyRateHit(key, subject.slice(0, 200), label, hitCount); // phone ping (grouped 15 min per ip)
  } catch { /* best-effort — never break login */ }
}
