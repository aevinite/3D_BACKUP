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
const PAGE = 1000;   // PostgREST's own per-request ceiling — a bigger .limit() is silently cut to it
// The order each table is paged in: its own unique key, so paging can never repeat or skip a row.
// Five tables have no `id` column (measured 2026-10-11); each is keyed by what makes a row unique.
const ORDER_KEY: Record<string, string> = {
  categories: "slug", filters: "slug", customers: "phone", daily_counters: "key,day", seq_counters: "key",
  restaurant_owners: "user_id", restaurant_billing: "restaurant_id",
};
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
  // ── EVERY ROW, A PAGE AT A TIME (sweep #10 T29, item 12) ────────────────────────────────────────
  // Each table used to be ONE read with `.limit(CAP)` (100,000). PostgREST answers at most 1,000 rows
  // per request whatever limit is asked for, so every table stopped at 1,000 — and `truncated` was
  // only set at 100,000, so the file said `complete: true` over it. Measured on French House: 1,000
  // of 20,561 orders and 1,000 of 1,315 Removals rows, in a file offered as the thing a permanently
  // removed restaurant is rebuilt from. Now each table is read in pages of 1,000 in a fixed order (its
  // own key, so no page can repeat or skip a row), up to CAP; a table that has more says so in
  // `truncated`, and a page that fails marks the table `failed` — never a shorter list with no word.
  const readAll = async (table: string, cols = "*"): Promise<{ rows: unknown[]; truncated: boolean; error?: undefined } | { error: string; rows?: undefined; truncated?: undefined }> => {
    const rows: unknown[] = [];
    const key = ORDER_KEY[table] || "id";
    // NEXT-AFTER-THE-LAST, NOT SKIP-N (sweep #10 T29 round 2, item 22). Skipping N rows makes the
    // database walk past all N again on every page, so a 20,000-order table got slower page after page
    // — and on a busy moment the dev database stalled on exactly those deep pages, marking `orders`
    // failed. With a single unique key each page starts right after the last row it returned
    // ("keyset" paging), so every page costs the same. The one two-column key (daily_counters, one small
    // row per counter per day) keeps the old way.
    const single = !key.includes(",");
    let last: unknown = null;
    for (let from = 0; from < CAP; from += PAGE) {
      let q = sb.from(table).select(cols).eq("restaurant_id", rid);
      for (const k of key.split(",")) q = q.order(k, { ascending: true });
      if (single && last !== null) q = q.gt(key, last as string);
      const r = single ? await q.limit(Math.min(PAGE, CAP - from)) : await q.range(from, Math.min(from + PAGE, CAP) - 1);
      if (r.error) return { error: r.error.message || "this table could not be read" };
      const batch = (r.data || []) as unknown as Record<string, unknown>[];
      rows.push(...batch);
      if (batch.length < PAGE) return { rows, truncated: false };
      last = batch[batch.length - 1][key];
    }
    // Exactly CAP rows read: one more look says whether anything was left behind.
    const more = await sb.from(table).select("restaurant_id", { count: "exact", head: true }).eq("restaurant_id", rid);
    return { rows, truncated: (more.count ?? CAP + 1) > CAP };
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

  // FOUR TABLES AT A TIME (item 22): the twenty-odd tables are independent, and reading them one after
  // another made the slowest part of the download a queue. Four at once keeps the database load modest
  // (one admin, one rare deliberate download) and the file is assembled in the same table order.
  const results: Awaited<ReturnType<typeof readAll>>[] = new Array(TABLES.length);
  for (let i = 0; i < TABLES.length; i += 4) {
    const batch = await Promise.all(TABLES.slice(i, i + 4).map((t) => readAll(t)));
    batch.forEach((r, j) => { results[i + j] = r; });
  }
  for (const [ti, t] of TABLES.entries()) {
    const q = results[ti];
    if (q.error !== undefined) { backup[t] = { error: q.error }; failed.push(t); continue; }
    // THE SETTINGS ROW CARRIES A CREDENTIAL, AND THIS FILE LEAVES THE BUILDING (T17 sweep,
    // 2026-08-13, finding F3). `settings.platform_channels` holds the delivery apps' connection
    // keys (mig 209) — the two admin screens that manage them deliberately never hand the value
    // back, and this download did, into a file that gets saved to a laptop or mailed. The staff
    // rows below were already stripped of their hashes for exactly this reason; the channel keys
    // were simply not thought of. Everything else about the row is kept, so a rebuild still has
    // every setting — a channel's key is re-entered from the platform's own dashboard, which is
    // the only place it should be read from anyway.
    backup[t] = t === "settings"
      ? q.rows.map((row) => panelSafeSettings(row as Record<string, unknown>))
      : q.rows;
    if (q.truncated) truncated.push(t);
  }

  // staff_users WITHOUT secrets — a backup must never carry password/pin hashes.
  const staffQ = await readAll("staff_users", "id, username, name, role, restaurant_id, phone, active, profile_confirmed, permissions, created_at");
  backup.staff_users = staffQ.error !== undefined ? { error: staffQ.error } : staffQ.rows;
  if (staffQ.error !== undefined) failed.push("staff_users");
  if (staffQ.truncated) truncated.push("staff_users");

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
  // SENT AS A STREAM (sweep #10 T29, item 12). A complete backup is tens of megabytes now that every row
  // is in it (French House: 43.8 MB), and a hosting platform may refuse a single buffered answer that
  // large. Handing the same bytes over in 1 MB pieces changes nothing about the file the admin saves.
  const text = JSON.stringify(backup, null, 2);
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(ctl) {
      for (let i = 0; i < text.length; i += 1 << 20) ctl.enqueue(enc.encode(text.slice(i, i + (1 << 20))));
      ctl.close();
    },
  });
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="backup-${slug}-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
