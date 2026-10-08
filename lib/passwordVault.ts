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
// THE KEYS — TWO OF THEM, ON PURPOSE (owner picked sweep #10 T17 item 14, 2026-10-08).
//
//   v2 copies are sealed with a key derived from CREDENTIAL_VAULT_KEY ALONE — a secret that exists only
//      for this vault, so the database's own service key can be rotated without touching a single copy.
//   v1 copies are what every copy was before: a key derived from CREDENTIAL_VAULT_KEY || the service key.
//
// Before this, the vault's key WAS the database's service key, so rotating that key (the first thing you
// do after a scare) turned every handover sheet into "not stored yet" at once. Now:
//   · sealPassword writes v2 whenever CREDENTIAL_VAULT_KEY is set, and v1 exactly as before when it isn't
//     (a stack without the new secret — backup-2, AV live — behaves exactly as it always did);
//   · openPassword reads BOTH, trying every key a v1 copy could have been sealed with. AES-GCM
//     authenticates, so a wrong key fails cleanly and the next one is tried — nothing ever shows
//     "not stored yet" mid-change, or on a server that started before the new secret existed;
//   · scripts/reseal-handover-passwords.mjs moves the existing v1 copies over to v2, first-save-wins.
// After the reseal, the service key can be rotated freely.
//
// Web Crypto (crypto.subtle), matching lib/userAuth.ts, so it runs in the Node and Edge runtimes.

const PBKDF2_ITERS = 100_000;
// A fixed salt is correct here and NOT the mistake it looks like: this derives ONE service key
// from ONE server secret, so there is nothing to slow down per-guess (unlike a password hash,
// where a per-row salt is the whole point). A random salt would have to be stored next to the
// ciphertext and would buy nothing.
const SALT: Record<"v1" | "v2", string> = { v1: "aevidine.credential.vault.v1", v2: "aevidine.credential.vault.v2" };

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

const usable = (s: string | undefined) => (s && s.length >= 16 ? s : null);
/** The vault's OWN secret — v2. Null when this stack has not been given one. */
function dedicated(): string | null { return usable(process.env.CREDENTIAL_VAULT_KEY); }
/** Every secret a v1 copy may have been sealed with (the old rule was "dedicated || service key"). */
function v1Secrets(): string[] {
  const out: string[] = [];
  for (const s of [usable(process.env.CREDENTIAL_VAULT_KEY), usable(process.env.SUPABASE_SERVICE_ROLE_KEY)]) if (s && !out.includes(s)) out.push(s);
  return out;
}

// Derived once per (version, secret) per process. Keyed by version + the secret, so a secret changed
// under a running process (Next's dev server reloads .env.local) derives afresh instead of reusing.
const keys = new Map<string, Promise<CryptoKey>>();
function keyFor(version: "v1" | "v2", s: string): Promise<CryptoKey> {
  const id = `${version}\u0000${s}`;
  let k = keys.get(id);
  if (!k) {
    k = (async () => {
      const base = await crypto.subtle.importKey("raw", enc(s), "PBKDF2", false, ["deriveKey"]);
      return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: enc(SALT[version]) as BufferSource, iterations: PBKDF2_ITERS, hash: "SHA-256" },
        base,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
    })();
    k.catch(() => keys.delete(id));
    keys.set(id, k);
  }
  return k;
}

/** Is a readable copy possible at all on this deployment? (Drives the admin card's wording.) */
export function vaultReady(): boolean {
  return dedicated() !== null || v1Secrets().length > 0;
}

/** Is this stored copy still on the OLD (v1) key while this stack has its own vault key? The reseal
 *  script moves exactly these. Never true on a stack without CREDENTIAL_VAULT_KEY. */
export function needsReseal(sealed: string | null | undefined): boolean {
  return dedicated() !== null && typeof sealed === "string" && sealed.startsWith("v1$");
}

/**
 * Encrypt a password for storage next to its hash. Returns null when there is no key or anything
 * goes wrong — the caller then simply stores nothing, and the login still works from its hash.
 */
export async function sealPassword(plain: string): Promise<string | null> {
  try {
    if (!plain) return null;
    const own = dedicated();
    const version: "v1" | "v2" = own ? "v2" : "v1";
    const secretToUse = own ?? v1Secrets()[0];
    if (!secretToUse) return null;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, await keyFor(version, secretToUse), enc(plain));
    return `${version}$${b64(iv)}$${b64(new Uint8Array(ct))}`;
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
    if (parts.length !== 3 || (parts[0] !== "v1" && parts[0] !== "v2")) return null;
    const version = parts[0] as "v1" | "v2";
    const candidates = version === "v2" ? [dedicated()].filter((x): x is string => !!x) : v1Secrets();
    const iv = unb64(parts[1]), ct = unb64(parts[2]);
    for (const s of candidates) {
      try {
        const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, await keyFor(version, s), ct as BufferSource);
        return dec(new Uint8Array(pt));
      } catch { /* not this key — GCM refuses cleanly; try the next */ }
    }
    return null;
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
