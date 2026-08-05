// /tablet — the waiter captain app, now hosted INSIDE the one app.
//
// Its exact original UI is served from /panels/tablet and embedded full-screen,
// so it looks/behaves identically to the old standalone tablet. Its data calls
// go to /api/tablet/* (the ported route handlers). The admin-only floating
// switcher (in the layout) floats above this.
//
// ?rid= (ADMIN "view as" only) is forwarded into the iframe so this tab stays
// pinned to its restaurant — see app/manager/page.tsx for the full story.
// panelAdminRid enforces the entry rule (admin only via the console's link) and
// strips ?rid= from non-admin visits.
// ?as=<staff id> (ADMIN only): open this tablet as ONE NAMED WAITER — their tables,
// their per-person permissions (owner, 2026-08-02, the profile's "Visit their panel").
import { panelAdminRid, panelIframeSrc } from "@/lib/panelGate";
import PanelFrame from "@/components/PanelFrame";

// The browser TAB title. All four panels inherited the root "Aevidine — Restaurant OS", so a
// manager with the manager panel, the kitchen screen and the waiter view open in three tabs had
// three identical tabs to pick from (T15 sweep, 2026-08-05). The guest menu already names itself.
export const metadata = { title: "Waiter tablet — Aevidine" };

export default async function TabletPanel({ searchParams }: { searchParams: Promise<{ rid?: string; as?: string; view?: string }> }) {
  const { rid, as, view } = await searchParams;
  const adminRid = await panelAdminRid("tablet", rid);
  const src = panelIframeSrc("/panels/tablet/index.html", adminRid, { as, view });
  // PanelFrame renders the iframe sized to the VISIBLE viewport AND pushes the phone's real
  // safe-area insets into it (env() doesn't resolve inside a nested iframe — see PanelFrame.tsx).
  return <PanelFrame src={src} title="Waiter tablet" />;
}
