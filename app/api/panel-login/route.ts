// POST /api/panel-login — staff log in with the username + password the admin
// created for them. On success sets the role-scoped USER_COOKIE and tells the
// client which panel to go to (+ whether first-login profile capture is needed).
import { NextRequest, NextResponse } from "next/server";
import { loginUser, USER_COOKIE } from "@/lib/userAuth";
import { isPanelEnabled, isRestaurantDeleted, ownerPanelEnabled } from "@/lib/panelAccess";
import { getRestaurantBySlug } from "@/lib/tenant";
import { logAction, deviceIdFrom } from "@/lib/oplog";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch {}
  // Tenant-scoped door (/r/<slug>/login) sends the slug: only THAT restaurant's
  // staff may match. An unknown slug gets the same generic message as bad
  // credentials — never confirm which slugs exist.
  let restaurantId: string | undefined;
  if (body?.restaurant) {
    const rest = await getRestaurantBySlug(String(body.restaurant));
    if (!rest) return NextResponse.json({ ok: false, error: "Wrong name or password." }, { status: 401 });
    restaurantId = rest.id;
  }
  const dev = deviceIdFrom(req);
  const r = await loginUser(String(body?.username || ""), String(body?.password || ""), restaurantId);
  // transient = the credential lookup itself failed (DB blip) → 503 "try again",
  // NOT 401 "wrong password" (stress test 2026-07-03).
  if (!r.ok) {
    // Record the REAL reason in the ADMIN operation log — "who tried what was lacking".
    // The user only ever sees the generic r.error (no account enumeration); the detail
    // here is admin-only. Skip transient blips (a DB hiccup isn't a login attempt) and
    // an empty form. Logged under the targeted account's panel/restaurant when known,
    // else "admin" so it still surfaces in the admin's cross-restaurant feed.
    if (!r.transient && r.reason && r.reason !== "empty") {
      const a = r.attempted;
      const who = a?.actor || a?.username || "(unknown)";
      const detail =
        r.reason === "no_such_name" ? `login failed · no active account named "${a?.username ?? ""}"`
        : r.reason === "wrong_password" ? `login failed · wrong password for "${who}"`
        : r.reason === "locked" ? `login blocked · "${who}" is locked out (too many wrong tries)`
        : r.reason === "too_long" ? "login failed · oversized input rejected"
        : "login failed";
      await logAction((a?.role ?? "admin"), "login_failed", {
        actor: who, device_id: dev, detail, restaurant_id: a?.restaurant_id ?? null,
      });
    }
    return NextResponse.json({ ok: false, error: r.error }, { status: r.transient ? 503 : 401 });
  }
  const u = r.user;
  const uWho = u.name || u.username;
  if (u.role === "owner") {
    // OWNERS (2026-07-06): their row's restaurant_id is the #1 "home" namespace, not
    // ownership — deleted/entitlement checks must run against what they actually OWN.
    // ownerPanelEnabled = "at least one live owned restaurant has the owner panel on";
    // uncached at the door (login is rare + must reflect an admin flip immediately).
    if (!(await ownerPanelEnabled(u.id, false))) {
      await logAction("owner", "login_denied", { actor: uWho, device_id: dev, detail: `"${uWho}" signed in but the owner panel is not enabled on any owned restaurant` });
      return NextResponse.json({ ok: false, error: "The owner panel isn't enabled for any of your restaurants. Ask your admin to turn it on." }, { status: 403 });
    }
  } else {
    // Restaurant in the recycle bin (mig 128): its logins are dead until it's
    // restored. Checked before the panel entitlement so a binned restaurant blocks
    // every role, not just disabled panels.
    if (await isRestaurantDeleted(u.restaurant_id)) {
      await logAction(u.role, "login_denied", { actor: uWho, device_id: dev, restaurant_id: u.restaurant_id, detail: `"${uWho}" signed in but the restaurant is in the recycle bin` });
      return NextResponse.json({ ok: false, error: "This restaurant is no longer available. Contact your admin." }, { status: 403 });
    }
    // Per-restaurant PANEL entitlement (mig 106): if the admin turned this role's panel OFF
    // for the user's restaurant, they can't sign in here. (The admin reaches panels via the
    // separate staff gate / act-as, not this route, so this never blocks the admin.)
    if (!(await isPanelEnabled(u.role, u.restaurant_id))) {
      await logAction(u.role, "login_denied", { actor: uWho, device_id: dev, restaurant_id: u.restaurant_id, detail: `"${uWho}" signed in but the ${u.role} panel is not enabled for this restaurant` });
      return NextResponse.json({ ok: false, error: "This panel isn't enabled for your restaurant. Ask your admin to turn it on." }, { status: 403 });
    }
  }
  // Audit the login in the operation log: who (name), their username, and the
  // generated user-id all land in `detail`; `actor` is the friendly name. The
  // log row is tagged with the role's panel so it shows under that panel.
  await logAction(u.role, "login", {
    actor: u.name || u.username,
    device_id: deviceIdFrom(req),
    detail: `${u.name || "(no name yet)"} logged in · user "${u.username}" · id ${u.id}`,
  });
  // Show the one-time setup card until the user has confirmed their profile ONCE
  // (even if the admin pre-filled everything). After that it never auto-opens.
  const needsProfile = !u.profile_confirmed;
  const res = NextResponse.json({ ok: true, role: u.role, needsProfile });
  res.cookies.set(USER_COOKIE, r.cookie, {
    path: "/", httpOnly: true, sameSite: "lax",
    secure: process.env.NODE_ENV === "production", // HTTPS-only in prod
    maxAge: 60 * 60 * 24 * 7, // 7 days (server also enforces this age in the signature)
  });
  return res;
}
