// /r/<slug>/tablet — the waiter app under the restaurant's OWN address.
//
// Same embedded panel as /tablet; the slug is validated against the session by
// requirePanelAt (a staff session from another restaurant is bounced to this
// slug's login — the URL never scopes data, the session does). For the ADMIN
// super-user the slug IS the view-as choice: the iframe gets ?rid=<id>, the
// existing per-tab admin pin (ignored server-side for real staff sessions).
import { requirePanelAt } from "@/lib/panelGate";
import PanelFrame from "@/components/PanelFrame";

// The browser TAB title. Its `/tablet` twin has named itself since the T15 sweep (2026-08-05) because a
// manager with the manager panel, the kitchen screen and the waiter view open in three tabs had three
// identical tabs to pick from. This address — the restaurant's OWN — never got the same line, so the
// three tabs a restaurant's own staff use all read "Aevidine — Restaurant OS" (the root layout's
// default). Same fault, same fix, on the twin route: T29 sweep, 2026-08-22.
export const metadata = { title: "Waiter tablet — Aevidine" };

export default async function ScopedTabletPanel({ params }: { params: Promise<{ restaurant: string }> }) {
  const { restaurant } = await params;
  const { restaurantId, admin } = await requirePanelAt("tablet", restaurant);
  const src = "/panels/tablet/index.html" + (admin ? `?rid=${encodeURIComponent(restaurantId)}` : "");
  // PanelFrame (not a raw iframe) — sizes to the VISIBLE viewport and bridges the
  // phone's safe-area insets into the panel. See components/PanelFrame.tsx.
  return <PanelFrame src={src} title="Waiter tablet" />;
}
