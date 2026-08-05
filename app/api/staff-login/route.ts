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
import { AUTH_COOKIE, FLAG_COOKIE, sha256hex, safeEqual, adminPassword } from "@/lib/staffAuth";
import { logAction, deviceIdFrom } from "@/lib/oplog";
import { throttleStatus, throttleFail, throttleReset, throttleIsBlocked, clientIp } from "@/lib/loginThrottle";
import { recordAlert } from "@/lib/rateLimit";

const ADMIN_MAX_FAILS = 10;             // wrong tries from one IP before a temporary lockout
const ADMIN_LOCK_MS = 5 * 60 * 1000;    // lockout length (5 minutes)
const ADMIN_ALERT_AT = 3;               // after N wrong tries → notify the admin (never locks them)
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
      : NextResponse.redirect(new URL(`/staff-login?${extra.blocked ? "blocked=1" : extra.locked ? "locked=1" : "bad=1"}&next=${encodeURIComponent(next)}`, req.url), 303);

  // Locked out? Refuse before even checking the password, and log the attempt. A DELIBERATE admin
  // block (far-future lock) is distinct from a few-minute wrong-tries lockout: it sends the visitor
  // to the "You're blocked" page (where they can ask to be unblocked), not the "wait a bit" message.
  const st = await throttleStatus(throttleKey);
  if (st.locked) {
    const blocked = await throttleIsBlocked(throttleKey);
    await logAction("admin", "login_blocked", { device_id: dev, detail: `admin login refused — ${ip} is ${blocked ? "blocked" : "locked out (too many wrong tries)"}` });
    return bad(blocked ? { blocked: true } : { locked: true });
  }

  const expected = adminPassword();
  // Compared through the shared constant-time helper (sweep 2026-08-05). Every other secret
  // comparison in this area already goes through safeEqual — including tokenIsValid, two lines
  // further down in lib/staffAuth, whose own comment explains why the helper exists. The one
  // comparison against the real typed password was the only one still using a plain `!==`.
  // Hashing both sides first makes the compare fixed-length, which is what safeEqual needs; the
  // length cap stays AHEAD of it so an oversize value never reaches the hash.
  const tooLong = password.length > MAX_PASSWORD_LEN;
  const matches = !!expected && !tooLong && safeEqual(await sha256hex(password), await sha256hex(expected));
  if (!matches) {
    const t = await throttleFail(throttleKey, ADMIN_MAX_FAILS, ADMIN_LOCK_MS);
    await logAction("admin", "login_failed", { device_id: dev, detail: `wrong admin password from ${ip}` });
    // After N wrong tries from this device → raise a WARN-ONLY alert (mig 208) so the admin gets a
    // notification + a Problems entry with a "Block this device" action. This NEVER locks the owner
    // out — it only tells them someone is guessing. The 5-min IP lockout above stays as the backstop.
    if (t.failCount >= ADMIN_ALERT_AT) {
      const label = `Admin panel · ${ip}${dev ? ` · device ${dev.slice(0, 10)}` : ""}`;
      await recordAlert("admin_login", ip, label, t.failCount);
    }
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
  // `secure` in production, matching the STAFF cookie in app/api/panel-login (sweep 2026-08-05).
  // Both doors set httpOnly/sameSite/path/maxAge, but only the staff one asked for HTTPS-only —
  // so the cookie guarding MORE (the whole admin console) was the looser of the two. Vercel serves
  // HTTPS only, so nothing changes in practice; the point is that the two doors now agree.
  const secure = process.env.NODE_ENV === "production";
  res.cookies.set(AUTH_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 604800, secure });
  res.cookies.set(FLAG_COOKIE, "1", { httpOnly: false, sameSite: "lax", path: "/", maxAge: 604800, secure });
  return res;
}
