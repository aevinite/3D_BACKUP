// WHO DID IT — and never a database id in that column (T12 sweep, 2026-08-27).
//
// The owner's two log surfaces — the "Recent activity · who did what" card on the dashboard and
// the Activity log on Audit & logs — print `staff_actions.actor` straight into the person column.
// For almost every row that is a login name ("diagm1", "zztest Beta") and reads correctly.
//
// Two writers put a raw uuid there instead. Measured live on French House, the owner's home screen
// showed, in the person column:
//
//     Handled a rating      c0af7b5b-c0d8-40f6-b831-f475e48bab53   2m ago
//     Erased a guest record c0af7b5b-c0d8-40f6-b831-f475e48bab53   8m ago
//
// Both come from app/api/owner/ratings/route.ts and app/api/owner/customers/route.ts, which build
// their actor as `(scope.all || scope.admin) ? "admin" : (scope.ownerId || "owner")` — and
// `scope.ownerId` is the owner's uuid, not a name. That is the real fault and it belongs in those
// two routes; they are outside this sweep's fence, so it is reported rather than edited here.
//
// What this file fixes is the half that IS on these screens: an owner must never be shown a
// database id where a person's name goes. It tells him nothing, and it reads as the screen being
// broken. So a bare uuid is rendered as the same em dash the row already uses for "no name was
// recorded", and the id itself stays in the row's tooltip so support can still trace it. Nothing is
// invented — we do not guess a name we were not given, and the full row (id included) is still
// there in the detail popup a row opens, so nothing is lost for support.
//
// Deliberately NOT in components/admin/shared: that file is the whole admin console's, and this is
// a two-screen display guard, not a new rule for eleven other screens.

/** A bare v4-ish uuid and nothing else. Anchored, so a name that merely CONTAINS one is left alone. */
const BARE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when this actor value is a raw database id rather than a person we can name. */
export function actorIsRawId(actor: string | null | undefined): boolean {
  return typeof actor === "string" && BARE_ID.test(actor.trim());
}

/** What to PRINT in the person column: the name we were given, or "—" when all we have is an id. */
export function actorLabel(actor: string | null | undefined): string {
  if (!actor) return "—";
  return actorIsRawId(actor) ? "—" : actor;
}

/** What to put in that cell's tooltip, so an id is traceable without being on screen. */
export function actorTitle(actor: string | null | undefined): string | undefined {
  if (!actor) return undefined;
  return actorIsRawId(actor)
    ? `Recorded without a name — the panel logged an internal reference (${actor}).`
    : undefined;
}
