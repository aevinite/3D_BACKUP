// The userAuth stand-in for terminal 13's harness. scripts/panel-stubs/userAuth.mjs exports only
// requireRole, which is all the manager route needs; the TABLET route also reaches lib/managerPin
// (verifySecret) and lib/viewAsPerson (userFromCookie), so this one carries those too. WHO is acting
// still comes from the shared world (G.ACTOR), exactly like the shared stub.
import { G } from "../../../panel-stubs/state.mjs";
export const USER_COOKIE = "lfh_user";
export class AuthDbError extends Error {}
export async function requireRole() { return G.ACTOR; }
export async function userFromCookie() { return G.ACTOR && G.ACTOR.ok ? G.ACTOR.user : null; }
// A stored PIN in the fixtures is the PLAIN pin prefixed "plain:" — enough to drive the PIN gate.
export async function verifySecret(plain, stored) { return !!stored && stored === `plain:${plain}`; }
export async function hashSecret(plain) { return `plain:${plain}`; }
export function roleSatisfies(have, need) {
  const rank = { kitchen: 0, tablet: 1, manager: 2, owner: 3 };
  if (need === "kitchen") return have === "kitchen" || rank[have] >= 2;
  return (rank[have] ?? -1) >= (rank[need] ?? 99);
}
