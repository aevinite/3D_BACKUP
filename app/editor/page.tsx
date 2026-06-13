// /editor — the editor panel, now hosted INSIDE the one app.
//
// Its exact original UI is served as static files from /panels/editor and
// embedded full-screen here, so the look/behaviour is byte-for-byte identical to
// the old standalone editor. Its data calls go to /api/editor/* (the ported
// route handlers). The admin-only floating switcher (mounted in the layout)
// floats above this. A native React rebuild is the later "polish" step.
export default function EditorPanel() {
  return (
    <iframe
      src="/panels/editor/index.html"
      title="Menu Editor"
      style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", border: 0 }}
    />
  );
}
