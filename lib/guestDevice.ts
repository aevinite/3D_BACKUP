// A stable, anonymous per-DEVICE id for the guest app, kept in localStorage so it
// survives reloads and reopens (cleared only by wiping site data / using incognito).
// It lets a staff "ban" target THIS device even when the guest has given no phone —
// the menu is browsable anonymously, so a phone-only ban couldn't stop a re-open.
// Sent only to the session RPCs (join + the load-time ban check + unban request).

const KEY = "lfh_device";

// Return this device's id, creating + storing one the first time. Browser-only
// (uses localStorage); returns "" if storage is unavailable (private mode), which
// the server treats as "no device" — the ban simply can't pin that case.
export function getGuestDeviceId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}
