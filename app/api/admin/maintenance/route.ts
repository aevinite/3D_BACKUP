// POST /api/admin/maintenance — flip settings.service_mode (the "we'll be right
// back" screen for the guest menu). Body: { on: boolean }. Admin-gated.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const on = body?.on === true;
  const r = await sb.from("settings").update({ service_mode: on }).eq("id", "site").select();
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  return NextResponse.json({ maintenance: (r.data?.[0] || {}).service_mode === true });
}
