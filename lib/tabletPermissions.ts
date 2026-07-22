// lib/tabletPermissions.ts — the MANAGER → TABLET rung of the access ladder (mig 163).
//
// The 4-rung ladder (owner rule, 2026-07-22): Admin entitles a feature + caps its reach
// → Owner grants it to the Manager → MANAGER grants it to the tablet/waiters. This file
// is that last rung: what a manager has switched on for their waiters' tablet, stored in
// restaurants.tablet_permissions (JSONB), mirroring lib/ownerEntitlements MANAGER_POWER_FLAGS.
//
// SERVER-ONLY (no React). Clients learn their tablet permissions through the panel
// whoami / board responses — they never read this table directly.

// The capabilities a manager can switch on/off for the tablet. Grows over time (the
// reusable pattern the owner wants for EVERY feature). Each may carry its own default.
export const TABLET_POWER_FLAGS = ["take_orders"] as const;
export type TabletPowerFlag = (typeof TABLET_POWER_FLAGS)[number];

// Per-flag default when the key is ABSENT. take_orders defaults ON because taking orders
// is the tablet's existing core function — a fresh/unconfigured restaurant's tablet must
// keep working untouched. A brand-new tablet capability added later would default OFF.
const TABLET_POWER_DEFAULT: Record<string, boolean> = { take_orders: true };
const tabletDefault = (flag: string): boolean => TABLET_POWER_DEFAULT[flag] ?? false;

export type TabletPermissions = Record<string, boolean>;

// Merge a raw JSONB value over the per-flag defaults (absent/non-boolean = default).
export function mergeTabletPermissions(raw: unknown): TabletPermissions {
  const out: TabletPermissions = {};
  for (const k of TABLET_POWER_FLAGS) out[k] = tabletDefault(k);
  if (raw && typeof raw === "object") {
    for (const k of TABLET_POWER_FLAGS) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === "boolean") out[k] = v;
    }
  }
  return out;
}

// Has the manager granted this capability to the tablet? Reads a RAW tablet_permissions
// value and honours the per-flag default (absent take_orders = ON).
export function tabletPowerGranted(raw: unknown, flag: string): boolean {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[flag] : undefined;
  return typeof v === "boolean" ? v : tabletDefault(flag);
}
