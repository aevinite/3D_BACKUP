// lib/loginThrottle.ts — brute-force lockout for login surfaces that aren't a
// staff_users row (the shared ADMIN password and the manager PIN). Staff ACCOUNTS
// already self-lock via staff_users.failed_count/locked_until (migration 055); this
// is the same idea for the two surfaces that had no row to count against.
//
// Backed by the `login_throttle` table (migration 143). A `key` names what+where is
// being guessed, e.g. "admin:<ip>" or "pin:<restaurant_id>:<device>". This is the
// LOGIN path (rare, never polled) so the extra read+write is negligible and stays
// off every hot/realtime path.
//
// FAIL-OPEN by design: if the throttle DB itself errors we must never lock out a
// legitimate user, so every helper swallows errors — matching deviceBlocked() in
// lib/oplog.ts. The slow PBKDF2 hash + generic error message remain the baseline
// deterrents; this just adds the lockout speed-bump on top.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

export type ThrottleStatus = { locked: boolean; retryMs: number };

// Is this key currently locked out? retryMs = how long until it clears (0 if open).
export async function throttleStatus(key: string): Promise<ThrottleStatus> {
  try {
    const { data } = await sb
      .from("login_throttle")
      .select("locked_until")
      .eq("key", key)
      .limit(1);
    const until = data?.[0]?.locked_until ? new Date(data[0].locked_until).getTime() : 0;
    const retryMs = until - Date.now();
    return retryMs > 0 ? { locked: true, retryMs } : { locked: false, retryMs: 0 };
  } catch {
    return { locked: false, retryMs: 0 }; // fail-open
  }
}

// Record ONE wrong try. Past `maxFails` consecutive misses, lock the key for
// `lockMs` and reset the counter (so the next window starts clean), exactly like
// the staff_users lockout. Fire-and-forget from the caller's point of view.
export async function throttleFail(key: string, maxFails: number, lockMs: number): Promise<void> {
  try {
    const { data } = await sb
      .from("login_throttle")
      .select("fail_count")
      .eq("key", key)
      .limit(1);
    const next = (data?.[0]?.fail_count || 0) + 1;
    const row: { key: string; fail_count: number; locked_until: string | null; updated_at: string } =
      next >= maxFails
        ? { key, fail_count: 0, locked_until: new Date(Date.now() + lockMs).toISOString(), updated_at: new Date().toISOString() }
        : { key, fail_count: next, locked_until: null, updated_at: new Date().toISOString() };
    await sb.from("login_throttle").upsert(row, { onConflict: "key" });
  } catch {
    /* fail-open: never let a throttle write break the login flow */
  }
}

// A correct entry clears the key so the counter never carries over between sessions.
export async function throttleReset(key: string): Promise<void> {
  try {
    await sb.from("login_throttle").delete().eq("key", key);
  } catch {
    /* fail-open */
  }
}

// Best-effort client IP from the proxy headers Vercel/Next set. Only used to KEY the
// throttle + label the audit log — never for trust decisions. Falls back to
// "unknown" so a missing header still shares one bucket rather than throwing.
export function clientIp(req: { headers: { get(name: string): string | null } }): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}
