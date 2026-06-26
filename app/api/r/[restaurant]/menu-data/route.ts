// app/api/r/[restaurant]/menu-data/route.ts
// Guest menu's SHARED data, served from the server-side Next data cache.
//
// <MenuView> (a client component) fetches THIS endpoint instead of reading
// dishes/categories/settings straight from Supabase in every browser. The heavy
// read is now deduped to once-per-120s-per-restaurant (or until an owner edit
// busts the tag) — see lib/menuDataServer.ts for the why. The response shape
// matches what the client already consumes: { items, categories, bubblesEnabled,
// serviceMode }.
//
// NOTE: we deliberately do NOT set a long Cache-Control / s-maxage here. A CDN
// edge cache is NOT purged by revalidateTag, so an owner edit wouldn't reach
// guests via the realtime refetch. The Next DATA cache (unstable_cache) is what
// gives us the Supabase-egress saving AND stays tag-purgeable. Per-guest hits to
// this cheap function are not the cost lever — the Supabase round-trip was.

import { NextRequest, NextResponse } from "next/server";
import { getRestaurantBySlug } from "@/lib/tenant";
import { getMenuBundle } from "@/lib/menuDataServer";

type Ctx = { params: Promise<{ restaurant: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { restaurant } = await ctx.params;
  const r = await getRestaurantBySlug(restaurant);
  // Unknown / disabled restaurant → 404, same gate as the menu page itself.
  if (!r || !r.active) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  try {
    const bundle = await getMenuBundle(r.id);
    // no-store on the HTTP layer: let the Next data cache (inside getMenuBundle)
    // do the dedup, not a browser/CDN cache that we can't tag-bust.
    return NextResponse.json(bundle, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed to load menu" },
      { status: 500 }
    );
  }
}
