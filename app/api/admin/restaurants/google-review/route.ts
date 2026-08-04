// Admin sets a restaurant's Google-review MODE + link (owner 2026-07-09, modes 2026-07-24).
// The mode is a single-select that lives under the reviews feature in the admin:
//   off                 → no Google invite (normal in-menu reviews only)
//   google              → Google review only (a "Review us on Google" CTA; in-menu rate form hidden)
//   google_plus_normal  → in-menu review form AND a Google CTA together
//   google_after_normal → the Google invite appears AFTER a guest leaves a 4–5★ in-menu review
// The destination link is google_review_url (mig 155); the mode is google_review_mode (mig 187).
// Both live on the settings row, scoped by restaurant_id. Admin-gated, service role — the owner
// cannot change this. Modeled on the sibling staff-features route.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";
import { cleanClonedSettings } from "@/lib/settingsClone";
import { logAction, deviceIdFrom } from "@/lib/oplog";

export const dynamic = "force-dynamic";

const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const MODES = ["off", "google", "google_plus_normal", "google_after_normal"] as const;
type Mode = (typeof MODES)[number];
const normalizeMode = (raw: unknown): Mode => (MODES.includes(raw as Mode) ? (raw as Mode) : "off");

// Accept an empty string (clears the link) or a plain http(s) URL, capped for sanity.
function normalizeUrl(raw: unknown): { ok: true; url: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, url: null };
  if (typeof raw !== "string") return { ok: false, error: "link must be text" };
  const u = raw.trim();
  if (!u) return { ok: true, url: null };
  if (u.length > 500) return { ok: false, error: "link is too long" };
  if (!/^https?:\/\/\S+$/i.test(u)) return { ok: false, error: "link must start with http:// or https://" };
  return { ok: true, url: u };
}

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const restaurantId = req.nextUrl.searchParams.get("restaurant_id") || "";
  if (!isUuid(restaurantId)) return NextResponse.json({ error: "missing or invalid restaurant_id" }, { status: 400 });
  const row = await sb.from("settings").select("google_review_url, google_review_mode").eq("restaurant_id", restaurantId).maybeSingle();
  if (row.error) return NextResponse.json({ error: row.error.message }, { status: 500 });
  const data = row.data as { google_review_url?: string | null; google_review_mode?: string | null } | null;
  return NextResponse.json({ url: data?.google_review_url ?? null, mode: normalizeMode(data?.google_review_mode) });
}

export async function POST(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const restaurant_id = body?.restaurant_id;
  if (!isUuid(restaurant_id)) return NextResponse.json({ error: "missing or invalid restaurant_id" }, { status: 400 });
  const norm = normalizeUrl(body?.url);
  if (!norm.ok) return NextResponse.json({ error: norm.error }, { status: 400 });
  const mode = normalizeMode(body?.mode);
  // A Google mode needs a destination — refuse to arm it with no link (else the guest CTA 404s).
  if (mode !== "off" && !norm.url) return NextResponse.json({ error: "Add the Google review link before choosing a Google mode." }, { status: 400 });

  // A FEATURE FLIP IS AUDITED (sweep 2026-08-04). These three routes wrote a per-restaurant switch
  const audit = () => logAction("admin", "google_review", {
    restaurant_id: restaurant_id as string, device_id: deviceIdFrom(req),
    detail: `Google review link ${norm.url ? "set" : "cleared"} · mode ${mode}`,
  });
  const rest = await sb.from("restaurants").select("id, slug").eq("id", restaurant_id).maybeSingle();
  if (rest.error) return NextResponse.json({ error: rest.error.message }, { status: 500 });
  if (!rest.data) return NextResponse.json({ error: "restaurant not found" }, { status: 404 });

  const cur = await sb.from("settings").select("id").eq("restaurant_id", restaurant_id).maybeSingle();
  if (cur.error) return NextResponse.json({ error: cur.error.message }, { status: 500 });

  const patch = { google_review_url: norm.url, google_review_mode: mode };
  if (cur.data) {
    const r = await sb.from("settings").update(patch).eq("restaurant_id", restaurant_id).select("google_review_url, google_review_mode").maybeSingle();
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
    await audit();
    const d = r.data as { google_review_url?: string | null; google_review_mode?: string | null } | null;
    return NextResponse.json({ url: d?.google_review_url ?? null, mode: normalizeMode(d?.google_review_mode) });
  }
  // No settings row yet → clone #1 as a template so every NOT NULL column is satisfied
  // (mirrors the features/panels/staff-features routes), then set id/restaurant_id + link + mode.
  const template = await sb.from("settings").select("*").eq("restaurant_id", DEFAULT_RESTAURANT_ID).maybeSingle();
  const base = cleanClonedSettings(template.data); // strip #1's identity/geo/tax so they don't leak
  const newRow = { ...base, id: rest.data.slug, restaurant_id, ...patch };
  const ins = await sb.from("settings").upsert(newRow, { onConflict: "restaurant_id" }).select("google_review_url, google_review_mode").maybeSingle();
  if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
  await audit();
  const d = ins.data as { google_review_url?: string | null; google_review_mode?: string | null } | null;
  return NextResponse.json({ url: d?.google_review_url ?? null, mode: normalizeMode(d?.google_review_mode), created: true });
}
