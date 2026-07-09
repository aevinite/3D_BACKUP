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
import { panelAdminRid } from "@/lib/panelGate";
import TabletFrame from "./TabletFrame";

export default async function TabletPanel({ searchParams }: { searchParams: Promise<{ rid?: string }> }) {
  const { rid } = await searchParams;
  const adminRid = await panelAdminRid("tablet", rid);
  const src = "/panels/tablet/index.html" + (adminRid ? `?rid=${encodeURIComponent(adminRid)}` : "");
  // TabletFrame renders the iframe AND pushes the phone's real safe-area insets into it (env()
  // doesn't resolve inside a nested iframe — see TabletFrame.tsx).
  return <TabletFrame src={src} />;
}
