// /r/<slug>/tablet — the waiter app under the restaurant's OWN address.
//
// Same embedded panel as /tablet; the slug is validated against the session by
// requirePanelAt (a staff session from another restaurant is bounced to this
// slug's login — the URL never scopes data, the session does). For the ADMIN
// super-user the slug IS the view-as choice: the iframe gets ?rid=<id>, the
// existing per-tab admin pin (ignored server-side for real staff sessions).
import { requirePanelAt, panelIframeSrc } from "@/lib/panelGate";
import PanelFrame from "@/components/PanelFrame";

// THE CONSOLE'S PER-TAB PINS RIDE ALONG HERE TOO (T29 follow-up, 2026-08-22).
//
// This URL used to be built by hand — `"/panels/tablet/index.html" + (admin ? "?rid=…" : "")` —
// while its `/tablet` twin went through `panelIframeSrc()`. That builder carries THREE admin-only
// pins into the iframe, and by hand only the first one arrived:
//   rid   which restaurant this tab is looking at
//   view  "real" = render as the role really gets it, not the admin X-ray
//   as    WHICH PERSON to mark against (the profile's "Visit their panel", owner 2026-08-02)
// So the same tab did two different things depending on which address it was opened at, and
// nothing would ever have said so. Both families now share one builder.
//
// IT CANNOT WIDEN ANYONE'S ACCESS, and that is why it is safe: `panelIframeSrc` returns the bare
// URL untouched when `adminRid` is null, and `requirePanelAt` returns `admin: true` ONLY for a
// valid admin cookie (a real staff session gets `admin: false`). So `as` and `view` are dropped
// for staff before they are ever looked at — and the server ignores them for a staff session
// regardless (lib/viewAsPerson). `panelIframeSrc` also validates `as` as a UUID and accepts
// exactly `view=real`, so a malformed pin is dropped rather than passed on.

// The browser TAB title. Its `/tablet` twin has named itself since the T15 sweep (2026-08-05) because a
// manager with the manager panel, the kitchen screen and the waiter view open in three tabs had three
// identical tabs to pick from. This address — the restaurant's OWN — never got the same line, so the
// three tabs a restaurant's own staff use all read "Aevidine — Restaurant OS" (the root layout's
// default). Same fault, same fix, on the twin route: T29 sweep, 2026-08-22.
export const metadata = { title: "Waiter tablet — Aevidine" };

export default async function ScopedTabletPanel(
  { params, searchParams }: {
    params: Promise<{ restaurant: string }>;
    searchParams: Promise<{ as?: string; view?: string }>;
  },
) {
  const { restaurant } = await params;
  const { as, view } = await searchParams;
  const { restaurantId, admin } = await requirePanelAt("tablet", restaurant);
  const src = panelIframeSrc("/panels/tablet/index.html", admin ? restaurantId : null, { as, view });
  // PanelFrame (not a raw iframe) — sizes to the VISIBLE viewport and bridges the
  // phone's safe-area insets into the panel. See components/PanelFrame.tsx.
  return <PanelFrame src={src} title="Waiter tablet" />;
}
