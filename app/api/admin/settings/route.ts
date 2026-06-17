// /api/admin/settings — read/write a small, ALLOW-LISTED set of restaurant
// settings the admin Settings page edits (currently the two log-retention windows).
// Admin-gated. Only whitelisted keys are accepted, so this can never be used to
// flip arbitrary settings. Mirrors the clamp the manager's settings save uses.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";

export const dynamic = "force-dynamic";

const clampDays = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 90) : 90;
};

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await sb.from("settings").select("oplog_retention_days, custlog_retention_days").eq("id", "site").limit(1);
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  const s = r.data?.[0] || {};
  return NextResponse.json({
    oplog_retention_days: s.oplog_retention_days ?? 90,
    custlog_retention_days: s.custlog_retention_days ?? 90,
  });
}

export async function POST(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch {}
  const patch: Record<string, unknown> = { id: "site" };
  for (const k of ["oplog_retention_days", "custlog_retention_days"]) {
    if (k in body) patch[k] = clampDays(body[k]);
  }
  if (Object.keys(patch).length === 1) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  const r = await sb.from("settings").upsert(patch, { onConflict: "id" }).select();
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
