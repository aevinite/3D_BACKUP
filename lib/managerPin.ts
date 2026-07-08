// lib/managerPin.ts — verifies a manager PIN for the tablet's gated actions.
//
// PINs are PER-MANAGER (staff_users.pin_hash, salted PBKDF2). A tablet action is
// unlocked by ANY active manager's PIN; we return which manager matched so the
// action can be logged with their name. The slow PBKDF2 hash is the brute-force
// deterrent (a 4–8 digit PIN checked against every active manager per attempt).
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

export type PinCheck = { ok: boolean; managerId?: string; managerName?: string; locked?: boolean };

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
    .eq("role", "manager").eq("active", true).not("pin_hash", "is", null);
  for (const m of data || []) {
    if (await verifySecret(clean, m.pin_hash)) {
      if (throttleKey) await throttleReset(throttleKey);
      return { ok: true, managerId: m.id as string, managerName: (m.name as string) || (m.username as string) };
    }
  }
  if (throttleKey) await throttleFail(throttleKey, PIN_MAX_FAILS, PIN_LOCK_MS);
  return { ok: false };
}
