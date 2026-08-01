// The owner "home" restaurant_id — resolved at runtime, never hardcoded.
//
// WHY THIS EXISTS: `staff_users.restaurant_id` is NOT NULL with a foreign key to
// `restaurants(id)` (migration 078). For an OWNER that column carries no meaning —
// what an owner actually owns lives in the `restaurant_owners` join table (mig 097)
// with `restaurants.owner_user_id` as the display "primary". The column is just a
// tenant anchor the schema demands, so both owner-creating routes used to hardcode
// it to restaurant #1 (`…0001`, the original seed restaurant).
//
// That hardcode breaks on any deployment where #1 no longer exists — e.g. a stack
// trimmed down to one client's restaurant. Creating an owner there fails with
// `insert or update on table "staff_users" violates foreign key constraint
// "staff_users_restaurant_fk"`, which reads like a mystery to the admin.
//
// So: ask the database which restaurant to anchor to. #1 if it's still there (keeps
// every existing stack byte-identical), else one of the restaurants this owner is
// being given, else the oldest live restaurant.
//
// Egress: one tiny indexed lookup (`id` = primary key) on a rare admin write path.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

export const DEFAULT_RID = "00000000-0000-0000-0000-000000000001";
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/**
 * Pick the restaurant row an owner's login can legally point at.
 * @param preferred restaurant ids the owner is being attached to (tried in order).
 * @param homeRid the preferred anchor; only overridden by the verify script, which
 *        passes an id that doesn't exist to exercise the fallbacks on the dev DB.
 * @returns `{ rid }` on success, or `{ error }` with an admin-readable reason.
 */
export async function resolveOwnerHomeRid(
  preferred: string[] = [],
  homeRid: string = DEFAULT_RID,
): Promise<{ rid?: string; error?: string }> {
  // 1) #1, if this database still has it — unchanged behaviour for existing stacks.
  const one = await sb.from("restaurants").select("id").eq("id", homeRid).limit(1);
  if (one.error) return { error: one.error.message };
  if (one.data?.[0]) return { rid: homeRid };

  // 2) a restaurant the admin just picked for this owner (skip binned ones).
  const wanted = preferred.filter(isUuid);
  if (wanted.length) {
    const hit = await sb.from("restaurants").select("id").in("id", wanted).is("deleted_at", null);
    if (hit.error) return { error: hit.error.message };
    const first = wanted.find((r) => hit.data?.some((x) => x.id === r));
    if (first) return { rid: first };
  }

  // 3) any live restaurant — the oldest, so the anchor is stable across calls.
  const any = await sb.from("restaurants").select("id")
    .is("deleted_at", null).order("created_at", { ascending: true }).limit(1);
  if (any.error) return { error: any.error.message };
  if (any.data?.[0]) return { rid: any.data[0].id as string };

  return { error: "Create a restaurant first — an owner login has to be anchored to one." };
}

/**
 * Is this login name already used by a LIVE account? The check is global — the old
 * per-restaurant check missed clashes with other restaurants' staff and let Postgres
 * throw a raw 23505 at the admin instead. `key` is always a normalizeLoginName()
 * result (lower-cased), and so is every stored username, so an exact match is enough —
 * and unlike ilike it can't be turned into a wildcard by a `%`/`_` in the name.
 *
 * RECYCLE-BIN RULE (owner, 2026-08-01): a binned account is DELETED as far as names go,
 * so `deleted_at IS NULL` — its name is free to take. Migration 245 made the unique
 * index partial to match, so the DB agrees instead of throwing behind our back. The
 * name only comes up again at RESTORE time, which asks the admin who gets renamed
 * (app/api/admin/owners → restore_owner).
 */
export async function loginNameTaken(key: string): Promise<boolean> {
  const dup = await sb.from("staff_users").select("id").eq("username", key).is("deleted_at", null).limit(1);
  return !!dup.data?.[0];
}

/**
 * Who LIVE holds this login name (used to explain a restore clash). Returns the rows
 * a restore would collide with, newest anchor info included so the admin can tell the
 * accounts apart. Empty array = the name is free.
 */
export async function liveHoldersOfName(key: string): Promise<
  { id: string; name: string | null; username: string; role: string; active: boolean; restaurant_id: string | null }[]
> {
  const q = await sb.from("staff_users")
    .select("id, name, username, role, active, restaurant_id")
    .eq("username", key).is("deleted_at", null).limit(10);
  return (q.data || []) as { id: string; name: string | null; username: string; role: string; active: boolean; restaurant_id: string | null }[];
}
