// storedPasswordCheck.mjs — "does this plain password match this stored hash?", for node scripts that cannot
// load lib/userAuth.ts (it imports through the app's "@/..." paths). It reads the SAME self-describing format
// lib/userAuth.ts → hashSecret writes — "pbkdf2$<iters>$<salt>$<hash>", base64url, SHA-256, 32 bytes — plus the
// legacy bare sha256 hex that verifySecret still accepts.
//
// A COPIED HELPER DRIFTS, so this one is pinned: verify:t25-doors runs it beside the real verifySecret on fresh
// hashes, a legacy hash, wrong passwords and damaged strings, and fails if the two ever disagree.
// (Sweep #10 T17 round 2, problem 15.)
import { pbkdf2Sync, createHash, timingSafeEqual } from "node:crypto";

export async function verifySecret(plain, stored) {
  if (!stored || typeof stored !== "string") return false;
  const parts = stored.split("$");
  const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
  if (parts[0] !== "pbkdf2" || parts.length !== 4) return same(createHash("sha256").update(String(plain)).digest("hex"), stored);
  try {
    const iters = parseInt(parts[1], 10) || 120000;
    const salt = Buffer.from(parts[2].replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (!/^[A-Za-z0-9_-]*$/.test(parts[2])) return false;
    const got = pbkdf2Sync(String(plain), salt, iters, 32, "sha256").toString("base64url");
    return same(got, parts[3]);
  } catch { return false; }
}
