// app/r/[restaurant]/item/[slug]/page.tsx — the dish detail page for ONE restaurant,
// resolved from the URL (/r/<slug>/item/<dish>). Mirrors the global /item/[slug]
// page but resolves the restaurant first and hands its id + slug to <ItemClient>, so
// the dish, its reviews, its features and every in-page link stay scoped to this
// restaurant (a guest browsing /r/pizza-palace never falls back to restaurant #1).
import { notFound, redirect } from "next/navigation";
import { getRestaurantBySlug, slugMovedTo, DEFAULT_RESTAURANT_ID } from "@/lib/tenant";
import { getMenuItem, getSettings } from "@/lib/menu";
import { accentPaletteCss, accentCanvasCss } from "@/lib/accent";
import ItemClient from "@/app/item/[slug]/ItemClient";
import Maintenance from "@/components/Maintenance";

// White-label: a dish link's tab title + share preview must read as THIS
// restaurant, never the platform brand ("Aevidine — Restaurant OS") the global
// layout falls back to (audit fix 2026-07-06). Mirrors the menu page's metadata.
export async function generateMetadata({ params }: { params: Promise<{ restaurant: string; slug: string }> }) {
  const { restaurant, slug } = await params;
  const r = await getRestaurantBySlug(restaurant);
  if (!r) return { title: "Menu" };
  // Same rule as the menu door beside it: a restaurant that is switched off — or whose Menu master
  // switch is off — must not preview a shared DISH link as though it were open. The page below
  // 404s in both cases; without this the link's own preview card still showed the dish, its photo
  // and its price to whoever it was forwarded to. Both reads are the cached ones the page already
  // makes, so this costs nothing.
  const settings = await getSettings(r.id);
  if (!r.active || !settings.menuEnabled) {
    return { title: "Menu", description: "This menu isn’t available right now." };
  }
  const dish = await getMenuItem(slug, r.id).catch(() => null);
  const title = dish?.title ? `${dish.title} — ${r.name}` : `${r.name} — Menu`;
  // A TITLE ALONE IS NOT WHITE-LABEL. Next inherits every field a page doesn't set, so returning
  // only the title left the root layout's "Aevidine — the all-in-one platform that runs your
  // restaurant" as the description of a shared DISH link, with no preview image (guest sweep T1,
  // 2026-08-06). The dish's own description is the honest blurb; its photo is the honest image.
  const description = dish?.description?.trim()
    ? `${dish.description.trim()} — at ${r.name}.`
    : `View ${dish?.title || "the menu"} at ${r.name}.`;
  const image = dish?.image || r.logoUrl || null;
  return {
    title,
    description,
    ...(r.logoUrl ? { icons: { icon: r.logoUrl } } : {}),
    openGraph: { title, description, type: "website", ...(image ? { images: [{ url: image }] } : {}) },
  };
}

