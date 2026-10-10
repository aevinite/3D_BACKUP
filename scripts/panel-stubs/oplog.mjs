// Captures the diary lines the handler writes, so a test can assert the walk-out money record.
import { G } from "./state.mjs";
export async function logAction(panel, action, meta) { G.LOGS.push({ panel, action, ...(meta || {}) }); }
export async function logError(panel, action, e, meta) { G.ERRORS.push({ panel, action, message: e?.message, ...(meta || {}) }); }
// OPT-IN (sweep #10 T10 round 3): a request carrying x-test-no-device has no device id, so the
// "this browser has no device id yet" refusals can be driven. Every other request is "dev-test", as before.
export function deviceIdFrom(req) { return req && req.headers && req.headers.get && req.headers.get("x-test-no-device") ? null : "dev-test"; }
// The kitchen route asks whether this device is blocked (sweep #10 T10 round 2 — added so the kitchen
// route can be driven in memory too). A stub device is never blocked.
export async function deviceBlocked() { return false; }
