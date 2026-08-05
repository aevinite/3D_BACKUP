// /manager — the manager panel (formerly "editor"), hosted INSIDE the one app.
//
// The visible route is /manager; the underlying vanilla UI is still served from
// /panels/editor and its data calls still go to /api/editor/* — those internal
// names are invisible to users, so we leave them to avoid pointless churn/risk.
// The role is "manager"; /editor redirects here for back-compat.
//
// ?rid=<restaurant id> (ADMIN "view as" only): forwarded into the iframe so the
// panel echoes it on every API call — this pins THIS TAB to that restaurant even
// if the admin opens another restaurant's panel later (the act-as cookie alone is
// browser-wide, which made the first tab silently shift restaurants). panelAdminRid
// enforces the entry rule (admin may ONLY arrive via the console's per-restaurant
// link, never a bare hand-typed /manager) and strips ?rid= from non-admin visits.
// ?as=<staff id> (ADMIN only): open this panel as ONE NAMED MANAGER — their menus,
// their per-person permissions (owner, 2026-08-02, the profile's "Visit their panel").
// Carried into the iframe by panelIframeSrc; re-checked on every API call.
import { panelAdminRid, panelIframeSrc } from "@/lib/panelGate";
import PanelFrame from "@/components/PanelFrame";

// The browser TAB title. All four panels inherited the root "Aevidine — Restaurant OS", so a
// manager with the manager panel, the kitchen screen and the waiter view open in three tabs had
// three identical tabs to pick from (T15 sweep, 2026-08-05). The guest menu already names itself.
export const metadata = { title: "Manager — Aevidine" };

export default async function ManagerPanel({ searchParams }: { searchParams: Promise<{ rid?: string; as?: string; view?: string }> }) {
  const { rid, as, view } = await searchParams;
  const adminRid = await panelAdminRid("manager", rid);
  const src = panelIframeSrc("/panels/editor/index.html", adminRid, { as, view });
  return <PanelFrame src={src} title="Manager" />;
}
