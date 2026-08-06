// POST /api/guest/limit-hit — public beacon fired by the guest client (lib/session.ts) when a
// database RPC returns { reason: "rate_limited" }. The three guest limits (guest_order, waiter_call,
// join_session) are enforced entirely inside Postgres, so no server route ever sees the hit and the
// owner would get no phone ping. This tiny endpoint closes that gap.
//
// It TRUSTS NOTHING from the body except which limit + restaurant to LOOK UP. pingLatestGuestLimit
// then only pings if a genuine OPEN rate_limit_events row exists (written by lfh_rate_check moments
// ago), and the alert text comes from that DB row — so a client can't fabricate an alert. Always
// returns 200 so the beacon never surfaces an error to the guest.
import { NextRequest, NextResponse } from "next/server";
import { pingLatestGuestLimit, type RateKey } from "@/lib/rateLimit";
import { clientIp } from "@/lib/loginThrottle";   // derives the IP from proxy headers, server-side only

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Map the RPC function name the client saw → the rate-limit key it enforces.
const FN_TO_KEY: Record<string, RateKey> = {
  lfh_place_order: "guest_order",
  lfh_place_order_public: "guest_order",
  lfh_call_waiter: "waiter_call",
  lfh_call_waiter_table: "waiter_call",
  lfh_join_session: "join_session",
};

// ── A CEILING, BECAUSE THIS ONE REACHES THE OWNER'S PHONE (T9 sweep, 2026-08-06) ─────────────────
//
// This endpoint is public, takes a body, and can end in an owner push notification. It had no cap of
// any kind — while its next-door neighbour /api/log/client-error, public in exactly the same way, was
// hardened TWICE for this (a per-device cap on 2026-08-04, then a separate ceiling for the `taps`
// branch on 2026-08-05 because that half "returned before reaching it").
//
// The existing mitigations are real and stay: `pingLatestGuestLimit` only pings when a genuine OPEN
// rate_limit_events row exists from the last two minutes, the alert text comes from that DB row (so a
// caller cannot compose an alert), and sendOwnerAlert dedupes for 15 minutes. But each call is still a
// database LOOKUP, not a no-op, so the volume needs a bound of its own.
//
// Deliberately IN-MEMORY rather than a new table or a counter row: a beacon must stay cheap, and the
// thing being bounded is lookups-per-caller-per-minute. The honest limitation is that a serverless
// platform runs several instances, so the effective ceiling is per instance — which still turns
// "unbounded" into "a small multiple of WINDOW", and costs nothing. A guest who legitimately trips a
// limit fires this once or twice; MAX_PER_WINDOW is generous next to that.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 6;
const MAX_TRACKED = 5000;                      // hard bound on the map itself
const seen = new Map<string, { n: number; at: number }>();

function withinCap(callerKey: string): boolean {
  const now = Date.now();
  // Opportunistic sweep so the map can never grow without limit, even if one instance lives for days.
  if (seen.size > MAX_TRACKED) {
    for (const [k, v] of seen) if (now - v.at > WINDOW_MS) seen.delete(k);
    if (seen.size > MAX_TRACKED) seen.clear();  // pathological: start the window over rather than grow
  }
  const hit = seen.get(callerKey);
  if (!hit || now - hit.at > WINDOW_MS) { seen.set(callerKey, { n: 1, at: now }); return true; }
  hit.n += 1;
  return hit.n <= MAX_PER_WINDOW;
}

export async function POST(req: NextRequest) {
  let b: { fn?: string; rid?: string } = {};
  try { b = await req.json(); } catch { /* empty body → no-op below */ }
  const key = FN_TO_KEY[String(b.fn || "")];
  if (key) {
    const rid = typeof b.rid === "string" && UUID.test(b.rid) ? b.rid : null;
    // The device cookie when the panel set one, else the server-derived IP — NEVER a body field, so a
    // caller cannot choose which bucket it is counted in. Same rule as /api/log/client-error's capKey.
    const callerKey = req.cookies.get("lfh_panel_device")?.value || `ip:${clientIp(req)}`;
    // Keyed per limit too, so tripping the order limit can't use up the waiter-call beacon's budget.
    if (withinCap(`${key}:${callerKey}`)) {
      await pingLatestGuestLimit(key, rid); // best-effort; only pings on a real recent event
    }
  }
  // Always 200 — the beacon must never surface an error to a diner (that is why it exists).
  return NextResponse.json({ ok: true });
}
