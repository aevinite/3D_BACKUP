// scripts/sweep/fixtureTables.mjs — WHICH TABLES BELONG TO WHICH GUARD.
//
// WHY (sweep #6 / T28, 2026-08-22). Two guards fought over table 28 and the loser reported a product
// fault. `verify-table-ownership` picks a free table dynamically and walks DOWN from the highest number
// (30, 29, 28 …) — which is exactly the range `verify-void-on-joined-party` owns (27 and 28) and where
// `verify-merged-floor` sits (21, 22, 23). Measured in a whole-suite run: ownership seated a party on
// 28, void's fixture check then read that party as its own, and void printed "2 check(s) failed" about
// a void that had worked perfectly.
//
// A collision like that is worse than a flake, because it looks exactly like a real fault in the
// product and it is not reproducible on its own — the two runs have to overlap. So:
//
//   · OFF_PLAN — names no restaurant has a table for. A row on one of these can only have come from a
//     test, which is what lets verify:fixtures give an unambiguous answer.
//   · RESERVED  — real, on-plan numbers a specific guard has taken. Anything that picks a table
//     DYNAMICALLY must treat these as busy, or it will sit down at somebody else's table.
//
// Add a line here when a guard claims a table. It is one list, in one place, on purpose: the previous
// arrangement was eight guards each naming their own number in their own file, and no way to see the
// clash until two of them ran at once.

/** Off-plan fixture tables → the guard that owns each. Nothing real is ever called these. */
export const OFF_PLAN = [
  ["288", "verify-cancelled-tile-parity.mjs"],
  ["ALGTEST", "verify-allergy-isolation.mjs"],
  ["9931", "verify-realtime.mjs"],
  ["9932", "verify-tablet-parity.mjs"],
  ["9965", "verify-sweep-extras.mjs"],
  ["9966", "verify-tablet-floor.mjs"],
  ["9967", "verify-tablet-floor.mjs"],
  ["9990", "verify-two-parties.mjs"],
  ["E2E-TAX", "verify-tax-mode-e2e.mjs"],
  ["OWNCHK", "verify-table-ownership.mjs"],
  ["T12-TEST", "verify-cancel-loss.ts"],
  ["T12-P2", "verify-cancel-made.ts"],
];

/**
 * On-plan table numbers a guard has claimed. A guard that picks its own table must skip these.
 * Keep the reason next to each — the point is that the next person can see the clash before it happens.
 */
export const RESERVED = [
  ["11", "verify-merged-floor.mjs — the four-table party's PARENT (it holds the joint bill)"],
  ["12", "verify-merged-floor.mjs — the four-table party"],
  ["13", "verify-merged-floor.mjs — the four-table party"],
  ["14", "verify-merged-floor.mjs — the four-table party"],
  ["15", "verify-edge-cases.mjs — the session-gate races (moved off 11 on 2026-08-30: 11 is the merged party's parent, and the two guards were scrambling each other)"],
  ["21", "verify-merged-floor.mjs / verify-families.mjs — the independent tables"],
  ["22", "verify-merged-floor.mjs / verify-families.mjs — the independent tables"],
  ["23", "verify-merged-floor.mjs — the independent tables"],
  ["25", "scripts/sweep/t3/order-end-to-end.mjs — it opens a session on 25 and walks an order through it (registered 2026-08-30: it had been sitting there unlisted, so any dynamic picker was free to take it mid-run)"],
  ["27", "verify-void-on-joined-party.mjs — the party that holds the bill"],
  ["28", "verify-void-on-joined-party.mjs — the joined table whose food must survive"],
  ["9", "verify-session-ux.mjs — the partner-approval walk"],
];

/** Every table name any guard has claimed, as strings — for `busy.add(...)` in a dynamic picker. */
export const claimedTables = () => [...OFF_PLAN.map(([t]) => t), ...RESERVED.map(([t]) => t)];

/** Who owns a table, for a message a person can act on. */
export const ownerOf = (t) =>
  (OFF_PLAN.find(([n]) => n === String(t)) || RESERVED.find(([n]) => n === String(t)) || [])[1] || null;
