// GET/POST /api/maintenance — read or flip the guest-menu maintenance switch
// (settings.service_mode = the "we'll be right back" screen) FOR THE ACTING RESTAURANT.
// Restricted to the MANAGER (and the admin super-user): only the manager panel + the admin
// panel expose it now — kitchen and tablet no longer can. requireRole("manager") passes
// for a logged-in manager OR the admin super-user, and rejects everyone else.
//
// TENANT SCOPE (fixed 2026-07-08): this used to read/write settings.eq("id","site") — the
// FIRST restaurant's legacy row — for EVERY caller. So a non-#1 manager tapping "take menu
// offline" flipped restaurant #1's menu (and saw #1's status) while their own menu never went
// offline. It now resolves the acting restaurant with panelRestaurantId (the same rule the
// editor panel uses: the logged-in manager's own restaurant, or the admin's per-tab ?rid) and
// scopes every read/write by restaurant_id.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { requireRole } from "@/lib/userAuth";
import { panelRestaurantId } from "@/lib/panelScope";

export const dynamic = "force-dynamic";

// Resolve the acting restaurant for a manager/admin request, or return the HTTP error to send.
async function scope(req: NextRequest, forWrite = false): Promise<{ rid: string } | { error: NextResponse }> {
  const g = await requireRole(req, "manager");
  if (!g.ok) {
    // transient = auth lookup failed (DB blip) → 503 so the client retries instead of logging out.
    return {
      error: g.transient
        ? NextResponse.json({ error: "Server can't reach the database — retrying." }, { status: 503 })
        : NextResponse.json({ error: "Not authorised." }, { status: 401 }),
    };
  }
  const rid = panelRestaurantId(req, g);
  if (!rid) return { error: NextResponse.json({ error: "No restaurant in context." }, { status: 400 }) };

  // WHO MAY TAKE THE MENU DOWN (owner, 2026-08-01). Taking it down stops every guest ordering,
  // so it is handed over deliberately: Access → Menu → "Put menu on maintenance", which is OFF
  // for every restaurant until someone switches it on, and then says whether the manager gets it
  // as well as the owner. Enforced on the WRITE only — reading the current state is harmless and
  // the panels need it to render their badge. The admin super-user (no staff cookie) always may.
  if (forWrite && g.user) {
    const cfg = (await sb.from("restaurants").select("access_config").eq("id", rid).maybeSingle()).data?.access_config as
      { maintenance?: { on?: boolean; manager_opts?: { who?: string } } } | null;
    const allowed = cfg?.maintenance?.on === true;
    const who = cfg?.maintenance?.manager_opts?.who === "owner_manager" ? "owner_manager" : "owner";
    const isOwner = g.user.role === "owner";
    if (!allowed || (!isOwner && who !== "owner_manager")) {
      return { error: NextResponse.json({ error: "Taking the menu down isn't switched on for you — ask your admin." }, { status: 403 }) };
    }
  }
  return { rid };
}

export async function GET(req: NextRequest) {
  const s = await scope(req);
  if ("error" in s) return s.error;
  const r = await sb.from("settings").select("service_mode").eq("restaurant_id", s.rid).maybeSingle();
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  return NextResponse.json({ maintenance: (r.data || {}).service_mode === true });
}

export async function POST(req: NextRequest) {
  const s = await scope(req, true);
  if ("error" in s) return s.error;
  const body = await req.json().catch(() => ({}));
  const on = body?.on === true;
  const r = await sb.from("settings").update({ service_mode: on }).eq("restaurant_id", s.rid).select("service_mode");
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  return NextResponse.json({ maintenance: (r.data?.[0] || {}).service_mode === true });
}
