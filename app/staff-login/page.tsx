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

  // REJECTED (owner, 2026-08-13): the `minHeight: "100vh"` below stays — do NOT change it to
  // `100dvh`. Raised by the T12 phone sweep (on Android the card sits low and the on-screen
  // keyboard can cover "Sign in") and judged not a problem in practice: "i don't thing 7th is
  // problem". See docs/REJECTED-IDEAS.md R19.
  // (RECONSTRUCTED 2026-08-13 from the doc row after a parallel session's uncommitted edit
  // here was destroyed by a `git reset --hard` in this shared folder — the decision and the
  // quote are the owner's; the wording is not the original.)
  // THE PAGE SCROLLS BY ITSELF (owner, 2026-10-08, sweep #10 T17 item 18: "do all"). The app-wide stylesheet
  // locks html/body (`overflow: hidden`, app/globals.css) for the guest menu's own inner scrolling, so on a phone
  // held SIDEWAYS (780×360) the admin card / the blocked card — taller than the screen — had its Sign in half off-screen with no way to
  // reach it. <main> is now its own scroll box (height 100% + overflowY auto) and the card centres with
  // `margin: auto`, which can never push the card's top out of reach the way a centred overflow can.
  // This is NOT R19's change: minHeight stays 100vh exactly as the owner ruled; only scrolling was added.
  return (
    <main style={{ margin: 0, minHeight: "100vh", height: "100%", overflowY: "auto", display: "grid", placeItems: "center", background: "#0b1220", color: "#dbe7ff", fontFamily: "system-ui, sans-serif", padding: 16 }}>
      {isBlocked ? (
        <BlockedView />
      ) : (
        <LoginForm next={next} initialError={locked ? { kind: "locked" as const } : bad ? { kind: "wrong" as const } : null} />
      )}
    </main>
  );
}
