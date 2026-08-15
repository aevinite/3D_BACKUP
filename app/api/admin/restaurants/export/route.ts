// GET /api/admin/restaurants/export?rid=<uuid> — download a full JSON backup of
// ONE restaurant (the row + every tenant-scoped table it owns). Offered before a
// permanent purge so a mistaken erase can be rebuilt from the file. Admin-gated,
// service role. Secrets are stripped: no password/pin hashes from staff_users, and no
// delivery-channel connection keys from settings (lib/panelSettings.ts).
//
// This is a rare, deliberate admin action, so a full scoped read is acceptable —
// it is NOT a hot/polled path. Each table is capped so a huge restaurant can't
// OOM the server; a hit cap is flagged in the file's `truncated` list.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";
import { logAction } from "@/lib/oplog";
// The one list of settings columns that are credentials, not settings.
import { panelSafeSettings } from "@/lib/panelSettings";

export const dynamic = "force-dynamic";
const CAP = 100_000; // per-table row cap for the backup
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

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
  if (!isUuid(rid)) return NextResponse.json({ error: "Missing or invalid rid." }, { status: 400 });

  const restQ = await sb.from("restaurants").select("*").eq("id", rid).maybeSingle();
  if (restQ.error) return adminFail("this restaurant's backup", restQ.error, { action: "load" });
  if (!restQ.data) return NextResponse.json({ error: "Restaurant not found." }, { status: 404 });

  // This recovery file DELIBERATELY contains financial records (order totals, payment
  // amounts) so a mistaken purge can be fully rebuilt — the one admin path where money is
  // present by design (owner-approved 2026-07-07). It is a disaster-recovery download, not a
  // browsable earnings view; `containsFinancials` flags that, and we log every export below.
  const backup: Record<string, unknown> = {
    _meta: {
      kind: "aevidine-restaurant-recovery-backup", version: 1,
      exportedAt: new Date().toISOString(), restaurantId: rid,
      containsFinancials: true,
      note: "Data-recovery backup. Contains financial records — store securely.",
    },
    restaurant: restQ.data,
  };
  const truncated: string[] = [];

  for (const t of TABLES) {
    const q = await sb.from(t).select("*").eq("restaurant_id", rid).limit(CAP);
    if (q.error) { backup[t] = { error: q.error.message }; continue; }
    // THE SETTINGS ROW CARRIES A CREDENTIAL, AND THIS FILE LEAVES THE BUILDING (T17 sweep,
    // 2026-08-13, finding F3). `settings.platform_channels` holds the delivery apps' connection
    // keys (mig 209) — the two admin screens that manage them deliberately never hand the value
    // back, and this download did, into a file that gets saved to a laptop or mailed. The staff
    // rows below were already stripped of their hashes for exactly this reason; the channel keys
    // were simply not thought of. Everything else about the row is kept, so a rebuild still has
    // every setting — a channel's key is re-entered from the platform's own dashboard, which is
    // the only place it should be read from anyway.
    backup[t] = t === "settings"
      ? (q.data || []).map((row) => panelSafeSettings(row as Record<string, unknown>))
      : (q.data || []);
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
  // Audit trail: record that a full recovery backup (with financials) was downloaded.
  await logAction("admin", "restaurant_export", { detail: "recovery backup downloaded (contains financials)", restaurant_id: rid });
  return new NextResponse(JSON.stringify(backup, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="backup-${slug}-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
