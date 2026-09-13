// lib/revealGate.ts — the second door in front of somebody else's password (owner, 2026-09-13).
//
// WHY A SECOND DOOR AT ALL. Signing in to /aevinite already proves you are the platform admin, and
// that is the right bar for everything else on the console — reading bills, suspending a restaurant,
// binning one. It is NOT the right bar for reading back a client's sign-in password, because an
// admin console left open on a laptop is a normal, everyday thing and a printed handover sheet is
// not. So the passwords stay covered until the admin types the password again, and they re-cover
// themselves a few minutes later without anybody remembering to lock them.
//
// THE OWNER'S PLAN THIS IS BUILT FOR (his words, 2026-09-13):
//   "later in admin we are gone put goggle lock like goggle auth to login admin but later so at
//    that time this pass which is right now is only use for the showing pass of other all user"
//
// So the two secrets are SEPARATE FROM DAY ONE even though today they hold the same value:
//   · getting IN to the console       → ADMIN_PASSWORD  (one day: Google sign-in / TOTP)
//   · uncovering SOMEBODY ELSE'S pass → REVEAL_PASSWORD, falling back to ADMIN_PASSWORD
// When the console moves to Google auth, set REVEAL_PASSWORD in the environment and nothing in this
// file, in the routes, or on the screens has to change. That is the whole reason it is its own
// function instead of a second call to adminPassword().
//
// THE FOUR RULES THIS FILE KEEPS:
//   1. THE UNLOCK EXPIRES BY ITSELF. The cookie carries its own expiry INSIDE the signature, so a
//      copied cookie cannot be re-dated and a forgotten tab re-covers the passwords on its own.
//   2. THE COOKIE IS NOT THE PASSWORD. It is an HMAC over the expiry, keyed by the server secret —
//      holding it proves somebody typed the password before, and reveals nothing about what it was.
//   3. NOTHING IS COMPARED WITH ===. Both the typed password and the signature go through a
//      constant-time compare, so neither can be narrowed down by how long a wrong answer takes.
//   4. IT FAILS CLOSED. No secret configured, a damaged cookie, a changed secret, an expired
//      window → locked. There is no branch in here that answers "unlocked" when it is unsure.
import { adminPassword, safeEqual, sha256hex } from "@/lib/staffAuth";

/** HttpOnly. Separate from the sign-in cookie on purpose — signing out must not be the only way to
 *  re-cover the passwords, and re-covering them must not sign the admin out. */
export const REVEAL_COOKIE = "lfh_reveal";

/** How long one unlock lasts. Long enough to walk a whole handover sheet without retyping it for
 *  every row; short enough that a console left open over lunch is covered again by the time
 *  anybody walks past it. */
export const REVEAL_TTL_MS = 5 * 60 * 1000;

/**
 * The secret that uncovers a password.
 *
 * REVEAL_PASSWORD first — that is the one to set the day the console itself moves to Google
 * sign-in, and it can be rotated on its own without signing every staff device out (changing
 * ADMIN_PASSWORD does exactly that — see the note in lib/userAuth.ts).
 */
export function revealPassword(): string {
  return process.env.REVEAL_PASSWORD || adminPassword();
}

/** Is there anything to type at all on this deployment? (Drives the wording on the screen — a
 *  console with no secret says so rather than showing a box that can never open.) */
export function revealConfigured(): boolean {
  return revealPassword().length > 0;
}

/** The key the cookie is signed with. Distinct from the password's own hash, so the cookie is not
 *  a value anybody can recompute from the password alone. */
async function signingKey(): Promise<string> {
  return sha256hex(`aevidine.reveal.v1$${revealPassword()}`);
}

async function sign(expiresAt: number): Promise<string> {
  return sha256hex(`${await signingKey()}$${expiresAt}`);
}

/** Does the typed password open the door? Constant-time, and always false when nothing is set. */
export async function revealPasswordMatches(typed: string): Promise<boolean> {
  const real = revealPassword();
  if (!real || !typed) return false;
  // Hash both sides first so safeEqual always compares two equal-length hex strings — a raw compare
  // of the typed text would leak its LENGTH through the early `a.length !== b.length` return.
  return safeEqual(await sha256hex(typed), await sha256hex(real));
}

/** Mint the cookie value for one unlock window. `<expiresAt>.<hmac>` — the expiry is in the open
 *  so the screen can count down, and inside the signature so it cannot be edited. */
export async function mintRevealToken(ttlMs = REVEAL_TTL_MS): Promise<{ value: string; expiresAt: number }> {
  const expiresAt = Date.now() + ttlMs;
  return { value: `${expiresAt}.${await sign(expiresAt)}`, expiresAt };
}

/**
 * Is this cookie a live unlock? Returns the moment it runs out, or null for locked.
 *
 * Returns null — never throws — for: no cookie, a shape it does not recognise, an expiry that is
 * not a number, a signature that does not match (including one signed with a secret that has since
 * been rotated), and an expiry in the past.
 */
export async function revealUnlockedUntil(token: string | null | undefined): Promise<number | null> {
  try {
    if (!token || !revealConfigured()) return null;
    const dot = token.indexOf(".");
    if (dot <= 0) return null;
    const expiresAt = Number(token.slice(0, dot));
    const sig = token.slice(dot + 1);
    if (!Number.isFinite(expiresAt) || !sig) return null;
    // Signature BEFORE expiry: an expired-but-genuine token and a forged one must take the same
    // path, so neither can be told apart from the outside.
    if (!safeEqual(sig, await sign(expiresAt))) return null;
    if (expiresAt <= Date.now()) return null;
    return expiresAt;
  } catch { return null; }
}

/** The plain yes/no every route uses. */
export async function revealUnlocked(token: string | null | undefined): Promise<boolean> {
  return (await revealUnlockedUntil(token)) !== null;
}

/** The one sentence every route says when the passwords are still covered, so the screens can all
 *  react to the same wording and the same 423. */
export const REVEAL_LOCKED_MESSAGE =
  "Passwords are covered. Type the admin password to uncover them.";
