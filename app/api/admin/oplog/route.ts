// GET /api/admin/oplog — recent staff actions across all panels, for the admin's
// "Recent activity" feed (the combined who-did-what view). Admin-gated.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { redactMoney } from "@/lib/oplog";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // ?limit lets the Overview feed ask for a few (30) and the Logs page ask for more
  // (up to 200). The admin sees ALL panels including admin actions (unlike the manager).
  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "30", 10) || 30, 1), 200);
  // ?restaurant_id scopes to ONE restaurant — used by the per-restaurant Report's
  // "recent activity" panel so it doesn't drag in every other tenant's rows.
  const restaurantId = url.searchParams.get("restaurant_id");
  // Reject a malformed id before it hits a uuid column (else Postgres returns a raw
  // "invalid input syntax for type uuid" in the 500 body — every sibling route validates).
  if (restaurantId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(restaurantId))
    return NextResponse.json({ error: "invalid restaurant_id" }, { status: 400 });
  // ?level=error|warn|info filters severity (Everything Log, mig 159) — e.g. "just show me
  // what broke". ?q= is a free-text search over the action + detail (the incident hunt).
  const level = url.searchParams.get("level");
  // ?action=<exact> — ONE kind of row, matched by equality, not by the ?q= ILIKE below. The
  // Access screen's "recent changes here" strip asks for action=access_change on one restaurant,
  // and an ILIKE over action+detail would also drag in every row whose DETAIL happened to say
  // "access". Equality rides the existing (restaurant_id, created_at DESC) index straight to a
  // handful of rows. Length-capped and character-restricted so it can only ever be an action name.
  const actionEq = (url.searchParams.get("action") || "").trim().slice(0, 40);
  const actionOk = /^[a-z0-9_]+$/.test(actionEq);
  const qText = (url.searchParams.get("q") || "").trim().slice(0, 80);
  // ?since=<ISO> bounds the query to rows newer than a timestamp — the Repair hub asks for
  // the last 24h so its "problems (24h)" label is TRUE (before this it fetched the latest N
  // rows of ANY age and mislabelled them 24h, disagreeing with the 24h-bounded bell). Ignored
  // if malformed so a bad value can never widen the result to the whole table.
  const sinceRaw = url.searchParams.get("since");
  const since = sinceRaw && !isNaN(Date.parse(sinceRaw)) ? new Date(sinceRaw).toISOString() : null;
  // Only the columns the activity feed actually renders — not select("*") — so we don't move
  // unused columns across the wire on every refresh (egress trim, 2026-07-07). `level` added
  // so the viewer can colour error rows red.
  // ?unresolved=1 — used by the Repair "Problems right now" list to hide errors the owner (or a
  // fix) has already cleared. The full Logs page omits it, so it still shows resolved rows.
  const unresolvedOnly = url.searchParams.get("unresolved") === "1";
  // device_id / actor_id / order_id ride along so the click-to-open detail popup can show
  // exactly WHICH tablet did it, the stable acting-user id, and link the order — the list
  // itself still renders only a few of these (small extra columns, low-volume feed).
  let q = sb.from("staff_actions").select("id, panel, action, actor, actor_id, device_id, order_id, detail, table_number, restaurant_id, level, seen_at, resolved_at, created_at").order("created_at", { ascending: false }).limit(limit);
  if (restaurantId) q = q.eq("restaurant_id", restaurantId);
  if (level === "error" || level === "warn" || level === "info") q = q.eq("level", level);
  if (actionOk) q = q.eq("action", actionEq);
  if (unresolvedOnly) q = q.is("resolved_at", null);
  if (since) q = q.gte("created_at", since);
  if (qText) {
    // Escape the PostgREST or-filter meta-characters (%,) so a search term can't break the filter.
    const safe = qText.replace(/[%,()]/g, " ");
    q = q.or(`action.ilike.%${safe}%,detail.ilike.%${safe}%`);
  }
  const r = await q;
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  const rows = r.data ?? [];

  // Stamp each row with WHICH restaurant it belongs to, so the admin (who sees every
  // restaurant) can tell them apart. Fetch the restaurant names ONCE into a map keyed
  // by id — no N+1 lookup per row. `restaurants.name` is plain text (per-tenant safe;
  // we deliberately avoid logo_text, which is #1's brand-bar wording).
  const ids = Array.from(new Set(rows.map((a) => a.restaurant_id).filter(Boolean)));
  const nameById = new Map<string, { name: string; slug: string }>();
  if (ids.length) {
    const rest = await sb.from("restaurants").select("id, name, slug").in("id", ids);
    for (const x of rest.data ?? []) nameById.set(x.id, { name: x.name, slug: x.slug });
  }
  const actions = rows.map((a) => {
    const meta = a.restaurant_id ? nameById.get(a.restaurant_id) : undefined;
    return { ...a, detail: redactMoney(a.detail), restaurant_name: meta?.name ?? null, restaurant_slug: meta?.slug ?? null };
  });
  return NextResponse.json({ actions });
}
