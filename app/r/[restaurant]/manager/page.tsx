// /r/<slug>/manager — the manager panel under the restaurant's OWN address.
// The underlying vanilla UI is still served from /panels/editor (internal name,
// invisible to users). See app/r/[restaurant]/tablet/page.tsx for the
// slug↔session rules.
import { requirePanelAt } from "@/lib/panelGate";
import PanelFrame from "@/components/PanelFrame";

// The browser TAB title. Its `/manager` twin has named itself since the T15 sweep (2026-08-05) because a
// manager with the manager panel, the kitchen screen and the waiter view open in three tabs had three
// identical tabs to pick from. This address — the restaurant's OWN — never got the same line, so the
// three tabs a restaurant's own staff use all read "Aevidine — Restaurant OS" (the root layout's
// default). Same fault, same fix, on the twin route: T29 sweep, 2026-08-22.
export const metadata = { title: "Manager — Aevidine" };

export default async function ScopedManagerPanel({ params }: { params: Promise<{ restaurant: string }> }) {
  const { restaurant } = await params;
  const { restaurantId, admin } = await requirePanelAt("manager", restaurant);
  const src = "/panels/editor/index.html" + (admin ? `?rid=${encodeURIComponent(restaurantId)}` : "");
  return <PanelFrame src={src} title="Manager" />;
}
