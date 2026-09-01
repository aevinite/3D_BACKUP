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
// The restaurant the RPC itself says this order landed on. `lfh_place_order` resolves it from the
// session token, so it is the one value that cannot be wrong — unlike the body field, which an old
// saved order may not carry at all (T9 finding F20).
function ridFromResult(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const v = (data as Record<string, unknown>).restaurant_id ?? (data as Record<string, unknown>).restaurantId;
  return isUuid(v) ? (v as string) : "";
}

// ── AND WHEN NEITHER THE REPLY NOR THE BODY KNOWS, ASK THE TOKEN (sweep #8 T3, item 4) ───────────
//
// The comment below this used to state, as settled fact, that "`lfh_place_order` returns the
// session's restaurant, and that is the authoritative value". IT DOES NOT. Every version of that
// function down to the newest (migration 357) ends `RETURN json_build_object('ok', true,
// 'order_id', v_order)` — there is no `restaurant_id` in it, and there never was. So
// ridFromResult() above has always answered "" for a session order, the route has always fallen
// back to the phone's own field, and T9's finding F20 — "a replayed order reached the kitchen while
// a manager reloading inside the shared 1.5s window could be handed a floor computed before it
// existed" — was never actually closed for the body it was written about: one saved by a build old
// enough not to carry `restaurantId`.
//
// This is what the reply cannot tell us and the token can. The route already holds the service-role
// client, and a session token maps to exactly one restaurant, so ONE narrow read settles it:
// two single-row lookups, each column-listed and capped, and ONLY on the path where both cheaper
// answers came back empty — so the ordinary replay, which does carry the field, makes no extra read
// at all. ridFromResult stays first in the chain: it costs nothing and becomes the right answer for
// free if that function is ever given the field.
async function ridFromToken(token: string | undefined): Promise<string> {
  if (!token) return "";
  try {
    const m = await sb.from("session_members").select("session_id").eq("token", token).limit(1).maybeSingle();
    const sid = m.data?.session_id;
    if (!sid) return "";
    const s = await sb.from("sessions").select("restaurant_id").eq("id", sid).limit(1).maybeSingle();
    const rid = s.data?.restaurant_id;
    return isUuid(rid) ? String(rid) : "";
  } catch { return ""; }   // best-effort: a failed lookup must never cost the diner their order
}

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

// ── A SENSIBLE CEILING ON WHAT ONE ORDER MAY CARRY (T9 improvement 7, 2026-08-06) ────────────────
//
// `items` and `allergies` used to be passed through with no size limit at all, and the allergy
// free-text had no length cap on THIS path (the ＋ Other chip stores whatever was typed). A real
// diner never comes near these numbers — the biggest genuine basket on the stack is a few dozen
// lines — but this route accepts a body that was SAVED ON A PHONE and replayed later, so a corrupted
// outbox entry or a buggy client could hand Postgres a huge payload to parse and store.
//
// Deliberately generous, and deliberately a REFUSAL rather than a silent trim: quietly dropping
// lines would send someone food they didn't order, or leave off an allergy they did declare. The
// codes are worded in lib/guestOutbox.ts → reasonMsg.
const MAX_ITEMS = 200;
const MAX_ALLERGIES = 40;
const MAX_ALLERGY_LEN = 200;

// ── "THE KITCHEN IS BUSY — WAIT THIS LONG" (improvement I10, owner 2026-08-12) ────────────────────
//
// A 502 here means the restaurant's server did not answer, and the phone saves the order and retries
// on its own fixed schedule. During a genuine rush that is the worst possible behaviour: every
// waiting phone comes back at the same moment, on the same timer, and lands on the server that was
// already struggling — the retry storm makes the rush it is reacting to worse.
//
// The server knows things the phone cannot: how many replays are in flight and how long the database
// has been unhappy. So it now sends a `retryAfter` (seconds) with the refusal, and the outbox uses it
// as its wait instead of its own constant.
//
// It is a HINT, deliberately, and the phone must still work if it ignores it: an old build that has
// never heard of the field keeps its existing schedule and is exactly as correct as before. The
// jitter is added HERE rather than on the device so a thousand phones get a thousand different
// answers — the whole point is that they stop arriving together.
//
// `reason: "server_busy"` stays spelled out in full: it is the code lib/guestOutbox.ts words for the
// diner, and `npm run verify:order-retry` greps this file for it (it caught this helper hiding it).
function busy(): Response {
  const retryAfter = 20 + Math.floor(Math.random() * 25);   // 20–45s, spread
  return NextResponse.json(
    { ok: false, reason: "server_busy", retryAfter },
    { status: 502, headers: { "Retry-After": String(retryAfter) } },
  );
}

