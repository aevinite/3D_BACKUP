// Branded 404 — shown for any unmatched route (e.g. /signup). A full-screen,
// Aevidine-branded "wrong page" screen in the Apple-glass look, layered above the
// always-on guest chrome so it reads as a clean dedicated page.
import Link from "next/link";

export default function NotFound() {
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999, display: "grid", placeItems: "center", padding: 24,
        background:
          "radial-gradient(820px 520px at 12% -8%, rgba(99,102,241,0.20), transparent 60%)," +
          "radial-gradient(720px 520px at 100% 0%, rgba(56,189,248,0.16), transparent 55%)," +
          "radial-gradient(760px 640px at 50% 120%, rgba(168,85,247,0.13), transparent 55%), #e7ebf3",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, system-ui, sans-serif", color: "#1d1d1f",
      }}
    >
      <div
        style={{
          width: "min(94vw, 460px)", textAlign: "center", padding: "42px 34px", borderRadius: 24,
          background: "rgba(255,255,255,0.55)", border: "1px solid rgba(255,255,255,0.75)",
          backdropFilter: "blur(24px) saturate(180%)", WebkitBackdropFilter: "blur(24px) saturate(180%)",
          boxShadow: "0 24px 64px rgba(31,41,80,0.16)",
        }}
      >
        <div style={{ fontSize: 30, color: "#4f46e5", letterSpacing: "0.04em" }}>✦</div>
        <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: "0.02em", marginTop: 4 }}>Aevidine</div>
        <div style={{ fontSize: 66, fontWeight: 800, letterSpacing: "-0.03em", margin: "16px 0 2px", color: "#4f46e5" }}>404</div>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 8px" }}>You took a wrong turn</h1>
        <p style={{ fontSize: 14, lineHeight: 1.55, color: "#6e6e73", margin: "0 0 24px" }}>
          This page doesn&apos;t exist — it may have moved, or the link was mistyped.
        </p>
        {/* The global `a { color: inherit !important }` (keeps guest links from turning
            blue) would force this button's text dark — a stronger class beats it. */}
        <style>{`.nf-cta,.nf-cta:visited,.nf-cta:hover,.nf-cta:active{color:#fff !important;text-decoration:none !important}`}</style>
        <Link
          href="/"
          className="nf-cta"
          style={{ display: "inline-block", padding: "12px 24px", borderRadius: 12, background: "#4f46e5", color: "#fff", fontWeight: 700, fontSize: 14, textDecoration: "none" }}
        >
          ← Back to safety
        </Link>
      </div>
    </div>
  );
}
