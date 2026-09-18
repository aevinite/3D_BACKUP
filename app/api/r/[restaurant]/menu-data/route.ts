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
// gives us the Supabase-egress saving AND stays tag-purgeable.
//
// ── …BUT THE SAME BUNDLE WENT DOWN THE WIRE EVERY MINUTE, TO EVERY PHONE (owner, 2026-09-18:
// "make sure there shouldn't be any kind of pulling like every second they will check because it
// will increase the egress problem") ────────────────────────────────────────────────────────────
// The header above ended "per-guest hits to this cheap function are not the cost lever". MEASURED,
// it is a lever: `useRealtime`'s 60-second safety net re-fires the guest menu's `menu` handler, so a
// phone left open on a table pulled the WHOLE bundle — 24.2 KB on French House — once a minute,
// almost always byte-for-byte identical. Twenty phones for two hours is ~58 MB a day of sending a
// menu to people who already have it.
//
// So the answer is now CONDITIONAL. The bundle is hashed and sent as a strong ETag; a client that
// already holds that version sends it back in `If-None-Match` and gets **304 with no body**. The
// safety net still runs every 60 s, still notices a real change within a minute even with realtime
// blocked, and costs ~0.2 KB instead of 24.2 KB when nothing has changed.
//
// Why an ETag and not a CDN cache: the reason in the paragraph above still stands — an edge cache
// cannot be tag-purged, so it could serve a stale menu. An ETag is per-request, compared
// server-side, and the moment an owner's save busts the data-cache tag the hash changes and the
// next answer is a full 200. Nothing is cached anywhere it cannot be corrected.
//
// It is also per-URL, which means per restaurant: one restaurant's hash can never match another's
// bundle. The client (components/MenuView.tsx) keeps its own copy of the ETag and treats 304 as
// "keep what you have" — see the note there.

import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getRestaurantBySlug } from "@/lib/tenant";
import { getMenuBundle } from "@/lib/menuDataServer";
import { getSettings } from "@/lib/menu";

type Ctx = { params: Promise<{ restaurant: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
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
    // THE THIRD READ NEEDED THE SAME TREATMENT AS THE TWO ABOVE (T9 sweep, 2026-08-06). The 2026-08-05
    // pass wrapped getRestaurantBySlug and getSettings, but the dish/category read fell through to the
    // generic catch below — which answered `500 { error: e.message }`. Two problems with that on a
    // diner's phone: the body is our schema ("relation ... does not exist"), and there is no
    // `transient` flag, so the client cannot tell a passing blip from a permanent failure and does not
    // retry. A failed menu read is exactly as transient as a failed settings read.
    let bundle;
    try { bundle = await getMenuBundle(r.id); } catch { return transient(); }
    // The version of this bundle. A hash of the JSON, so it changes if and only if something a
    // guest can see changed — no column to remember to bump, nothing to keep in step.
    const body = JSON.stringify(bundle);
    const etag = `"m${createHash("sha1").update(body).digest("base64url").slice(0, 22)}"`;
    // ALREADY HOLDING THIS VERSION → 304, no body. `If-None-Match` may carry a list, and a proxy
    // is allowed to weaken a tag to `W/"…"`, so both shapes are accepted.
    const asked = req.headers.get("if-none-match") || "";
    const holds = asked.split(",").some((t) => t.trim().replace(/^W\//, "") === etag);
    if (holds) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag, "Cache-Control": "no-store" } });
    }
    // no-store on the HTTP layer: let the Next data cache (inside getMenuBundle)
    // do the dedup, not a browser/CDN cache that we can't tag-bust. The ETag above is compared
    // HERE, by us, on every request — it is not a cache anyone else can serve from.
    return new NextResponse(body, {
      headers: { "Content-Type": "application/json", ETag: etag, "Cache-Control": "no-store" },
    });
  } catch (e) {
    // Last resort only — the three reads above each answer for themselves now. Still never hands the
    // database's own words to a guest: the detail goes to our log, the diner gets a sentence.
    console.error("[menu-data] unexpected failure:", e instanceof Error ? e.message : e);
    return transient();
  }
}
