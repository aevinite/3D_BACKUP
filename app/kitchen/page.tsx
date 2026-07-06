// /kitchen — the kitchen KDS, now hosted INSIDE the one app.
//
// Its exact original UI is served from /panels/kitchen and embedded full-screen,
// so it looks/behaves identically to the old standalone kitchen. Its data calls
// go to /api/kitchen/* (the ported route handlers). The admin-only floating
// switcher (in the layout) floats above this.
//
// ?rid= (ADMIN "view as" only) is forwarded into the iframe so this tab stays
// pinned to its restaurant — see app/manager/page.tsx for the full story.
// panelAdminRid enforces the entry rule (admin only via the console's link) and
// strips ?rid= from non-admin visits.
import { panelAdminRid } from "@/lib/panelGate";

export default async function KitchenPanel({ searchParams }: { searchParams: Promise<{ rid?: string }> }) {
  const { rid } = await searchParams;
  const adminRid = await panelAdminRid("kitchen", rid);
  const src = "/panels/kitchen/index.html" + (adminRid ? `?rid=${encodeURIComponent(adminRid)}` : "");
  return (
    <iframe
      src={src}
      title="Kitchen — live orders"
      style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", border: 0 }}
    />
  );
}
