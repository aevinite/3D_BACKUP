// app/r/[restaurant]/item/[slug]/page.tsx — the dish detail page for ONE restaurant,
// resolved from the URL (/r/<slug>/item/<dish>). Mirrors the global /item/[slug]
// page but resolves the restaurant first and hands its id + slug to <ItemClient>, so
// the dish, its reviews, its features and every in-page link stay scoped to this
// restaurant (a guest browsing /r/pizza-palace never falls back to restaurant #1).
import { notFound } from "next/navigation";
import { getRestaurantBySlug, DEFAULT_RESTAURANT_ID } from "@/lib/tenant";
import { getMenuItem, getSettings } from "@/lib/menu";
import { accentPaletteCss, accentCanvasCss } from "@/lib/accent";
import ItemClient from "@/app/item/[slug]/ItemClient";

// White-label: a dish link's tab title + share preview must read as THIS
// restaurant, never the platform brand ("Aevidine — Restaurant OS") the global
// layout falls back to (audit fix 2026-07-06). Mirrors the menu page's metadata.
export async function generateMetadata({ params }: { params: Promise<{ restaurant: string; slug: string }> }) {
  const { restaurant, slug } = await params;
  const r = await getRestaurantBySlug(restaurant);
  if (!r) return { title: "Menu" };
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
  if (!r || !r.active) notFound();
  // Menu master switch (access rebuild): no guest menu means no dish pages either —
  // gating only the list would leave every dish reachable by its own URL.
  if (!(await getSettings(r.id)).menuEnabled) notFound();
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
      {accentCss && <style dangerouslySetInnerHTML={{ __html: accentCss }} />}
      {/* r.slug, not the address-bar text — the same reason as the menu page: this prop namespaces
          the cart/favourites and builds the back-to-menu link, so a capitalised URL must land in
          the SAME scope as the lower-case one (owner, 2026-08-12). */}
      <ItemClient slug={slug} fromCat={cat} restaurantId={r.id} restaurantSlug={r.slug} />
    </>
  );
}
