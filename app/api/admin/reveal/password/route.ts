// /api/admin/reveal/password — ONE person's password, read back or replaced (owner, 2026-09-13).
//
// WHY THIS EXISTS AS ITS OWN ROUTE. He asked for a "show password" on the owner's details AND on a
// user's details, on top of the one that already lived on a restaurant's handover card. Three
// screens asking the same question three different ways is three places for the rules to drift —
// and the rules here are the ones you cannot afford to have drift. So there is ONE door:
//
//   POST { user_id }                      → { stored: true,  password }   the readable copy
//                                         → { stored: false }             nothing was ever kept
//   POST { user_id, action: "set" }       → a NEW password, stored readable, returned
//          [, signOut: true ]               …and only with signOut does anyone get signed out
//
// THE FIVE RULES THIS ROUTE KEEPS:
//   1. TWO DOORS, BOTH LOCKED. The admin sign-in cookie (`tokenIsValid`, like every /api/admin/*
//      route) AND a live uncover window (lib/revealGate.ts). Neither alone is enough. A covered
//      console answers 423 and never touches the database.
//   2. THE PERSON IS READ BY ID, NEVER BY ANYTHING THE SCREEN SENDS. The row decides its own role
//      and restaurant; nothing in the request body can widen what comes back.
//   3. A PASSWORD IS NEVER LOGGED. The record names WHO was looked at and by whom. lib/passwordVault
//      says the same thing at openPassword(), and it is the one line that would undo the encryption.
//   4. SETTING A NEW PASSWORD DOES NOT SIGN ANYBODY OUT UNLESS ASKED (owner, 2026-09-13: "the table
//      and the password change no relation"). `token_version` is only bumped when signOut is true.
//      The full reasoning lives on the handover route's resetAll(); the short version is that
//      rotating a password for a HANDOVER and evicting someone are two different intentions, and
//      only one of them should empty the floor.
//   5. A PIN IS NOT A PASSWORD AND IS NOT HERE. `pin_hash` stays one-way, exactly as it is on the
//      handover sheet. A manager's PIN authorises an action; it is not a credential to hand over.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { logAction } from "@/lib/oplog";
import { openPassword, passwordFields, vaultReady } from "@/lib/passwordVault";
import { REVEAL_COOKIE, REVEAL_LOCKED_MESSAGE, revealUnlocked } from "@/lib/revealGate";
import { withIdempotency } from "@/lib/idempotency";
import { adminFail } from "@/lib/adminFail";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });

/** The same alphabet the restaurant builder and the handover card use: no l/o/0/1, so nothing on a
 *  printed sheet or read down a phone can be heard two ways. */
export function genPassword(): string {
  const a = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = ""; const r = crypto.getRandomValues(new Uint8Array(10));
  for (const b of r) s += a[b % a.length];
  return s;
}

async function postImpl(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value))) return err("unauthorized", 401);
  // 423 Locked, not 403 — the screens tell these apart: 401 sends you to sign in again, 423 opens
  // the "type the admin password" box in place, and 403 is a real refusal about this person.
  if (!(await revealUnlocked(req.cookies.get(REVEAL_COOKIE)?.value))) return err(REVEAL_LOCKED_MESSAGE, 423);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const userId = String(body.user_id || "");
  if (!UUID.test(userId)) return err("invalid user_id");
  const wantsNew = String(body.action || "") === "set";
  const signOut = body.signOut === true;

  const uQ = await sb.from("staff_users")
    .select("id, username, name, role, restaurant_id, token_version, password_shown")
    .eq("id", userId).is("deleted_at", null).maybeSingle();
  // A blip must not read as "that login no longer exists" — nothing retries a 404, and on the
  // button that MINTS a password that is the difference between "try again" and "burn a new one".
  if (uQ.error) return adminFail("this login", uQ.error, { action: "load" });
  const u = uQ.data as {
    id: string; username: string; name: string | null; role: string;
    restaurant_id: string | null; token_version: number | null; password_shown: string | null;
  } | null;
  if (!u) return err("That login no longer exists.", 404);
  const who = u.name || u.username;

  // ── READ IT BACK ────────────────────────────────────────────────────────────────────────────
  if (!wantsNew) {
    const password = await openPassword(u.password_shown);
    if (password === null) {
      // Not an error, and it must not read as one: it is the plain fact that this password predates
      // migration 330 (or the key has since been rotated), so no readable copy of it has ever
      // existed. The screen offers "Set a new one" from here.
      return NextResponse.json({ stored: false, vaultReady: vaultReady(), name: who, username: u.username, role: u.role });
    }
    await logAction("admin", "admin_reveal_password", {
      actor: "admin", restaurant_id: u.restaurant_id,
      detail: `looked at the password for "${who}" (${u.role})`,
    });
    return NextResponse.json({ stored: true, password, name: who, username: u.username, role: u.role });
  }

  // ── REPLACE IT ──────────────────────────────────────────────────────────────────────────────
  if (!vaultReady()) {
    return err("This deployment has no credential key set, so a password can't be stored for printing.", 409);
  }
  const password = genPassword();
  const wr = await sb.from("staff_users")
    .update({
      ...(await passwordFields(password)),
      // See rule 4 in the header. Bumping this is what ends every session on the account, so it is
      // opt-in and the screen says in plain words which of the two it is about to do.
      ...(signOut ? { token_version: (u.token_version || 0) + 1 } : {}),
      failed_count: 0, locked_until: null,
    })
    .eq("id", userId).select("id").maybeSingle();
  if (wr.error) return adminFail("this login's new password", wr.error, { action: "save" });
  // Never report a password the database didn't take (the 2026-07-07 rule).
  if (!wr.data) return err("Couldn't set that password — nothing was changed. Please try again.", 500);

  await logAction("admin", "user_reset_password", {
    actor: "admin", restaurant_id: u.restaurant_id,
    detail: `new password set for "${who}" (${u.role})`
      + (signOut ? " · every session on that account ended" : " · their screens stayed signed in"),
  });
  return NextResponse.json({ stored: true, password, name: who, username: u.username, role: u.role, signedOut: signOut });
}

// A double-tap must not burn two passwords and leave the one on screen wrong.
export const POST = withIdempotency(postImpl, "admin");
