// /r/<slug>/login — a restaurant's OWN staff door. Same card as /login but
// branded with the restaurant's name, and the login is SCOPED: only this
// restaurant's staff can sign in here (the slug rides along to /api/panel-login).
// Unknown slug → 404. A visitor already signed into THIS restaurant is sent
// straight to their scoped panel; a session from ANOTHER restaurant still sees
// the form (signing in here simply replaces that session).
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { USER_COOKIE, userFromCookie, AuthDbError } from "@/lib/userAuth";
import { ROLE_HOME } from "@/lib/panelGate";
import { isPanelEnabled } from "@/lib/panelAccess";
import { getRestaurantBySlug, slugMovedTo } from "@/lib/tenant";
import LoginForm from "@/app/login/LoginForm";

export default async function ScopedLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurant: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { restaurant } = await params;
  const { next } = await searchParams;
  const r = await getRestaurantBySlug(restaurant);
  // A staff bookmark of the old address should reach the sign-in page, not a dead end (mig 350).
  // `next` is carried so "sign in, then take me where I was going" still works after the hop.
  if (!r) {
    const moved = await slugMovedTo(restaurant);
    if (moved) redirect(`/r/${moved}/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  }
  if (!r) notFound();
  const store = await cookies();
  // A RESTAURANT'S OWN SIGN-IN DOOR MUST NOT BREAK WHEN THE DATABASE IS SLOW (sweep #8 T25,
  // item 4). `/login` was given exactly this treatment as T10's finding F1, and its own comment
  // says why at length: `userFromCookie` THROWS `AuthDbError` when the staff_users lookup itself
  // fails, and an uncaught throw in a page renders Next's error page — so the one screen a person
  // needs in order to START a shift showed a crash instead of the Username / Password card. This
  // door was left behind, and it is the door every restaurant's staff actually bookmark:
  // /r/<slug>/login is where requirePanelAt sends anyone who is signed out.
  //
  // The answer is the same one /login settled on. The lookup is asked here ONLY to bounce somebody
  // who is ALREADY signed in, so "I couldn't check" is answered by simply showing the form: the
  // form is public, nothing on it needs the cookie, and the worst case is that a signed-in person
  // sees the card for a moment instead of being forwarded. That is strictly better than a crash
  // page, because the sign-in POST answers 503 "Server can't reach the database — retrying",
  // which the card shows and they can retry from.
  let u: Awaited<ReturnType<typeof userFromCookie>> = null;
  try {
    u = await userFromCookie(store.get(USER_COOKIE)?.value);
  } catch (e) {
    if (!(e instanceof AuthDbError)) throw e;   // a real bug still surfaces
    console.error("[r/login] couldn't check for an existing session:", e.message);
  }
  // Already signed in HERE → straight to your panel. Only when the panel is
  // actually reachable, though — a disabled panel (or inactive restaurant) would
  // bounce right back from requirePanelAt and loop the redirects forever; showing
  // the form instead lets a re-login surface the clear 403 "panel isn't enabled".
  if (u && u.restaurant_id === r.id && r.active && (await isPanelEnabled(u.role, r.id))) {
    redirect(`/r/${restaurant}${ROLE_HOME[u.role] || "/menu"}`);
  }
  return (
    <LoginForm
      next={typeof next === "string" ? next : ""}
      restaurantSlug={restaurant}
      restaurantName={r.name}
    />
  );
}
