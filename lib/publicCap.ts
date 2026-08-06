// lib/publicCap.ts — ONE place for "how often has this caller done this?" on PUBLIC endpoints.
//
// WHY (T9 improvement 18, 2026-08-06). Four public endpoints each grew their own ceiling, in four
// different shapes:
//   · /api/log/client-error — counts the caller's own recent rows in `staff_actions` (10 min).
//   · /api/guest/limit-hit  — an in-process window (added 2026-08-06).
//   · /api/blocked          — a per-IP DAILY cap counted in `unblock_requests`.
//   · /api/staff-login      — an IP LOCKOUT (lib/loginThrottle, mig 151).
// The result was that the newest public endpoint had no ceiling at all until someone noticed, which
// is exactly how /api/guest/limit-hit ended up as the one public path that can reach the owner's
// phone with nothing counting it.
//
// WHAT IS SHARED HERE, and what deliberately is NOT:
//   SHARED — the two general shapes below, plus `capKeyFor()`, which is the single decision about
//   WHO a caller is. A new public endpoint gets a ceiling by adding one line.
//   NOT SHARED — `/api/staff-login`'s lockout and `/api/blocked`'s daily quota. Those are not
//   "how often lately", they are "you are locked out for N minutes" and "you may file 3 requests a
//   day, ever". Folding genuinely different rules into one helper is how a limiter starts lying about
//   which rule it is applying. They keep their own code and are cross-referenced from it.
import type { NextRequest } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { clientIp } from "@/lib/loginThrottle";

/**
 * WHO is calling, for counting purposes. The per-panel device cookie when there is one, else the
 * IP derived from proxy headers SERVER-side.
 *
 * Never a body field: a caller must not be able to choose which bucket it is counted in. That is the
 * whole reason this lives in one function instead of being re-derived per route.
 */
export function capKeyFor(req: NextRequest): string {
  return req.cookies.get("lfh_panel_device")?.value || `ip:${clientIp(req)}`;
}

/**
 * How many rows this caller already wrote for one `action` inside `windowMs`, capped at `max` so the
 * read itself is bounded.
 *
 * Backed by `idx_staff_actions_device_action_created` (migration 305) — before that index this query
 * walked the whole platform's last ten minutes and filtered in memory, so the guard protecting the
 * database was the most expensive part of a public request.
 *
 * Fails OPEN (returns 0) on a read error: a counter that cannot be read must not block a real crash
 * report from being recorded. The row cap is a safety net, not a gate.
 */
export async function recentActionCount(
  capKey: string,
  action: string,
  windowMs: number,
  max: number,
): Promise<number> {
  try {
    const since = new Date(Date.now() - windowMs).toISOString();
    const { data, error } = await sb
      .from("staff_actions")
      .select("id")
      .eq("device_id", capKey)
      .eq("action", action)
      .gte("created_at", since)
      .limit(max);
    if (error) return 0;
    return data?.length ?? 0;
  } catch {
    return 0;
  }
}

/** True when this caller is still under `max` for `action` in the window. */
export async function underActionCap(capKey: string, action: string, windowMs: number, max: number): Promise<boolean> {
  return (await recentActionCount(capKey, action, windowMs, max)) < max;
}

// ── the in-process window, for a beacon too cheap to justify a database read ─────────────────────
//
// Used by /api/guest/limit-hit, whose whole job is to be nearly free. The honest limitation: a
// serverless platform runs several instances, so the effective ceiling is per instance — which still
// turns "unbounded" into "a small multiple of the window", at no cost. Anything that needs a real
// platform-wide ceiling must use the counted version above.
const MAX_TRACKED = 5000;                        // hard bound on the map itself
const windows = new Map<string, { n: number; at: number }>();

export function withinMemoryCap(key: string, windowMs: number, max: number): boolean {
  const now = Date.now();
  // Opportunistic sweep so the map can never grow without limit on a long-lived instance.
  if (windows.size > MAX_TRACKED) {
    for (const [k, v] of windows) if (now - v.at > windowMs) windows.delete(k);
    if (windows.size > MAX_TRACKED) windows.clear();   // pathological: start the window over
  }
  const hit = windows.get(key);
  if (!hit || now - hit.at > windowMs) { windows.set(key, { n: 1, at: now }); return true; }
  hit.n += 1;
  return hit.n <= max;
}
