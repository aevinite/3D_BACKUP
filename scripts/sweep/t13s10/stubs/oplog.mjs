// The oplog stand-in for terminal 13's harness: the shared stub plus deviceBlocked, which the tablet
// route asks on every write and (memoised) on every board read. A device is blocked when the world
// lists it in G.BLOCKED as "<restaurant>:<device>" — so "blocked HERE, not there" can be driven.
import { G } from "../../../panel-stubs/state.mjs";
export async function logAction(panel, action, meta) { G.LOGS.push({ panel, action, ...(meta || {}) }); }
export async function logError(panel, action, e, meta) { G.ERRORS.push({ panel, action, message: e?.message, ...(meta || {}) }); }
export function deviceIdFrom(req) { try { return req?.headers?.get?.("x-lfh-device") || "dev-test"; } catch { return "dev-test"; } }
export async function deviceBlocked(dev, rid) { (G.BLOCK_ASKS ||= []).push(`${rid}:${dev}`); return !!(G.BLOCKED && G.BLOCKED.includes(`${rid}:${dev}`)); }
