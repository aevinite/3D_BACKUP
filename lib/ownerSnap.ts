// Device-side instant-paint snapshots for the owner cockpit (owner, 2026-07-26).
//
// The server already holds every dashboard/report number pre-calculated (the 5-min
// compute-on-view cache) — but a page reload still waits one network round-trip before
// anything paints. These helpers keep the LAST-SEEN payloads in sessionStorage so a
// reopened page paints real numbers at ~0ms and the usual entrance animations (count-up,
// chart draw-in) play on that data, while the normal fetch revalidates behind it and
// swaps in anything newer. Server behaviour, formats and numbers are untouched.
//
// Safety:
//   • sessionStorage = per-tab, gone when the tab closes — nothing lingers on the device.
//   • clearOwnerSnaps() runs on every successful login, so a different account logging in
//     inside the same tab can never see the previous account's numbers, even for a frame.
//   • Values are versioned; a shape change just bumps SNAP_VER and old blobs are ignored.
//   • Storage is best-effort: quota/parse errors silently fall back to the normal fetch.

const PREFIX = "lfh_osnap:";
const SNAP_VER = "v1";
const MAX_BYTES = 1_500_000; // stay far under the ~5MB sessionStorage quota

const full = (name: string) => `${PREFIX}${SNAP_VER}:${name}`;

export function readSnap<T>(name: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(full(name));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

export function writeSnap(name: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    const raw = JSON.stringify(value);
    if (raw.length > MAX_BYTES) return; // oversized → just skip; fetch path still works
    sessionStorage.setItem(full(name), raw);
  } catch { /* quota/serialisation — instant-paint is best-effort */ }
}

// Remove EVERY owner snapshot (all versions). Called on successful login so a new
// account in the same tab starts clean.
export function clearOwnerSnaps(): void {
  if (typeof window === "undefined") return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => sessionStorage.removeItem(k));
  } catch { /* best-effort */ }
}
