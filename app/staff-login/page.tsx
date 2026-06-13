// /staff-login — the password page for staff (admin/editor/kitchen/tablet).
// A plain HTML form (no client JS needed) that POSTs to /api/staff-login, which
// checks the password, sets the login cookie, and bounces you to where you were
// headed. This page is public (not behind the gate) so you can actually log in.

export default async function StaffLogin({
  searchParams,
}: {
  searchParams: Promise<{ bad?: string; next?: string }>;
}) {
  const { bad, next = "/admin" } = await searchParams;
  return (
    <main style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#0b1220", color: "#dbe7ff", fontFamily: "system-ui, sans-serif" }}>
      <form
        method="POST"
        action="/api/staff-login"
        style={{ background: "#111a2e", border: "1px solid #1f2c49", borderRadius: 16, padding: 28, width: "min(92vw, 360px)" }}
      >
        <h1 style={{ fontSize: 18, margin: "0 0 14px" }}>🔒 Admin sign in</h1>
        <input type="hidden" name="next" value={next} />
        <input
          type="password"
          name="password"
          placeholder="Password"
          autoFocus
          autoComplete="current-password"
          style={{ width: "100%", boxSizing: "border-box", padding: 12, borderRadius: 10, border: "1px solid #2a3a5f", background: "#0b1220", color: "#dbe7ff", fontSize: 15 }}
        />
        {bad ? <div style={{ color: "#f87171", fontSize: 13, marginTop: 8 }}>Wrong password — try again.</div> : null}
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
