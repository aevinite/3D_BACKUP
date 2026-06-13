// Stub for /editor — the real editor panel is brought into the app in Phase B.
// Kept as a placeholder so the switcher has a working destination meanwhile.
export default function EditorStub() {
  return (
    <main style={{ minHeight: "100vh", background: "#0b1220", color: "#dbe7ff", fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
      <div>
        <h1 style={{ margin: 0 }}>✏️ Editor</h1>
        <p style={{ opacity: 0.7 }}>Being moved into the one app (Phase B). For now it still runs on its own server.</p>
      </div>
    </main>
  );
}
