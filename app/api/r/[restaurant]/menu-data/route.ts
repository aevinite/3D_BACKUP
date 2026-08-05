// app/api/r/[restaurant]/menu-data/route.ts
// Guest menu's SHARED data, served from the server-side Next data cache.
//
// <MenuView> (a client component) fetches THIS endpoint instead of reading
// dishes/categories straight from Supabase in every browser. The heavy read is
// deduped per restaurant until an owner edit busts the tag — see
// lib/menuDataServer.ts for the why.
//
// THE RESPONSE IS `{ items, categories }` AND NOTHING ELSE. This header used to
// claim it also carried `bubblesEnabled` and `serviceMode`; it never has since
// MenuBundle was defined, and lib/menuDataServer.ts says settings are deliberately
// left out. The stale line mattered because it implies the MAINTENANCE switch
// reaches guests through this cached, tag-busted endpoint — it does not. Guest
// settings (service_mode, bubbles, features, tax) come from `getSettings()` →
// the lfh_guest_settings RPC on its own short TTL (lib/menu.ts), so flipping
// maintenance needs no cache bust here. (Corrected in the T9 sweep, 2026-08-05.)
//
// NOTE: we deliberately do NOT set a long Cache-Control / s-maxage here. A CDN
// edge cache is NOT purged by revalidateTag, so an owner edit wouldn't reach
// guests via the realtime refetch. The Next DATA cache (unstable_cache) is what
// gives us the Supabase-egress saving AND stays tag-purgeable. Per-guest hits to
// this cheap function are not the cost lever — the Supabase round-trip was.

import { NextRequest, NextResponse } from "next/server";
import { getRestaurantBySlug } from "@/lib/tenant";
import { getMenuBundle } from "@/lib/menuDataServer";
import { getSettings } from "@/lib/menu";

type Ctx = { params: Promise<{ restaurant: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { restaurant } = await ctx.params;
  // "I COULDN'T ASK" IS NOT "IT DOESN'T EXIST", AND IT IS NOT "IT'S SWITCHED OFF" EITHER.
  // Both reads below sit INSIDE the try (T9 sweep, 2026-08-05). getRestaurantBySlug THROWS on a
  // failed read rather than returning null — deliberately (2026-08-03: "'something went wrong,
  // try again' is honest and a 404 is not") — but the call sat OUTSIDE the catch, so a database
  // blip escaped as a bare unhandled 500 with no body the guest menu could act on. getSettings
  // throws the same way, and a settings blip must likewise not read as "the menu is off". Both
  // failures are transient, so both answer 503 + retryable and the client tries again. A genuinely
  // unknown slug, an inactive restaurant, and a switched-off Menu still answer 404, exactly as
  // they did.
  const transient = () => NextResponse.json(
    { error: "Couldn't load the menu just now — please try again.", transient: true },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
  try {
    let r;
    try { r = await getRestaurantBySlug(restaurant); } catch { return transient(); }
    // Unknown / disabled restaurant → 404, same gate as the menu page itself.
    if (!r || !r.active) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    // MENU MASTER SWITCH — the SECOND half of the gate the comment above already claims.
    // The page (app/r/[restaurant]/menu/page.tsx) refuses on BOTH `!active` and `!menuEnabled`;
    // this route only ever checked the first, so a restaurant whose Menu feature is off had its
    // page correctly answer "not found" while this endpoint still served the whole menu to anyone
    // with the link (found on Aangan: page 404, 199 dishes over the API). Hiding a screen is never
    // the only guard — the endpoint has to refuse too, or the switch does not mean what it says.
    let gate;
    try { gate = await getSettings(r.id); } catch { return transient(); }
    if (!gate.menuEnabled) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
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
