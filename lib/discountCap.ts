// Per-role discount %-cap (owner 2026-07-24). The admin sets, per restaurant, the most a role
// may take off a bill in one go — stored in restaurants.access_config.give_discounts.limit
// { manager, waiter } as a percentage of the PRE-TAX base (subtotal). Server-enforced so a
// hand-formed request can't exceed it.
//
// AN OWNER HAS NO CEILING AT ALL (owner, 2026-08-06 — asked directly, answered "owner should not
// have discount ceiling"). This used to READ access_config.give_discounts.limit.owner, and both
// French House and Aangan had 100 sitting in there from the old model — a number no row on the
// Access screen can show or change, so it could only ever have been a silent cap that appeared
// from nowhere. The Access screen offers a cap for the manager and the waiter and nothing else;
// this now answers the same. The admin super-user (role null) is uncapped for the same reason.
//
// NOTHING STORED now falls back to the MODEL default the Access screen displays (owner,
// 2026-08-02: "discount bill percentage will be fifty percent" for every restaurant — manager
// 50%, waiter 5%). It used to fall back to NO CLAMP, which meant the screen showed a cap the
// server never applied — the dead-switch disagreement the access rebuild exists to remove.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { NODE_BY_ID, defOf } from "@/lib/accessTree";

export type DiscountRole = "manager" | "waiter";

// Map a staff role to the cap bucket. tablet = waiter. kitchen/unknown → waiter (most restrictive).
// `null` = nobody caps this person: the admin super-user, and the OWNER (their own restaurant,
// their own money — the owner's word, 2026-08-06).
export function discountRole(role: string | null | undefined): DiscountRole | null {
  if (!role) return null;                       // admin super-user — uncapped
  if (role === "owner") return null;            // the owner — uncapped, and no row offers one
  if (role === "manager") return "manager";
  return "waiter";                              // tablet (and any other staff)
}

export async function discountCapPct(rid: string, role: DiscountRole | null): Promise<number | null> {
  if (!role) return null;
  const cfg = (await sb.from("restaurants").select("access_config").eq("id", rid).maybeSingle()).data?.access_config as
    { give_discounts?: { limit?: Record<string, number> } } | null;
  const v = cfg?.give_discounts?.limit?.[role];
  if (typeof v === "number") return v;          // the admin set one → honour it
  // Absent → the default the Access screen shows for that role (one rule, both sides read it).
  const node = role === "manager" ? NODE_BY_ID["mgr_give_discounts_cap"]
    : NODE_BY_ID["wtr_give_discounts_cap"];
  const d = node ? Number(defOf(node)) : NaN;
  return Number.isFinite(d) && d > 0 ? d : null;
}

// Is a discount of `amount` off a pre-tax `base` OVER the role's cap? (+0.01 tolerates rounding.)
export function overDiscountCap(amount: number, base: number, capPct: number | null): boolean {
  if (capPct == null || base <= 0) return false;
  return (amount / base) * 100 > capPct + 0.01;
}
