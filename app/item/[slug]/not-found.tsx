// Guest-facing not-found for this route. Scoped deliberately NARROW (per guest route,
// not at app/r/[restaurant]/) so a STAFF 404 — e.g. app/r/<slug>/login — still falls
// through to the platform 404, which is the right page for staff. See GuestNotFound.
import GuestNotFound from "@/components/GuestNotFound";

// THE TAB AND THE SHARE PREVIEW ARE PART OF THE WHITE LABEL TOO (owner's item 7, 2026-09-02).
//
// The SCREEN below this has been fully white-label since 2026-08-04 — the order docket, the
// restaurant's own colours and typeface, not one mention of the platform. Its <head> was not.
// MEASURED on both doors: `/item/no-such-dish-zz` and `/r/aangan-garden-restaurant/item/nope-zz`
// each answered a correct HTTP 404 carrying
//     <title>Aevidine — Restaurant OS</title>
//     <meta name="description" content="Aevidine — the all-in-one platform that runs your restaurant.">
// So a diner who opened a stale or mistyped dish link read OUR company across the top of their
// phone, and if they forwarded that link the preview card under it was our SALES PITCH, sent out
// under the restaurant's name.
//
// WHY IT HAPPENED, AND WHY THE ROUTE'S OWN TITLE DID NOT SAVE IT. Both dish routes have a
// generateMetadata that returns the restaurant's own title. Next DISCARDS the segment's metadata
// when the page calls notFound(), renders this file instead, and falls back to the ROOT layout's
// metadata — which is the platform default in app/layout.tsx and is correct for every staff and
// marketing surface. A not-found boundary receives no params, so it cannot name the restaurant
// without a read, and a database read on a 404 page is not a trade worth making. Neutral and
// brand-free is the honest answer: it says nothing untrue about anybody.
//
// The wording matches the closed-menu title app/item/[slug]/page.tsx already returns, and the
// sentence mirrors GuestNotFound's own sub-copy, curly apostrophe included, so the page and its
// head cannot read as two different products.
//
// A `metadata` export is enough for the SERVED page — verified on the running app, not assumed:
// the 404 carries exactly one <title> and one description, and they are these. That is the half
// that matters for a forwarded link, because a crawler reads the served HTML and never runs React.
//
// BUT THE LIVE TAB SAYS SOMETHING ELSE, AND IT IS NOT A FAULT (owner's item 7, 2026-09-14).
// MEASURED on all four doors: the served title is "Menu", and about 300 ms after React hydrates it
// becomes the RESTAURANT's own — "My Little French House — Menu", "AANGAN GARDEN RESTAURANT — Menu",
// "Sakura Sushi — Menu", "Pizza Palace — Menu". Next keeps the segment's generateMetadata alive on
// the client even though the page called notFound(), so the route's own title wins on the live tab.
//
// Nothing here is wrong: every door shows its OWN restaurant, never another's, and never the
// platform brand — which is the entire fault this file exists to fix. It is written down because
// this comment used to read as though "Menu" were the whole story, and the next person to measure
// the live tab would file the difference as a regression. It is not one.
export const metadata = {
  title: "Menu",
  description: "This page isn’t available. Scan the QR code on your table, or ask a member of staff.",
};

export default function NotFound() {
  return <GuestNotFound />;
}
