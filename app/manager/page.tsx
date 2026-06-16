// /manager — the manager panel (formerly "editor"), hosted INSIDE the one app.
//
// The visible route is /manager; the underlying vanilla UI is still served from
// /panels/editor and its data calls still go to /api/editor/* — those internal
// names are invisible to users, so we leave them to avoid pointless churn/risk.
// The role is "manager"; /editor redirects here for back-compat.
export default function ManagerPanel() {
  return (
    <iframe
      src="/panels/editor/index.html"
      title="Manager"
      style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", border: 0 }}
    />
  );
}
