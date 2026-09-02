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
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";
import { logAction } from "@/lib/oplog";
// The diary line for an edit is written in words, next to the label list it borrows them from.
import { rateEditWords } from "@/lib/rateLimit";
import { throttleBlock, throttleUnblock, listBlocked, clientIp } from "@/lib/loginThrottle";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return err("unauthorized", 401);
  const rules = await sb.from("rate_limit_rules")
    .select("id, key, label, max_count, window_seconds, enabled, updated_at")
    .is("restaurant_id", null).order("key").limit(500);
  if (rules.error) return adminFail("the rate limits", rules.error, { action: "load" });

  const ev = await sb.from("rate_limit_events")
    .select("id, restaurant_id, key, subject, subject_label, hit_count, max_count, window_seconds, status, created_at, last_at")
    .eq("status", "open").order("last_at", { ascending: false }).limit(50);
  if (ev.error) return adminFail("the rate limits", ev.error, { action: "load" });

  // Attach a friendly restaurant name (zero-uuid = not restaurant-scoped, e.g. admin login).
  const ids = [...new Set((ev.data ?? []).map((e) => e.restaurant_id).filter((x) => x && x !== "00000000-0000-0000-0000-000000000000"))];
  const names: Record<string, string> = {};
  if (ids.length) {
    const rs = await sb.from("restaurants").select("id, name").in("id", ids).limit(2000);
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
  // THE LIST'S OWN FAILURE MATTERS MORE THAN THE COUNT'S (sweep #6, T19). The note below records
  // that `|| 1` once hid a failed COUNT — but the LIST it decorates was still unchecked, so a
  // failure there sent `requests: []` with a 200. An empty section reads as "nobody is asking",
  // which is the one wrong answer this section can give: the person on the other end is locked out
  // of the panel and asking to be let back in is the ONLY move they have. If we cannot read their
  // requests we have to say so, not quietly speak for them.
  if (reqRows.error) return adminFail("the unblock requests", reqRows.error, { action: "load" });
  // "asked N× today" per ip, across the last 24h (open + resolved), so the admin sees repeat askers.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const counted = await sb.from("unblock_requests").select("ip").gte("created_at", since).limit(1000);
  const perIp: Record<string, number> = {};
  for (const r of counted.data ?? []) perIp[r.ip] = (perIp[r.ip] || 0) + 1;
  // `|| 1` used to hide a FAILED read: a device that had asked eight times today came back as a
  // first-timer, which is the one fact this chip exists to show. When the count can't be read,
  // send null and let the page say nothing rather than something wrong (T20 sweep, 2026-08-16).
  const countOk = !counted.error;
  const requests = (reqRows.data ?? []).map((r) => ({
    ...r, asked_today: countOk ? (perIp[r.ip] || 1) : null,
  }));

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
  if (r.error) return adminFail("the rate limits", r.error, { action: "save" });
  // AN EDIT MUST NOT SUCCEED AT NOTHING — the same rule allow/dismiss learned below, applied to the
  // one path on this page that actually changes a limit. `r.data` is null when the id matched no row
  // (the rule was renamed or removed in another tab since the page loaded), and this still answered
  // ok:true and wrote a log line reading `rate limit "<uuid>" updated`. So the admin watched a
  // limit he had just raised sit at its old value with no hint why, and the record of the change
  // named a rule nobody can find.
  if (!r.data) return err("that limit no longer exists — refresh the page", 404);
  // THE RECORD OF THE CHANGE IS A SENTENCE, NOT THE PATCH OBJECT (owner, 2026-09-02: "why the
  // logs are in the code supabase language"). This wrote `rate limit "guest_order" updated:
  // {"enabled":true,"updated_at":"…","updated_by":"admin"}` — and that line is shown on the
  // admin DASHBOARD in "Latest activity", so raw JSON was the first thing the console printed.
  // rateEditWords lives in lib/rateLimit.ts next to the label list, so the diary calls a limit
  // exactly what the Rate limits screen calls it. Rows written the old way still read correctly:
  // formatActionDetail (components/admin/shared.tsx) parses that legacy shape back into English.
  await logAction("admin", "rate_limit_edit", { level: "info", detail: rateEditWords(r.data.key, patch) });
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
    // Any open unblock requests for this device are now moot → resolve them as approved. The block
    // itself is already lifted by the line above, so a failure here leaves a stale row in the ASK
    // list rather than a person still locked out — reported, not fatal (T20 sweep #7, 2026-08-27).
    const tidy = await sb.from("unblock_requests").update({ status: "approved", resolved_at: new Date().toISOString(), resolved_by: "admin" }).eq("key", key).eq("status", "open");
    if (tidy.error) console.error("[admin/rate-limits] unblock tidied the block but not the request row:", tidy.error.message);
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
    const tidy2 = await sb.from("unblock_requests").update({ status: "approved", resolved_at: new Date().toISOString(), resolved_by: "admin" }).eq("key", r.key).eq("status", "open");
    if (tidy2.error) console.error("[admin/rate-limits] approve lifted the block but not the request row:", tidy2.error.message);
    await logAction("admin", "admin_unblock", { level: "info", detail: `unblock request approved · ${r.key}` });
    return NextResponse.json({ ok: true });
  }
  // Deny an unblock request: leave the block in place, just clear the request from the list.
  if (action === "deny_request") {
    const id = String(b.request_id || "");
    if (!UUID.test(id)) return err("invalid request_id");
    const r = await sb.from("unblock_requests").update({ status: "denied", resolved_at: new Date().toISOString(), resolved_by: "admin" }).eq("id", id).select("id, key, ip").maybeSingle();
    if (r.error) return adminFail("the rate limits", r.error, { action: "save" });
    // ── DENY WAS THE ONE DECISION ON THIS PAGE THAT LEFT NO TRACE (T20 sweep #7, 2026-08-27) ────────
    // Two things were missing, and they are the two rules its own siblings on this page state out loud:
    //
    //  · IT MUST NOT SUCCEED AT NOTHING. `r.data` is null when the id matched no row (another tab
    //    already handled it), and this still answered ok:true — the page removes the row
    //    optimistically, so the admin watched it disappear believing they had decided it. `dismiss`
    //    forty lines down 404s in exactly this case, with a comment saying why; this one was missed.
    //
    //  · IT MUST BE ON RECORD. Every other action here writes a `logAction` line — unblock, approve,
    //    block, clear, allow, dismiss_all. Denying is a decision about a PERSON who is locked out of
    //    the panel and whose only remaining move was to ask, and it was the single action on this
    //    board that happened invisibly. "Who said no, and when" had no answer anywhere in the product.
    if (!r.data) return err("that request no longer exists — refresh the page", 404);
    await logAction("admin", "admin_unblock_denied", {
      level: "info",
      detail: `unblock request DENIED · ${(r.data as { key?: string }).key || (r.data as { ip?: string }).ip || id} — the block stays in place`,
    });
    return NextResponse.json({ ok: true });
  }

  // CLEAR THE WHOLE ALERT LIST (owner, 2026-08-20 — "all option should be for everything").
  // Dismiss only: it clears ALERTS and changes nothing else. Deliberately NOT offered in bulk —
  // "allow" (which resets a subject's counter, i.e. lifts a wall for whoever hit it) and "block"
  // (which bars a device from the admin panel): both decide something about ONE person, and a
  // one-tap "do that to everyone" is how a limit stops protecting anything.
  // Scoped to one restaurant when the console is, so a button under "Showing French House only"
  // cannot quietly touch nine restaurants' alerts.
  if (action === "dismiss_all") {
    const scope = typeof b.restaurant_id === "string" && UUID.test(b.restaurant_id) ? b.restaurant_id : null;
    let upd = sb.from("rate_limit_events")
      .update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: "admin" })
      .eq("status", "open");
    if (scope) upd = upd.eq("restaurant_id", scope);
    // COUNTED BEFORE, NOT COUNTED FROM WHAT CAME BACK (T19 sweep #7, 2026-09-01 — the same lesson
    // "Forget all" in app/api/admin/error-memory already carries). Asking the update to RETURN its
    // rows puts the ANSWER under PostgREST's own row cap: with more open alerts than that, every one
    // would be cleared and the audit line would record a smaller number. Rule 3 of
    // verify:admin-api-a deliberately does NOT flag a write's returning clause — correctly, it is not
    // a list read — so nothing was watching this. Rule 5 in that guard now is. A head count with the
    // SAME filter moves no rows and cannot be shortened.
    let cnt = sb.from("rate_limit_events").select("id", { count: "exact", head: true }).eq("status", "open");
    if (scope) cnt = cnt.eq("restaurant_id", scope);
    const before = await cnt;
    if (before.error) return adminFail("the rate limits", before.error, { action: "load" });
    const r = await upd;
    if (r.error) return adminFail("the rate limits", r.error, { action: "save" });
    const n = before.count ?? 0;
    await logAction("admin", "rate_limit_dismiss_all", {
      restaurant_id: scope ?? undefined, level: "info",
      detail: `Cleared ${n} limit-reached alert(s)${scope ? " (one restaurant)" : " (all restaurants)"}. No limit changed and nobody was let through or blocked.`,
    });
    return NextResponse.json({ ok: true, dismissed: n });
  }

  const eventId = String(b.event_id || "");
  if (!UUID.test(eventId)) return err("invalid event_id");

  // Block the device/IP behind an admin-login alert from reaching the admin panel.
  if (action === "block") {
    // A BLIP MUST NOT READ AS "that alert is gone" (item 21, T19 sweep #7, 2026-09-01) — on the
    // screen where a refusal means a person stays locked out.
    const eQ = await sb.from("rate_limit_events").select("id, key, subject, subject_label").eq("id", eventId).maybeSingle();
    if (eQ.error) return adminFail("that limit alert", eQ.error, { action: "load" });
    const e = eQ.data as { key: string; subject: string; subject_label: string | null } | null;
    if (!e) return err("that alert no longer exists", 404);
    if (e.key !== "admin_login") return err("blocking only applies to admin-login alerts");
    // Safeguard: never let the admin block their OWN current IP (would lock themselves out).
    if (e.subject && e.subject === clientIp(req)) return err("That's your own device — you can't block yourself.");
    await throttleBlock(`admin:${e.subject}`, e.subject_label || `admin panel · ${e.subject}`);
    // The BLOCK is what mattered and it has landed; a failure to mark the alert handled only leaves the
    // row on the board, so it is reported rather than fatal.
    const mark = await sb.from("rate_limit_events").update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: "admin" }).eq("id", eventId);
    if (mark.error) console.error("[admin/rate-limits] blocked the device but couldn't clear its alert:", mark.error.message);
    await logAction("admin", "admin_block", { level: "info", detail: `admin-panel access blocked for ${e.subject_label || e.subject}` });
    return NextResponse.json({ ok: true });
  }

  // Clear the short login lockout on the device behind an admin-login alert ("let them try again").
  // admin-login is warn-only (no blocking counter), but several wrong tries lock that IP out for a
  // few minutes via login_throttle — this lifts that so a genuine person (e.g. the owner forgot the
  // password) can retry now. Marks the alert handled.
  if (action === "clear") {
    // Checked like the block path above (item 21): "that alert no longer exists" is a sentence the
    // admin acts on, and a person waiting to be let back in pays for it being wrong.
    const eQ = await sb.from("rate_limit_events").select("id, key, subject, subject_label").eq("id", eventId).maybeSingle();
    if (eQ.error) return adminFail("that limit alert", eQ.error, { action: "load" });
    const e = eQ.data as { key: string; subject: string; subject_label: string | null } | null;
    if (!e) return err("that alert no longer exists", 404);
    if (e.key !== "admin_login") return err("clearing a lockout only applies to admin-login alerts");
    if (e.subject) await throttleUnblock(`admin:${e.subject}`);
    await sb.from("rate_limit_events").update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: "admin" }).eq("id", eventId);
    await logAction("admin", "admin_lockout_clear", { level: "info", detail: `admin-login lockout cleared for ${e.subject_label || e.subject}` });
    return NextResponse.json({ ok: true });
  }

  // ALLOW / DISMISS MUST NOT SUCCEED AT NOTHING (sweep T20). Both used to answer ok:true for an
  // event id that matches no row — the page removes the row optimistically, so the admin watched
  // it disappear and believed a wall had been lifted while the person on the floor was still
  // stuck. "clear" above already 404s in exactly this case; these two now match it. Same rule the
  // user DELETE learned in the 2026-07-07 audit: never log and report a change that didn't happen.
  if (action === "allow") {
    const eQ = await sb.from("rate_limit_events").select("id").eq("id", eventId).maybeSingle();
    if (eQ.error) return adminFail("that limit alert", eQ.error, { action: "load" });
    const e = eQ.data;
    if (!e) return err("that limit-reached record no longer exists — refresh the page", 404);
    // Reset that subject's counter now (unblock them) + mark the event handled.
    const r = await sb.rpc("lfh_rate_allow", { p_event_id: eventId, p_actor: "admin" });
    if (r.error) return adminFail("the rate limits", r.error, { action: "save" });
    await logAction("admin", "rate_limit_allow", { level: "info", detail: `rate-limit hit allowed (counter reset) · ${eventId}` });
    return NextResponse.json({ ok: true });
  }
  if (action === "dismiss") {
    const r = await sb.from("rate_limit_events").update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: "admin" }).eq("id", eventId).select("id").maybeSingle();
    if (r.error) return adminFail("the rate limits", r.error, { action: "save" });
    if (!r.data) return err("that limit-reached record no longer exists — refresh the page", 404);
    return NextResponse.json({ ok: true });
  }
  return err("unknown action");
}
