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
  if (!verifyWebhook(source as AggSource, req.headers.get("x-webhook-secret"))) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  let payload: Record<string, unknown> = {};
  try { payload = await req.json(); } catch { /* empty body */ }
  try {
    const row = await ingestIncoming(source as AggSource, payload as Record<string, any>);
    return NextResponse.json({ ok: true, id: row?.id, external_id: row?.external_id }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
