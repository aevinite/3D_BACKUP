// The in-memory world the four guest routes see through ./sb.mjs and the helper stand-ins.
// One object on globalThis, so the bundled route and the test share it however many times a route
// is re-required.
export const G = (globalThis.__T3S10 ||= { reset() {} });
G.reset = () => {
  G.RPC = {};            // name → (args) => { data, error } | value
  G.RPC_CALLS = [];      // [{ name, args }]
  G.TABLES = { action_idempotency: [], session_members: [], sessions: [], rate_limit_events: [] };
  G.READS = [];          // [{ table, filters, limit }]
  G.FLOOR = [];          // every invalidateFloor(rid)
  G.PLAN = null;         // (rid, table, opts) => string|null — what offPlanTable answers
  G.PLAN_CALLS = [];
  G.CLASH = null;        // (args) => ClashInfo|null
  G.CLASH_CALLS = [];
  G.PINGS = [];          // every pingLatestGuestLimit(key, rid)
  G.THROW_FROM = null;   // a table name whose reads throw
};
if (!G.TABLES) G.reset();   // never wipe a world a check has already set up when a bundle is re-required
