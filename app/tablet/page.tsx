// /tablet — the waiter captain app, now hosted INSIDE the one app.
//
// Its exact original UI is served from /panels/tablet and embedded full-screen,
// so it looks/behaves identically to the old standalone tablet. Its data calls
// go to /api/tablet/* (the ported route handlers). The admin-only floating
// switcher (in the layout) floats above this.
export default function TabletPanel() {
  return (
    <iframe
      src="/panels/tablet/index.html"
      title="Waiter tablet"
      style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", border: 0 }}
    />
  );
}
