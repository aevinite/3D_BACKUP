// lib/botCheck.ts — the cheap filter on the login doors (added 2026-08-16).
//
// ── WHAT THIS IS, HONESTLY ───────────────────────────────────────────────────────────────────
// This is the LOW rung of bot protection, and it is worth being straight about that. Two signals:
//
//   1. A TRAP FIELD nobody can see. A person filling in the login form cannot type into it —
//      it is not on screen and cannot be tabbed to. A script that fills every input on the page
//      fills it too. Anything arriving with that field filled did not come from a person.
//   2. HOW LONG THE FORM WAS OPEN. A person needs time to type a password. A script posts the
//      instant the page exists.
//
// Neither stops somebody who looks at the page and writes a script for THIS form specifically.
// They stop the untargeted, fill-everything traffic that finds a login page and starts guessing —
// which is the overwhelming majority of it, and which currently arrives here unimpeded.
//
// The REAL defences remain what they already were and this does not replace them: the per-account
// lockout (lib/userAuth, mig 055), the IP lockout on the shared admin password (lib/loginThrottle,
// mig 151), the request rate limit (lib/rateLimit, mig 205), and a password hash slow enough
// (PBKDF2 ×120,000) that guessing costs real time. This is one more cheap layer in front.
//
// FOR THE STRONG VERSION, turn on Cloudflare Turnstile: set TURNSTILE_SECRET_KEY (server) and
// NEXT_PUBLIC_TURNSTILE_SITE_KEY (browser) and it starts being enforced with NO code change —
// see verifyTurnstile() below. With no keys set it is skipped entirely, which is the state today.
//
// ── THE RULE THAT MATTERS MOST: IT FAILS OPEN ────────────────────────────────────────────────
// If the signals are ABSENT, the login is ALLOWED. That is deliberate and non-negotiable:
//   · staff can be running a weeks-old cached panel (see CLAUDE.md — `?v=` is a content hash),
//     and that old page does not know to send these fields;
//   · the no-JS <form> fallback on /staff-login posts without them;
//   · a queued/offline login replay has no live form behind it.
// A protection that locks a waiter out of the tablet mid-service is worse than the traffic it
// blocks. So this only ever refuses on a signal that is PRESENT AND WRONG.

/** Name of the trap input. Deliberately NOT "email"/"username"/"phone" — those are exactly the
 *  names a password manager offers to autofill, and an autofilled trap would refuse a real
 *  person. Nothing on the site is called this. */
export const BOT_TRAP_FIELD = "lfh_hp_ref";

/** Name of the "how many milliseconds was the form open" input. A DURATION measured on the
 *  device, never a clock reading: a phone with the wrong date would otherwise be refused, and
 *  restaurant tablets have wrong clocks all the time. */
export const BOT_ELAPSED_FIELD = "lfh_hp_ms";

/** Below this many ms between the form appearing and being submitted, it was not typed by a
 *  person. Set LOW on purpose. A password manager that autofills and submits still needs the
 *  page painted and an event loop turn; 400ms leaves enormous headroom. Raising this is how you
 *  would start refusing real people, so don't, without measuring first. */
export const MIN_HUMAN_MS = 400;

export type BotVerdict = { ok: true } | { ok: false; reason: "trap" | "too_fast" | "turnstile" };

/**
 * Judge one login submission. `trap` and `elapsed` are the two form values as they arrived
 * (string | null — whatever formData/JSON gave you; no pre-cleaning needed).
 *
 * Returns ok:true for anything it cannot judge. See the fails-open note above.
 */
export function botVerdict(trap: unknown, elapsed: unknown): BotVerdict {
  // 1. The trap. Present and non-empty = filled by something that fills everything.
  if (typeof trap === "string" && trap.trim() !== "") return { ok: false, reason: "trap" };

  // 2. The duration. Only judge a value that is actually a number we can trust the shape of.
  //    Missing, empty, non-numeric, negative or absurd → no opinion, allow.
  if (elapsed !== null && elapsed !== undefined && String(elapsed).trim() !== "") {
    const ms = Number(elapsed);
    if (Number.isFinite(ms) && ms >= 0 && ms < MIN_HUMAN_MS) return { ok: false, reason: "too_fast" };
  }

  return { ok: true };
}

/**
 * Cloudflare Turnstile — OFF unless TURNSTILE_SECRET_KEY is set, and that is the whole switch.
 *
 * Returns true (= allowed) when no secret is configured, so nothing changes on a stack that has
 * not been given keys. Also returns true if Cloudflare itself cannot be reached: an outage at a
 * third party must not be able to stop a restaurant signing in. That is the same fail-open
 * judgement as the rest of this file, made explicit rather than left to a thrown error.
 */
export async function verifyTurnstile(token: unknown, ip?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // not configured — skip entirely

  if (typeof token !== "string" || !token) return false; // configured, but nothing sent

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      // A login must not hang on a third party. If Cloudflare is slow, we allow (below).
      signal: AbortSignal.timeout(4000),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return true; // unreachable / timed out → do not block the login
  }
}

/** Is Turnstile switched on for the browser? Used by the form to decide whether to render the
 *  widget at all. Reads the PUBLIC key, which is the one that is safe in the browser. */
export const turnstileSiteKey = () => process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";
