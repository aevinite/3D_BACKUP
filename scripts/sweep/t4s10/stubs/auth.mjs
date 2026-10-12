// Stand-in for lib/userAuth.ts AND lib/staffAuth.ts. W.auth.user = the staff row a cookie names (or
// null); W.auth.dbError = true makes the staff lookup fail the way a database flap does; W.auth.admin =
// whether the admin cookie is valid.
import { W } from "./world.mjs";
export const USER_COOKIE = "lfh_user";
export const AUTH_COOKIE = "lfh_staff";
export class AuthDbError extends Error { constructor(m) { super(m || "auth lookup failed"); this.name = "AuthDbError"; } }
export async function userFromCookie(v) {
  if (W.auth.dbError) throw new AuthDbError("staff_users lookup failed after retry");
  if (W.auth.badCookie) throw new Error("bad cookie");
  return v ? (W.auth.user ?? null) : null;
}
export async function tokenIsValid(v) { return !!v && !!W.auth.admin; }
