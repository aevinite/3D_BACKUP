// /r/<slug>/kitchen — the kitchen KDS under the restaurant's OWN address.
// See app/r/[restaurant]/tablet/page.tsx for the slug↔session rules.
import { requirePanelAt } from "@/lib/panelGate";
import PanelFrame from "@/components/PanelFrame";

// The browser TAB title. Its `/kitchen` twin has named itself since the T15 sweep (2026-08-05) because a
// manager with the manager panel, the kitchen screen and the waiter view open in three tabs had three
// identical tabs to pick from. This address — the restaurant's OWN — never got the same line, so the
// three tabs a restaurant's own staff use all read "Aevidine — Restaurant OS" (the root layout's
// default). Same fault, same fix, on the twin route: T29 sweep, 2026-08-22.
export const metadata = { title: "Kitchen — Aevidine" };

export default async function ScopedKitchenPanel({ params }: { params: Promise<{ restaurant: string }> }) {
  const { restaurant } = await params;
  const { restaurantId, admin } = await requirePanelAt("kitchen", restaurant);
  const src = "/panels/kitchen/index.html" + (admin ? `?rid=${encodeURIComponent(restaurantId)}` : "");
  return <PanelFrame src={src} title="Kitchen — live orders" />;
}
