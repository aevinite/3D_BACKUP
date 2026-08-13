// /login — the SINGLE staff door. One username+password box for everyone
// (manager / kitchen / tablet); on success the user is sent to their own panel
// based on their role. Public route (you must be able to reach it logged-out).
//
// If you're ALREADY logged in, we don't show the form again — straight to your
// panel. The menu stays open and is unaffected by any of this.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { USER_COOKIE, userFromCookie } from "@/lib/userAuth";
import { ROLE_HOME } from "@/lib/panelGate";
import LoginForm from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const store = await cookies();
  const u = await userFromCookie(store.get(USER_COOKIE)?.value);
  if (u) redirect(ROLE_HOME[u.role] || "/menu"); // already signed in → your panel
  return <LoginForm next={typeof next === "string" ? next : ""} />;
}
