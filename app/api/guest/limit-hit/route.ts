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

export async function POST(req: NextRequest) {
  let b: { fn?: string; rid?: string } = {};
  try { b = await req.json(); } catch { /* empty body → no-op below */ }
  const key = FN_TO_KEY[String(b.fn || "")];
  if (key) {
    const rid = typeof b.rid === "string" && UUID.test(b.rid) ? b.rid : null;
    await pingLatestGuestLimit(key, rid); // best-effort; only pings on a real recent event
  }
  return NextResponse.json({ ok: true });
}
