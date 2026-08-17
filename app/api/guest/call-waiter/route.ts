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

// ── "THE RESTAURANT IS BUSY — WAIT THIS LONG" (T10 sweep, improvement I2) ─────────────────────────
//
// A 502 here means the restaurant's server did not answer, and the phone saves the call and retries
// on its own fixed schedule. /api/guest/place-order was given a server-set wait for exactly this
// (improvement I10, owner 2026-08-12) and its reasoning applies word for word to a raised hand:
// "during a genuine rush that is the worst possible behaviour: every waiting phone comes back at the
// same moment, on the same timer, and lands on the server that was already struggling."
//
// It applies MORE to a call, if anything. Calling a waiter is the thing a diner does when something
// is wrong, so it is the most re-tapped guest action of all — and the queue that carries it is the
// same queue: lib/guestOutbox.ts drains orders and calls in ONE loop, and reads the hint GENERICALLY
// (`if (j?.retryAfter != null) noteServerRetryAfter(j.retryAfter)`, before any branch) into a shared
// backoff. So a busy moment taught the phone to back off when it happened to be draining an order
// and taught it nothing when it happened to be draining a call — the same server, the same rush, two
// different behaviours depending on what the diner had tapped.
//
// Nothing on the device changes: the field is already read, it is a HINT, and a build that ignores
// it keeps its existing schedule and is exactly as correct as before. The jitter is added HERE
// rather than on the phone so a thousand devices get a thousand different answers — the whole point
// is that they stop arriving together. `reason: "server_busy"` stays spelled out in full: it is the
// code lib/guestOutbox.ts words for the diner, and `npm run verify:order-retry` greps for it.
function busy(): Response {
  const retryAfter = 20 + Math.floor(Math.random() * 25);   // 20–45s, spread
  return NextResponse.json(
    { ok: false, reason: "server_busy", retryAfter },
    { status: 502, headers: { "Retry-After": String(retryAfter) } },
  );
}

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
  // A BAD `at` MUST NOT BE A FREE PASS (T9 finding F24, fixed 2026-08-12). This was
  // `const at = Number(b.at || 0); if (at && …)`, so any value that isn't a usable number — "abc",
  // an object, null — became NaN or 0 and skipped the check entirely. The comment above calls this
  // guard "the half that does not depend on the phone getting it right"; a body the phone got wrong
  // was precisely the body that walked past it, and a twenty-minute-old call rang the floor.
  //
  // A REPLAY THAT CARRIES AN UNREADABLE TIMESTAMP IS TREATED AS TOO OLD, deliberately: this route
  // exists only for calls saved on a phone and delivered later, so "I can't tell when this was
  // tapped" is not a good enough reason to send a waiter across the room for something nobody
  // remembers asking for. A body with NO `at` field at all is an ordinary online call and still goes
  // straight through, exactly as before.
  // `at` is typed `number` but arrives as untrusted JSON, so the empty-string case is checked on the
  // raw value rather than the declared type.
  const rawAt = (b as { at?: unknown }).at;
  const hasAt = rawAt !== undefined && rawAt !== null && rawAt !== "";
  const at = Number(rawAt);
  if (hasAt && !Number.isFinite(at)) return NextResponse.json({ ok: false, reason: "call_too_old" });
  if (hasAt && Date.now() - at > STALE_CALL_MS) return NextResponse.json({ ok: false, reason: "call_too_old" });

  const reason = String(b.reason || "").slice(0, 200);

  if (b.mode === "session") {
    if (!b.token) return NextResponse.json({ ok: false, reason: "invalid_token" }, { status: 400 });
    const { data, error } = await sb.rpc("lfh_call_waiter", { p_token: b.token, p_reason: reason });
    // The database's own words never travel to a diner — a code does, and lib/guestOutbox.ts owns
    // the sentence. Same rule as place-order.
    if (error) { console.error("[guest/call-waiter] session RPC failed:", error.message); return busy(); }
    // Prefer the restaurant the RPC itself resolved from the token over the one the phone sent —
    // an older saved call may carry none, and the floor snapshot then never got dropped, so a
    // manager reloading inside the shared 1.5s window saw a floor without the raised hand on it
    // (T9 finding F20, the twin of the same fix in place-order).
    const fromRpc = (data && typeof data === "object")
      ? ((data as Record<string, unknown>).restaurant_id ?? (data as Record<string, unknown>).restaurantId)
      : null;
    const rid = isUuid(fromRpc) ? (fromRpc as string) : (isUuid(b.restaurantId) ? (b.restaurantId as string) : "");
    if (rid) invalidateFloor(rid);   // a raised hand changes the floor
    else console.warn("[guest/call-waiter] session replay had no resolvable restaurant — floor snapshot not dropped");
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
  if (error) { console.error("[guest/call-waiter] public RPC failed:", error.message); return busy(); }
  invalidateFloor(rid);
  return NextResponse.json(data ?? { ok: false, reason: "empty" });
}

// At-most-once on replay, so a call delivered twice rings the floor once (lib/idempotency.ts).
export const POST = withIdempotency(postImpl, "guest");
