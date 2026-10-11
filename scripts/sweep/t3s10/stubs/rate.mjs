// Stand-in for lib/rateLimit.ts's one export these routes use.
import { G } from "./state.mjs";
export async function pingLatestGuestLimit(key, rid) { G.PINGS.push({ key, rid }); }
