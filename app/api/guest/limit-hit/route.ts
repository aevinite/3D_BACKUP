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
import { capKeyFor, withinMemoryCap } from "@/lib/publicCap";

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

// ── A CEILING, BECAUSE THIS ONE REACHES THE OWNER'S PHONE ────────────────────────────────────────
//
// This endpoint is public, takes a body, and can end in an owner push notification. It had no cap of
// any kind — while its next-door neighbour /api/log/client-error, public in exactly the same way, was
// hardened TWICE for this. The mitigations that already existed still stand: pingLatestGuestLimit
// only pings when a genuine OPEN rate_limit_events row exists from the last two minutes, the alert
// text comes from that DB row (so a caller cannot compose an alert), and sendOwnerAlert dedupes for
// 15 minutes. But each call is still a database LOOKUP, so the volume needs a bound of its own.
//
// The window itself now lives in lib/publicCap (T9 improvement 18): one place decides WHO a caller is
// and holds both cap shapes, so the next public endpoint gets a ceiling in one line instead of
// growing a fifth hand-rolled version.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 6;

export async function POST(req: NextRequest) {
  let b: { fn?: string; rid?: string } = {};
  try { b = await req.json(); } catch { /* empty body → no-op below */ }
  const key = FN_TO_KEY[String(b.fn || "")];
  if (key) {
    const rid = typeof b.rid === "string" && UUID.test(b.rid) ? b.rid : null;
    // The device cookie when the panel set one, else the server-derived IP — NEVER a body field, so a
    // caller cannot choose which bucket it is counted in. Same rule as /api/log/client-error's capKey.
    // capKeyFor: the device cookie else the server-derived IP — never a body field, so a caller
    // cannot choose its own bucket. Keyed per limit too, so tripping the order limit can't use up the
    // waiter-call beacon's budget.
    if (withinMemoryCap(`limithit:${key}:${capKeyFor(req)}`, WINDOW_MS, MAX_PER_WINDOW)) {
      await pingLatestGuestLimit(key, rid); // best-effort; only pings on a real recent event
    }
  }
  // Always 200 — the beacon must never surface an error to a diner (that is why it exists).
  return NextResponse.json({ ok: true });
}
