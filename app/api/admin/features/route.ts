// POST /api/admin/features — flip ONE guest-facing feature switch. Body:
// { key, value }. Only the ten guest switches are editable here; the four
// backend-only flags (verification/payments/aggregators/gst_invoice) are NOT
// exposed (owner's rule — they're by-hand DB changes). Admin-gated.
//
// Feature toggles now live ONLY in the admin (removed from the editor).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// The guest-facing switches that may be toggled from the admin UI.
const GUEST_FEATURE_KEYS = [
  "ratings", "reviews", "model3d", "allergies", "favorites",
  "waiter_calls", "search", "languages", "currency", "scrollspy",
];

export async function POST(req: NextRequest) {
  const { key, value } = await req.json().catch(() => ({}));
  if (!GUEST_FEATURE_KEYS.includes(key)) {
    return NextResponse.json({ error: "unknown or non-editable feature" }, { status: 400 });
  }
  const cur = await sb.from("settings").select("features").eq("id", "site").maybeSingle();
  if (cur.error) return NextResponse.json({ error: cur.error.message }, { status: 500 });

  // Merge over whatever's stored; keep only booleans so a bad value can't poison
  // the guest app's gating.
  const features: Record<string, boolean> = {};
  const stored = (cur.data?.features || {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(stored)) if (typeof v === "boolean") features[k] = v;
  features[key] = value === true;

  const r = await sb.from("settings").update({ features }).eq("id", "site").select();
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  return NextResponse.json({ features: (r.data?.[0] || {}).features || features });
}
