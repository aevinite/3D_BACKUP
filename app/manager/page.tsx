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
// browser-wide, which made the first tab silently shift restaurants). The server
// ignores ?rid= for real staff logins, so it grants nothing to non-admins.
export default async function ManagerPanel({ searchParams }: { searchParams: Promise<{ rid?: string }> }) {
  const { rid } = await searchParams;
  const src = "/panels/editor/index.html" + (rid ? `?rid=${encodeURIComponent(rid)}` : "");
  return (
    <iframe
      src={src}
      title="Manager"
      style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", border: 0 }}
    />
  );
}
