// app/r/[restaurant]/menu/page.tsx — the guest menu for ONE restaurant, resolved
// from the URL slug (/r/<slug>/menu). A server component resolves the slug to a
// restaurant row, then renders the shared <MenuView> with that restaurant's id;
// everything MenuView fetches (dishes, categories, features) is scoped to it.
//
// QR codes can point at /r/<slug>/menu?table=N — MenuView reads ?table / ?t.
import { notFound } from "next/navigation";
import MenuView from "@/components/MenuView";
import { getRestaurantBySlug } from "@/lib/tenant";
import { getSettings } from "@/lib/menu";

// White-label: a guest's browser tab, its shared-link preview, AND its tab icon
// all show THIS restaurant — not the SaaS platform (audit fix bugs #8, #14). Any
// non-#1 tenant used to inherit the platform's "Aevidine — the all-in-one…"
// description and had no OpenGraph tags, so a shared menu link showed the SaaS
// pitch with no restaurant name/image.
export async function generateMetadata({ params }: { params: Promise<{ restaurant: string }> }) {
  const { restaurant } = await params;
  const r = await getRestaurantBySlug(restaurant);
  if (!r) return { title: "Menu" };
  const title = r.name ? `${r.name} — Menu` : "Menu";
  // A friendly, restaurant-specific description (its own tagline when it has one).
  const description = r.tagline
    ? `${r.tagline} — view the menu and order at ${r.name}.`
    : `View the menu and order at ${r.name}.`;
  // Give the restaurant its own browser-tab icon when it has uploaded a logo,
  // instead of the one shared platform favicon.
  const icons = r.logoUrl ? { icon: r.logoUrl } : undefined;
  return {
    title,
    description,
    icons,
    openGraph: {
      title,
      description,
      type: "website",
      ...(r.logoUrl ? { images: [{ url: r.logoUrl }] } : {}),
    },
  };
}

export default async function RestaurantMenuPage({
  params,
}: {
  params: Promise<{ restaurant: string }>;
}) {
  const { restaurant } = await params;
  const r = await getRestaurantBySlug(restaurant);
  if (!r || !r.active) notFound();
  // MENU MASTER SWITCH (access rebuild): a restaurant whose Menu feature is off has no
  // guest menu at all — no QR menu, nothing for a diner to open. It must be genuinely
  // absent rather than an empty page, so this is the same "not found" a wrong slug gets.
  const settings = await getSettings(r.id);
  if (!settings.menuEnabled) notFound();
  return (
    <>
      {/* Access → Menu → Format → Default light/dark. The root <html> is stamped 'light' by
          the global boot script in app/layout.tsx, which can't know WHICH restaurant is
          opening; this runs as the parser reaches it — before the menu paints — so a
          dark-default restaurant never flashes light. A guest who has chosen a mode keeps
          it: we only act when nothing is saved. */}
      {settings.menuDefaultMode === "dark" && (
        <script
          dangerouslySetInnerHTML={{
            __html: "(function(){try{if(!localStorage.getItem('lfh_theme'))document.documentElement.setAttribute('data-theme','dark');}catch(e){}})();",
          }}
        />
      )}
      <MenuView
        restaurantId={r.id}
        restaurantSlug={restaurant}
        restaurantName={r.name ?? undefined}
        logoText={r.logoText ?? undefined}
        heroTitle={r.heroTitle ?? undefined}
        tagline={r.tagline ?? undefined}
        accentColor={r.accentColor ?? undefined}
        theme={r.theme ?? undefined}
        logoUrl={r.logoUrl ?? undefined}
        defaultLayout={settings.menuDefaultLayout === "list" ? "list" : "gallery"}
      />
    </>
  );
}
