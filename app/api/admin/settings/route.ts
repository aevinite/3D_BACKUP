// /api/admin/settings — read/write a small, ALLOW-LISTED set of restaurant
// settings the admin Settings page edits (currently the two log-retention windows).
// Admin-gated. Only whitelisted keys are accepted, so this can never be used to
// flip arbitrary settings. Mirrors the clamp the manager's settings save uses.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { logAction, deviceIdFrom } from "@/lib/oplog";

export const dynamic = "force-dynamic";

// Capped at 1 MONTH (30 days) — the owner's platform-wide "max save lock" (2026-07-09). 7 days
// is the lighter option; never longer than a month, to keep the log tables small.
const clampDays = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 30) : 30;
};

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await sb.from("settings").select("oplog_retention_days, custlog_retention_days").eq("id", "site").limit(1);
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  const s = r.data?.[0] || {};
  return NextResponse.json({
    // Default to the 30-day MAX (clampDays cap), not 90 — an unconfigured row used to report
    // 90, which the UI then rendered as a phantom "90 days" option above its own "1-month
    // maximum" that couldn't be reselected once changed (audit 2026-07-23).
    oplog_retention_days: s.oplog_retention_days ?? 30,
    custlog_retention_days: s.custlog_retention_days ?? 30,
  });
}

export async function POST(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch {}
  // "One setting for all" (owner 2026-07-09): the admin's retention window applies to EVERY
  // restaurant — a true platform-wide policy, no per-restaurant divergence (and no coupling to
  // restaurant #1's id='site' row). Capped at 1 month by clampDays.
  const patch: Record<string, unknown> = {};
  for (const k of ["oplog_retention_days", "custlog_retention_days"]) {
    if (k in body) patch[k] = clampDays(body[k]);
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  // Every settings row carries a restaurant_id (id='site' is #1's row) → this writes them all.
  const r = await sb.from("settings").update(patch).not("restaurant_id", "is", null);
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  // HOW LONG THE AUDIT TRAIL LIVES IS ITSELF AUDITED (sweep 2026-08-04). This is the one setting that
  // decides how long the operation log survives, it applies to EVERY restaurant, and it recorded
  // nothing — so shortening the trail from 30 days to 1 was indistinguishable from a trail that was
  // never written. Every neighbouring admin write already logs itself; this was the gap.
  await logAction("admin", "retention_change", {
    device_id: deviceIdFrom(req),
    detail: `log retention set for ALL restaurants — ${Object.entries(patch).map(([k, v]) => `${k.replace(/_/g, " ")} ${v} day(s)`).join(", ")}`,
  });
  return NextResponse.json({ ok: true });
}
