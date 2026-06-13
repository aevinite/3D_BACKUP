// Shared helpers for the STAFF password gate (admin/editor/kitchen/tablet).
//
// One password (STAFF_PASSWORD in .env.local) protects every staff route. The
// guest menu stays public. The login cookie stores a HASH of the password, never
// the password itself, so a stolen cookie can't reveal it. sha256hex uses Web
// Crypto so it works in BOTH the edge middleware and Node route handlers.

export const AUTH_COOKIE = "lfh_staff_auth"; // HttpOnly — the real gate (hash of the password)
export const FLAG_COOKIE = "lfh_is_staff";   // readable — a UI hint so the switcher can show

// SHA-256 → hex, using the universal Web Crypto API (edge + node).
export async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The configured staff password (prefer STAFF_PASSWORD; accept the old per-panel
// names too, in case they're set). Empty string = none configured.
export function staffPassword(): string {
  return process.env.STAFF_PASSWORD || process.env.ADMIN_PASSWORD || process.env.EDITOR_PASSWORD || "";
}
