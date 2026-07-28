// GET/DELETE /api/admin/error-memory — the list of problems already dealt with (mig 218).
//
// The Repair page uses this for two things:
//   1) a "Dealt with" panel the owner can review and undo ("Show this again"), so muting is never
//      a one-way door;
//   2) labelling a live problem tile "came back after the fix on <date>" — a problem recorded as
//      fixed that is happening again means the fix did NOT hold, and that has to be visible.
//
// Admin-gated, bounded, newest first. Restaurant names are resolved in ONE map read (no N+1).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { logAction } from "@/lib/oplog";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return err("unauthorized", 401);
  const rid = new URL(req.url).searchParams.get("restaurant_id");
  if (rid && !UUID.test(rid)) return err("invalid restaurant_id");

  let q = sb.from("error_signatures")
    .select("id, restaurant_id, panel, action, sig, state, fixed_at, fixed_by, pr_url, note, recurrences, last_seen_at")
    .order("fixed_at", { ascending: false }).limit(100);
  // A NULL-restaurant signature covers every restaurant, so it belongs in a scoped view too.
  if (rid) q = q.or(`restaurant_id.eq.${rid},restaurant_id.is.null`);
  const r = await q;
  if (r.error) return err(r.error.message, 500);
  const rows = (r.data ?? []) as { restaurant_id: string | null }[];

  const ids = [...new Set(rows.map((x) => x.restaurant_id).filter(Boolean))] as string[];
  let names = new Map<string, string>();
  if (ids.length) {
    const n = await sb.from("restaurants").select("id, name").in("id", ids);
    names = new Map(((n.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
  }
  return NextResponse.json({
    memories: rows.map((x) => ({ ...x, restaurant: x.restaurant_id ? names.get(x.restaurant_id) || "—" : "All restaurants" })),
  });
}

// DELETE ?id=… — forget one memory ("Show this again"). The error alarms normally from now on.
export async function DELETE(req: NextRequest) {
  if (!(await admin(req))) return err("unauthorized", 401);
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!UUID.test(id)) return err("invalid id");
  const r = await sb.from("error_signatures").delete().eq("id", id).select("panel, action, sig, state, restaurant_id").maybeSingle();
  if (r.error) return err(r.error.message, 500);
  if (!r.data) return err("that entry is already gone", 404);
  const gone = r.data as { panel: string; action: string; sig: string; restaurant_id: string | null };
  await logAction("admin", "error_memory_cleared", {
    restaurant_id: gone.restaurant_id ?? undefined, level: "info",
    detail: `Show again: ${gone.panel}/${gone.action} — ${gone.sig.slice(0, 90)}`,
  });
  return NextResponse.json({ ok: true });
}
