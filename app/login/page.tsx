// /login — the SINGLE staff door. One username+password box for everyone
// (manager / kitchen / tablet); on success the user is sent to their own panel
// based on their role. Public route (you must be able to reach it logged-out).
//
// If you're ALREADY logged in, we don't show the form again — straight to your
// panel. The menu stays open and is unaffected by any of this.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { USER_COOKIE, userFromCookie, AuthDbError } from "@/lib/userAuth";
import { ROLE_HOME } from "@/lib/panelGate";
import LoginForm from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const store = await cookies();
  // THE SIGN-IN DOOR MUST NOT BREAK WHEN THE DATABASE IS SLOW (T10 sweep, finding F1).
  //
  // `userFromCookie` THROWS `AuthDbError` when the staff_users lookup itself fails — a sustained
  // DB/DNS flap, the shape the 2026-07-03 stress test is built around; lib/userAuth.ts says in its
  // own words that this "otherwise threw AuthDbError, which the page/layout gates surface as a raw
  // 500". This call sat bare, so the one screen a person needs in order to START a shift rendered
  // Next's error page instead of the Username / Password card. Nothing on it told them what to do.
  //
  // It is only asked here to REDIRECT somebody who is ALREADY signed in. "I couldn't check" is
  // therefore answered by simply showing the form: the form is public, so falling through discloses
  // nothing, and the worst case is that a signed-in person sees the card for a moment instead of
  // being bounced straight to their panel. That is strictly better than a crash page, because the
  // sign-in POST answers 503 "Server can't reach the database — retrying", which the card shows and
  // they can retry from.
  //
  // Same treatment app/owner/layout.tsx, /api/panel-logout and /api/panel-profile were each given
  // in the T17 sweep (2026-08-13); this door was the one left behind.
  let u: Awaited<ReturnType<typeof userFromCookie>> = null;
  try {
    u = await userFromCookie(store.get(USER_COOKIE)?.value);
  } catch (e) {
    if (!(e instanceof AuthDbError)) throw e;   // a real bug still surfaces
    console.error("[login] couldn't check for an existing session:", e.message);
  }
  if (u) redirect(ROLE_HOME[u.role] || "/menu"); // already signed in → your panel
  return <LoginForm next={typeof next === "string" ? next : ""} />;
}
