// GET /api/admin/restaurants/export?rid=<uuid> — download a full JSON backup of
// ONE restaurant (the row + every tenant-scoped table it owns). Offered before a
// permanent purge so a mistaken erase can be rebuilt from the file. Admin-gated,
// service role. Secrets are stripped from staff_users (no password/pin hashes).
//
// This is a rare, deliberate admin action, so a full scoped read is acceptable —
// it is NOT a hot/polled path. Each table is capped so a huge restaurant can't
// OOM the server; a hit cap is flagged in the file's `truncated` list.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";

export const dynamic = "force-dynamic";
const CAP = 100_000; // per-table row cap for the backup

// Tenant tables to include (staff_users handled separately to drop secrets).
const TABLES = [
  "settings", "categories", "filters", "menu_items",
  "sessions", "session_members", "orders", "order_items",
  "payments", "aggregator_orders", "feedback", "reviews",
  "customers", "waiter_calls", "requests", "blocklist",
  "staff_actions", "daily_counters", "seq_counters",
  "restaurant_owners", "restaurant_billing", "restaurant_payments", "issues",
] as const;

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rid = new URL(req.url).searchParams.get("rid") || "";
  if (!rid) return NextResponse.json({ error: "Missing rid." }, { status: 400 });

  const restQ = await sb.from("restaurants").select("*").eq("id", rid).maybeSingle();
  if (restQ.error) return NextResponse.json({ error: restQ.error.message }, { status: 500 });
  if (!restQ.data) return NextResponse.json({ error: "Restaurant not found." }, { status: 404 });

  const backup: Record<string, unknown> = {
    _meta: { kind: "aevidine-restaurant-backup", version: 1, exportedAt: new Date().toISOString(), restaurantId: rid },
    restaurant: restQ.data,
  };
  const truncated: string[] = [];

  for (const t of TABLES) {
    const q = await sb.from(t).select("*").eq("restaurant_id", rid).limit(CAP);
    if (q.error) { backup[t] = { error: q.error.message }; continue; }
    backup[t] = q.data || [];
    if ((q.data?.length || 0) >= CAP) truncated.push(t);
  }

  // staff_users WITHOUT secrets — a backup must never carry password/pin hashes.
  const staffQ = await sb.from("staff_users")
    .select("id, username, name, role, restaurant_id, phone, active, profile_confirmed, permissions, created_at")
    .eq("restaurant_id", rid).limit(CAP);
  backup.staff_users = staffQ.error ? { error: staffQ.error.message } : (staffQ.data || []);

  (backup._meta as Record<string, unknown>).truncated = truncated;

  const slug = (restQ.data as { slug?: string }).slug || rid;
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(backup, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="backup-${slug}-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
