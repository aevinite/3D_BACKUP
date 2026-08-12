// Inbound webhook for real Zomato/Swiggy order-relay (DORMANT today).
//
// Zomato/Swiggy POST a new order here once we're an onboarded POS-integration
// partner. Until the `aggregators` flag is ON it answers { disabled: true } and
// does nothing — exactly like the other backend-only stubs (verification/OTP).
// When live, it verifies the shared secret, normalizes the payload, and inserts
// the order via the same path the manager's test button uses → it appears on the
// Platform board + the kitchen automatically.

import { NextRequest, NextResponse } from "next/server";
import { aggregatorsEnabled, verifyWebhook, ingestIncoming, resolveWebhookRestaurant, type AggSource } from "@/lib/aggregators";

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
  // ── A BODY SIZE CEILING (T9 idea I4) ──────────────────────────────────────────────────────────
  // This is the one door an OUTSIDE company POSTs through, and it had no cap while every other
  // public POST on this stack caps its body first. Generous — a banquet order from a platform is
  // still only a few dozen lines — and a refusal rather than a truncation, because a silently
  // trimmed order is food somebody doesn't get.
  const raw = await req.text().catch(() => "");
  if (raw.length > 64_000) {
    return NextResponse.json({ error: "That order is too large to accept." }, { status: 413 });
  }
  let payload: Record<string, unknown> = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { /* empty body */ }
  try {
    // ── WHICH RESTAURANT IS THIS ORDER FOR? (T9 finding F11, fixed 2026-08-12) ───────────────────
    // `ingestIncoming(source, payload, restaurantId = DEFAULT_RESTAURANT_ID)` — and this route never
    // passed a third argument, so EVERY incoming platform order would have landed on restaurant #1
    // regardless of which restaurant it was actually for. Dormant today (the `aggregators` flag is
    // off), which is the only reason it has never bitten; the day it is switched on for a second
    // restaurant, that restaurant's orders and their money appear on #1's board and books.
    //
    // This is the identical fault /api/guest/place-order was fixed for, in its own words: "used to
    // fall back to restaurant #1 whenever the field was missing, which on a stack serving many
    // restaurants quietly puts a real order — and its money — on the wrong restaurant's floor and
    // books."
    //
    // Resolving it is deliberately EXPLICIT and refuses rather than guesses: the outlet id the
    // platform sends is mapped to one of our restaurants through the channel configuration each
    // restaurant already stores. An unmapped outlet is answered with a plain 404 so the aggregator
    // stops retrying and somebody goes and sets the mapping up — which is a far better failure than
    // an order silently appearing on a stranger's floor.
    const restaurantId = await resolveWebhookRestaurant(source as AggSource, payload);
    if (!restaurantId) {
      return NextResponse.json(
        { error: "We don't recognise that outlet. Ask Aevidine to link it to a restaurant first." },
        { status: 404 },
      );
    }
    const row = await ingestIncoming(source as AggSource, payload as Record<string, any>, restaurantId);
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
