// lib/tableAssign.ts — waiter SECTIONS: a tablet login works only the tables it was
// given. Migration 221; design notes in docs/ACCESS-MODEL.md (module `table_assign`).
//
// SERVER-ONLY (imports supabaseAdmin). The panels hide what a waiter may not touch,
// but hiding a tile is never the guard — every read is narrowed and every write is
// re-checked here.
//
// THE ONE RULE THAT KEEPS EVERYTHING ELSE WORKING: `waiterTables()` answers `null` =
// "not restricted" for the admin super-user, for any role that isn't `tablet`
// (a manager/owner looking into the tablet panel keeps the whole floor), and for every
// restaurant whose module is off. Only a real waiter at a restaurant using sections
// ever gets an array back — so this file is a no-op for everyone else, which is why it
// can be wired into the hot path without changing today's behaviour anywhere.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
// The "which table does this write touch?" resolver now lives in its own file so
// lib/clash.ts (offline clashes) can share it without pulling in this whole module.
import { affectedTables, normTable, type Affected } from "@/lib/tableOfAction";
import type { StaffUser } from "@/lib/userAuth";

/**
 * ALWAYS ON (owner, 2026-07-30): "giving waiters their own tables is not a feature, it should
 * always be on — no need for a toggle. Don't make unnecessary features."
 *
 * So there is no admin module rung any more. Giving each waiter a section is simply how the
 * tablet works; who may EDIT the sections is still controlled, by the ordinary
 * `table_assign` manager power (admin entitlement + owner grant).
 *
 * The mig-222 settings columns are left in place (harmless, and dropping them would need
 * another migration on both databases) but nothing reads them. This helper stays so every
 * call site keeps one shared answer if that ever changes again.
 */
export const tableAssignLadder = async (_rid: string) =>
  ({ allowed: true, ownerControl: false, enabled: true, effective: true });

// normTable + affectedTables come from lib/tableOfAction.ts; re-exported so every existing
// importer of this module keeps working unchanged.
export { normTable, affectedTables };
export type { Affected };

// The waiter's own list, normalised. Read straight off the staff row that
// requireRole/userFromCookie already fetched — no query.
export function assignedOf(user: StaffUser | null | undefined): string[] {
  const raw: unknown = user?.assigned_tables;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const t = normTable(v);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * What this caller is limited to, or `null` when they are not limited at all.
 *
 * `null` (unrestricted) for: the admin super-user (`user === null`), anyone who isn't a
 * waiter, and every restaurant where the module isn't effective. A LIMIT object (whose
 * `tables` may be EMPTY) only for a real waiter at a restaurant using sections — empty
 * deliberately means "sees nothing", the owner's chosen behaviour for an unassigned waiter.
 *
 * `floor` is the restaurant's table_count, and it is the second half of the rule — see
 * allows() for why a table number ABOVE it is never hidden.
 */
export type SectionLimit = {
  tables: string[];
  floor: number;
  /** Set when the floor size could NOT be read (item 5): the failure itself, so a write that needs
   *  the answer can be refused as busy — kept and replayed — rather than allowed or refused on a guess. */
  floorUnknown?: unknown;
};

export async function waiterTables(
  user: StaffUser | null | undefined,
  rid: string,
): Promise<SectionLimit | null> {
  if (!user) return null;              // admin super-user
  if (user.role !== "tablet") return null; // manager/owner oversight keeps the full floor
  // Sections are ALWAYS on (owner 2026-07-30) — no module rung to consult. One tiny read
  // for the floor size, which allows() needs to spot an off-plan table.
  //
  // ── A FAILED READ MUST NOT OPEN THE WHOLE FLOOR (sweep #10 T4, item 5) ────────────────────────────
  // This kept only `.data`, so a read that failed looked like a restaurant with table_count 0 — and
  // allows() treats every table above the floor size as "off the plan, visible to everyone". With a
  // floor of 0 that is EVERY table: for as long as one settings read failed, a waiter limited to
  // tables 4–6 could act on table 20, and the targeted floor read handed them its tiles. The floor
  // size only ever exists to grant that one exemption, so when it cannot be read the exemption is
  // simply not granted — the waiter keeps exactly their own section and nothing beyond it. No error
  // is thrown on purpose: four routes call this, and "busy" for a waiter's OWN tables would be worse.
  // A WRITE outside the section during that window is not refused either (that would throw the tap
  // away with a wrong reason): blockedReason() answers it as busy, so the panel keeps it and sends it
  // again once the size can be read — and only then is it allowed or refused for real.
  let floor = Number.POSITIVE_INFINITY; // unknown → no table counts as off-plan
  let floorUnknown: unknown = undefined;
  try {
    const { data, error } = await sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle();
    if (error) floorUnknown = error;
    else floor = Math.max(0, Number(data?.table_count) || 0);
  } catch (e) { floorUnknown = e || new Error("settings read failed"); /* unknown → keep the safe answer above */ }
  return floorUnknown === undefined ? { tables: assignedOf(user), floor } : { tables: assignedOf(user), floor, floorUnknown };
}

