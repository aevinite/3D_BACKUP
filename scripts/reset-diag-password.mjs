// Reset a DIAGNOSTIC staff account's password to a known value, so headless verifies and
// scripts/view-device.mjs can log in as that restaurant's manager. TEST ACCOUNTS ONLY —
// never touches real owner/manager accounts or production credentials. Replicates the app's
// exact PBKDF2-SHA256 scheme (lib/userAuth.hashSecret) so the login endpoint accepts it.
// Usage: node scripts/reset-diag-password.mjs <username> <newPassword>
//   e.g. node scripts/reset-diag-password.mjs diagm2 diag-mgr-2026
// Prints only success/username — NEVER the password or any key.
import fs from "fs";

const [, , username, newPass] = process.argv;
if (!username || !newPass) { console.error("usage: node scripts/reset-diag-password.mjs <username> <newPassword>"); process.exit(1); }
if (!/^diag/i.test(username)) { console.error("refusing: only 'diag*' test accounts may be reset by this tool"); process.exit(1); }

const env = fs.readFileSync(".env.local", "utf8");
const g = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']|["']$/g, "") : ""; };
const URL = g("NEXT_PUBLIC_SUPABASE_URL"), KEY = g("SUPABASE_SERVICE_ROLE_KEY");

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function hashSecret(plain) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(plain), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" }, key, 256);
  return `pbkdf2$120000$${b64url(salt)}$${b64url(new Uint8Array(bits))}`;
}

(async () => {
  const hash = await hashSecret(newPass);
  const res = await fetch(`${URL}/rest/v1/staff_users?username=eq.${encodeURIComponent(username)}`, {
    method: "PATCH",
    headers: { apikey: KEY, Authorization: "Bearer " + KEY, "content-type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ password_hash: hash }),
  });
  const rows = await res.json();
  if (res.status >= 300 || !Array.isArray(rows) || !rows.length) { console.error("FAILED:", res.status, JSON.stringify(rows).slice(0, 200)); process.exit(1); }
  console.log(`✅ reset password for ${rows.length} account(s): ${rows.map((r) => r.username).join(", ")}`);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
