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

export const dynamic = "force-dynamic";

const DEFAULT_RID = "00000000-0000-0000-0000-000000000001";

// A replayed offline order can still trip the guest_order limit inside the RPC. The online path
// pings via the client beacon, but this server route bypasses it — so ping here too. Best-effort.
function maybePing(data: unknown, rid: string): void {
  if (data && typeof data === "object" && (data as { reason?: string }).reason === "rate_limited") {
    void pingLatestGuestLimit("guest_order", rid);
  }
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
    if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 502 });
    maybePing(data, ""); // session mode: rid unknown → helper scans recent guest_order events
    return NextResponse.json(data ?? { ok: false, reason: "empty" });
  }

  // Non-session (QR/public) order.
  const { data, error } = await sb.rpc("lfh_place_order_public", {
    p_table: b.table || "",
    p_items: items,
    p_allergies: allergies,
    p_restaurant_id: b.restaurantId || DEFAULT_RID,
  });
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 502 });
  maybePing(data, b.restaurantId || DEFAULT_RID);
  return NextResponse.json(data ?? { ok: false, reason: "empty" });
}

// At-most-once on replay (see lib/idempotency.ts). No X-LFH-Action-Id header → runs normally.
export const POST = withIdempotency(postImpl, "guest");
