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
import { capKeyFor, recentActionCount } from "@/lib/publicCap";
import { getRestaurantBySlug } from "@/lib/tenant";

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

// The 10-minute window both branches count in. The COUNT itself and the "who is calling" decision
// now live in lib/publicCap (T9 improvement 18, 2026-08-06) — the same two helpers /api/guest/limit-hit
// uses, so the two public write paths cannot drift apart on what a caller is or how it is counted.
const WINDOW_MS = 10 * 60 * 1000;

// ── A TILE THAT NAMES NO RESTAURANT CANNOT BE ACTED ON (T17 follow-up, 2026-08-20) ────────────
// Five problems were sitting on the Repair board with no restaurant against them, three of them
// from the French House guest menu — whose own address SAYS which restaurant it is
// (`/r/french-house/menu`). They arrived that way because the React error boundaries report through
// lib/errorReport.ts, which never sent `rid` at all; only the static panels tag the tenant
// (public/panels/errlog.js → LFH_RT.getRid()). So the admin's restaurant picker could not narrow to
// them and "Showing French House only" hid the very rows that were French House's.
//
// The address is already in hand — it is what we store as `where` — so the restaurant is derivable
// here, for old shapes and new alike, without asking the client to change. getRestaurantBySlug is
// the project's ONE resolver (lib/tenant.ts) and it is memoised for 15s, so a burst of reports from
// one crashing menu costs a single lookup, not one per row.
//
// Deliberately only the GUEST doors: `/r/<slug>/…` names its restaurant, `/owner/khata` does not,
// and an owner looking at "all restaurants" genuinely has no single one — guessing there would put
// a wrong name on a problem, which is worse than none.
const SLUG_IN_PATH = /(?:^|[^a-z0-9])\/?r\/([a-z0-9][a-z0-9-]{0,60})(?:\/|$|\s|#|\?)/i;

// ── WHICH BROWSER, IN FOUR WORDS (2026-08-20) ────────────────────────────────────────────────
// Two problems on the Repair board could not be chased at all: five reports of "The operation is
// insecure." and three of a minified React error, both on the French House guest menu. Driven
// again — normally, and with a browser rigged to refuse storage exactly the way Safari's private
// mode does — the menu opens clean both times. The reports are real, but nothing in them says WHOSE
// browser, so there is no way to tell a Safari-only fault from a Chrome one, or a phone from a
// laptop. "The operation is insecure." is not even a message Chrome produces: it is Safari's and
// Firefox's wording, which is the single most useful fact about it, and we had to infer it.
//
// So the row now carries a short browser tag. Deliberately SHORT and derived server-side:
//   · the whole User-Agent is 150+ characters of noise on a screen a person reads, and this
//     endpoint's detail is capped at 500 for good reason;
//   · deriving it here means both reporters (the panels' errlog.js and the React boundaries) get
//     it without either of them changing, and old clients get it too;
//   · a browser NAME and platform is what makes a bug reproducible. Nothing here identifies a
//     person — no full UA, no version minutiae, no device id beyond the cap key already stored.
function browserTag(ua: string | null): string {
  const s = String(ua || "");
  if (!s) return "";
  // Order matters: every one of these also claims to be "Safari", and Chrome-on-iOS says "CriOS".
  const name =
    /\bEdg\//.test(s) ? "Edge" :
    /\b(CriOS|Chrome)\//.test(s) ? "Chrome" :
    /\bFirefox|FxiOS\//.test(s) ? "Firefox" :
    /\bSamsungBrowser\//.test(s) ? "Samsung" :
    /\bSafari\//.test(s) ? "Safari" : "";
  const platform =
    /\biPhone\b/.test(s) ? "iPhone" :
    /\biPad\b/.test(s) ? "iPad" :
    /\bAndroid\b/.test(s) ? "Android" :
    /\bMac OS X\b/.test(s) ? "Mac" :
    /\bWindows\b/.test(s) ? "Windows" :
    /\bLinux\b/.test(s) ? "Linux" : "";
  const both = [name, platform].filter(Boolean).join(" · ");
  return both ? ` [${both}]` : "";
}

async function ridFromAddress(where: string, referer: string | null): Promise<string | null> {
  for (const candidate of [where, referer || ""]) {
    const slug = candidate.match(SLUG_IN_PATH)?.[1];
    if (!slug) continue;
    try {
      const r = await getRestaurantBySlug(slug);
      if (r?.id) return r.id;
    } catch { /* the log line matters more than its label — fall through to null */ }
  }
  return null;
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

    // WHO is calling: the per-panel device cookie (set by /panels/maint.js) when there is one, else
    // the server-derived IP. That decision now lives in ONE place — capKeyFor (lib/publicCap) — which
    // /api/guest/limit-hit uses too, so the two public write paths cannot disagree about it.
    //
    // THE CAP MUST APPLY WHETHER OR NOT THERE IS A COOKIE (sweep 2026-08-04). This endpoint is
    // PUBLIC, and the flood cap below used to sit inside `if (device)`. A caller with no cookie was
    // therefore uncapped: every request wrote a level:'error' row, so the admin's Logs and Repair
    // board could be filled with rows that look like a restaurant in trouble and push the real
    // errors off the first page — the same "a board full of non-faults is a board nobody reads"
    // reasoning the errlog noise filter was built on. The IP is derived server-side (never from the
    // body) and is only ever used as this counter's key.
    const capKey = capKeyFor(req);

    if (kind === "taps") {
      const detail = String(body.detail || "").slice(0, 1500);
      if (!detail) return NextResponse.json({ ok: true, skipped: "empty" });
      // Same ceiling reasoning as the error branch below — see MAX_TAPS_PER_DEVICE_10MIN.
      if (await recentActionCount(capKey, "ui_taps", WINDOW_MS, MAX_TAPS_PER_DEVICE_10MIN) >= MAX_TAPS_PER_DEVICE_10MIN) {
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
    if (await recentActionCount(capKey, "client_error", WINDOW_MS, MAX_ERRORS_PER_DEVICE_10MIN) >= MAX_ERRORS_PER_DEVICE_10MIN) {
      return NextResponse.json({ ok: true, skipped: "rate_limited" });
    }

    const message = String(body.message || "client error").slice(0, 300);
    const where = String(body.where || "").slice(0, 120);
    // The browser tag goes on the END, after the address, so the readable part of the line is
    // untouched and the Repair board's one-line view still leads with the message.
    const detail = `${where ? `${message} @ ${where}` : message}${browserTag(req.headers.get("user-agent"))}`.slice(0, 500);
    // No rid from the client → read it off the address the crash happened at (see ridFromAddress).
    // Only for a real error row: the tap batches above are already tagged by the panels.
    const scoped = rid ?? await ridFromAddress(where, req.headers.get("referer"));
    // Written under capKey, not `device` — the cap counts rows by device_id, so a cookie-less
    // caller's rows must carry the same key or the cap would count zero of them forever.
    await sb.from("staff_actions").insert({
      panel, action: "client_error", detail, device_id: capKey, level: "error",
      restaurant_id: scoped,
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
