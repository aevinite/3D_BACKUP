// lib/staffProfile.ts — SERVER-ONLY staff-profile helpers (imports the service-role client
// through lib/tableTags). It re-exports every PURE rule from lib/staffProfileShared so server
// code has one import; anything rendered in a BROWSER must import staffProfileShared instead.
import { payrollLadder } from "@/lib/tableTags";
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
    // The old ladder's "rung 1a" (owner_entitlements.power_<flag>) LEFT on 2026-08-06 with every
    // other read of it. Nothing can write that key: the sole writer of owner_entitlements is the
    // access-tree route, which allow-lists owner PAGE keys only, so the rung was permanently
    // true. The live cap for these three payroll powers is the Payroll MODULE itself, which is
    // checked as `moduleOn` at the top of this function — switch Payroll off and none of them
    // exist, which is the switch the Access screen actually offers.
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

// ── DELETING A PERSON MUST NOT ERASE WHAT THEY WERE PAID (2026-08-04) ────────────────────────
//
// `staff_payments.staff_id` is `REFERENCES staff_users(id) ON DELETE CASCADE` (migration 220), and
// both delete paths are HARD deletes — so removing a login silently took that person's whole
// salary-and-advance ledger with it. Two things made that worse than a tidy-up:
//   • docs/STAFF-PROFILE.md calls the ledger append-only: "a wrong entry is cancelled with a
//     reason, never deleted".
//   • the button's own warning said "their past orders and bills stay in the books either way".
//     Orders and bills do — they hang off the restaurant. The money paid to the person did not.
// Salary is an expense in the day book and in "After staff pay" on the owner dashboard, so a
// delete quietly rewrote last month's totals with nothing in the audit to show it.
//
// So a person with pay history cannot be deleted at all. "Mark as left" is the right action and
// already does everything leaving means (records the day, stops the pay counting from it, switches
// the login off) while keeping every row. Called by BOTH delete routes so neither can drift.
export async function payHistoryBlocksDelete(
  sb: { from: (t: string) => any },
  staffId: string,
): Promise<{ blocked: boolean; count: number }> {
  const q = await sb.from("staff_payments").select("id", { count: "exact", head: true }).eq("staff_id", staffId);
  // FAIL CLOSED. If we cannot read the ledger we do not delete: the whole point is that these rows
  // are unrecoverable, so "I couldn't check" must never resolve to "go ahead".
  if (q.error) return { blocked: true, count: -1 };
  const count = Number(q.count || 0);
  return { blocked: count > 0, count };
}

/** The one wording both routes give back, so the person reads the same sentence either way. */
export const PAY_HISTORY_DELETE_MESSAGE = (count: number) =>
  count < 0
    ? "Couldn't check this person's pay record just now, so the login wasn't removed — try again in a moment."
    : `This person has ${count} pay ${count === 1 ? "entry" : "entries"} on record, and deleting the login would erase ${count === 1 ? "it" : "them"} — salary and advances are part of the books. Use “Mark as left” instead: it records the day they left, stops their pay counting from then, and switches the login off, keeping everything.`;
