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

export const dynamic = "force-dynamic";

const PANELS = new Set(["tablet", "kitchen", "editor", "manager", "owner", "admin", "guest", "menu"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ERRORS_PER_DEVICE_10MIN = 5;

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

    if (kind === "taps") {
      const detail = String(body.detail || "").slice(0, 1500);
      if (!detail) return NextResponse.json({ ok: true, skipped: "empty" });
      await sb.from("staff_actions").insert({
        panel, action: "ui_taps", detail, device_id: device, level: "info",
        ...(rid !== null ? { restaurant_id: rid } : { restaurant_id: null }),
      });
      return NextResponse.json({ ok: true });
    }

    // kind === "error": per-device flood cap (protects the DB; no new table).
    if (device) {
      const sinceIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data } = await sb
        .from("staff_actions")
        .select("id")
        .eq("device_id", device)
        .eq("action", "client_error")
        .gte("created_at", sinceIso)
        .limit(MAX_ERRORS_PER_DEVICE_10MIN);
      if (data && data.length >= MAX_ERRORS_PER_DEVICE_10MIN) {
        return NextResponse.json({ ok: true, skipped: "rate_limited" });
      }
    }

    const message = String(body.message || "client error").slice(0, 300);
    const where = String(body.where || "").slice(0, 120);
    const detail = (where ? `${message} @ ${where}` : message).slice(0, 500);
    await sb.from("staff_actions").insert({
      panel, action: "client_error", detail, device_id: device, level: "error",
      ...(rid !== null ? { restaurant_id: rid } : { restaurant_id: null }),
    });

    // Best-effort grouped alert (15-min dedupe lives in sendOwnerAlert). Wrapped in after() so
    // the serverless platform keeps the function alive until the push completes AFTER the
    // response is sent — a bare fire-and-forget gets frozen on Vercel and drops the alert
    // (proven flaky in a live test 2026-07-24). The response stays instant; the push runs after.
    after(sendOwnerAlert(
      alertText("⚠️ A screen showed an error", [
        ["Panel", panel],
        ["Problem", message.slice(0, 160)],
        ["Screen", where || null],
      ], "Open admin → Logs to see the full detail."),
      `client:${panel}`,
      { title: `Screen error in ${panel}` },
    ).catch(() => {}));

    return NextResponse.json({ ok: true });
  } catch {
    // Never surface an error from the error-logger itself.
    return NextResponse.json({ ok: true, skipped: "internal" });
  }
}
