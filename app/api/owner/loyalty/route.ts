// app/api/owner/loyalty/route.ts — the restaurant's OWN loyalty rules, and correcting a balance.
//
// The two things mig 401 deliberately left unbuilt (owner, 2026-09-20: "DO WHAT'S LEFT COMPLETE
// EVERYTHING"). Until now every restaurant ran on the hard-coded defaults and a wrong balance could
// only be fixed by editing the database by hand.
//
// WHOSE DECISION IS WHICH. The admin decides whether this restaurant HAS loyalty at all — that is
// the switch on Access & permissions and nothing here can turn it on. How generous the scheme is,
// though, is the restaurant's own commercial decision, so the rules live in the OWNER panel. That
// split is what `ownerUse: "panel"` on the Loyalty row in lib/accessTree.ts already declares.
//
// GATED THREE WAYS, every request: the owner's scope (never trust a client-supplied
// restaurant_id beyond their own set) · the admin-controlled "customers" entitlement, because this
// is guest data · and the loyalty ladder itself, re-read server-side. With the module off, every
// verb here answers `{ on: false }` or refuses, so the screen renders nothing.
import { NextRequest, NextResponse } from "next/server";
import {
  ownerScopeOr503, scopedRestaurantIds, RestaurantListIncomplete, incompleteListResponse,
  ownerActorName,
} from "@/lib/ownerScope";
import { entitledSubset } from "@/lib/ownerEntitlements";
import { loyaltyRules, saveLoyaltyRules, adjustPoints, loyaltyHistory } from "@/lib/loyalty";

export const dynamic = "force-dynamic";

const scopedIds = (scope: Parameters<typeof scopedRestaurantIds>[0]) => scopedRestaurantIds(scope);

/** The restaurant must be one of theirs AND still entitled to Customers. Admin skips the
 *  entitlement (admin = top power) but never the ownership check. */
async function mine(req: NextRequest, restaurantId: string) {
  const sc = await ownerScopeOr503(req);
  if (sc.resp) return { resp: sc.resp } as const;
  const scope = sc.scope;
  if (!restaurantId) return { resp: NextResponse.json({ error: "restaurant_id required" }, { status: 400 }) } as const;
  let ids: string[];
  try { ids = await scopedIds(scope); }
  catch (e) { if (e instanceof RestaurantListIncomplete) return { resp: incompleteListResponse() } as const; throw e; }
  if (!ids.includes(restaurantId)) return { resp: NextResponse.json({ error: "not your restaurant" }, { status: 403 }) } as const;
  if (!scope.all && !scope.admin) {
    const allowed = await entitledSubset([restaurantId], "customers");
    if (!allowed.length) return { resp: NextResponse.json({ error: "Customers isn't enabled for your restaurant.", disabled: true }, { status: 403 }) } as const;
  }
  return { scope } as const;
}

// GET ?restaurant_id=…            → the rules
// GET ?restaurant_id=…&phone=…    → that guest's points history (for justifying a correction)
export async function GET(req: NextRequest) {
  const rid = req.nextUrl.searchParams.get("restaurant_id") || "";
  const g = await mine(req, rid);
  if (g.resp) return g.resp;

  const phone = String(req.nextUrl.searchParams.get("phone") || "").slice(0, 20);
  if (phone) return NextResponse.json({ history: await loyaltyHistory(rid, phone, 20) });
  return NextResponse.json(await loyaltyRules(rid));
}

// POST { restaurant_id, action: "rules", earn_per_100, point_value_paise, min_redeem, max_redeem_pct }
// POST { restaurant_id, action: "adjust", phone, delta, note }
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "bad body" }, { status: 400 }); }

  const rid = String(body?.restaurant_id || "");
  const g = await mine(req, rid);
  if (g.resp) return g.resp;
  const by = ownerActorName(g.scope);

  if (body?.action === "rules") {
    const r = await saveLoyaltyRules(rid, {
      earn_per_100: Number(body.earn_per_100),
      point_value_paise: Number(body.point_value_paise),
      min_redeem: Number(body.min_redeem),
      max_redeem_pct: Number(body.max_redeem_pct),
    });
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 400 });
    return NextResponse.json({ ok: true, ...(await loyaltyRules(rid)) });
  }

  if (body?.action === "adjust") {
    // Points are worth money, so a hand correction is a money change: adjustPoints() writes the
    // ledger row AND the Removals row. A reason is required by the database, not only by the form.
    const r = await adjustPoints(
      rid, String(body.phone || "").slice(0, 20), Number(body.delta), String(body.note || ""), by,
      { user: null, deviceId: null, from: g.scope.all || g.scope.admin ? "admin" : "owner panel" },
    );
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 400 });
    return NextResponse.json(r);
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