/**
 * Is this table within the caller's reach?
 *
 * Two ways to be allowed:
 *  1. it's in their section, or
 *  2. it is OUTSIDE the restaurant's floor plan (number > table_count, or not a number).
 *
 * Rule 2 exists because of a real state found on the live backup: tables 47 and 48 still
 * carried live orders while the floor was set to 30 (a leftover from when the restaurant
 * had more tables). Such a table is in NOBODY's section — it can't be, the section editor
 * only offers 1…table_count — so hiding it would strand an open bill that no waiter could
 * reach or settle. An off-plan table is an anomaly staff must be able to clear, so it stays
 * visible to everyone; sections only ever divide up the REAL floor.
 */
export const allows = (limit: SectionLimit | null, table: unknown): boolean => {
  if (limit === null) return true;
  const t = normTable(table);
  if (!t) return true;                       // not a table number at all → not ours to hide
  if (limit.tables.includes(t)) return true; // in their section
  return Number(t) > limit.floor;            // off the floor plan → visible to everyone
};


/**
 * The section a BRAND-NEW waiter starts with: the whole floor (owner, 2026-07-29 —
 * "whoever the users are created, all will have full access").
 *
 * The alternative — starting empty — means a waiter added halfway through service gets a
 * blank tablet and cannot work until someone remembers to assign them. Starting full means
 * sections are only ever a SUBTRACTION: a manager takes tables away deliberately, and
 * nobody is ever accidentally locked out. Matches the mig-223 backfill of existing waiters,
 * so "every waiter has full access unless someone chose otherwise" is true for the whole
 * team, not just the people who existed on the day this shipped.
 *
 * Returns [] (harmless) if the restaurant has no settings row yet.
 */
/**
 * The tables a NEWLY created waiter should start with, given what the person creating them
 * picked. Owner, 2026-07-30: "new tablet user will have to choose … there should be just a
 * select all option."
 *
 * The choice is REQUIRED: an empty pick is refused (the owner chose "block it — must pick at
 * least one") rather than quietly creating a waiter whose tablet shows nothing. Numbers are
 * clamped to the real floor, so a stale form can't grant a table that doesn't exist.
 *
 * Returns the sanitised list, or throws with a message meant for the person on screen.
 */
export async function newWaiterTables(rid: string, picked: unknown): Promise<number[]> {
  const floor = await fullFloorFor(rid);
  const max = floor.length ? floor[floor.length - 1] : 0;
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of Array.isArray(picked) ? picked : []) {
    const n = parseInt(String(v), 10);
    if (Number.isFinite(n) && n >= 1 && n <= max && !seen.has(n)) { seen.add(n); out.push(n); }
  }
  out.sort((a, b) => a - b);
  if (!out.length) {
    throw new Error("Pick at least one table for this waiter — their tablet shows only the tables you give them. Use “Select all” for the whole floor.");
  }
  return out;
}

export async function fullFloorFor(rid: string): Promise<number[]> {
  const { data, error } = await sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle();
  // …and the same split here (item 5): a read that failed is not a restaurant with no tables. The
  // two create-a-waiter screens show this message as it is, and the old answer — an empty floor —
  // made newWaiterTables() tell a person who HAD picked tables to "pick at least one table".
  if (error) throw new Error("Couldn't read this restaurant's tables just now — please try again in a moment.");
  const n = Math.max(1, Number(data?.table_count) || 0);
  if (!data?.table_count) return [];
  return Array.from({ length: n }, (_, i) => i + 1);
}

// The message a blocked waiter sees. Deliberately plain and non-alarming: this is a
// rota, not a telling-off.
export const notYoursMessage = (t: string) =>
  t ? `Table ${t} isn't in your section — ask your manager to add it.`
    : `That table isn't in your section — ask your manager to add it.`;

/**
 * The single check the tablet POST dispatcher runs. Returns null when the write may
 * proceed, or the refusal message when it may not.
 */
export async function blockedReason(
  limit: SectionLimit | null,
  rid: string,
  a: string, b: string | undefined, c: string | undefined,
  body: Record<string, unknown> | null | undefined,
): Promise<string | null> {
  if (limit === null) return null;                       // not a restricted caller
  // `rid` is not optional and is deliberately second: affectedTables reads rows by id with the
  // service-role key, so without the restaurant it would answer from whichever restaurant owns the
  // id (T25 round 2, item 29). A missing one comes back `unknown`, which this function already
  // refuses on.
  const { tables, unknown } = await affectedTables(rid, a, b, c, body);
  if (unknown) return notYoursMessage("");
  const bad = tables.find((t) => t && !allows(limit, t));
  // Outside the section, and the floor size that decides "off-plan, so visible to everyone" could not
  // be read (item 5): neither allow nor refuse on a guess — answer busy, with the read's own failure,
  // so the route's lib/panelFailure says "busy — retrying" and the panel's queue keeps the tap.
  if (bad && limit.floorUnknown !== undefined) throw limit.floorUnknown;
  return bad ? notYoursMessage(bad) : null;
}
