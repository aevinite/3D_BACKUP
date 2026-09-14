// A DINER'S "I'VE LEFT THIS TABLE", SENT BY THE PHONE WHEN THE SIGNAL COMES BACK.
//
// WHY THIS ROUTE EXISTS (owner picked it, 2026-08-30). Leaving a table used to be a live RPC and
// nothing else, so on a bad connection the restaurant never heard it. Sweep 7 stopped the app
// CLAIMING they had left when it had not landed — but that left the diner holding the job ("please
// let a member of staff know"). Now the phone saves it like an order and sends it itself.
//
// The guest queue speaks fetch + Response (a status code, a JSON body, an X-LFH-Action-Id), so a
// leave gets its own endpoint rather than a special case inside the flush loop. Everything the
// queue already does — the deadline, the 5xx-is-busy rule, the bounded retries, the honest wording
// — then applies to it for free.
//
// IT IS SAFE TO SEND TWICE. lfh_leave_session (mig 146) has no refusing branch: a token that is no
// longer a live member returns { ok:true, already_gone:true }. The at-most-once wrapper is kept
// anyway, for the same reason the waiter call has one — a replay should not do the work twice even
// when doing it twice is harmless.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { withIdempotency } from "@/lib/idempotency";
import { invalidateFloor } from "@/lib/floorSummary";

export const dynamic = "force-dynamic";

const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// Same shape as the sibling routes: a database that will not answer is BUSY, never a refusal, so
// the phone keeps the request and tries again instead of telling the diner it failed.
function busy(): Response {
  const retryAfter = 20 + Math.floor(Math.random() * 25);
  return NextResponse.json(
    { ok: false, reason: "server_busy", retryAfter },
    { status: 502, headers: { "Retry-After": String(retryAfter) } },
  );
}

type Body = { token?: string; restaurantId?: string };

async function postImpl(req: NextRequest): Promise<Response> {
  let b: Body;
  try { b = (await req.json()) as Body; } catch { return NextResponse.json({ ok: false, reason: "bad_body" }, { status: 400 }); }
  if (!b.token || typeof b.token !== "string") {
    return NextResponse.json({ ok: false, reason: "invalid_token" }, { status: 400 });
  }

  const { data, error } = await sb.rpc("lfh_leave_session", { p_token: b.token });
  if (error) { console.error("[guest/leave] RPC failed:", error.message); return busy(); }

  // Someone leaving changes the floor — a seat frees, and a head leaving hands the table over.
  //
  // ── …EXCEPT WHEN THEY HAD ALREADY LEFT (item 9) ────────────────────────────────────────────────
  //
  // `lfh_leave_session` (mig 146) answers `{ok:true, already_gone:true}` for a token that is no
  // longer a live member, and that branch RETURNS BEFORE IT WRITES ANYTHING — no row removed, no
  // waiter call resolved, no head transferred, no cart cleared. Every other path does write, and
  // all of those genuinely change the floor.
  //
  // It is far from a rare answer here: this route exists for a leave the phone SAVED and delivers
  // later, and the at-most-once wrapper is deliberately kept even though leaving twice is harmless
  // — so a replay, a retry after a lost reply, or a diner the staff had already closed the table on
  // all land on `already_gone`. Dropping the shared snapshot for those forces every manager, tablet
  // and kitchen screen on the floor to recompute for something that did not happen. Migration 238
  // exists precisely so one floor read is shared for 1.5 seconds instead of recomputed per panel,
  // and its own note says not to simplify it back.
  //
  // The two sibling doors already check first — /api/guest/place-order through dropFloorIfPlaced()
  // and /api/guest/call-waiter through callLanded(). This is the third door catching up with them.
  const rid = isUuid(b.restaurantId) ? (b.restaurantId as string) : "";
  const leaveLanded = !(data && typeof data === "object" && (data as { already_gone?: unknown }).already_gone === true);
  if (rid && leaveLanded) invalidateFloor(rid);
  else if (!rid) console.warn("[guest/leave] no resolvable restaurant — floor snapshot not dropped");

  return NextResponse.json(data ?? { ok: false, reason: "empty" });
}

export const POST = withIdempotency(postImpl, "guest");
