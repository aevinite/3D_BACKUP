// Admin · Rate Limits — view/edit the configurable limits (mig 205) and act on the hits.
//   GET   → { rules, events, blocked, requests }  (rules + open hits + blocked devices + unblock requests)
//   PATCH { id, max_count?, window_seconds?, enabled? } → edit one rule
//   POST  { action, ... }:
//     "allow"|"dismiss" { event_id }              → reset a subject's counter / clear a hit
//     "block" { event_id }                        → bar an admin-login device from the panel
//     "unblock" { key }                           → lift a block by throttle key
//     "approve_request"|"deny_request" { request_id } → act on an unblock request (mig 214)
// Admin-gated (same cookie as every other /api/admin/* route).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { logAction } from "@/lib/oplog";
import { throttleBlock, throttleUnblock, listBlocked, clientIp } from "@/lib/loginThrottle";

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
  // Devices/IPs deliberately blocked from the admin panel (admin: keys, far-future lock).
  const blockedRaw = await listBlocked("admin:");
  const blocked = blockedRaw.map((b) => ({ key: b.key, ip: b.key.replace(/^admin:/, ""), note: b.note, since: b.locked_until }));

  // Open "please unblock me" requests from blocked devices (mig 214). Shown at the bottom of the
  // page, just above the block list. Silent by design — never in the bell / phone alerts.
  const reqRows = await sb.from("unblock_requests")
    .select("id, key, ip, device_id, message, created_at")
    .eq("status", "open").order("created_at", { ascending: false }).limit(50);
  // "asked N× today" per ip, across the last 24h (open + resolved), so the admin sees repeat askers.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const counted = await sb.from("unblock_requests").select("ip").gte("created_at", since).limit(1000);
  const perIp: Record<string, number> = {};
  for (const r of counted.data ?? []) perIp[r.ip] = (perIp[r.ip] || 0) + 1;
  const requests = (reqRows.data ?? []).map((r) => ({ ...r, asked_today: perIp[r.ip] || 1 }));

  return NextResponse.json({ rules: rules.data ?? [], events, blocked, requests });
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

  // Unblock takes a login_throttle key, not an event id.
  if (action === "unblock") {
    const key = String(b.key || "");
    if (!/^admin:/.test(key)) return err("invalid key");
    await throttleUnblock(key);
    // Any open unblock requests for this device are now moot → resolve them as approved.
    await sb.from("unblock_requests").update({ status: "approved", resolved_at: new Date().toISOString(), resolved_by: "admin" }).eq("key", key).eq("status", "open");
    await logAction("admin", "admin_unblock", { level: "info", detail: `admin-panel block lifted · ${key}` });
    return NextResponse.json({ ok: true });
  }

  // Approve an unblock request: lift the block on that device AND mark the request(s) handled.
  if (action === "approve_request") {
    const id = String(b.request_id || "");
    if (!UUID.test(id)) return err("invalid request_id");
    const r = (await sb.from("unblock_requests").select("key").eq("id", id).maybeSingle()).data as { key: string } | null;
    if (!r) return err("that request no longer exists", 404);
    await throttleUnblock(r.key);
    await sb.from("unblock_requests").update({ status: "approved", resolved_at: new Date().toISOString(), resolved_by: "admin" }).eq("key", r.key).eq("status", "open");
    await logAction("admin", "admin_unblock", { level: "info", detail: `unblock request approved · ${r.key}` });
    return NextResponse.json({ ok: true });
  }
  // Deny an unblock request: leave the block in place, just clear the request from the list.
  if (action === "deny_request") {
    const id = String(b.request_id || "");
    if (!UUID.test(id)) return err("invalid request_id");
    const r = await sb.from("unblock_requests").update({ status: "denied", resolved_at: new Date().toISOString(), resolved_by: "admin" }).eq("id", id).select("id").maybeSingle();
    if (r.error) return err(r.error.message, 500);
    return NextResponse.json({ ok: true });
  }

  const eventId = String(b.event_id || "");
  if (!UUID.test(eventId)) return err("invalid event_id");

  // Block the device/IP behind an admin-login alert from reaching the admin panel.
  if (action === "block") {
    const e = (await sb.from("rate_limit_events").select("id, key, subject, subject_label").eq("id", eventId).maybeSingle()).data as { key: string; subject: string; subject_label: string | null } | null;
    if (!e) return err("that alert no longer exists", 404);
    if (e.key !== "admin_login") return err("blocking only applies to admin-login alerts");
    // Safeguard: never let the admin block their OWN current IP (would lock themselves out).
    if (e.subject && e.subject === clientIp(req)) return err("That's your own device — you can't block yourself.");
    await throttleBlock(`admin:${e.subject}`, e.subject_label || `admin panel · ${e.subject}`);
    await sb.from("rate_limit_events").update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: "admin" }).eq("id", eventId);
    await logAction("admin", "admin_block", { level: "info", detail: `admin-panel access blocked for ${e.subject_label || e.subject}` });
    return NextResponse.json({ ok: true });
  }

  // Clear the short login lockout on the device behind an admin-login alert ("let them try again").
  // admin-login is warn-only (no blocking counter), but several wrong tries lock that IP out for a
  // few minutes via login_throttle — this lifts that so a genuine person (e.g. the owner forgot the
  // password) can retry now. Marks the alert handled.
  if (action === "clear") {
    const e = (await sb.from("rate_limit_events").select("id, key, subject, subject_label").eq("id", eventId).maybeSingle()).data as { key: string; subject: string; subject_label: string | null } | null;
    if (!e) return err("that alert no longer exists", 404);
    if (e.key !== "admin_login") return err("clearing a lockout only applies to admin-login alerts");
    if (e.subject) await throttleUnblock(`admin:${e.subject}`);
    await sb.from("rate_limit_events").update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: "admin" }).eq("id", eventId);
    await logAction("admin", "admin_lockout_clear", { level: "info", detail: `admin-login lockout cleared for ${e.subject_label || e.subject}` });
    return NextResponse.json({ ok: true });
  }

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
