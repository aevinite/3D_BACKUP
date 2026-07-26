// POST /api/staff-login — check the admin password, set the login cookie, and
// redirect back to where the user was headed. Public (not behind the gate) so
// login is possible. Stores a HASH of the password in an HttpOnly cookie, plus a
// readable flag cookie the UI uses to show the admin switcher.
//
// The admin password is a SINGLE shared secret (not a staff_users row), so it can't
// use the per-account lockout in lib/userAuth. Instead it gets an IP-keyed lockout
// via lib/loginThrottle (migration 151): too many wrong tries locks that IP out for
// a few minutes. Every attempt (ok / wrong / blocked) is written to the ADMIN
// operation log so the admin can see who tried what on the most-targeted screen.

import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, FLAG_COOKIE, sha256hex, adminPassword } from "@/lib/staffAuth";
import { logAction, deviceIdFrom } from "@/lib/oplog";
import { throttleStatus, throttleFail, throttleReset, clientIp } from "@/lib/loginThrottle";
import { rateAllowed } from "@/lib/rateLimit";

const ADMIN_MAX_FAILS = 10;             // wrong tries from one IP before a lockout
const ADMIN_LOCK_MS = 5 * 60 * 1000;    // lockout length (5 minutes)
const MAX_PASSWORD_LEN = 200;           // reject oversize input outright

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const dev = deviceIdFrom(req);
  const throttleKey = `admin:${ip}`;

  const form = await req.formData().catch(() => null);
  const password = String(form?.get("password") || "");
  const rawNext = String(form?.get("next") || "/aevinite");
  // Only allow same-site relative paths as the redirect target (no open redirect).
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/aevinite";

  // The client form fetches with Accept: application/json so it can keep the typed password,
  // show "N attempts left" and auto-clear the error — without a full page reload. A no-JS
  // browser posts the plain form (Accept: text/html) and still gets the classic redirects.
  const wantsJson = (req.headers.get("accept") || "").includes("application/json");
  const bad = (extra: Record<string, unknown>) =>
    wantsJson
      ? NextResponse.json({ ok: false, ...extra }, { status: 401 })
      : NextResponse.redirect(new URL(`/staff-login?${extra.locked ? "locked=1" : "bad=1"}&next=${encodeURIComponent(next)}`, req.url), 303);

  // Locked out? Refuse before even checking the password, and log the attempt.
  const st = await throttleStatus(throttleKey);
  if (st.locked) {
    await logAction("admin", "login_blocked", { device_id: dev, detail: `admin login blocked — ${ip} is locked out (too many wrong tries)` });
    return bad({ locked: true });
  }

  // Configurable admin-login limit (mig 205) — ships DISABLED so the owner is never locked out
  // of the god-panel; a no-op unless the admin deliberately turns 'admin_login' on. Separate from
  // the IP lockout above, which stays as the always-on backstop.
  if (!(await rateAllowed("admin_login", `admin:${ip}`, { label: `admin password from ${ip}` }))) {
    await logAction("admin", "rate_limited", { device_id: dev, detail: `admin login rate limit reached from ${ip}` });
    return bad({ locked: true });
  }

  const expected = adminPassword();
  if (!expected || password.length > MAX_PASSWORD_LEN || password !== expected) {
    const t = await throttleFail(throttleKey, ADMIN_MAX_FAILS, ADMIN_LOCK_MS);
    await logAction("admin", "login_failed", { device_id: dev, detail: `wrong admin password from ${ip}` });
    // Just locked by THIS miss → tell them it's locked; otherwise surface attempts left.
    return bad(t.locked ? { locked: true } : { attemptsLeft: t.attemptsLeft });
  }

  // Correct: clear the counter and record the successful admin sign-in.
  await throttleReset(throttleKey);
  await logAction("admin", "login", { actor: "admin", device_id: dev, detail: `admin signed in from ${ip}` });

  const token = await sha256hex(expected);
  const res = wantsJson
    ? NextResponse.json({ ok: true, next })
    : NextResponse.redirect(new URL(next, req.url), 303);
  res.cookies.set(AUTH_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 604800 });
  res.cookies.set(FLAG_COOKIE, "1", { httpOnly: false, sameSite: "lax", path: "/", maxAge: 604800 });
  return res;
}
