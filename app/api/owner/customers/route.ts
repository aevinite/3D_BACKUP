// GET /api/owner/customers — the OWNER's guest list (the `customers` table, mig 014),
// scoped to their restaurants + gated by the admin-controlled "customers" entitlement.
// READ-ONLY and money-free (the table holds only contact info + first/last seen). A
// "returning" guest = last_seen meaningfully after first_seen. Egress-safe: explicit
// columns, .in(restaurant_id), .limit, one cheap head-count for the true total.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { ownerScope, scopedRestaurantIds } from "@/lib/ownerScope";
import { entitledSubset } from "@/lib/ownerEntitlements";
import { cachedOwnerPayload, scopeKeyOf } from "@/lib/ownerCache";
import { logAction } from "@/lib/oplog";

export const dynamic = "force-dynamic";
// visits/consent added by Customer CRM (mig 212): a REAL repeat count + the DPDP
// opt-in flag. Still money-free (no spend column exists).
const COLS = "restaurant_id, phone, name, blocked, visits, consent, first_seen_at, last_seen_at";
const REPEAT_MIN = 2; // visits >= 2 = a returning customer (real count, not a time heuristic)

// The concrete id list for this scope. Shared helper (lib/ownerScope) because the
// admin all-restaurants read must be PAGED — three local copies each dropped restaurants
// past PostgREST's row cap (found 2026-08-04).
const scopedIds = scopedRestaurantIds;

