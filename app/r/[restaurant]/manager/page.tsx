// /r/<slug>/manager — the manager panel under the restaurant's OWN address.
// The underlying vanilla UI is still served from /panels/editor (internal name,
// invisible to users). See app/r/[restaurant]/tablet/page.tsx for the
// slug↔session rules.
import { requirePanelAt } from "@/lib/panelGate";
import PanelFrame from "@/components/PanelFrame";

export default async function ScopedManagerPanel({ params }: { params: Promise<{ restaurant: string }> }) {
  const { restaurant } = await params;
  const { restaurantId, admin } = await requirePanelAt("manager", restaurant);
  const src = "/panels/editor/index.html" + (admin ? `?rid=${encodeURIComponent(restaurantId)}` : "");
  return <PanelFrame src={src} title="Manager" />;
}
