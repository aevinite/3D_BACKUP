// lib/staffProfile.ts — SERVER-ONLY staff-profile helpers (imports the service-role client
// through lib/tableTags). It re-exports every PURE rule from lib/staffProfileShared so server
// code has one import; anything rendered in a BROWSER must import staffProfileShared instead.
import { payrollLadder } from "@/lib/tableTags";
import { powerEntitlementKey } from "@/lib/ownerEntitlements";
import { ABSENT_ON_PAY_POWERS, POWER_SEE_PAY, POWER_RECORD_PAY, POWER_EDIT_PROFILE } from "@/lib/staffProfileShared";

export * from "@/lib/staffProfileShared";

// ── Who may do what (the ladder, resolved server-side) ───────────────────────
export type PayAccess = {
  moduleOn: boolean;   // does this restaurant have the feature at all
  canSeePay: boolean;  // may this caller see salary + payment history of OTHERS
  canRecordPay: boolean;
  canEditProfile: boolean;
  canEditJobPay: boolean; // job + pay SETUP — owner/admin only, never a manager
};

type ActorKind = "admin" | "owner" | "manager";
type RestaurantBits = {
  manager_permissions?: Record<string, boolean> | null;
  owner_entitlements?: Record<string, boolean> | null;
};

/** Resolve one restaurant's staff-pay access for a caller. `admin` and `owner` pass every
 *  rung under the module; a MANAGER needs the admin entitlement AND the owner's grant.
 *  Reads the module ladder itself — use payAccessWith when you already know `moduleOn`
 *  (e.g. a page that batch-read `settings` for several restaurants at once). */
export async function payAccess(actor: ActorKind, r: RestaurantBits, rid: string): Promise<PayAccess> {
  return payAccessWith(actor, r, (await payrollLadder(rid)).effective);
}

/** The same decision, pure — ONE copy of the grant rules for every caller. */
export function payAccessWith(actor: ActorKind, r: RestaurantBits, moduleOn: boolean): PayAccess {
  if (!moduleOn) return { moduleOn: false, canSeePay: false, canRecordPay: false, canEditProfile: false, canEditJobPay: false };
  if (actor === "admin" || actor === "owner") {
    return { moduleOn: true, canSeePay: true, canRecordPay: true, canEditProfile: true, canEditJobPay: true };
  }
  const granted = (flag: string): boolean => {
    // rung 1a: an admin who removed the power caps everything below it
    if (r.owner_entitlements?.[powerEntitlementKey(flag)] === false) return false;
    const v = r.manager_permissions?.[flag];
    if (typeof v === "boolean") return v;
    return ABSENT_ON_PAY_POWERS.has(flag); // absent: on for the two low-risk powers, off for pay
  };
  return {
    moduleOn: true,
    canSeePay: granted(POWER_SEE_PAY),
    canRecordPay: granted(POWER_RECORD_PAY),
    canEditProfile: granted(POWER_EDIT_PROFILE),
    canEditJobPay: false,
  };
}
