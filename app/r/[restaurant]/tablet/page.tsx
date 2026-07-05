// /r/<slug>/tablet — the waiter app under the restaurant's OWN address.
//
// Same embedded panel as /tablet; the slug is validated against the session by
// requirePanelAt (a staff session from another restaurant is bounced to this
// slug's login — the URL never scopes data, the session does). For the ADMIN
// super-user the slug IS the view-as choice: the iframe gets ?rid=<id>, the
// existing per-tab admin pin (ignored server-side for real staff sessions).
import { requirePanelAt } from "@/lib/panelGate";

export default async function ScopedTabletPanel({ params }: { params: Promise<{ restaurant: string }> }) {
  const { restaurant } = await params;
  const { restaurantId, admin } = await requirePanelAt("tablet", restaurant);
  const src = "/panels/tablet/index.html" + (admin ? `?rid=${encodeURIComponent(restaurantId)}` : "");
  return (
    <iframe
      src={src}
      title="Waiter tablet"
      style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", border: 0 }}
    />
  );
}
