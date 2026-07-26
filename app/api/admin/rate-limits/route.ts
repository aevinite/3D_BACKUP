// Admin · Rate Limits — view/edit the configurable limits (mig 205) and act on the hits.
//   GET   → { rules, events }  (global rules + open "limit reached" events, newest first)
//   PATCH { id, max_count?, window_seconds?, enabled? } → edit one rule
//   POST  { action: "allow"|"dismiss", event_id } → Allow (reset that subject's counter) / dismiss
// Admin-gated (same cookie as every other /api/admin/* route).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { logAction } from "@/lib/oplog";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return err("unauthorized", 401);
  const rules = await sb.from("rate_limit_rules")
    .select("id, key, label, max_count, window_seconds, enabled, updated_at")
    .is("restaurant_id", null).order("key");
  if (rules.error) return err(rules.error.message, 500);

  const ev = await sb.from("rate_limit_events")
    .select("id, restaurant_id, key, subject, subject_label, hit_count, max_count, window_seconds, status, created_at, last_at")
    .eq("status", "open").order("last_at", { ascending: false }).limit(50);
  if (ev.error) return err(ev.error.message, 500);

  // Attach a friendly restaurant name (zero-uuid = not restaurant-scoped, e.g. admin login).
  const ids = [...new Set((ev.data ?? []).map((e) => e.restaurant_id).filter((x) => x && x !== "00000000-0000-0000-0000-000000000000"))];
  const names: Record<string, string> = {};
  if (ids.length) {
    const rs = await sb.from("restaurants").select("id, name").in("id", ids);
    for (const r of rs.data ?? []) names[r.id] = r.name;
  }
  const events = (ev.data ?? []).map((e) => ({ ...e, restaurant_name: names[e.restaurant_id] || null }));
  return NextResponse.json({ rules: rules.data ?? [], events });
}

export async function PATCH(req: NextRequest) {
  if (!(await admin(req))) return err("unauthorized", 401);
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { /* empty */ }
  const id = String(b.id || "");
  if (!UUID.test(id)) return err("invalid id");
  const patch: Record<string, unknown> = {};
  if (b.max_count !== undefined) {
    const n = Math.trunc(Number(b.max_count));
    if (!Number.isFinite(n) || n < 0 || n > 100000) return err("max_count out of range");
    patch.max_count = n;
  }
  if (b.window_seconds !== undefined) {
    const n = Math.trunc(Number(b.window_seconds));
    if (!Number.isFinite(n) || n < 1 || n > 86400) return err("window_seconds out of range (1..86400)");
    patch.window_seconds = n;
  }
  if (b.enabled !== undefined) patch.enabled = !!b.enabled;
  if (!Object.keys(patch).length) return err("nothing to update");
  patch.updated_at = new Date().toISOString();
  patch.updated_by = "admin";
  const r = await sb.from("rate_limit_rules").update(patch).eq("id", id).select("key").maybeSingle();
  if (r.error) return err(r.error.message, 500);
  await logAction("admin", "rate_limit_edit", { level: "info", detail: `rate limit "${r.data?.key ?? id}" updated: ${JSON.stringify(patch)}` });
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  if (!(await admin(req))) return err("unauthorized", 401);
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { /* empty */ }
  const action = String(b.action || "");
  const eventId = String(b.event_id || "");
  if (!UUID.test(eventId)) return err("invalid event_id");

  if (action === "allow") {
    // Reset that subject's counter now (unblock them) + mark the event handled.
    const r = await sb.rpc("lfh_rate_allow", { p_event_id: eventId, p_actor: "admin" });
    if (r.error) return err(r.error.message, 500);
    await logAction("admin", "rate_limit_allow", { level: "info", detail: `rate-limit hit allowed (counter reset) · ${eventId}` });
    return NextResponse.json({ ok: true });
  }
  if (action === "dismiss") {
    const r = await sb.from("rate_limit_events").update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: "admin" }).eq("id", eventId).select("id").maybeSingle();
    if (r.error) return err(r.error.message, 500);
    return NextResponse.json({ ok: true });
  }
  return err("unknown action");
}
