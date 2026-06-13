// The guest's name, remembered on THIS device so the order-confirm step can
// pre-fill it and later rounds skip retyping. Stored long-lived in localStorage
// (cleared only if the guest clears their browser). Used purely client-side; the
// name is also written to the guest's table membership via lfh_set_member_name so
// it shows on the bill / kitchen / editor and can feed blocking.

const KEY = "lfh_guest_name";

export function getGuestName(): string {
  try { return localStorage.getItem(KEY) || ""; } catch { return ""; }
}

export function setGuestName(name: string): void {
  try {
    const n = (name || "").trim();
    if (n) localStorage.setItem(KEY, n);
  } catch { /* private mode / blocked storage — name just won't persist */ }
}
