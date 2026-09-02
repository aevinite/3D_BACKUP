// middleware.ts — ONE JOB: an address a browser cannot even read must not answer a bare error.
//
// WHY THIS FILE EXISTS AT ALL, GIVEN CLAUDE.md SAYS THERE IS DELIBERATELY NO MIDDLEWARE.
//
// That decision is about the LOGIN GATE. It moved out of a middleware and into every route on
// purpose — `/aevinite` checks `tokenIsValid` itself, the panel APIs call `requireRole()`, the
// owner's APIs call `ownerScope()` — and none of that moves back here. This file checks no
// permission, reads no session, touches no database and knows nothing about who anyone is.
//
// It exists because of one thing a diner can be handed and this app could not answer:
//
//   /r/%E0%A4/menu   →   HTTP 500, twenty-one bytes: "Internal Server Error"
//
// A web address can only carry plain characters, so anything else is written as % plus two digits.
// If those digits are damaged — a link cut short by a chat app, a stray % typed by hand, a QR
// photographed badly and retyped — the address is no longer readable text. Next decodes the
// restaurant name out of the path as part of matching this route, that decode throws, and the
// throw happens INSIDE Next's own request handling: before any page, any layout, and any error
// boundary. Proved, not assumed — a route-level `error.tsx` was added and the same bare 500 came
// back unchanged (T1 round 3, 2026-09-02).
//
// So there is no other place to stand. A middleware runs before routing and is handed the address
// still encoded, which is the only moment at which the question "can this even be read?" can be
// asked without throwing.
//
// SCOPED TO THE TWO GUEST DOORS AND NOTHING ELSE (see `config.matcher` below). It does not run on
// the panels, the APIs, the assets, or anything a member of staff touches. On a good address it
// does one `decodeURIComponent` and gets out of the way.
//
// WHAT THE PERSON GETS INSTEAD: the guest screen that already exists for "this menu isn't
// available right now — please ask a member of staff", rather than a wordless error page. That is
// the honest answer here: we genuinely cannot tell which restaurant a broken address meant, and
// the person's way back is the QR code on their table, which is short, printed and always valid.
import { NextResponse, type NextRequest } from "next/server";

// Where a broken address is sent. It is a slug that no restaurant can ever have — every real one
// is lower-case letters, digits and hyphens — so this route resolves to nothing and renders the
// guest "this menu isn't available" screen, with its "ask a member of staff" line.
// WHY A REDIRECT AND NOT A REWRITE, which was the first attempt and did not work. A rewrite keeps
// the ORIGINAL address on the request, so the tenant route still pulled the restaurant name out of
// that same unreadable path and threw exactly as before — the 500 came back unchanged, while the
// same rewrite on `/q` worked, which is what made the cause obvious. A redirect replaces the
// address, so what finally reaches the route is readable text. 307, never 308: a permanent hop
// would be cached in that person's browser for ever, and this is a mistake, not a move.
//
// Where it points: a slug no restaurant can ever have — every real one is lower-case letters,
// digits and hyphens, and this one starts with `zz-` besides. So it resolves to nothing and draws
// the guest screen that already exists for this: "This menu isn't available right now. Please ask
// a member of staff — they can bring you the menu or scan the current code for your table."
// Which is the true thing to say. We cannot tell which restaurant a broken address meant, and the
// way back is the QR on their table: short, printed, and always valid.
const DEAD_END = "/r/zz-unreadable-address/menu";

export function middleware(req: NextRequest) {
  try {
    decodeURIComponent(req.nextUrl.pathname);
  } catch {
    return NextResponse.redirect(new URL(DEAD_END, req.nextUrl.origin), 307);
  }
  return NextResponse.next();
}

// ONLY the two doors whose address carries a restaurant or a table code in it. Those are the only
// routes that decode a path segment, and therefore the only ones that can fail this way.
export const config = { matcher: ["/r/:path*", "/q/:path*"] };
