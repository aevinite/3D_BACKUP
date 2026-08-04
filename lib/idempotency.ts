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
// The "was anything actually changed?" rule lives in its own import-free file so the guard
// (scripts/verify-order-retry.mjs) can execute the REAL rule instead of a copy. See it for why.
import { didSomething, storedIsRefusal } from "@/lib/idempotencyRule";

// A claimed-but-not-completed row older than this is treated as a crashed attempt
// and allowed to run again (otherwise a server crash mid-write would wedge that
// action forever). Comfortably longer than any single request.
const STALE_MS = 30_000;

type ClaimState = "fresh" | "done" | "processing";
// `result` is the stored JSON body of a completed action, so a later duplicate can be
// answered with the SAME payload (e.g. the original order_id) instead of an empty
// "duplicate". Returned per-call (never a shared module var) so concurrent requests
// can't read each other's result.
type Claim = { state: ClaimState; result?: unknown };

async function begin(actionId: string, panel: string): Promise<Claim> {
  try {
    const ins = await sb.from("action_idempotency").insert({ action_id: actionId, panel }).select("action_id");
    if (!ins.error) return { state: "fresh" }; // we claimed it first → run the write
    // Unique-violation → someone already claimed this action_id.
    if ((ins.error as { code?: string }).code === "23505") {
      const row = await sb.from("action_idempotency").select("done, created_at, result").eq("action_id", actionId).single();
      if (row.error || !row.data) return { state: "fresh" }; // can't read it → fail open
      if (row.data.done) {
        const stored = (row.data as { result?: unknown }).result ?? null;
        // SELF-HEALING for rows written before didSomething() existed: a refusal that was
        // wrongly marked done would otherwise keep replaying forever (the diner's basket could
        // never be sent again). Drop it and let the handler run — it changed nothing, so there
        // is nothing to protect.
        if (storedIsRefusal(stored)) {
          // Reuse the row as a fresh claim (rather than deleting it) so this attempt is still
          // protected against a concurrent duplicate while it runs.
          await sb.from("action_idempotency")
            .update({ done: false, result: null, created_at: new Date().toISOString() })
            .eq("action_id", actionId);
          return { state: "fresh" };
        }
        return { state: "done", result: stored }; // completed → duplicate (echo stored result)
      }
      const age = Date.now() - new Date(row.data.created_at as string).getTime();
      if (age > STALE_MS) {
        // Stale in-flight claim (likely a crashed attempt) → take it over.
        await sb.from("action_idempotency").update({ created_at: new Date().toISOString() }).eq("action_id", actionId);
        return { state: "fresh" };
      }
      return { state: "processing" }; // a concurrent request is handling it right now → tell client to retry
    }
    return { state: "fresh" }; // any other DB error (e.g. table not migrated yet) → fail open
  } catch {
    return { state: "fresh" }; // network/other → fail open
  }
}

async function finish(actionId: string, ok: boolean, result?: unknown): Promise<void> {
  try {
    // Store the successful result so a later duplicate echoes the same order_id.
    if (ok) await sb.from("action_idempotency").update({ done: true, result: result ?? null }).eq("action_id", actionId);
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

    const claim = await begin(actionId, panel);
    if (claim.state === "done") {
      // Echo the original result (order_id etc.) alongside the duplicate flag so the
      // client can still track an order whose first reply was lost.
      const stored = (claim.result && typeof claim.result === "object") ? claim.result as Record<string, unknown> : {};
      return NextResponse.json({ ok: true, ...stored, duplicate: true });
    }
    if (claim.state === "processing") return NextResponse.json({ error: "sync_in_progress", retry: true }, { status: 409 });

    let res: Response;
    try {
      res = await fn(req, ctx);
    } catch (e) {
      await finish(actionId, false);
      throw e;
    }
    // Capture the JSON body (cloned, so the original response is still readable by the
    // caller) to store for future duplicates.
    let body: unknown = null;
    try { body = await res.clone().json(); } catch { /* non-JSON response → store nothing */ }
    await finish(actionId, didSomething(res.status, body), body);
    return res;
  };
}
