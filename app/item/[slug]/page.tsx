// The big interactive dish page lives in ItemClient (runs in the browser).
// This file is the thin "server" wrapper that reads the address bar first.
import ItemClient from "./ItemClient";

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