export async function GET(req: NextRequest) {
  let scope = await ownerScope(req);
  if (!scope) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // A real owner is limited to restaurants whose "customers" section the admin still
  // allows; the admin's own session is never gated (admin = top power).
  if (!scope.all && !scope.admin) {
    const allowed = await entitledSubset(scope.ids, "customers");
    if (!allowed.length) return NextResponse.json({ error: "Customers isn't enabled for your restaurant — contact Aevidine.", disabled: true }, { status: 403 });
    scope = { ...scope, ids: allowed };
  }
  const ids = await scopedIds(scope);
  if (!ids.length) return NextResponse.json({ summary: { total: 0, returning: 0, newThisMonth: 0, blocked: 0, shown: 0 }, customers: [] });

  // Sanitised search (their own data; strip chars that would break the PostgREST or() filter).
  const search = (req.nextUrl.searchParams.get("q") || "").replace(/[,()%*]/g, "").trim();
  // Narrowing controls (owner, 2026-07-30): one restaurant, a segment, and the sort —
  // all applied in the DATABASE so the payload stays small however many guests exist.
  const sp = req.nextUrl.searchParams;
  const onlyRid = sp.get("restaurant_id") || "";
  const seg = sp.get("seg") || "all";
  const sort = sp.get("sort") === "visits" ? "visits" : "last_seen_at";
  let q = sb.from("customers").select(COLS)
    .in("restaurant_id", onlyRid && ids.includes(onlyRid) ? [onlyRid] : ids)
    .order(sort, { ascending: false }).limit(300);
  if (search) q = q.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
  if (seg === "regulars") q = q.gte("visits", REPEAT_MIN);
  if (seg === "new") q = q.lt("visits", REPEAT_MIN);
  if (seg === "blocked") q = q.eq("blocked", true);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const list = (data || []) as Array<{ restaurant_id: string; phone: string; name: string | null; blocked: boolean; visits: number; consent: boolean; first_seen_at: string; last_seen_at: string }>;

  // Restaurant names (multi-restaurant owner tells brands apart).
  const rids = [...new Set(list.map((c) => c.restaurant_id))];
  const names: Record<string, string> = {};
  if (rids.length) {
    const r = await sb.from("restaurants").select("id, name, slug").in("id", rids);
    // restaurants.name is a JSONB of translations on some rows, a plain string on others.
    for (const x of (r.data || []) as Array<{ id: string; name: unknown; slug: string }>) {
      const n = x.name;
      names[x.id] = typeof n === "string" && n.trim() ? n
        : (n && typeof n === "object" && typeof (n as Record<string, unknown>).en === "string" && ((n as Record<string, unknown>).en as string).trim())
          ? ((n as Record<string, unknown>).en as string)
          : x.slug;
    }
  }

  const monthAgo = Date.now() - 30 * 86_400_000;
  const monthAgoIso = new Date(monthAgo).toISOString();
  const customers = list.map((c) => ({ ...c, restaurantName: names[c.restaurant_id] || "—", returning: (c.visits || 0) >= REPEAT_MIN }));

  // Summary counts are TRUE scoped head-counts, not derived from the 300-row display page —
  // before this, "Blocked"/"New" undercounted for a restaurant with >300 guests (a guest
  // blocked long ago, or a busy month, fell outside the recent-300 window). `total`,
  // `blocked` and `newThisMonth` are plain column filters, so each is one cheap indexed
  // COUNT(head) scoped by restaurant_id — no extra rows fetched. `returning` needs a
  // per-row comparison of two timestamps (last_seen vs first_seen), which a column filter
  // can't express, so it stays derived from the shown page and can undercount on very busy
  // restaurants; making it exact needs a small scoped DB function (see OVERNIGHT note).
  // `returning` is now an EXACT scoped head-count (visits >= 2) — the real visit
  // counter (mig 212) lets us count it in the DB instead of eyeballing timestamps on
  // the shown page, so it no longer undercounts busy restaurants.
  // ── ONE guest's bills, with money. Their own restaurants only: the id list passed to
  // the function is the ALREADY-authorised scope, never a raw request parameter. Deliberately
  // per-guest (indexed on sessions(restaurant_id, cust_phone)) rather than a spend column on
  // every row, which would aggregate every bill on every page load.
  const detailPhone = (req.nextUrl.searchParams.get("phone") || "").replace(/\D/g, "").slice(0, 15);
  if (detailPhone) {
    const { data: hist, error: hErr } = await sb.rpc("lfh_owner_customer_bills", {
      p_restaurant_ids: ids, p_phone: detailPhone, p_limit: 20,
    });
    if (hErr) return NextResponse.json({ error: hErr.message }, { status: 500 });
    // Read this guest's rows directly — the list above is a filtered page and may not
    // contain them (searching for someone, then opening an older guest).
    const { data: mineRaw } = await sb.from("customers").select(COLS).in("restaurant_id", ids).eq("phone", detailPhone).limit(20);
    const mineRows = (mineRaw || []) as typeof list;
    // fill in any restaurant name the list page didn't already resolve
    const missing = mineRows.map((c) => c.restaurant_id).filter((id) => !names[id]);
    if (missing.length) {
      const r2 = await sb.from("restaurants").select("id, name, slug").in("id", missing);
      for (const x of (r2.data || []) as Array<{ id: string; name: unknown; slug: string }>) {
        const n = x.name;
        names[x.id] = typeof n === "string" && n.trim() ? n
          : (n && typeof n === "object" && typeof (n as Record<string, unknown>).en === "string") ? String((n as Record<string, unknown>).en) : x.slug;
      }
    }
    const mine = mineRows.map((c) => ({ ...c, restaurantName: names[c.restaurant_id] || "—" }));
    return NextResponse.json({ detail: { ...(hist || {}), rows: mine } });
  }

  // The four tiles are AGGREGATES over every guest row, so they ride the compute-on-view
  // snapshot cache (standing rule) instead of counting on every open and every 60s backstop.
  // The change-detector is the newest customer write (mig 229) — an index-only peek — so the
  // counting only re-runs when a guest was actually added or seen again. The LIST above stays
  // live: it's a paged, indexed read, not an aggregate. Placed AFTER the drawer's early return,
  // so opening one guest's record doesn't pay for the tiles at all.
  const scopeIds = onlyRid && ids.includes(onlyRid) ? [onlyRid] : ids;
  const counted = await cachedOwnerPayload({
    key: `ownercust:v1:${scopeKeyOf(scopeIds.length === 1 ? scopeIds[0] : null, false, scopeIds)}`,
    force: sp.get("refresh") === "1",
    fingerprint: async () => {
      const { data } = await sb.rpc("lfh_customers_fingerprint", { p_restaurant_id: scopeIds.length === 1 ? scopeIds[0] : null });
      return typeof data === "string" ? data : null;
    },
    compute: async () => {
      const head = () => sb.from("customers").select("phone", { count: "exact", head: true }).in("restaurant_id", scopeIds);
      const [cntAll, cntBlocked, cntNew, cntReturning] = await Promise.all([
        head(), head().eq("blocked", true), head().gte("first_seen_at", monthAgoIso), head().gte("visits", REPEAT_MIN),
      ]);
      return { total: cntAll.count ?? 0, blocked: cntBlocked.count ?? 0, newThisMonth: cntNew.count ?? 0, returning: cntReturning.count ?? 0 };
    },
  });
  const summary = {
    total: counted.total,
    returning: counted.returning,
    newThisMonth: counted.newThisMonth,
    blocked: counted.blocked,
    shown: list.length,
    cachedAt: counted.cachedAt,
  };
  const restaurantList = ids.map((id) => ({ id, name: names[id] || "" })).filter((r) => r.name);
  return NextResponse.json({ summary, customers, restaurants: restaurantList });
}

