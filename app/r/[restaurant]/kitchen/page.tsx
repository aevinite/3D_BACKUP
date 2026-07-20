// /r/<slug>/kitchen — the kitchen KDS under the restaurant's OWN address.
// See app/r/[restaurant]/tablet/page.tsx for the slug↔session rules.
import { requirePanelAt } from "@/lib/panelGate";
import PanelFrame from "@/components/PanelFrame";

export default async function ScopedKitchenPanel({ params }: { params: Promise<{ restaurant: string }> }) {
  const { restaurant } = await params;
  const { restaurantId, admin } = await requirePanelAt("kitchen", restaurant);
  const src = "/panels/kitchen/index.html" + (admin ? `?rid=${encodeURIComponent(restaurantId)}` : "");
  return <PanelFrame src={src} title="Kitchen — live orders" />;
}
