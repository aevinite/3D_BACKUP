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
  // The money trail (T20 sweep, 2026-08-16). A file offered as the thing you rebuild a restaurant
  // from carried its orders and payments but none of its invoice history, refunds, split payments
  // or the record of what was removed and why — so a rebuilt restaurant would have had its sales
  // and no way to prove what happened to any of them.
  "invoice_events", "credit_notes", "session_payments", "deletion_audit",
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
  // ── A BACKUP THAT IS INCOMPLETE MUST SAY SO AT THE TOP (T20 sweep, 2026-08-19) ─────────────────
  // A failed table read already put `{ error: … }` in place of that table's rows, which is right —
  // this file is what you rebuild a restaurant from, so whoever reads it needs to know which table
  // came back empty and why. But it was only visible if you happened to scroll to that key in a
  // hundred-thousand-line JSON: `_meta` listed `truncated` and said nothing about tables that failed
  // outright. So the download looked like a complete backup, with a 200 and a filename, while a
  // table's worth of the restaurant was quietly missing.
  //
  // Same reasoning as `truncated` itself and as the owner-panel `partial` rule: an answer that could
  // not be complete has to name what is missing rather than let the reader assume it is all there.
  const failed: string[] = [];

  for (const t of TABLES) {
    const q = await sb.from(t).select("*").eq("restaurant_id", rid).limit(CAP);
    if (q.error) { backup[t] = { error: q.error.message }; failed.push(t); continue; }
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
  if (staffQ.error) failed.push("staff_users");

  const meta = backup._meta as Record<string, unknown>;
  meta.truncated = truncated;
  meta.failed = failed;
  // The one line a person reads before trusting the file. `complete: false` is what a restore script
  // would branch on; the note is what a human would.
  meta.complete = failed.length === 0;
  if (failed.length) {
    meta.note = `INCOMPLETE BACKUP — ${failed.length} table${failed.length === 1 ? "" : "s"} could not be read `
      + `(${failed.join(", ")}). Each one holds an "error" instead of its rows. Take the backup again before `
      + `relying on this file. Contains financial records — store securely.`;
  }

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
