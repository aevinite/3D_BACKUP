// /staff-login — the password page for staff (admin/editor/kitchen/tablet).
// Thin server wrapper: reads the redirect target + any no-JS fallback flags, then renders the
// client <LoginForm/> (which keeps the typed password, shows attempts left, and auto-clears the
// "wrong password" message). Public (not behind the gate) so you can actually log in.
import LoginForm from "./LoginForm";

export default async function StaffLogin({
  searchParams,
}: {
  searchParams: Promise<{ bad?: string; locked?: string; next?: string }>;
}) {
  const { bad, locked, next = "/aevinite" } = await searchParams;
  const initialError = locked ? { kind: "locked" as const } : bad ? { kind: "wrong" as const } : null;
  return (
    <main style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#0b1220", color: "#dbe7ff", fontFamily: "system-ui, sans-serif" }}>
      <LoginForm next={next} initialError={initialError} />
    </main>
  );
}
