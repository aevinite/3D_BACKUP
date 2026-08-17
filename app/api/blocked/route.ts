// Public endpoint for a device that the admin has BLOCKED from the admin panel.
//   GET  → { blocked, usedToday, remaining, pending } for THIS device's IP (drives the blocked page
//          + its Retry button).
//   POST → file one "please unblock me" request. Allowed only while genuinely blocked, and capped at
//          MAX_PER_DAY per IP over the last 24h. Deliberately writes ONLY to unblock_requests — it
//          never pings the phone or the bell (owner's call: these requests are scroll-only).
//
// The IP is derived server-side from proxy headers (clientIp) — never trusted from the body — so a
// caller can't file requests as, or peek at, another device. No admin cookie: this is the one thing
// a blocked visitor is allowed to do.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { clientIp, throttleIsBlocked } from "@/lib/loginThrottle";
import { deviceIdFrom } from "@/lib/oplog";
import { capKeyFor, withinMemoryCap } from "@/lib/publicCap";

export const dynamic = "force-dynamic";

const MAX_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

// How many requests this IP filed in the last 24h.
// Returns the count, or NULL when it genuinely could not be read.
//
// ── THE TWO CALLERS WANT OPPOSITE THINGS, AND THAT IS THE WHOLE POINT (T9 finding F25, 2026-08-12) ──
// This used to swallow every failure as `0`, with the comment "fail-open: a count blip shouldn't
// strand the visitor". That is exactly right for the GET, which only draws the page — and exactly
// wrong for the POST, which uses the same function to ENFORCE the 3-per-day cap. A zero on failure
// means "you have used none of your three", so for as long as the count was unreadable an IP could
// file unlimited rows. A limiter that stops limiting the moment its counter breaks is not a limiter.
//
// So the two states are separated and each caller decides: the page still renders on doubt, the
// write still refuses on doubt.
async function usedToday(ip: string): Promise<number | null> {
  try {
    const since = new Date(Date.now() - DAY_MS).toISOString();
    const { count, error } = await sb
      .from("unblock_requests")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("created_at", since);
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const ip = clientIp(req);
  const key = `admin:${ip}`;
  // ── A CEILING ON THE READ TOO (improvement I3, owner 2026-08-12) ───────────────────────────────
  // The POST below has been capped at 3 a day since it shipped; this GET had no limit at all, and it
  // is a PUBLIC page that hits the database twice per load (the throttle check plus the count). One
  // line, now that lib/publicCap holds the shape.
  //
  // Generous on purpose — 20 in a minute is far more than a person tapping Retry, so a genuinely
  // stuck visitor never meets it — and it degrades to the SAME page rather than an error, just
  // without the fresh counts. Being told "you are still blocked" is the part that matters, and that
  // comes from the throttle, not from the count.
  //
  // ── "COULDN'T COUNT" MUST NOT READ AS "YOU'VE USED THEM ALL" (T10 sweep, improvement I1) ──────
  // This used to answer `remaining: 0`, and app/staff-login/BlockedView.tsx computes
  // `outOfTries = remaining <= 0` — which DISABLES both the note box and the "Request unblock"
  // button and puts "0 left today" under them. So the one thing a blocked person is allowed to do
  // was taken away, and the screen told them a number that was never counted. The cap is not about
  // them: `capKeyFor` falls back to the server-derived IP, so a restaurant behind one connection
  // shares this bucket between every device on it — a manager and two waiters all checking after a
  // block reach 20 a minute far sooner than one person would.
  //
  // The honest degraded answer is "we didn't count, so assume nothing is used": the page stays
  // usable, and the REAL cap is enforced where it has always been — on the POST below, which does
  // its own count and refuses closed on doubt. Nothing here can hand out a fourth request.
  if (!withinMemoryCap(`blocked:get:${capKeyFor(req)}`, 60_000, 20)) {
    return NextResponse.json({ blocked: true, usedToday: 0, remaining: MAX_PER_DAY, pending: false, throttled: true });
  }
  const blocked = await throttleIsBlocked(key);
  // The PAGE fails open, deliberately: an unreadable counter must not stop a blocked visitor seeing
  // the page that explains their situation. Only the WRITE below treats "couldn't count" as a refusal.
  const used = (blocked ? await usedToday(ip) : 0) ?? 0;
  // Any still-open request from this IP → so the page can say "already asked, waiting".
  let pending = false;
  if (blocked) {
    const { data } = await sb.from("unblock_requests").select("id").eq("ip", ip).eq("status", "open").limit(1);
    pending = !!(data && data.length);
  }
  return NextResponse.json({ blocked, usedToday: used, remaining: Math.max(0, MAX_PER_DAY - used), pending });
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const key = `admin:${ip}`;
  if (!(await throttleIsBlocked(key))) {
    // Not blocked (maybe just unblocked) → tell the client to reload back to the login form.
    return NextResponse.json({ ok: false, reason: "not_blocked" });
  }
  const used = await usedToday(ip);
  // COULDN'T COUNT → REFUSE, and say it is temporary so the page offers a retry rather than
  // implying they are out of requests. This is the half that must fail CLOSED (see usedToday).
  if (used === null) {
    return NextResponse.json({ ok: false, reason: "try_later", transient: true }, { status: 503 });
  }
  if (used >= MAX_PER_DAY) {
    return NextResponse.json({ ok: false, reason: "limit", remaining: 0 });
  }
  let message: string | null = null;
  try {
    const b = (await req.json()) as { message?: unknown };
    if (typeof b.message === "string" && b.message.trim()) message = b.message.trim().slice(0, 200);
  } catch { /* message is optional */ }

  const ins = await sb.from("unblock_requests").insert({
    key, ip, device_id: deviceIdFrom(req), message, status: "open",
  }).select("id").maybeSingle();
  if (ins.error) return NextResponse.json({ ok: false, reason: "save_failed" }, { status: 500 });

  return NextResponse.json({ ok: true, remaining: Math.max(0, MAX_PER_DAY - (used + 1)) });
}
