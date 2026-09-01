// lib/managerPin.ts — verifies a manager PIN for the tablet's gated actions.
//
// PINs are PER-MANAGER (staff_users.pin_hash, salted PBKDF2). A tablet action is
// unlocked by ANY active manager's PIN; we return which manager matched so the
// action can be logged with their name. The slow PBKDF2 hash is the brute-force
// deterrent (a 4–8 digit PIN checked against every active manager per attempt).
//
// SHARED-PIN ATTRIBUTION (owner, 2026-07-24): each manager sets their OWN PIN, so a
// unique PIN names exactly one manager in the log. But two managers CAN pick the same
// digits — then that PIN is genuinely ambiguous, and the log must name EVERY manager it
// could have been (not silently credit whichever the DB returned first). So we check
// EVERY active manager's hash (no early return) and return ALL matches. The extra slow
// hashes only run on a rare gated tap (never a poll), so the cost is negligible.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { verifySecret } from "@/lib/userAuth";
import { throttleStatus, throttleFail, throttleReset } from "@/lib/loginThrottle";

const PIN_MAX_FAILS = 5;          // wrong PINs (per device) before a short lockout
const PIN_LOCK_MS = 60 * 1000;    // lockout length (1 minute)

// Bootstrap gate: until at least one active manager has a PIN, the tablet's PIN
// gates stay OPEN so a waiter is never locked out before setup. Enforcement turns
// on the moment any manager has a PIN.
// SCOPED PER RESTAURANT (2026-06-26): a tablet must only ever consider managers of
// ITS OWN restaurant — otherwise a manager PIN from restaurant B could unlock a tablet
// at restaurant A, and one restaurant setting a PIN would flip the gate on for everyone.
export async function anyManagerHasPin(restaurantId: string): Promise<boolean> {
  const { data } = await sb.from("staff_users").select("id")
    .eq("restaurant_id", restaurantId)
    .eq("role", "manager").eq("active", true).not("pin_hash", "is", null).limit(1);
  return !!(data && data.length);
}

// managerName/managerId = the FIRST matching manager (kept for callers that want one
// name). managerNames = EVERY manager whose PIN matched; sharedPin = more than one did
// (the ambiguous case the log must spell out). managerIds mirrors managerNames.
export type PinCheck = {
  ok: boolean;
  managerId?: string; managerName?: string;
  managerIds?: string[]; managerNames?: string[]; sharedPin?: boolean;
  locked?: boolean;
};

// `throttleKey` (e.g. "pin:<restaurant>:<device>") turns on a brute-force lockout so a
// 4-digit PIN can't be tried unlimited times: PIN_MAX_FAILS wrong tries per device
// lock it for PIN_LOCK_MS. Omit it and the check behaves exactly as before (the slow
// PBKDF2 hash is still the baseline deterrent). Fail-open via lib/loginThrottle.
export async function verifyManagerPin(pin: string, restaurantId: string, throttleKey?: string): Promise<PinCheck> {
  const clean = String(pin || "").trim();
  if (!/^\d{4,8}$/.test(clean)) return { ok: false };
  if (throttleKey && (await throttleStatus(throttleKey)).locked) return { ok: false, locked: true };
  const { data } = await sb.from("staff_users").select("id,name,username,pin_hash")
    .eq("restaurant_id", restaurantId)
    .eq("role", "manager").eq("active", true).not("pin_hash", "is", null)
    // BOUNDED (T25 round 2, item 31): a read with no limit is silently capped at 1,000 rows by
    // PostgREST, which is a truncation nobody is told about. 200 is far past any restaurant's
    // manager count, so it can only ever be a ceiling, never a cut.
    .limit(200);
  // Check EVERY manager (no early return) so a shared PIN credits ALL of them, not just
  // whichever row the DB returned first — that would name the wrong manager in the log.
  const matches: { id: string; name: string }[] = [];
  for (const m of data || []) {
    if (await verifySecret(clean, m.pin_hash)) {
      matches.push({ id: m.id as string, name: (m.name as string) || (m.username as string) });
    }
  }
  if (matches.length) {
    if (throttleKey) await throttleReset(throttleKey);
    return {
      ok: true,
      managerId: matches[0].id, managerName: matches[0].name,
      managerIds: matches.map((x) => x.id),
      managerNames: matches.map((x) => x.name),
      sharedPin: matches.length > 1,
    };
  }
  if (throttleKey) await throttleFail(throttleKey, PIN_MAX_FAILS, PIN_LOCK_MS);
  return { ok: false };
}
