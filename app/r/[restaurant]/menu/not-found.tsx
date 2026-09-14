// Guest-facing not-found for this route. Scoped deliberately NARROW (per guest route,
// not at app/r/[restaurant]/) so a STAFF 404 — e.g. app/r/<slug>/login — still falls
// through to the platform 404, which is the right page for staff. See GuestNotFound.
import GuestNotFound from "@/components/GuestNotFound";

// THE TAB AND THE SHARE PREVIEW ARE PART OF THE WHITE LABEL HERE TOO (sweep #9 T1, item 1).
//
// The two DISH doors got this on 2026-09-02 (owner's item 7) and this one — the door a printed QR
// code actually opens — was not carried across. MEASURED on a production build of this worktree:
//
//     /r/no-such-place-xyz/menu  →  HTTP 404
//     <title>Aevidine — Restaurant OS</title>
//     <meta name="description" content="Aevidine — the all-in-one platform that runs your restaurant.">
//
// while `/r/french-house/item/no-such-dish-zz` beside it answered `<title>Menu</title>` and the
// neutral sentence below. Same 404, two different answers, and the wrong one on the busier door.
//
// This boundary is what a diner gets for an unknown slug, a restaurant that has been switched off,
// and — the common case — a restaurant whose Menu master switch is off. So somebody sitting at a
// table in a closed restaurant read OUR company across the top of their phone, and a link they
// forwarded previewed as our sales pitch under the restaurant's name.
//
// WHY THE ROUTE'S OWN generateMetadata DOES NOT SAVE IT: Next DISCARDS a segment's metadata when
// the page calls notFound(), renders this file, and falls back to the ROOT layout's metadata —
// which is the platform default in app/layout.tsx and is correct for every staff and marketing
// surface. A not-found boundary receives no params, so it cannot name the restaurant without a
// database read, and a read on a 404 page is not a trade worth making. Neutral and brand-free is
// the honest answer: it says nothing untrue about anybody.
//
// The wording is COPIED from app/r/[restaurant]/item/[slug]/not-found.tsx deliberately, curly
// apostrophe included, so a diner who mistypes a dish link and a diner who mistypes a menu link
// cannot read as two different products.
//
// Driven, not assumed: verify:notfound now fetches this door's served <head> alongside the two
// dish doors and fails on any platform brand in it.
export const metadata = {
  title: "Menu",
  description: "This page isn’t available. Scan the QR code on your table, or ask a member of staff.",
};

export default function NotFound() {
  return <GuestNotFound />;
}
