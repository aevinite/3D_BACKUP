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
  // A MENU THAT ISN'T SERVING MUST NOT ADVERTISE ITSELF (guest sweep T1, 2026-08-16).
  //
  // app/q/[code] already does this — a dead code answers with a neutral title and no platform
  // blurb — but this door returned the restaurant's name, tagline and logo whatever the state was,
  // and only the PAGE below checked `active` / `menuEnabled`. So a link shared in a chat, or one
  // already sitting in someone's history, previewed as an open menu ("Restaurant — Menu · view the
  // menu and order at Restaurant", with the logo) and then landed on "This menu isn't available
  // right now". Same fix, same wording, as the QR door: neutral, and no restaurant image.
  //
  // getSettings and getRestaurantBySlug are both cached (8s / 15s, de-duplicated), and the page
  // below asks for exactly the same two things — so this costs no extra read.
  const settings = await getSettings(r.id);
  if (!r.active || !settings.menuEnabled) {
    return { title: "Menu", description: "This menu isn’t available right now." };
  }
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
        /* THE RESOLVED slug, never the text from the address bar (owner, 2026-08-12: capitals and
           lower case must behave identically). getRestaurantBySlug now folds case, so
           /r/French-House/menu resolves — but this prop goes on to build every dish link AND to
           NAMESPACE this restaurant's cart, favourites and browse state (lib/tenantStorage.ts,
           MenuView's sk()). Handing it "French-House" would give that link its own separate cart
           from "french-house": add two dishes, reopen the lower-case link, empty basket. Passing
           r.slug makes one restaurant one scope however the address was typed. */
        restaurantSlug={r.slug}
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
