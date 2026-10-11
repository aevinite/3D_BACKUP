// Stand-in for lib/floorSummary.ts: records every snapshot drop.
import { G } from "./state.mjs";
export function invalidateFloor(rid) { G.FLOOR.push(rid); }
export async function sharedFloorSummary(_k, compute) { return compute(); }
