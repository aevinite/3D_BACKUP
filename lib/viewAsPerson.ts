// lib/viewAsPerson.ts — "show me THIS PERSON's panel" (owner, 2026-08-02).
//
// The admin console could already enter a RESTAURANT and open its panels (the act-as
// cookie + the per-tab ?rid pin), and could ask to see a panel as the real role rather
// than the full admin X-ray (?view=real). What it could NOT do is see it as ONE NAMED
// PERSON — and that is the only view that answers the question the profile screen
// raises: "this waiter has Discount switched OFF and holds tables 4–9; what does their
// tablet actually look like?"
//
// So a panel URL may carry ?as=<staff id>, exactly like ?rid= and ?view=real: per-tab,
// echoed by the panel on every API call, and meaningless without the admin cookie.
//
// WHAT THE PIN CHANGES — and what it deliberately does NOT:
//   • It changes what is SHOWN: whoami answers as that person's role (so the panel
//     renders their real, limited menu instead of the admin X-ray), their per-person
//     permission overrides shape the tri-state switches, and a waiter's sections narrow
//     the floor to the tables they hold.
//   • It does NOT change who is WRITING. Every write gate still sees the admin (top
//     power, uncapped) and every log row is still stamped as the admin view — the same
//     contract ?view=real has had since 2026-07-28. An admin looking through someone
//     else's eyes must never be able to leave footprints under that person's name.
//
// FAIL-SAFE BY DESIGN: any doubt (no admin cookie, a real staff session in this tab, an
// unknown/disabled person, someone from another restaurant, a role that doesn't match
// the panel) returns null — which is simply today's plain admin view. A pin can only
// ever narrow what the admin sees, never widen it.
import type { NextRequest } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import type { Role, StaffUser } from "@/lib/userAuth";

/** A staff id is a uuid. Checked before any DB read so a hand-typed pin costs nothing. */
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isPersonId = (v: string | undefined | null): v is string => !!v && ID_RE.test(v);

// The pinned person is re-read at most every 20s. An admin-view tab polls its panel, so
// a naive lookup would add one read per poll; 20s keeps a permission the admin just
// changed in the profile arriving within a few seconds while costing almost nothing.
// (Same shape as isPanelEnabledCached — one small PK read behind a short TTL.)
const TTL_MS = 20_000;
const cache = new Map<string, { at: number; row: StaffUser | null }>();

async function personById(id: string): Promise<StaffUser | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.row;
  const res = await sb.from("staff_users").select("*").eq("id", id).eq("active", true).limit(1);
  if (res.error) return null; // a blip just means "no pin this time" — never an error page
  const row = (res.data?.[0] as StaffUser | undefined) ?? null;
  cache.set(id, { at: Date.now(), row });
  return row;
}

/**
 * The person this admin tab is looking THROUGH, or null for the ordinary view.
 *
 * @param req   the panel API request (carries ?as= and the admin cookie)
 * @param rid   the restaurant this request is already scoped to (panelRestaurantId)
 * @param g     the gate result — a non-null user means a REAL staff session, never pinned
 * @param role  the panel's own role; the person must be exactly that (a manager pin on
 *              the tablet panel would show a view neither of them ever gets)
 */
export async function viewAsPerson(
  req: NextRequest,
  rid: string,
  g: { user: StaffUser | null },
  role: Role,
): Promise<StaffUser | null> {
  if (g.user) return null;                                  // a real login is nobody's periscope
  const id = req.nextUrl.searchParams.get("as");
  if (!isPersonId(id)) return null;                         // no pin → no read at all
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value))) return null; // admin only
  const u = await personById(id);
  if (!u || u.role !== role) return null;
  if ((u.restaurant_id || "") !== rid) return null;         // never across restaurants
  return u;
}

/** How the ribbon names them: their name if they have one, else the login they type. */
export const personLabel = (u: StaffUser | null): string | null =>
  u ? (u.name || u.username || null) : null;
