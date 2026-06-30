// app/r/[restaurant]/menu/page.tsx — the guest menu for ONE restaurant, resolved
// from the URL slug (/r/<slug>/menu). A server component resolves the slug to a
// restaurant row, then renders the shared <MenuView> with that restaurant's id;
// everything MenuView fetches (dishes, categories, features) is scoped to it.
//
// QR codes can point at /r/<slug>/menu?table=N — MenuView reads ?table / ?t.
import { notFound } from "next/navigation";
import MenuView from "@/components/MenuView";
import { getRestaurantBySlug } from "@/lib/tenant";

// White-label: a guest's browser tab shows THIS restaurant's name, not the SaaS brand.
export async function generateMetadata({ params }: { params: Promise<{ restaurant: string }> }) {
  const { restaurant } = await params;
  const r = await getRestaurantBySlug(restaurant);
  return { title: r?.name ? `${r.name} — Menu` : "Menu" };
}

export default async function RestaurantMenuPage({
  params,
}: {
  params: Promise<{ restaurant: string }>;
}) {
  const { restaurant } = await params;
  const r = await getRestaurantBySlug(restaurant);
  if (!r || !r.active) notFound();
  return (
    <MenuView
      restaurantId={r.id}
      restaurantSlug={restaurant}
      restaurantName={r.name ?? undefined}
      logoText={r.logoText ?? undefined}
      heroTitle={r.heroTitle ?? undefined}
      tagline={r.tagline ?? undefined}
      accentColor={r.accentColor ?? undefined}
      theme={r.theme ?? undefined}
    />
  );
}
