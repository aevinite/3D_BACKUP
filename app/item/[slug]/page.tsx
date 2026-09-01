// The big interactive dish page lives in ItemClient (runs in the browser).
// This file is the thin "server" wrapper that reads the address bar first.
import { notFound } from "next/navigation";
import ItemClient from "./ItemClient";
import Maintenance from "@/components/Maintenance";
import OfflineNoticeStatic from "@/components/OfflineNoticeStatic";
import { getMenuItem, getSettings } from "@/lib/menu";

// The bare /item/<slug> route is restaurant #1's own dish page. Give it #1's
// dish-titled tab/share title instead of the platform brand fallback (audit fix
// 2026-07-06). Restaurant #1 keeps "My Little French House" branding here.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // A closed menu must not preview a shared dish link as though it were open — same rule, and the
  // same cached read, as the tenant twin. Without it the page 404s but the link forwarded to a
  // friend still showed the dish, its photo and its price. (sweep #6 T2, 2026-08-17)
  //
  // SERVICE (MAINTENANCE) MODE COUNTS AS CLOSED HERE TOO (sweep #7 T2, 2026-08-22 — item 4).
  // The gate below the fold already returns the maintenance screen for it; this one checked only
  // the master switch. So a restaurant that had switched itself off for the evening served the
  // branded "we'll be right back" screen to anyone who OPENED a dish link, while the same link
  // pasted into WhatsApp still previewed the dish, its photo and its price. Two switches, one
  // meaning — the 3D screen beside these two doors has treated them as one since 2026-08-04
  // (`if (!s.menuEnabled || s.serviceMode)`), and now so do both dish doors, on both halves.
  const settings = await getSettings();
  if (!settings.menuEnabled || settings.serviceMode) {
    return { title: "Menu", description: "This menu isn’t available right now." };
  }
  const dish = await getMenuItem(slug).catch(() => null);
  const title = dish?.title ? `${dish.title} — My Little French House` : "My Little French House — Menu";
  // Same reason as the /r/<slug>/item twin: a page that sets only a title inherits the platform
  // description from app/layout.tsx, so a shared dish link read as the SaaS pitch (guest sweep T1,
  // 2026-08-06). Restaurant #1 gets its own sentence and the dish's own photo.
  const description = dish?.description?.trim()
    ? `${dish.description.trim()} — at My Little French House.`
    : `View ${dish?.title || "the menu"} at My Little French House.`;
  return {
    title,
    description,
    openGraph: { title, description, type: "website", ...(dish?.image ? { images: [{ url: dish.image }] } : {}) },
  };
}

// This is the dish detail page, shown at addresses like "/item/croissant".
// The "[slug]" folder name means the last part of the address (e.g.
// "croissant") gets handed to us as `slug` — that tells us which dish to show.
// It's an "async" function because in Next 16 the address details (params and
// searchParams) arrive as a promise we have to "await" (wait for) before using.
export default async function ItemPage({
  params,        // the dish id from the address, e.g. { slug: "croissant" }
  searchParams,  // any "?cat=..." extra bit on the address, used for prev/next nav
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ cat?: string }>;
}) {
  // Wait for the address pieces, then pull out the values we want.
  const { slug } = await params;          // which dish
  const { cat } = await searchParams;     // which category we came from (optional)
  // MENU MASTER SWITCH — brought in line with the /r/<slug>/item twin (guest sweep
  // 2026-08-04). Gating only the tenant route left restaurant #1's dish pages fully
  // open by their own URLs after its guest menu was switched off.
  const settings = await getSettings();
  if (!settings.menuEnabled) notFound();
  // SERVICE (MAINTENANCE) MODE CLOSES THIS DOOR TOO — the same gap, and the same reasoning, as the
  // /r/<slug>/item twin: the maintenance swap lives in AppShell, and this page renders ItemClient
  // without it, so a direct dish link stayed fully orderable while the restaurant was closed.
  // Restaurant #1 keeps its own hardcoded mark on that screen (isDefault). (sweep #6 T2, 2026-08-17)
  if (settings.serviceMode) return <Maintenance isDefault />;
  // A dish that doesn't exist must ANSWER "not found". This route used to render the
  // friendly "Item not found" card inside a 200, which tells search engines the page is
  // real and tells our own monitoring the request succeeded — the exact reason the /r/
  // twin already 404s here. getMenuItem is cached, so asking costs one small read.
  if (!(await getMenuItem(slug).catch(() => null))) notFound();
  // Hand both to the browser-side component, which does the real work.
  return (
    <>
      {/* The offline warning that survives a reload with no signal, when React never boots and
          components/OfflineNotice.tsx therefore cannot render. See that file for the measurement.
          It removes itself the moment React's own bar takes over. (Owner's item 11, 2026-09-01.) */}
      <OfflineNoticeStatic />
      <ItemClient slug={slug} fromCat={cat} />
    </>
  );
}
