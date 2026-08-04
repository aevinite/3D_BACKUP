// ONE shared world, hung off globalThis.
//
// WHY: esbuild BUNDLES these stub modules into the route bundle, so the copy the handler talks to
// is a different module instance from the copy the test imports. Fixtures set by the test then
// never reach the handler, and it quietly runs against an empty database — which looked exactly
// like a broken permission gate. Sharing through a global makes the instance count irrelevant.
export const G = (globalThis.__T3 ||= {
  FIX: { restaurants: [], settings: [], orders: [], sessions: [], table_merges: [], table_tags: [], staff_actions: [], khata_customers: [], feedback: [], order_items: [], aggregator_orders: [], session_members: [], requests: [], waiter_calls: [] },
  WRITES: [], RPCS: [], RPC_ANSWERS: {}, LOGS: [], ERRORS: [],
  ACTOR: { ok: true, user: null },
});
export function resetWorld() {
  for (const k of Object.keys(G.FIX)) G.FIX[k] = [];
  G.WRITES.length = 0; G.RPCS.length = 0; G.LOGS.length = 0; G.ERRORS.length = 0;
  for (const k of Object.keys(G.RPC_ANSWERS)) delete G.RPC_ANSWERS[k];
}
