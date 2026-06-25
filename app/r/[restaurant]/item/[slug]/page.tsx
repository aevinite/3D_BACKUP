// app/r/[restaurant]/item/[slug]/page.tsx — the dish detail page for ONE restaurant,
// resolved from the URL (/r/<slug>/item/<dish>). Mirrors the global /item/[slug]
// page but resolves the restaurant first and hands its id + slug to <ItemClient>, so
// the dish, its reviews, its features and every in-page link stay scoped to this
// restaurant (a guest browsing /r/pizza-palace never falls back to restaurant #1).
import { notFound } from "next/navigation";
import { getRestaurantBySlug } from "@/lib/tenant";
import ItemClient from "@/app/item/[slug]/ItemClient";

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
