// The big interactive dish page lives in ItemClient (runs in the browser).
// This file is the thin "server" wrapper that reads the address bar first.
import ItemClient from "./ItemClient";
import { getMenuItem } from "@/lib/menu";

// The bare /item/<slug> route is restaurant #1's own dish page. Give it #1's
// dish-titled tab/share title instead of the platform brand fallback (audit fix
// 2026-07-06). Restaurant #1 keeps "My Little French House" branding here.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const dish = await getMenuItem(slug).catch(() => null);
  return { title: dish?.title ? `${dish.title} — My Little French House` : "My Little French House — Menu" };
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
  // Hand both to the browser-side component, which does the real work.
  return <ItemClient slug={slug} fromCat={cat} />;
}