export default async function RestaurantItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurant: string; slug: string }>;
  searchParams: Promise<{ cat?: string }>;
}) {
  const { restaurant, slug } = await params;
  const { cat } = await searchParams;
  const r = await getRestaurantBySlug(restaurant);
  // A shared dish link outlives the address the same way a printed code does (mig 350). Only when
  // the address resolves to nothing — a restaurant that exists but is switched off still 404s below.
  if (!r) {
    const moved = await slugMovedTo(restaurant);
    if (moved) redirect(`/r/${moved}/item/${slug}${cat ? `?cat=${encodeURIComponent(cat)}` : ""}`);
  }
  if (!r || !r.active) notFound();
  // Menu master switch (access rebuild): no guest menu means no dish pages either —
  // gating only the list would leave every dish reachable by its own URL.
  const settings = await getSettings(r.id);
  if (!settings.menuEnabled) notFound();
  // SERVICE (MAINTENANCE) MODE CLOSES THE DISH PAGE TOO (sweep #6 T2, 2026-08-17).
  //
  // "Service mode replaces the whole menu with the maintenance screen" — but that swap lives in
  // components/AppShell.tsx, and this page renders ItemClient WITHOUT AppShell. So a restaurant
  // that switched itself off for maintenance still served a full, orderable dish page to anyone
  // holding a direct link: photo, price and a working Add to Cart, for a kitchen that is closed.
  // The 3D screen beside it closed this exact hole on 2026-08-04 with a comment naming both
  // switches; the dish page only ever got the master switch.
  //
  // The MENU'S OWN SCREEN, not a 404: a diner who bookmarked a dish should read the restaurant's
  // branded "we'll be right back", the same words they would get from the menu — and with this
  // restaurant's own name and logo, never the flagship's.
  if (settings.serviceMode) {
    return <Maintenance logoText={r.logoText || r.name} logoUrl={r.logoUrl || undefined} isDefault={r.id === DEFAULT_RESTAURANT_ID} />;
  }
  // A dish that doesn't exist must ANSWER "not found", not 200 with a friendly message
  // inside (found by the whole-app sweep, phase 28). The guest saw the right words either
  // way, but a 200 tells search engines the page is real and tells our own monitoring the
  // request succeeded. generateMetadata above already fetched this dish, so asking again
  // here costs one small cached read on a page nobody polls.
  if (!(await getMenuItem(slug, r.id).catch(() => null))) notFound();
  // WHITE-LABEL (audit fix 2026-07-08): this page renders ItemClient WITHOUT the
  // AppShell that themes the menu, so its price + "Add to Cart" button fell back to
  // restaurant #1's GOLD accent for every OTHER restaurant. Emit this restaurant's
  // accent palette at :root here (non-#1 only) so the dish page matches its own menu.
  // #1 passes nothing and keeps its hand-tuned gold from globals.css.
  const accentCss =
    r.id !== DEFAULT_RESTAURANT_ID && r.accentColor
      // The canvas travels with the accent (lib/accent.ts → accentCanvasCss). Without it the dish
      // page kept restaurant #1's cream/brown page while the MENU it was opened from had the
      // tenant's own — the two screens would no longer match (guest sweep T1, 2026-08-06).
      ? `${accentCanvasCss(r.accentColor)}:root{${accentPaletteCss(r.accentColor)}}`
      : "";
  return (
    <>
      {/* THE FOURTH THING THIS PAGE HAS TO REPEAT. It renders OUTSIDE AppShell, so everything the
          shell does for the menu has to be done again here: maintenance mode (above), the menu
          switch (above), the accent (below) — and the restaurant's DEFAULT light/dark, which was
          the one still missing. app/layout.tsx stamps <html> 'light' globally and cannot know WHICH
          restaurant is opening; the menu page emits this same line behind the same condition. Tap
          through from the menu and the choice is already in localStorage, so nothing showed — but a
          FULL page load of a dish (a shared link, a refresh, a QR straight to a dish) opened LIGHT
          on a restaurant whose admin had chosen dark. Byte-identical to the menu page's on purpose:
          it runs as the parser reaches it, before the dish paints, and it only acts when the guest
          has saved nothing of their own. (T29 sweep #7, 2026-08-28, on the owner's word — the fault
          was handed off by sweep #6 as P14317/P14460/P14462 and had stayed open.) */}
      {settings.menuDefaultMode === "dark" && (
        <script
          dangerouslySetInnerHTML={{
            __html: "(function(){try{if(!localStorage.getItem('lfh_theme'))document.documentElement.setAttribute('data-theme','dark');}catch(e){}})();",
          }}
        />
      )}
      {accentCss && <style dangerouslySetInnerHTML={{ __html: accentCss }} />}
      {/* r.slug, not the address-bar text — the same reason as the menu page: this prop namespaces
          the cart/favourites and builds the back-to-menu link, so a capitalised URL must land in
          the SAME scope as the lower-case one (owner, 2026-08-12). */}
      <ItemClient slug={slug} fromCat={cat} restaurantId={r.id} restaurantSlug={r.slug} />
    </>
  );
}
