// lib/passwordVault.ts — the readable copy of a staff password, so the admin can hand a
// restaurant its logins on paper (owner, 2026-08-16; migration 330).
//
// WHY THIS EXISTS. `password_hash` is a one-way scramble: it can CHECK a password and can never
// reproduce one. That is right for signing in, and it is exactly what made "print the client's
// logins" impossible — the starter passwords were shown once on the create screen and then were
// gone for everybody, including the owner of the platform. So alongside the hash we keep a second
// copy of the same password, encrypted, that only the server can open.
//
// THE RULES THIS FILE KEEPS, AND WHY EACH ONE MATTERS:
//   1. NOTHING READABLE IS EVER STORED. sealPassword() encrypts before the value leaves this
//      process (AES-256-GCM, a fresh random IV per password), so the column holds ciphertext.
//   2. SIGN-IN NEVER READS THIS. lib/userAuth.ts is untouched — password_hash alone decides
//      whether someone gets in. If this whole column vanished tomorrow, every login still works.
//      That is deliberate: a second thing that can let you in is a second thing that can be wrong.
//   3. IT FAILS CLOSED AND QUIET. No key, a changed key, a corrupt value → openPassword() returns
//      null and the admin card says "not stored yet — Reveal sets a new one". It never throws,
//      never guesses, and never puts a half-decrypted string on screen.
//   4. IT IS NEVER LOGGED. Callers must not put the result in logAction/console — see the note on
//      openPassword().
//
// THE KEY. `CREDENTIAL_VAULT_KEY` if it is set (the right way — a dedicated secret you can rotate
// on its own), otherwise derived from SUPABASE_SERVICE_ROLE_KEY so this works with no env change
// on either stack. Rotating whichever one is in use makes existing copies unreadable, which shows
// up as "not stored yet" rather than as an error — recoverable with one Reveal per login.
//
// Web Crypto (crypto.subtle), matching lib/userAuth.ts, so it runs in the Node and Edge runtimes.

const VERSION = "v1";
const PBKDF2_ITERS = 100_000;
// A fixed salt is correct here and NOT the mistake it looks like: this derives ONE service key
// from ONE server secret, so there is nothing to slow down per-guess (unlike a password hash,
// where a per-row salt is the whole point). A random salt would have to be stored next to the
// ciphertext and would buy nothing.
const KEY_SALT = "aevidine.credential.vault.v1";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

function secret(): string | null {
  const s = process.env.CREDENTIAL_VAULT_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return s.length >= 16 ? s : null;
}

// Derive once per process — the key never changes while the server is up.
let keyPromise: Promise<CryptoKey> | null = null;
function vaultKey(): Promise<CryptoKey> | null {
  const s = secret();
  if (!s) return null;
  if (!keyPromise) {
    keyPromise = (async () => {
      const base = await crypto.subtle.importKey("raw", enc(s), "PBKDF2", false, ["deriveKey"]);
      return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: enc(KEY_SALT) as BufferSource, iterations: PBKDF2_ITERS, hash: "SHA-256" },
        base,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
    })().catch(() => { keyPromise = null; throw new Error("vault key"); });
  }
  return keyPromise;
}

/** Is a readable copy possible at all on this deployment? (Drives the admin card's wording.) */
export function vaultReady(): boolean {
  return secret() !== null;
}

/**
 * Encrypt a password for storage next to its hash. Returns null when there is no key or anything
 * goes wrong — the caller then simply stores nothing, and the login still works from its hash.
 */
export async function sealPassword(plain: string): Promise<string | null> {
  try {
    if (!plain) return null;
    const key = vaultKey();
    if (!key) return null;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, await key, enc(plain));
    return `${VERSION}$${b64(iv)}$${b64(new Uint8Array(ct))}`;
  } catch { return null; }
}

/**
 * Read a stored password back, for the admin's handover sheet ONLY.
 *
 * NEVER pass the result to logAction(), console.*, an alert or any response that is not the
 * admin-gated credentials endpoint. The whole point of the encryption is undone by one log line.
 * Returns null for: nothing stored, no key, a key that has since changed, or a corrupt value.
 */
export async function openPassword(sealed: string | null | undefined): Promise<string | null> {
  try {
    if (!sealed) return null;
    const parts = String(sealed).split("$");
    if (parts.length !== 3 || parts[0] !== VERSION) return null;
    const key = vaultKey();
    if (!key) return null;
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(parts[1]) as BufferSource }, await key, unb64(parts[2]) as BufferSource);
    return dec(new Uint8Array(pt));
  } catch { return null; }
}

/**
 * The two columns to write whenever a password is set, so no call site can remember one and forget
 * the other. Every place that writes `password_hash` uses this — see migration 330's header for
 * the full list.
 */
export async function passwordFields(plain: string): Promise<{ password_hash: string; password_shown: string | null }> {
  const { hashSecret } = await import("@/lib/userAuth");
  const [password_hash, password_shown] = await Promise.all([hashSecret(plain), sealPassword(plain)]);
  return { password_hash, password_shown };
}
