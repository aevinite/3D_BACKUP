// Guest call-waiter — the server door used ONLY for an OFFLINE-REPLAYED call (improvement #4,
// 2026-08-06). The online flow is unchanged: the browser still calls the anon RPC directly
// (lib/menu.ts callWaiter), exactly as it always has.
//
// WHY THIS EXISTS. Until now the ONLY guest action that survived losing signal was placing an
// order. Calling a waiter — the thing a diner does when something is WRONG — simply failed, and
// it is the request most likely to be made from the corner of the room with no bars. Now it is
// saved on the phone and delivered on reconnect, through this route so the same at-most-once
// guard the orders use applies: a replay that arrives twice must not ring the floor twice.
//
// The RPC is SECURITY DEFINER and purely parameter-driven, so calling it with the service role
// here behaves identically to the browser's anon call — same throttle, same block-list, same
// pile-up cap. Nothing is trusted from the client beyond what the RPC itself validates.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { withIdempotency } from "@/lib/idempotency";
import { offPlanTable } from "@/lib/planTable";
import { invalidateFloor } from "@/lib/floorSummary";

export const dynamic = "force-dynamic";

const DEFAULT_RID = "00000000-0000-0000-0000-000000000001";
const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// A call this old is not worth ringing the floor for. The diner asked twenty minutes ago; a
// waiter walking over now, for something nobody remembers, is worse than not going — and the
// phone tells them plainly rather than pretending it was delivered. Kept in step with the same
// constant on the device (lib/guestOutbox.ts STALE_CALL_MS), which is where it is usually caught
// first; this is the half that does not depend on the phone getting it right.
const STALE_CALL_MS = 10 * 60 * 1000;

type Body = {
  mode?: "session" | "public";
  token?: string;
  table?: string;
  restaurantId?: string;
  reason?: string;
  /** When the diner actually tapped it — not when the phone got round to sending. */
  at?: number;
};

async function postImpl(req: NextRequest): Promise<Response> {
  let b: Body;
  try { b = (await req.json()) as Body; } catch { return NextResponse.json({ ok: false, reason: "bad_body" }, { status: 400 }); }

  // TOO LATE TO BE USEFUL. Answered as a plain refusal (not an error) so the phone stops
  // retrying it and can say something true to the person.
  const at = Number(b.at || 0);
  if (at && Date.now() - at > STALE_CALL_MS) return NextResponse.json({ ok: false, reason: "call_too_old" });

  const reason = String(b.reason || "").slice(0, 200);

  if (b.mode === "session") {
    if (!b.token) return NextResponse.json({ ok: false, reason: "invalid_token" }, { status: 400 });
    const { data, error } = await sb.rpc("lfh_call_waiter", { p_token: b.token, p_reason: reason });
    // The database's own words never travel to a diner — a code does, and lib/guestOutbox.ts owns
    // the sentence. Same rule as place-order.
    if (error) { console.error("[guest/call-waiter] session RPC failed:", error.message); return NextResponse.json({ ok: false, reason: "server_busy" }, { status: 502 }); }
    const rid = isUuid(b.restaurantId) ? (b.restaurantId as string) : "";
    if (rid) invalidateFloor(rid);   // a raised hand changes the floor
    return NextResponse.json(data ?? { ok: false, reason: "empty" });
  }

  // QR / table-number path. Same restaurant rule as place-order: the legacy single-restaurant
  // shape (no field at all) falls back to #1, but a malformed value is refused rather than
  // quietly ringing a different restaurant's floor.
  const rid = b.restaurantId === undefined ? DEFAULT_RID : (isUuid(b.restaurantId) ? b.restaurantId : "");
  if (!rid) return NextResponse.json({ ok: false, reason: "unknown_restaurant" }, { status: 400 });
  if (await offPlanTable(rid, b.table)) return NextResponse.json({ ok: false, reason: "off_plan_table" }, { status: 400 });

  const { data, error } = await sb.rpc("lfh_call_waiter_table", {
    p_table: b.table || null,
    p_note: reason || null,
    p_restaurant_id: rid,
  });
  if (error) { console.error("[guest/call-waiter] public RPC failed:", error.message); return NextResponse.json({ ok: false, reason: "server_busy" }, { status: 502 }); }
  invalidateFloor(rid);
  return NextResponse.json(data ?? { ok: false, reason: "empty" });
}

// At-most-once on replay, so a call delivered twice rings the floor once (lib/idempotency.ts).
export const POST = withIdempotency(postImpl, "guest");
