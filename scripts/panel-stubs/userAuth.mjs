// WHO is acting, from the shared world. user === null means the admin super-user (no staff cookie).
import { G } from "./state.mjs";
export async function requireRole() { return G.ACTOR; }
