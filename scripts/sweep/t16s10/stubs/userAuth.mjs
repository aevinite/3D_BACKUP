// Stand-in for lib/userAuth for T16's in-memory routes: the shared stub (requireRole from the world)
// plus the cookie helpers the owner routes import. userFromCookie answers the world's owner, or null.
import { G } from "../../../panel-stubs/state.mjs";
export { requireRole, verifySecret } from "../../../panel-stubs/userAuth.mjs";
export const USER_COOKIE = "lfh_user";
export class AuthDbError extends Error {}
export async function userFromCookie() { return G.COOKIE_USER || null; }
