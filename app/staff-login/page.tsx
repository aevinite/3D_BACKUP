// /staff-login — the password page for staff (admin/editor/kitchen/tablet).
// Thin server wrapper: reads the redirect target + any no-JS fallback flags, then renders the
// client <LoginForm/> (which keeps the typed password, shows attempts left, and auto-clears the
// "wrong password" message). Public (not behind the gate) so you can actually log in.
//
// If the admin has DELIBERATELY blocked this device from the admin panel, we render <BlockedView/>
// instead — a clear "you're blocked" screen with Retry + a capped "ask to be unblocked" button.
import { headers } from "next/headers";
import LoginForm from "./LoginForm";
import BlockedView from "./BlockedView";
import { clientIp, throttleIsBlocked } from "@/lib/loginThrottle";

export default async function StaffLogin({
  searchParams,
}: {
  searchParams: Promise<{ bad?: string; locked?: string; blocked?: string; next?: string }>;
}) {
  const { bad, locked, blocked, next = "/aevinite" } = await searchParams;

  // Is THIS device deliberately blocked? (far-future lock on admin:<ip>). One cheap indexed read;
  // fail-open so a DB blip never traps a legitimate user on the blocked screen.
  const h = await headers();
  const ip = clientIp({ headers: { get: (n: string) => h.get(n) } });
  const isBlocked = (await throttleIsBlocked(`admin:${ip}`)) || blocked === "1";

  return (
    <main style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#0b1220", color: "#dbe7ff", fontFamily: "system-ui, sans-serif", padding: 16 }}>
      {isBlocked ? (
        <BlockedView />
      ) : (
        <LoginForm next={next} initialError={locked ? { kind: "locked" as const } : bad ? { kind: "wrong" as const } : null} />
      )}
    </main>
  );
}
