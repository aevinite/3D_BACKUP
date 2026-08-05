// POST /api/log/client-error — a PUBLIC (unauthenticated) sink for two kinds of client-side
// diary lines, written by public/panels/errlog.js and the guest error reporter:
//   • kind:"error" — a browser crash (window.onerror / unhandledrejection) or a failed api() call.
//     Recorded at level 'error' so it shows red in the admin log and can trigger an owner alert.
//   • kind:"taps"  — a BATCH of recent action-button taps (one row per panel per ~30s), level
//     'info', so we can see what the user was doing right before a problem. Batched on the client
//     so this is at most one write per panel per 30s (egress rule).
//
// Because it's public, it is hardened: tiny body, strict field whitelists, and a per-device rate
// cap enforced against the log itself (no new table). It fails soft — a bad or over-limit request
// just returns ok:true without writing, so a misbehaving client can never error-storm the DB.
import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { sendOwnerAlert, alertText } from "@/lib/alerts";
import { clientIp } from "@/lib/loginThrottle";

export const dynamic = "force-dynamic";

const PANELS = new Set(["tablet", "kitchen", "editor", "manager", "owner", "admin", "guest", "menu"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ERRORS_PER_DEVICE_10MIN = 5;
// TAP BATCHES NEED THEIR OWN CEILING (T9 sweep, 2026-08-05). The error cap above was hardened for a
// cookie-less caller last sweep, but the `taps` branch RETURNED BEFORE reaching it, so that half of
// this public endpoint had no ceiling at all. A well-behaved client batches one write per panel per
// ~30s (public/panels/errlog.js), i.e. ~20 in ten minutes — 40 leaves generous headroom for two
// panels open on one device while still bounding the damage.
const MAX_TAPS_PER_DEVICE_10MIN = 40;

// How many rows this device/IP already wrote for one action in the last ten minutes. Shared by
// both branches so the two caps can't drift apart again.
async function recentCount(capKey: string, action: string, max: number): Promise<number> {
  const sinceIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data } = await sb
    .from("staff_actions")
    .select("id")
    .eq("device_id", capKey)
    .eq("action", action)
    .gte("created_at", sinceIso)
    .limit(max);
  return data?.length ?? 0;
}

export async function POST(req: NextRequest) {
  try {
    // Cap the body hard: a runaway stack trace or a hostile payload can't be huge.
    const raw = await req.text();
    if (raw.length > 2048) return NextResponse.json({ ok: true, skipped: "too_large" });
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(raw || "{}"); } catch { return NextResponse.json({ ok: true, skipped: "bad_json" }); }

    const panel = String(body.panel || "").toLowerCase();
    if (!PANELS.has(panel)) return NextResponse.json({ ok: true, skipped: "bad_panel" });
    const kind = body.kind === "taps" ? "taps" : "error";

    // Optional restaurant scope: trust it only if it's a well-formed uuid, else leave null.
    const ridRaw = typeof body.rid === "string" ? body.rid : "";
    const rid = UUID.test(ridRaw) ? ridRaw : null;

    // Device id from the per-panel cookie (set by /panels/maint.js). The rate cap keys on it.
    const device = req.cookies.get("lfh_panel_device")?.value || null;
    // THE CAP MUST APPLY WHETHER OR NOT THERE IS A COOKIE (sweep 2026-08-04). This endpoint is
    // PUBLIC, and the flood cap below used to sit inside `if (device)`. A caller with no cookie was
    // therefore uncapped: every request wrote a level:'error' row, so the admin's Logs and Repair
    // board could be filled with rows that look like a restaurant in trouble and push the real
    // errors off the first page — the same "a board full of non-faults is a board nobody reads"
    // reasoning the errlog noise filter was built on. The IP is derived server-side (never from the
    // body) and is only ever used as this counter's key.
    const capKey = device || `ip:${clientIp(req)}`;

    if (kind === "taps") {
      const detail = String(body.detail || "").slice(0, 1500);
      if (!detail) return NextResponse.json({ ok: true, skipped: "empty" });
      // Same ceiling reasoning as the error branch below — see MAX_TAPS_PER_DEVICE_10MIN.
      if (await recentCount(capKey, "ui_taps", MAX_TAPS_PER_DEVICE_10MIN) >= MAX_TAPS_PER_DEVICE_10MIN) {
        return NextResponse.json({ ok: true, skipped: "rate_limited" });
      }
      await sb.from("staff_actions").insert({
        // Written under capKey, not `device`, for exactly the reason the error row below is:
        // the cap counts rows BY device_id, so a cookie-less caller's rows must carry the same
        // key or its own cap would forever count zero of them.
        panel, action: "ui_taps", detail, device_id: capKey, level: "info",
        ...(rid !== null ? { restaurant_id: rid } : { restaurant_id: null }),
      });
      return NextResponse.json({ ok: true });
    }

    // kind === "error": per-device (or per-IP) flood cap (protects the DB; no new table).
    if (await recentCount(capKey, "client_error", MAX_ERRORS_PER_DEVICE_10MIN) >= MAX_ERRORS_PER_DEVICE_10MIN) {
      return NextResponse.json({ ok: true, skipped: "rate_limited" });
    }

    const message = String(body.message || "client error").slice(0, 300);
    const where = String(body.where || "").slice(0, 120);
    const detail = (where ? `${message} @ ${where}` : message).slice(0, 500);
    // Written under capKey, not `device` — the cap counts rows by device_id, so a cookie-less
    // caller's rows must carry the same key or the cap would count zero of them forever.
    await sb.from("staff_actions").insert({
      panel, action: "client_error", detail, device_id: capKey, level: "error",
      ...(rid !== null ? { restaurant_id: rid } : { restaurant_id: null }),
    });

    // Best-effort grouped alert (15-min dedupe lives in sendOwnerAlert). Wrapped in after() so
    // the serverless platform keeps the function alive until the push completes AFTER the
    // response is sent — a bare fire-and-forget gets frozen on Vercel and drops the alert
    // (proven flaky in a live test 2026-07-24). The response stays instant; the push runs after.
    after(sendOwnerAlert(
      alertText([
        ["Problem", message.slice(0, 160)],
        ["Screen", where || null],
      ], "Open admin → Logs to see the full detail."),
      `client:${panel}`,
      { title: `Screen error in ${panel}`, tags: "warning" },
    ).catch(() => {}));

    return NextResponse.json({ ok: true });
  } catch {
    // Never surface an error from the error-logger itself.
    return NextResponse.json({ ok: true, skipped: "internal" });
  }
}
