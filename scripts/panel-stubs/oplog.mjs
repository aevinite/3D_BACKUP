// Captures the diary lines the handler writes, so a test can assert the walk-out money record.
import { G } from "./state.mjs";
export async function logAction(panel, action, meta) { G.LOGS.push({ panel, action, ...(meta || {}) }); }
export async function logError(panel, action, e, meta) { G.ERRORS.push({ panel, action, message: e?.message, ...(meta || {}) }); }
export function deviceIdFrom() { return "dev-test"; }
