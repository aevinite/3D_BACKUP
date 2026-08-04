// Guest place-order — server passthrough used ONLY for OFFLINE-REPLAY of a guest
// order (offline sync feature, 2026-07-07). The ONLINE guest flow is unchanged: it
// still calls the anon RPCs directly from the browser (lib/session.ts / lib/menu.ts).
//
// When the guest was offline, lib/guestOutbox.ts saves the order on-device and, on
// reconnect, POSTs it here with an `X-LFH-Action-Id`. This handler is wrapped with
// withIdempotency (the same at-most-once guard the staff panels use, migration 138),
// so a replay that arrives twice places the order ONCE — never a duplicate order.
//
// Both place-order RPCs are SECURITY DEFINER and purely parameter-driven (identity
// via p_token / restaurant via p_restaurant_id), so calling them with the service
// role here behaves identically to the browser's anon call.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { withIdempotency } from "@/lib/idempotency";
import { pingLatestGuestLimit } from "@/lib/rateLimit";
import { replayClash, clashJson } from "@/lib/clash";
import { offPlanTable } from "@/lib/planTable";
import { invalidateFloor } from "@/lib/floorSummary";

export const dynamic = "force-dynamic";

const DEFAULT_RID = "00000000-0000-0000-0000-000000000001";
const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// A replayed offline order can still trip the guest_order limit inside the RPC. The online path
// pings via the client beacon, but this server route bypasses it — so ping here too. Best-effort.
//
// `rid` MATTERS and must be the order's own restaurant. With an empty one the helper drops its
// restaurant filter and pings on the newest open guest_order event anywhere in the last two
// minutes — so a replay at one restaurant could buzz a different owner's phone about an event
// that had nothing to do with it. Session mode now sends its restaurant too, for exactly this.
function maybePing(data: unknown, rid: string): void {
  if (data && typeof data === "object" && (data as { reason?: string }).reason === "rate_limited") {
    void pingLatestGuestLimit("guest_order", rid);
  }
}

// A dish that reaches the kitchen changes the floor, so the shared 1.5s snapshot must be dropped
// or a manager reloading right after can be handed a floor computed before this order existed.
// Only for a real placement — a refusal changed nothing.
function dropFloorIfPlaced(data: unknown, rid: string): void {
  if (rid && data && typeof data === "object" && (data as { ok?: unknown }).ok !== false) invalidateFloor(rid);
}

type Body = {
  mode?: "session" | "public";
  token?: string;
  table?: string;
  restaurantId?: string;
  items?: unknown[];
  allergies?: string[];
};

async function postImpl(req: NextRequest): Promise<Response> {
  let b: Body;
  try { b = (await req.json()) as Body; } catch { return NextResponse.json({ ok: false, reason: "bad_body" }, { status: 400 }); }
  const items = Array.isArray(b.items) ? b.items : [];
  const allergies = Array.isArray(b.allergies) ? b.allergies : [];

  if (b.mode === "session") {
    if (!b.token) return NextResponse.json({ ok: false, reason: "invalid_token" }, { status: 400 });
    const { data, error } = await sb.rpc("lfh_place_order", { p_token: b.token, p_items: items, p_allergies: allergies });
    // NEVER hand the database's own words to a diner. `error.message` ends up in the phone's
    // "couldn't send" list verbatim, which is meaningless to them and internal to us. The code
    // below is what lib/guestOutbox.ts knows how to word; the detail stays in the server log.
    if (error) { console.error("[guest/place-order] session RPC failed:", error.message); return NextResponse.json({ ok: false, reason: "server_busy" }, { status: 502 }); }
    // The restaurant is only used to SCOPE the limit ping — identity still comes from the token,
    // so a wrong value here can never place an order anywhere.
    const sessionRid = isUuid(b.restaurantId) ? (b.restaurantId as string) : "";
    maybePing(data, sessionRid);
    dropFloorIfPlaced(data, sessionRid);
    return NextResponse.json(data ?? { ok: false, reason: "empty" });
  }

  // Non-session (QR/public) order. This is the one path that needs the clash check:
  // it takes a TABLE NUMBER, so a phone that was offline for twenty minutes could put its
  // order onto whoever is sitting at that table NOW, or onto a bill that has already been
  // settled. (The session path above doesn't need it — lfh_place_order validates the
  // guest's own session token and answers `session_closed` itself.)
  // WHICH RESTAURANT. This used to fall back to restaurant #1 whenever the field was missing,
  // which on a stack serving many restaurants quietly puts a real order — and its money — on the
  // wrong restaurant's floor and books. A saved order that lost its restaurant is refused instead
  // and shown to the diner. The fallback is kept ONLY for a body that names no restaurant at all,
  // which is the single-restaurant shape this route shipped with; a malformed value is refused.
  const publicRid = b.restaurantId === undefined ? DEFAULT_RID : (isUuid(b.restaurantId) ? b.restaurantId : "");
  if (!publicRid) return NextResponse.json({ ok: false, reason: "unknown_restaurant" }, { status: 400 });
  // A QR that encodes a nonsense table must not create an order nobody can reach on the floor.
  // A CODE, not the helper's sentence: the client owns the wording (lib/guestOutbox.ts
  // reasonMsg), and the helper's text names the restaurant's table count, which is a staff
  // detail rather than something to put in front of a diner.
  const offPlan = await offPlanTable(publicRid, b.table);
  if (offPlan) return NextResponse.json({ ok: false, reason: "off_plan_table" }, { status: 400 });
  const clash = await replayClash(req, publicRid, "order", undefined, undefined, { table: b.table });
  if (clash) return clashJson(clash);

  const { data, error } = await sb.rpc("lfh_place_order_public", {
    p_table: b.table || "",
    p_items: items,
    p_allergies: allergies,
    p_restaurant_id: publicRid,
  });
  if (error) { console.error("[guest/place-order] public RPC failed:", error.message); return NextResponse.json({ ok: false, reason: "server_busy" }, { status: 502 }); }
  maybePing(data, publicRid);
  dropFloorIfPlaced(data, publicRid);
  return NextResponse.json(data ?? { ok: false, reason: "empty" });
}

// At-most-once on replay (see lib/idempotency.ts). No X-LFH-Action-Id header → runs normally.
export const POST = withIdempotency(postImpl, "guest");
