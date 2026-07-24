// Per-role discount %-cap (owner 2026-07-24). The admin sets, per restaurant, the most a role
// may take off a bill in one go — stored in restaurants.access_config.give_discounts.limit
// { owner, manager, waiter } as a percentage of the PRE-TAX base (subtotal). Server-enforced so
// a hand-formed request can't exceed it. NON-BREAKING: no cap configured for a role → null → no
// clamp (current behaviour; whole-bill still clamps to the base via mig 148). The admin super-user
// (role null) is never capped.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

export type DiscountRole = "owner" | "manager" | "waiter";

// Map a staff role to the cap bucket. tablet = waiter. kitchen/unknown → waiter (most restrictive).
export function discountRole(role: string | null | undefined): DiscountRole | null {
  if (!role) return null;                       // admin super-user — uncapped
  if (role === "owner") return "owner";
  if (role === "manager") return "manager";
  return "waiter";                              // tablet (and any other staff)
}

export async function discountCapPct(rid: string, role: DiscountRole | null): Promise<number | null> {
  if (!role) return null;
  const cfg = (await sb.from("restaurants").select("access_config").eq("id", rid).maybeSingle()).data?.access_config as
    { give_discounts?: { limit?: Record<string, number> } } | null;
  const v = cfg?.give_discounts?.limit?.[role];
  return typeof v === "number" ? v : null;      // absent → no cap (non-breaking)
}

// Is a discount of `amount` off a pre-tax `base` OVER the role's cap? (+0.01 tolerates rounding.)
export function overDiscountCap(amount: number, base: number, capPct: number | null): boolean {
  if (capPct == null || base <= 0) return false;
  return (amount / base) * 100 > capPct + 0.01;
}
