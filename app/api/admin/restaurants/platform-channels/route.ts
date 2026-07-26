// Admin sets a restaurant's Platform CHANNELS — which delivery apps are live (Zomato / Swiggy /
// Website takeaway) and each channel's API key (mig 209). Stored in settings.platform_channels
// JSONB, scoped by restaurant_id. Admin-gated, service role — the owner cannot change this.
//
// SECRETS DISCIPLINE: the API key VALUE is never returned to the browser. GET reports only
// `hasKey: true/false`; the manager panel only ever learns a channel's on/off (via the editor
// route), never a key. A channel with no key still runs in demo/representation mode.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";
import { cleanClonedSettings } from "@/lib/settingsClone";
import { logAction } from "@/lib/oplog";

export const dynamic = "force-dynamic";

const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const CHANNELS = ["zomato", "swiggy", "website"] as const;
type Channel = (typeof CHANNELS)[number];
type ChanCfg = { on?: boolean; key?: string | null };
type ChanMap = Record<string, ChanCfg>;

// Public shape sent to the admin UI — on/off + whether a key is saved, NEVER the key itself.
function present(raw: unknown) {
  const m = (raw && typeof raw === "object" ? raw : {}) as ChanMap;
  const out: Record<Channel, { on: boolean; hasKey: boolean }> = {
    zomato: { on: false, hasKey: false }, swiggy: { on: false, hasKey: false }, website: { on: false, hasKey: false },
  };
  for (const c of CHANNELS) out[c] = { on: m[c]?.on === true, hasKey: typeof m[c]?.key === "string" && (m[c]!.key as string).length > 0 };
  return out;
}

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rid = req.nextUrl.searchParams.get("restaurant_id") || "";
  if (!isUuid(rid)) return NextResponse.json({ error: "missing or invalid restaurant_id" }, { status: 400 });
  const row = await sb.from("settings").select("platform_channels").eq("restaurant_id", rid).maybeSingle();
  if (row.error) return NextResponse.json({ error: row.error.message }, { status: 500 });
  return NextResponse.json({ channels: present((row.data as { platform_channels?: unknown } | null)?.platform_channels) });
}

export async function POST(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const rid = body?.restaurant_id;
  const channel = String(body?.channel || "") as Channel;
  if (!isUuid(rid)) return NextResponse.json({ error: "missing or invalid restaurant_id" }, { status: 400 });
  if (!CHANNELS.includes(channel)) return NextResponse.json({ error: "unknown channel" }, { status: 400 });

  const rest = await sb.from("restaurants").select("id, slug").eq("id", rid).maybeSingle();
  if (rest.error) return NextResponse.json({ error: rest.error.message }, { status: 500 });
  if (!rest.data) return NextResponse.json({ error: "restaurant not found" }, { status: 404 });

  const cur = await sb.from("settings").select("id, platform_channels").eq("restaurant_id", rid).maybeSingle();
  if (cur.error) return NextResponse.json({ error: cur.error.message }, { status: 500 });

  // Merge onto whatever's stored — only touch the one channel in this request.
  const existing = ((cur.data as { platform_channels?: unknown } | null)?.platform_channels || {}) as ChanMap;
  const next: ChanCfg = { ...(existing[channel] || {}) };
  if (typeof body?.on === "boolean") next.on = body.on;
  // key: a non-empty string sets it; an empty string clears it; absent leaves it unchanged.
  if (typeof body?.key === "string") { const k = body.key.trim(); next.key = k ? k.slice(0, 500) : null; }
  const merged: ChanMap = { ...existing, [channel]: next };
  const patch = { platform_channels: merged };
  // Never log the key value — only what changed.
  const logDetail = `${channel}: ${typeof body?.on === "boolean" ? (body.on ? "on" : "off") : "—"}${typeof body?.key === "string" ? (body.key.trim() ? " · key set" : " · key cleared") : ""}`;

  if (cur.data) {
    const r = await sb.from("settings").update(patch).eq("restaurant_id", rid).select("platform_channels").maybeSingle();
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
    await logAction("admin", "platform_channel", { detail: logDetail, restaurant_id: rid });
    return NextResponse.json({ channels: present((r.data as { platform_channels?: unknown } | null)?.platform_channels) });
  }
  // No settings row yet → clone #1 as a template so every NOT NULL column is satisfied, then apply.
  const template = await sb.from("settings").select("*").eq("restaurant_id", DEFAULT_RESTAURANT_ID).maybeSingle();
  const base = cleanClonedSettings(template.data);
  const newRow = { ...base, id: rest.data.slug, restaurant_id: rid, ...patch };
  const ins = await sb.from("settings").upsert(newRow, { onConflict: "restaurant_id" }).select("platform_channels").maybeSingle();
  if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
  await logAction("admin", "platform_channel", { detail: logDetail, restaurant_id: rid });
  return NextResponse.json({ channels: present((ins.data as { platform_channels?: unknown } | null)?.platform_channels), created: true });
}
