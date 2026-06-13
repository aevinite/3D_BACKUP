// /kitchen — the kitchen KDS, now hosted INSIDE the one app.
//
// Its exact original UI is served from /panels/kitchen and embedded full-screen,
// so it looks/behaves identically to the old standalone kitchen. Its data calls
// go to /api/kitchen/* (the ported route handlers). The admin-only floating
// switcher (in the layout) floats above this.
export default function KitchenPanel() {
  return (
    <iframe
      src="/panels/kitchen/index.html"
      title="Kitchen — live orders"
      style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", border: 0 }}
    />
  );
}
