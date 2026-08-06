// Inbound webhook for real Zomato/Swiggy order-relay (DORMANT today).
//
// Zomato/Swiggy POST a new order here once we're an onboarded POS-integration
// partner. Until the `aggregators` flag is ON it answers { disabled: true } and
// does nothing — exactly like the other backend-only stubs (verification/OTP).
// When live, it verifies the shared secret, normalizes the payload, and inserts
// the order via the same path the manager's test button uses → it appears on the
// Platform board + the kitchen automatically.

import { NextRequest, NextResponse } from "next/server";
import { aggregatorsEnabled, verifyWebhook, ingestIncoming, type AggSource } from "@/lib/aggregators";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ source?: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { source } = await ctx.params;
  if (source !== "zomato" && source !== "swiggy") {
    return NextResponse.json({ error: "unknown source" }, { status: 404 });
  }
  // Backend-only flag: dormant until turned on by hand in the DB.
  if (!(await aggregatorsEnabled())) {
    return NextResponse.json({ ok: false, disabled: true }, { status: 200 });
  }
  // `await` MATTERS: verifyWebhook is async now (it hashes both sides for a constant-time compare).
  // Without it this would test a Promise — always truthy — and the 401 would be unreachable, which is
  // the exact fault /api/issue-media shipped with until the 2026-08-04 sweep found it.
  if (!(await verifyWebhook(source as AggSource, req.headers.get("x-webhook-secret")))) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  let payload: Record<string, unknown> = {};
  try { payload = await req.json(); } catch { /* empty body */ }
  try {
    const row = await ingestIncoming(source as AggSource, payload as Record<string, any>);
    // A RETRY GETS 200, NOT 500 (T9 sweep, 2026-08-05). `duplicate:true` means we already hold
    // this external_id, so the aggregator is told "delivered" and stops retrying. Answering 5xx
    // for an order we HAVE is what would make Zomato/Swiggy retry it forever — the same
    // at-most-once contract our own panels get from lib/idempotency.ts.
    return NextResponse.json(
      { ok: true, id: row?.id, external_id: row?.external_id, ...(row?.duplicate ? { duplicate: true } : {}) },
      { status: 200 },
    );
  } catch (e) {
    // The message is already a plain sentence (lib/aggregators.ts turns a database error into one
    // and logs the detail our side) — an external caller never receives our schema.
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't record that order." }, { status: 500 });
  }
}
