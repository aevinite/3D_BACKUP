// lib/auditActor.ts — WHO a removal is attributed to, for a reader who is NOT the admin.
//
// The standing rule (CLAUDE.md): "Admin = top power, invisibly: from /aevinite, reach any
// restaurant's panels, no password, no hint shown to the owner." The owner reinforced it on
// 2026-08-11 for this exact area: "admin data should not be shown anywhere to the owner or to the
// manager — it could be shown to admin."
//
// The Activity log already obeys it. `/api/owner/oplog` drops the whole `admin`/`db` panels and,
// for anything the admin did from inside a panel view, nulls the ADMIN_VIEW_ACTOR_ID marker with
// the comment "a REAL owner gets the row as a plain, neutral panel action (the admin stays
// invisible, per the standing rule)".
//
// The AUDIT (deletion_audit, mig 251) never got the same treatment. `recordRemoval` stamps
// `p_actor: … || "Admin (Aevidine)"` and `p_actor_role: … || "admin"`, so when an Aevidine admin
// deleted a bill from the ledger, the owner's own Audit screen named them — and the manager's
// Removals screen did too (T7 finding, 2026-08-11).
//
// WHAT THIS DOES **NOT** DO: hide the row. A removal must stay visible — that is the whole
// compliance argument of this product (docs/COMPLIANCE-GUARDRAILS.md: the software must be
// incapable of making a real sale quietly vanish). The reason, the amount, the bill number, the
// time and the full detail card are all untouched. Only the ADMIN'S IDENTITY is withheld, exactly
// as the Activity log withholds it, so an owner sees that a bill was removed and why, without
// being told Aevidine was inside their restaurant.
//
// The admin's own screens pass `isAdmin: true` and get the row verbatim.

/** The roles that mean "this was Aevidine, not one of the restaurant's own people". */
const ADMIN_ROLES = new Set(["admin", "db"]);

type ActorRow = { actor?: string | null; actor_role?: string | null };

/** True when this row was written by the platform rather than by the restaurant's staff. */
export function isPlatformActor(row: ActorRow): boolean {
  if (ADMIN_ROLES.has(String(row?.actor_role || "").toLowerCase())) return true;
  // Belt for rows written before actor_role was reliably stamped: the recorder's own fallback
  // string is the only value that has ever carried these words.
  return /^admin\b/i.test(String(row?.actor || "").trim());
}

/**
 * Strip the admin's identity from ONE audit row, for a non-admin reader. Returns the row as-is
 * for an admin, and for anything a real staff member did.
 *
 * `actor` becomes null rather than a made-up name: the screens already render `actor || "—"`, and
 * inventing a person ("System", "Support") on a money record would be worse than saying nothing.
 */
export function forReader<T extends ActorRow>(row: T, isAdmin: boolean): T {
  if (isAdmin || !isPlatformActor(row)) return row;
  return { ...row, actor: null, actor_role: null };
}

/** The same, for a whole list. */
export function auditForReader<T extends ActorRow>(rows: T[], isAdmin: boolean): T[] {
  if (isAdmin) return rows;
  return rows.map((r) => forReader(r, false));
}
