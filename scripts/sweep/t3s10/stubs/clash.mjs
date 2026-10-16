// Stand-in for lib/clash.ts's two exports the place-order route uses.
import { G } from "./state.mjs";
import { NextResponse } from "next/server";
export async function replayClash(req, rid, kind, a, b, ctx) {
  G.CLASH_CALLS.push({ rid, kind, ctx, replay: req.headers.get("x-lfh-replay"), queuedAt: req.headers.get("x-lfh-queued-at") });
  return G.CLASH ? G.CLASH({ rid, kind, ctx }) : null;
}
export function clashJson(c) { return NextResponse.json({ ok: false, reason: "clash", clash: c }, { status: 409 }); }
// lib/idempotency.ts opens and releases an edit "turn" around every handler (T12 item 10, 2026-10-15). The
// guest doors never take a turn (that is the staff panels' same-thing-saved-twice rule), so for them both
// are no-ops — exactly what the real ones do for a request that took no turn.
export function openEditTurnScope() {}
export async function releaseEditTurn() {}
