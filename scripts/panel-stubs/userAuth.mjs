// WHO is acting, from the shared world. user === null means the admin super-user (no staff cookie).
import { G } from "./state.mjs";
export async function requireRole() { return G.ACTOR; }
// The waiter route imports the PIN checker (lib/managerPin.ts). A stub PIN never matches — added by
// sweep #10 T10 round 2 so the waiter route can be driven in memory.
export async function verifySecret() { return false; }
