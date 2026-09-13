// /api/admin/reveal — uncover, re-cover, and report on the password gate (owner, 2026-09-13).
//
//   GET                    → { configured, unlocked, until }   — what the screens draw their state from
//   POST { password }      → uncovers for REVEAL_TTL_MS, sets the HttpOnly cookie
//   DELETE                 → re-covers immediately ("Cover them again")
//
// THE FOUR RULES THIS ROUTE KEEPS:
//   1. THE ADMIN COOKIE IS CHECKED FIRST, ALWAYS. This is an /api/admin/* route like every other
//      one: `tokenIsValid` runs before anything else, so a stranger cannot even reach the place
//      where wrong guesses are counted, let alone make them.
//   2. THE PASSWORD IS NEVER ECHOED. Not in the answer, not in the log line, not in an error. The
//      audit trail records THAT the admin uncovered the passwords and when — never what he typed,
//      and never whose password was uncovered by it (that is the per-person route's own record).
//   3. WRONG GUESSES ARE SLOWED DOWN. Five wrong answers inside five minutes and this door stops
//      answering for five minutes, per signed-in console. Deliberately NOT the DB rate limiter:
//      that one pings the owner's PHONE when a wall is reached (lib/rateLimit.ts → notifyRateHit),
//      and the person tripping this wall IS the owner, mistyping his own password. An alert about
//      yourself is exactly the noise that makes a real alert get ignored.
//   4. IT SAYS "LOCKED", NEVER "WRONG PASSWORD, TRY AGAIN" WITH A HINT. One sentence for every
//      wrong answer, with the number of tries left, and nothing about how close it was.
import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, tokenIsValid, sha256hex } from "@/lib/staffAuth";
import { logAction } from "@/lib/oplog";
import {
  REVEAL_COOKIE, REVEAL_TTL_MS, mintRevealToken, revealConfigured,
  revealPasswordMatches, revealUnlockedUntil,
} from "@/lib/revealGate";

export const dynamic = "force-dynamic";

const err = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);
const secure = () => process.env.NODE_ENV === "production";

// ── The wrong-guess counter ──────────────────────────────────────────────────────────────────────
// In memory, keyed by a HASH of the admin cookie, so one console's mistyping cannot lock another
// out and the key itself is not the cookie. A serverless restart forgets the count — accepted, and
// worth saying plainly rather than pretending otherwise: this slows a person down at a keyboard,
// which is the whole threat model here (the admin cookie is already required to get this far).
const MAX_TRIES = 5;
const COOL_OFF_MS = 5 * 60 * 1000;
const tries = new Map<string, { n: number; first: number; until: number }>();

function gate(key: string): { blocked: true; retryInMs: number } | { blocked: false; left: number } {
  const now = Date.now();
  const t = tries.get(key);
  if (!t) return { blocked: false, left: MAX_TRIES };
  if (t.until > now) return { blocked: true, retryInMs: t.until - now };
  if (now - t.first > COOL_OFF_MS) { tries.delete(key); return { blocked: false, left: MAX_TRIES }; }
  return { blocked: false, left: Math.max(0, MAX_TRIES - t.n) };
}

function countWrong(key: string): number {
  const now = Date.now();
  const t = tries.get(key);
  if (!t || now - t.first > COOL_OFF_MS) { tries.set(key, { n: 1, first: now, until: 0 }); return MAX_TRIES - 1; }
  t.n += 1;
  if (t.n >= MAX_TRIES) t.until = now + COOL_OFF_MS;
  return Math.max(0, MAX_TRIES - t.n);
}

// Keep the map from growing without bound on a long-lived server: a few hundred entries is already
// far more consoles than exist, and every one of them is stale after the cool-off.
function sweep() {
  if (tries.size < 200) return;
  const now = Date.now();
  for (const [k, t] of tries) if (t.until <= now && now - t.first > COOL_OFF_MS) tries.delete(k);
}

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return err("unauthorized", 401);
  const until = await revealUnlockedUntil(req.cookies.get(REVEAL_COOKIE)?.value);
  return NextResponse.json({
    configured: revealConfigured(),
    unlocked: until !== null,
    until,
    ttlMs: REVEAL_TTL_MS,
  });
}

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (!(await tokenIsValid(cookie))) return err("unauthorized", 401);
  if (!revealConfigured()) {
    return err("No admin password is set on this deployment, so passwords can't be uncovered here.", 409);
  }

  sweep();
  const key = await sha256hex(String(cookie));
  const g = gate(key);
  if (g.blocked) {
    const mins = Math.max(1, Math.ceil(g.retryInMs / 60000));
    return err(`Too many wrong tries. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`, 429);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const typed = String(body.password || "");
  if (!typed) return err("Type the admin password.", 400);

  if (!(await revealPasswordMatches(typed))) {
    const left = countWrong(key);
    // ONE record for a wrong try, so a run of them is visible in Audit & logs afterwards. It names
    // no value and no person — only that the door was knocked on.
    await logAction("admin", "admin_reveal_denied", {
      actor: "admin",
      detail: `wrong password typed on the "uncover passwords" gate — ${left} tr${left === 1 ? "y" : "ies"} left`,
    });
    return err(left > 0
      ? `That isn't the admin password. ${left} tr${left === 1 ? "y" : "ies"} left.`
      : "That isn't the admin password. Too many tries — wait five minutes.", 403);
  }

  tries.delete(key);
  const { value, expiresAt } = await mintRevealToken();
  const res = NextResponse.json({ ok: true, unlocked: true, until: expiresAt, ttlMs: REVEAL_TTL_MS });
  // maxAge matches the signature's own expiry, so the browser drops it at the same moment the
  // server stops honouring it. The signature is what actually decides — this is only tidiness.
  res.cookies.set(REVEAL_COOKIE, value, {
    httpOnly: true, sameSite: "lax", path: "/",
    maxAge: Math.ceil(REVEAL_TTL_MS / 1000), secure: secure(),
  });
  await logAction("admin", "admin_reveal_unlocked", {
    actor: "admin",
    detail: `passwords uncovered on the admin console for ${Math.round(REVEAL_TTL_MS / 60000)} minutes`,
  });
  return res;
}

// "Cover them again" — and what a screen calls when the admin walks away from the card.
export async function DELETE(req: NextRequest) {
  if (!(await admin(req))) return err("unauthorized", 401);
  const res = NextResponse.json({ ok: true, unlocked: false, until: null });
  res.cookies.set(REVEAL_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0, secure: secure() });
  return res;
}
