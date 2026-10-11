// Stand-in for lib/planTable.ts: answers whatever the check set in G.PLAN, and records the question.
import { G } from "./state.mjs";
export const PLAN_MARGIN = 500;
export async function offPlanTable(rid, table, opts) { G.PLAN_CALLS.push({ rid, table, opts }); return G.PLAN ? G.PLAN(rid, table, opts) : null; }
