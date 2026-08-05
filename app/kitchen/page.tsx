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
// ?as=<staff id> (ADMIN only): open this screen as ONE NAMED KITCHEN LOGIN (owner,
// 2026-08-02, the profile's "Visit their panel"). The KDS has no per-person settings,
// so this shows the real kitchen view and names whose screen it is.
import { panelAdminRid, panelIframeSrc } from "@/lib/panelGate";
import PanelFrame from "@/components/PanelFrame";

// The browser TAB title. All four panels inherited the root "Aevidine — Restaurant OS", so a
// manager with the manager panel, the kitchen screen and the waiter view open in three tabs had
// three identical tabs to pick from (T15 sweep, 2026-08-05). The guest menu already names itself.
export const metadata = { title: "Kitchen — Aevidine" };

export default async function KitchenPanel({ searchParams }: { searchParams: Promise<{ rid?: string; as?: string; view?: string }> }) {
  const { rid, as, view } = await searchParams;
  const adminRid = await panelAdminRid("kitchen", rid);
  const src = panelIframeSrc("/panels/kitchen/index.html", adminRid, { as, view });
  return <PanelFrame src={src} title="Kitchen — live orders" />;
}
