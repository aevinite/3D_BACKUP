// Captures the diary lines the handler writes, so a test can assert the walk-out money record.
import { G } from "./state.mjs";
export async function logAction(panel, action, meta) { G.LOGS.push({ panel, action, ...(meta || {}) }); }
export async function logError(panel, action, e, meta) { G.ERRORS.push({ panel, action, message: e?.message, ...(meta || {}) }); }
export function deviceIdFrom() { return "dev-test"; }
// The kitchen route asks whether this device is blocked (sweep #10 T10 round 2 — added so the kitchen
// route can be driven in memory too). A stub device is never blocked.
export async function deviceBlocked() { return false; }
