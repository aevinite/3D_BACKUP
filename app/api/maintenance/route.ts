// GET/POST /api/maintenance — read or flip the guest-menu maintenance switch
// (settings.service_mode = the "we'll be right back" screen). Restricted to the
// MANAGER (and the admin super-user): only the manager panel + the admin panel
// expose it now — kitchen and tablet no longer can. requireRole("manager") passes
// for a logged-in manager OR the admin super-user, and rejects everyone else.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { requireRole } from "@/lib/userAuth";

export const dynamic = "force-dynamic";

async function gate(req: NextRequest): Promise<NextResponse | null> {
  const g = await requireRole(req, "manager");
  return g.ok ? null : NextResponse.json({ error: "Not authorised." }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const denied = await gate(req); if (denied) return denied;
  const r = await sb.from("settings").select("service_mode").eq("id", "site").maybeSingle();
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  return NextResponse.json({ maintenance: (r.data || {}).service_mode === true });
}

export async function POST(req: NextRequest) {
  const denied = await gate(req); if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const on = body?.on === true;
  const r = await sb.from("settings").update({ service_mode: on }).eq("id", "site").select();
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  return NextResponse.json({ maintenance: (r.data?.[0] || {}).service_mode === true });
}
