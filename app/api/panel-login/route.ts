// POST /api/panel-login — staff log in with the username + password the admin
// created for them. On success sets the role-scoped USER_COOKIE and tells the
// client which panel to go to (+ whether first-login profile capture is needed).
import { NextRequest, NextResponse } from "next/server";
import { loginUser, USER_COOKIE, describeLoginTarget } from "@/lib/userAuth";
import { isPanelEnabled, isRestaurantDeleted, ownerPanelEnabled } from "@/lib/panelAccess";
import { getRestaurantBySlug } from "@/lib/tenant";
import { logAction, deviceIdFrom } from "@/lib/oplog";
import { rateAllowed, subjectFor, rateResetOnSuccess } from "@/lib/rateLimit";
import { botVerdict, verifyTurnstile } from "@/lib/botCheck";
import { clientIp } from "@/lib/loginThrottle";

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
  // NOT-A-PERSON CHECK (2026-08-16) — before the rate limit, so junk traffic never even reaches
  // the counter and can therefore never use up a real staff member's allowance. The form posts
  // JSON here, so the two values arrive as plain `trap` / `elapsed` keys (components/BotTrap.tsx).
  // Refuses ONLY on a present-and-wrong signal; a weeks-old cached panel that sends neither is
  // allowed through, which is the point — see lib/botCheck.ts.
  //
  // The answer is the SAME generic "Wrong name or password." this route gives for everything
  // else: never tell an automated caller which check it failed, and never let it count towards
  // the lockout on a real person's account.
  const verdict = botVerdict(body?.trap, body?.elapsed);
  if (!verdict.ok || !(await verifyTurnstile(body?.["cf-turnstile-response"], clientIp(req)))) {
    await logAction("admin", "login_failed", { device_id: dev, detail: `panel login refused — automated submission (${verdict.ok ? "turnstile" : verdict.reason})` });
    return NextResponse.json({ ok: false, error: "Wrong name or password." }, { status: 401 });
  }

  // RATE LIMIT (mig 205): stop password guessing. Counted per username (+ restaurant when the
  // door names one) BEFORE the credential lookup. The event label shows who + which restaurant,
  // so the admin sees exactly whose login is being hammered. Fails open on any limiter glitch.
  const uname = String(body?.username || "");
  if (uname) {
    const label = `"${uname.slice(0, 60)}"${body?.restaurant ? ` @ ${String(body.restaurant).slice(0, 40)}` : ""}`;
    // `describe` runs ONLY if the wall is actually hit, so a normal login still does no extra
    // read before the counter. It turns "ravi reached the limit" into "Manager “Ravi Kumar”
    // (ravi) at Aangan" on the phone ping AND in the bell / Problems list (owner 2026-07-29).
    const okRate = await rateAllowed("staff_login", `${restaurantId || "*"}:${subjectFor(uname)}`, {
      restaurantId, label, device: dev,
      describe: () => describeLoginTarget(uname, restaurantId ?? null),
    });
    if (!okRate) {
      await logAction("admin", "rate_limited", { actor: uname, device_id: dev, restaurant_id: restaurantId ?? null, detail: `login rate limit reached for ${label}` });
      return NextResponse.json({ ok: false, error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429 });
    }
  }
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
        // A disabled person typed their RIGHT password — recorded so the owner can see the
        // person tried, and the person themselves was told plainly (owner, 2026-08-02).
        : r.reason === "disabled" ? `login refused · "${who}" is disabled`
        : "login failed";
      await logAction((a?.role ?? "admin"), "login_failed", {
        actor: who, device_id: dev, detail, restaurant_id: a?.restaurant_id ?? null,
      });
    }
    return NextResponse.json({ ok: false, error: r.error }, { status: r.transient ? 503 : 401 });
  }
  const u = r.user;
  const uWho = u.name || u.username;
  // They knew the password → clear the login counter, so ordinary repeat sign-ins (a shared waiter
  // tablet, a staff member switching users) can never build up to a wall or an alert.
  // Scoped to the restaurant the wall was counted under (rateAllowed above passes the same
  // `restaurantId`), so a correct sign-in here can only ever clear THIS restaurant's wall. The
  // subject already carries the restaurant, so nothing moves today — but the plain /login door
  // sends "*" for it, and two restaurants sharing a staff name share that counter.
  if (uname) await rateResetOnSuccess("staff_login", `${restaurantId || "*"}:${subjectFor(uname)}`, restaurantId ?? null);
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
    // The STABLE id, so "days worked / hours active" can be counted from sign-ins (a login is
    // the first action of a shift) — and so a rename doesn't orphan past rows. (2026-07-29)
    actor_id: u.id,
    // …and the row belongs to THEIR restaurant. Omitting this fell back to the column default
    // (#1), so every tenant's sign-ins were filed under restaurant #1: #1's Log showed other
    // restaurants' logins and a non-#1 restaurant's Log showed none of its own.
    restaurant_id: u.restaurant_id ?? null,
    device_id: deviceIdFrom(req),
    // The row already carries `actor` (the name) and `actor_id` (the uuid), and the log line
    // renders as "Signed in · <actor> · <detail>". Repeating both here made every sign-in read
    // "Signed in · diagm1 · diagm1 logged in · user \"diagm1\" · id bc422e5d-…" — the same name
    // three times, ending in a uuid chopped mid-string. The id is in actor_id, which the
    // click-through detail card shows in full under "Log id"/"Done by" (T15 sweep, 2026-08-05).
    // Keep only what the name does NOT already say: the username, when it differs.
    detail: u.name && u.name !== u.username ? `username "${u.username}"` : null,
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
