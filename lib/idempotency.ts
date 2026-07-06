// idempotency.ts — server-side "run this action AT MOST ONCE" guard for the
// offline sync feature (2026-07-06). See migration 138.
//
// A panel that was offline stores the actions the user took and replays them when
// the connection returns. A replayed action can legitimately arrive more than once
// (the first request may have committed before the socket dropped; or the client
// retries after a mid-flight failure). To make sure a bill is never settled twice
// or an order placed twice, every replayable write carries a client-generated
// `action_id` (UUID) in the `X-LFH-Action-Id` header. We CLAIM that id before
// running the handler; a duplicate is short-circuited.
//
// SAFETY: this FAILS OPEN. If the idempotency table is unreachable or missing, we
// simply run the write without dedup — better a rare duplicate (still caught by the
// tablet's existing 3-second content guard) than every staff write breaking because
// a helper table hiccuped.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

// A claimed-but-not-completed row older than this is treated as a crashed attempt
// and allowed to run again (otherwise a server crash mid-write would wedge that
// action forever). Comfortably longer than any single request.
const STALE_MS = 30_000;

type ClaimState = "fresh" | "done" | "processing";

async function begin(actionId: string, panel: string): Promise<ClaimState> {
  try {
    const ins = await sb.from("action_idempotency").insert({ action_id: actionId, panel }).select("action_id");
    if (!ins.error) return "fresh"; // we claimed it first → run the write
    // Unique-violation → someone already claimed this action_id.
    if ((ins.error as { code?: string }).code === "23505") {
      const row = await sb.from("action_idempotency").select("done, created_at").eq("action_id", actionId).single();
      if (row.error || !row.data) return "fresh"; // can't read it → fail open
      if (row.data.done) return "done"; // already completed successfully → duplicate
      const age = Date.now() - new Date(row.data.created_at as string).getTime();
      if (age > STALE_MS) {
        // Stale in-flight claim (likely a crashed attempt) → take it over.
        await sb.from("action_idempotency").update({ created_at: new Date().toISOString() }).eq("action_id", actionId);
        return "fresh";
      }
      return "processing"; // a concurrent request is handling it right now → tell client to retry
    }
    return "fresh"; // any other DB error (e.g. table not migrated yet) → fail open
  } catch {
    return "fresh"; // network/other → fail open
  }
}

async function finish(actionId: string, ok: boolean): Promise<void> {
  try {
    if (ok) await sb.from("action_idempotency").update({ done: true }).eq("action_id", actionId);
    // Failed write → release the claim so the client's next replay can genuinely retry.
    else await sb.from("action_idempotency").delete().eq("action_id", actionId);
  } catch {
    /* best-effort — dedup is a safety net, not a hard dependency */
  }
}

// Wrap a route handler so any request carrying an X-LFH-Action-Id header runs at
// most once. Requests without the header (the guest app, curl, older clients) are
// passed straight through unchanged.
export function withIdempotency<C>(
  fn: (req: NextRequest, ctx: C) => Promise<Response> | Response,
  panel: string,
): (req: NextRequest, ctx: C) => Promise<Response> {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    const actionId = req.headers.get("x-lfh-action-id");
    if (!actionId) return fn(req, ctx);

    const state = await begin(actionId, panel);
    if (state === "done") return NextResponse.json({ ok: true, duplicate: true });
    if (state === "processing") return NextResponse.json({ error: "sync_in_progress", retry: true }, { status: 409 });

    let res: Response;
    try {
      res = await fn(req, ctx);
    } catch (e) {
      await finish(actionId, false);
      throw e;
    }
    await finish(actionId, res.status < 400);
    return res;
  };
}
