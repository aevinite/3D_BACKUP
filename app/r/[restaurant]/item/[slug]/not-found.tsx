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
// A `metadata` export is enough here — verified on the running app, not assumed: with this in
// place the served 404 carries exactly one <title> and one description, and they are these.
export const metadata = {
  title: "Menu",
  description: "This page isn’t available. Scan the QR code on your table, or ask a member of staff.",
};

export default function NotFound() {
  return <GuestNotFound />;
}
