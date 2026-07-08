// /staff-login — the password page for staff (admin/editor/kitchen/tablet).
// A plain HTML form (no client JS needed) that POSTs to /api/staff-login, which
// checks the password, sets the login cookie, and bounces you to where you were
// headed. This page is public (not behind the gate) so you can actually log in.

export default async function StaffLogin({
  searchParams,
}: {
  searchParams: Promise<{ bad?: string; locked?: string; next?: string }>;
}) {
  const { bad, locked, next = "/aevinite" } = await searchParams;
  return (
    <main style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#0b1220", color: "#dbe7ff", fontFamily: "system-ui, sans-serif" }}>
      <form
        method="POST"
        action="/api/staff-login"
        style={{ background: "#111a2e", border: "1px solid #1f2c49", borderRadius: 16, padding: 28, width: "min(92vw, 360px)" }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/aevidine-mark.svg" alt="Aevidine" width={48} height={48} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 0.2 }}>Aevidine</div>
            <div style={{ fontSize: 12.5, color: "#8aa0c6" }}>Restaurant OS · staff sign in</div>
          </div>
        </div>
        <input type="hidden" name="next" value={next} />
        <input
          type="password"
          name="password"
          placeholder="Password"
          autoFocus
          autoComplete="current-password"
          style={{ width: "100%", boxSizing: "border-box", padding: 12, borderRadius: 10, border: "1px solid #2a3a5f", background: "#0b1220", color: "#dbe7ff", fontSize: 16 }}
        />
        {locked ? <div style={{ color: "#f87171", fontSize: 13, marginTop: 8 }}>Too many wrong tries — wait a few minutes and try again.</div>
          : bad ? <div style={{ color: "#f87171", fontSize: 13, marginTop: 8 }}>Wrong password — try again.</div> : null}
        <button
          type="submit"
          style={{ marginTop: 12, width: "100%", padding: 12, borderRadius: 10, border: 0, background: "#3b82f6", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer" }}
        >
          Enter
        </button>
      </form>
    </main>
  );
}
