// GET /api/admin/audit — the Removals record across ALL restaurants (deletion_audit,
// mig 251): every cancelled KOT, deleted bill, dish taken off an order or off the menu,
// with the reason and the person. This is the "Audit" tab of the admin's Audit & logs
// page; the activity feed is /api/admin/oplog. Admin-gated; the admin always sees every
// restaurant's rows — the Access screen's sub-options limit managers and owners, never
// the admin. Amounts are shown (same oversight rule as the admin Bills ledger).
//
// Egress-safe: explicit column list, optional restaurant scope, hard limit — never a
// whole-table read. deletion_audit is indexed (restaurant_id, at DESC).
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";

export const dynamic = "force-dynamic";

const COLS = "id, at, kind, reason_code, reason_note, actor, actor_role, table_number, bill_no, invoice_no, kot_no, item_title, qty, amount, restaurant_id";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 1), 300);
  const restaurantId = url.searchParams.get("restaurant_id");
  if (restaurantId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(restaurantId))
    return NextResponse.json({ error: "invalid restaurant_id" }, { status: 400 });
  // ?q= free-text search over the dish title, the person and the typed reason.
  const qText = (url.searchParams.get("q") || "").trim().slice(0, 80);

  let q = sb.from("deletion_audit").select(COLS).order("at", { ascending: false }).limit(limit);
  if (restaurantId) q = q.eq("restaurant_id", restaurantId);
  if (qText) {
    const safe = qText.replace(/[%,()]/g, " ");
    q = q.or(`item_title.ilike.%${safe}%,actor.ilike.%${safe}%,reason_note.ilike.%${safe}%`);
  }

  const r = await q;
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  const rows = r.data ?? [];

  // Stamp each row with WHICH restaurant it belongs to — one batched name lookup, no N+1
  // (same pattern as /api/admin/oplog).
  const ids = Array.from(new Set(rows.map((a) => a.restaurant_id).filter(Boolean))) as string[];
  const nameById = new Map<string, string>();
  if (ids.length) {
    const rest = await sb.from("restaurants").select("id, name").in("id", ids);
    for (const x of rest.data ?? []) nameById.set(x.id, x.name);
  }
  const removals = rows.map((a) => ({ ...a, restaurant_name: a.restaurant_id ? nameById.get(a.restaurant_id) ?? null : null }));
  return NextResponse.json({ removals });
}
