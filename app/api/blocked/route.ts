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

export const dynamic = "force-dynamic";

const MAX_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

// How many requests this IP filed in the last 24h.
async function usedToday(ip: string): Promise<number> {
  try {
    const since = new Date(Date.now() - DAY_MS).toISOString();
    const { count } = await sb
      .from("unblock_requests")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("created_at", since);
    return count ?? 0;
  } catch {
    return 0; // fail-open: a count blip shouldn't strand the visitor
  }
}

export async function GET(req: NextRequest) {
  const ip = clientIp(req);
  const key = `admin:${ip}`;
  const blocked = await throttleIsBlocked(key);
  const used = blocked ? await usedToday(ip) : 0;
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