// DELETE /api/owner/customers — erase a customer (DPDP right-to-erasure, mig 212).
// Removes the customers row + their visit ledger + device links, scoped to a
// restaurant the owner actually owns AND still has the "customers" section for.
// Admin (top power) is never gated. Body: { restaurant_id, phone }.
export async function DELETE(req: NextRequest) {
  const scope = await ownerScope(req);
  if (!scope) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { restaurant_id?: string; phone?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad body" }, { status: 400 }); }
  const restaurantId = String(body?.restaurant_id || "");
  const phone = String(body?.phone || "");
  if (!restaurantId || !phone) return NextResponse.json({ error: "restaurant_id and phone required" }, { status: 400 });

  // The restaurant must be in the owner's own, still-entitled set (never trust the
  // client's restaurant_id beyond that). Admin bypasses the entitlement gate only.
  const ownIds = await scopedIds(scope);
  if (!ownIds.includes(restaurantId)) return NextResponse.json({ error: "not your restaurant" }, { status: 403 });
  if (!scope.all && !scope.admin) {
    const allowed = await entitledSubset([restaurantId], "customers");
    if (!allowed.length) return NextResponse.json({ error: "Customers isn't enabled for your restaurant.", disabled: true }, { status: 403 });
  }

  await sb.from("customer_visits").delete().eq("restaurant_id", restaurantId).eq("phone", phone);
  await sb.from("customer_devices").delete().eq("restaurant_id", restaurantId).eq("phone", phone);
  const del = await sb.from("customers").delete().eq("restaurant_id", restaurantId).eq("phone", phone).select("phone");
  if (del.error) return NextResponse.json({ error: del.error.message }, { status: 500 });
  // THE ONLY IRREVERSIBLE ERASE IN THE OWNER PANEL, AND IT WAS UNRECORDED (sweep 2026-08-04). This
  // hard-deletes the guest, their visit history and their devices — three tables, no tombstone, no
  // restore. (That is correct for a "erase my data" request under DPDP; sales rows are untouched and
  // stay under the CGST soft-delete rule.) But the FACT that it happened has to be traceable, or a
  // guest vanishing from the list is indistinguishable from a bug — and with several co-owners
  // nobody could say who did it. Only the last 4 digits are recorded: the log must not become a
  // second copy of the number the owner just asked us to erase.
  await logAction("owner", "customer_erase", {
    restaurant_id: restaurantId,
    actor: (scope.all || scope.admin) ? "admin" : (scope.ownerId || "owner"),
    detail: `erased guest record ending ${phone.slice(-4)} (${(del.data || []).length} row(s)) + their visits and devices`,
  });
  return NextResponse.json({ ok: true, erased: (del.data || []).length });
}
