// Stand-in for lib/planTable.ts: answers whatever the check set in G.PLAN, and records the question.
import { G } from "./state.mjs";
export const PLAN_MARGIN = 500;
export async function offPlanTable(rid, table, opts) { G.PLAN_CALLS.push({ rid, table, opts }); return G.PLAN ? G.PLAN(rid, table, opts) : null; }
// The guest-table rule is pure, so the REAL one is used, never a copy that could drift (round 3 — the two
// guest doors call it before offPlanTable; lib/planTable.ts's own database import goes to ./sb.mjs).
export { guestTable } from "../../../../lib/planTable.ts";