async function postImpl(req: NextRequest): Promise<Response> {
  let b: Body;
  try { b = (await req.json()) as Body; } catch { return NextResponse.json({ ok: false, reason: "bad_body" }, { status: 400 }); }
  const items = Array.isArray(b.items) ? b.items : [];
  const allergies = Array.isArray(b.allergies) ? b.allergies : [];
  if (items.length > MAX_ITEMS) return NextResponse.json({ ok: false, reason: "order_too_big" }, { status: 400 });
  if (allergies.length > MAX_ALLERGIES || allergies.some((a) => typeof a === "string" && a.length > MAX_ALLERGY_LEN)) {
    return NextResponse.json({ ok: false, reason: "allergies_too_long" }, { status: 400 });
  }

  if (b.mode === "session") {
    if (!b.token) return NextResponse.json({ ok: false, reason: "invalid_token" }, { status: 400 });
    const { data, error } = await sb.rpc("lfh_place_order", { p_token: b.token, p_items: items, p_allergies: allergies });
    // NEVER hand the database's own words to a diner. `error.message` ends up in the phone's
    // "couldn't send" list verbatim, which is meaningless to them and internal to us. The code
    // below is what lib/guestOutbox.ts knows how to word; the detail stays in the server log.
    if (error) { console.error("[guest/place-order] session RPC failed:", error.message); return busy(); }
    // The restaurant is only used to SCOPE the limit ping — identity still comes from the token,
    // so a wrong value here can never place an order anywhere.
    //
    // ── AND TO DROP THE FLOOR SNAPSHOT, WHICH IS WHY A MISSING ONE MATTERED (T9 finding F20) ──────
    // When the body carried no (or a malformed) `restaurantId`, `invalidateFloor` was skipped — so a
    // replayed order reached the kitchen while a manager reloading inside the shared 1.5s window
    // could still be handed a floor computed before that order existed. Three answers, cheapest
    // first: the RPC's own reply (which does not carry it today — see ridFromToken above), the
    // phone's field, and finally the token itself, which always knows. The third is what makes the
    // sentence above actually true.
    const sessionRid = ridFromResult(data)
      || (isUuid(b.restaurantId) ? (b.restaurantId as string) : "")
      || await ridFromToken(b.token);
    maybePing(data, sessionRid);
    dropFloorIfPlaced(data, sessionRid);
    if (!sessionRid) {
      // Nothing to invalidate against. Say so in the log rather than leaving a silently stale floor.
      console.warn("[guest/place-order] session replay had no resolvable restaurant — floor snapshot not dropped");
    }
    return NextResponse.json(data ?? { ok: false, reason: "empty" });
  }

  // Non-session (QR/public) order. This is the one path that needs the clash check:
  // it takes a TABLE NUMBER, so a phone that was offline for twenty minutes could put its
  // order onto whoever is sitting at that table NOW, or onto a bill that has already been
  // settled. (The session path above doesn't need it — lfh_place_order validates the
  // guest's own session token and answers `session_closed` itself.)
  // WHICH RESTAURANT — AND THERE IS NO LONGER A GUESS (owner, 2026-08-18: "I agree to 7").
  //
  // This used to read: no `restaurantId` field at all → restaurant #1. That fallback was the shape
  // these routes shipped with, back when there was only ever one restaurant, and it was deliberately
  // kept when a MALFORMED value was made a refusal. On a stack serving many restaurants it is the one
  // remaining way a real order — and its money — can land on somebody else's floor and somebody
  // else's books: an order saved on a phone by a build old enough to predate the field replays here
  // months later and is filed under #1.
  //
  // Nothing that runs today can hit this. `useRestaurantId()` (lib/restaurant-context.tsx) always
  // returns a real id — it defaults to #1 itself and is never undefined — and every call site that
  // queues a guest action passes it (components/CartPanel.tsx, ChefPopup.tsx, SessionGate.tsx). So the
  // only body that reaches this branch is one saved before the field existed, which is exactly the
  // body we must not guess about. Checked before changing it: guessing was the whole risk, and
  // refusing costs a genuinely ancient saved order that would otherwise have been billed to the wrong
  // restaurant.
  //
  // The diner is TOLD, not silently dropped: lib/guestOutbox.ts already words `unknown_restaurant` as
  // "We couldn't tell which restaurant this order was for." No client change was needed.
  const publicRid = isUuid(b.restaurantId) ? (b.restaurantId as string) : "";
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
  if (error) { console.error("[guest/place-order] public RPC failed:", error.message); return busy(); }
  maybePing(data, publicRid);
  dropFloorIfPlaced(data, publicRid);
  return NextResponse.json(data ?? { ok: false, reason: "empty" });
}

// At-most-once on replay (see lib/idempotency.ts). No X-LFH-Action-Id header → runs normally.
export const POST = withIdempotency(postImpl, "guest");
