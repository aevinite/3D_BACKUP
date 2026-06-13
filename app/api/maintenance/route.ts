// GET/POST /api/maintenance — read or flip the guest-menu maintenance switch
// (settings.service_mode = the "we'll be right back" screen). Shared by the staff
// panels (editor/kitchen/tablet) so any of them can take the menu offline, not
// just the admin. Open like those panels are for now — RE-LOCK before hosting.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET() {
  const r = await sb.from("settings").select("service_mode").eq("id", "site").maybeSingle();
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  return NextResponse.json({ maintenance: (r.data || {}).service_mode === true });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const on = body?.on === true;
  const r = await sb.from("settings").update({ service_mode: on }).eq("id", "site").select();
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  return NextResponse.json({ maintenance: (r.data?.[0] || {}).service_mode === true });
}
