// The guest's name, remembered on THIS device so the order-confirm step can
// pre-fill it and later rounds skip retyping. Stored long-lived in localStorage
// (cleared only if the guest clears their browser). Used purely client-side; the
// name is also written to the guest's table membership via lfh_set_member_name so
// it shows on the bill / kitchen / editor and can feed blocking.

// Tenant-scoped: the name you gave one restaurant shouldn't auto-appear at another.
import { tget, tset } from "./tenantStorage";
const KEY = "lfh_guest_name";

export function getGuestName(): string {
  return tget(KEY) || "";
}

export function setGuestName(name: string): void {
  const n = (name || "").trim();
  if (n) tset(KEY, n);
}
