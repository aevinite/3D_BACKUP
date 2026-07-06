// app/r/[restaurant]/item/[slug]/page.tsx — the dish detail page for ONE restaurant,
// resolved from the URL (/r/<slug>/item/<dish>). Mirrors the global /item/[slug]
// page but resolves the restaurant first and hands its id + slug to <ItemClient>, so
// the dish, its reviews, its features and every in-page link stay scoped to this
// restaurant (a guest browsing /r/pizza-palace never falls back to restaurant #1).
import { notFound } from "next/navigation";
import { getRestaurantBySlug } from "@/lib/tenant";
import { getMenuItem } from "@/lib/menu";
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
  return { title };
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
  return <ItemClient slug={slug} fromCat={cat} restaurantId={r.id} restaurantSlug={restaurant} />;
}
