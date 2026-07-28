// Shared log-marker constants — importable from BOTH server routes and client
// components (no server-only imports here, unlike lib/oplog).
//
// ADMIN_VIEW_ACTOR_ID (owner, 2026-07-28): staff_actions.actor_id is a uuid column,
// so the "this was the ADMIN acting via a panel view" marker is a reserved sentinel
// uuid (never collides with a real user's random v4 id). Writers stamp it when a
// panel action runs with no staff cookie; the ADMIN's log surfaces render it as an
// "Admin (panel view)" pill; staff/owner log reads replace it with null so the
// admin stays invisible to them.
export const ADMIN_VIEW_ACTOR_ID = "00000000-0000-0000-0000-0000000000ad";
