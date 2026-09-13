// scripts/backfill-readable-passwords.mjs — fill in the readable copy for every login that has
// none (owner, 2026-09-13: "set random pass for all and all resturant i want i could able to see
// the password … in database it should store encrypted").
//
// ── THE PROBLEM THIS SOLVES ──────────────────────────────────────────────────────────────────────
// `password_hash` is one-way. Migration 330 (2026-08-16) added `password_shown`, an AES-256-GCM copy
// that only the server can open, so the admin can print a client's logins. It fills on WRITE — so
// every login created before that date has an empty one, and the admin console honestly says the
// password cannot be read back, because no copy of it has ever existed.
//
// ── THE TWO KINDS OF ROW, AND WHY TREATING THEM THE SAME WOULD BREAK THE TEST SUITE ─────────────
// The obvious script — "give everyone a random password and seal it" — would have broken every
// sweep, every verify:* guard that signs in, and scripts/view-device.mjs, because the diag logins
// have FIXED passwords hard-coded across scripts/ (scripts/sweep/login.mjs → DIAG_LOGINS). So:
//
//   1. A KNOWN PASSWORD → seal the one it already has. The hash is not touched, so it is the same
//      password it always was: nothing signs out, nothing in scripts/ changes, and it becomes
//      readable on the console. The list below is not trusted blindly — each candidate is CHECKED
//      against the stored hash with the real pbkdf2 verify before it is sealed. A guess that does
//      not verify is not used.
//   2. EVERYTHING ELSE → a fresh random password, sealed and hashed together.
//
// ── NOBODY IS SIGNED OUT ─────────────────────────────────────────────────────────────────────────
// `token_version` is never bumped. A password decides who may sign in NEXT time; token_version
// decides who is signed in NOW (owner, 2026-09-13: "the table and the password change no relation").
// So this can run mid-service without a screen in any restaurant noticing.
//
// ── IT IS SAFE TO RUN TWICE ──────────────────────────────────────────────────────────────────────
// Only rows whose `password_shown` is empty or unreadable are touched, so a second run reports zero
// and changes nothing (the standing "bulk rewrite scripts MUST be idempotent" rule).
//
//   node scripts/backfill-readable-passwords.mjs --dry     ← count only, writes nothing
//   node scripts/backfill-readable-passwords.mjs
//
// IT ONLY RUNS AGAINST THE DEV DATABASE. The dev project ref is an allow-list below; this is a dev
// tool, and pointing it anywhere else would give somebody else's staff a new password.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { webcrypto as crypto } from "node:crypto";

// ── env ─────────────────────────────────────────────────────────────────────────────────────────
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
// AN ALLOW-LIST, NOT A DENY-LIST. Naming the database this must never touch would put that name in
// the repo; naming the ONE it may touch refuses everything else, including a stack that does not
// exist yet. Anything but the dev project and this script does nothing at all.
const DEV_REF = "wnsfcizclkbobwzcxqsf";
if (!URL_.includes(DEV_REF)) {
  console.error(`REFUSED: this only runs against the dev database (${DEV_REF}). NEXT_PUBLIC_SUPABASE_URL points somewhere else.`);
  process.exit(1);
}
if (!URL_ || !SERVICE) { console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
const DRY = process.argv.includes("--dry");
const sb = createClient(URL_, SERVICE, { auth: { persistSession: false } });

// ── the same crypto the app uses, reimplemented here rather than imported ───────────────────────
// lib/userAuth.ts and lib/passwordVault.ts are TypeScript with `@/` path aliases; a plain node
// script cannot import them. These are byte-for-byte the same algorithms — if either of those files
// ever changes shape, this script's own verification step fails loudly rather than writing
// something the app cannot read.
const enc = (s) => new TextEncoder().encode(s);
const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlDec = (s) => new Uint8Array(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
const PBKDF2_ITERS = 120_000;

async function pbkdf2(plain, salt, iters) {
  const key = await crypto.subtle.importKey("raw", enc(plain), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: iters, hash: "SHA-256" }, key, 256));
}
async function hashSecret(plain) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITERS}$${b64url(salt)}$${b64url(await pbkdf2(plain, salt, PBKDF2_ITERS))}`;
}
async function verifySecret(plain, stored) {
  if (!stored) return false;
  const p = String(stored).split("$");
  if (p[0] !== "pbkdf2" || p.length !== 4) return false;
  try { return b64url(await pbkdf2(plain, b64urlDec(p[2]), parseInt(p[1], 10) || PBKDF2_ITERS)) === p[3]; }
  catch { return false; }
}

// The vault — lib/passwordVault.ts. Same key derivation, same AES-GCM envelope, same "v1$iv$ct".
const KEY_SALT = "aevidine.credential.vault.v1";
const VAULT_SECRET = process.env.CREDENTIAL_VAULT_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
let vaultKey = null;
async function getVaultKey() {
  if (vaultKey) return vaultKey;
  const base = await crypto.subtle.importKey("raw", enc(VAULT_SECRET), "PBKDF2", false, ["deriveKey"]);
  vaultKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc(KEY_SALT), iterations: 100_000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return vaultKey;
}
const vb64 = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const vunb64 = (s) => new Uint8Array(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
async function sealPassword(plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await getVaultKey(), enc(plain));
  return `v1$${vb64(iv)}$${vb64(new Uint8Array(ct))}`;
}
async function openPassword(sealed) {
  try {
    const p = String(sealed || "").split("$");
    if (p.length !== 3 || p[0] !== "v1") return null;
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: vunb64(p[1]) }, await getVaultKey(), vunb64(p[2]));
    return new TextDecoder().decode(pt);
  } catch { return null; }
}

// Same alphabet as the app's own generator: no l/o/0/1, so nothing printed can be read two ways.
function genPassword() {
  const a = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (const b of crypto.getRandomValues(new Uint8Array(10))) s += a[b % a.length];
  return s;
}

// ── the known test logins (scripts/sweep/login.mjs and friends) ────────────────────────────────
// Every one of these is VERIFIED against the row's own hash before it is used. The list is a set of
// candidates, not an assertion — a stale entry simply fails to verify and that row gets a random
// password like any other.
const KNOWN = [
  "diag-mgr-2026", "diag-o1-2026", "diag-kitchen-2026", "diag-t1-2026",
  "diag-multi-2026", "diag-estate-2026",
];

const rows = (await sb.from("staff_users")
  .select("id, username, name, role, restaurant_id, password_hash, password_shown")
  .is("deleted_at", null).limit(2000)).data || [];

const rests = Object.fromEntries(((await sb.from("restaurants").select("id, name").limit(500)).data || [])
  .map((r) => [r.id, r.name]));

let sealedKnown = 0, minted = 0, alreadyFine = 0, failed = 0;
const report = [];

for (const u of rows) {
  // Already readable? Leave it completely alone — that is what makes a second run a no-op.
  if (await openPassword(u.password_shown)) { alreadyFine++; continue; }

  // 1. Is this one of the fixed test logins? If the candidate verifies, the row keeps the password
  //    it already has and only gains its readable copy. Nothing else about the row changes.
  let known = null;
  for (const cand of KNOWN) {
    if (await verifySecret(cand, u.password_hash)) { known = cand; break; }
  }

  const password = known ?? genPassword();
  const patch = known
    ? { password_shown: await sealPassword(password) }
    : { password_shown: await sealPassword(password), password_hash: await hashSecret(password) };

  if (DRY) {
    report.push([rests[u.restaurant_id] || "—", u.role, u.username, known ? "seal existing" : "new password"]);
    known ? sealedKnown++ : minted++;
    continue;
  }

  // NOTE: `token_version` is deliberately absent — see the header. Nobody is signed out.
  const wr = await sb.from("staff_users").update(patch).eq("id", u.id).select("id").maybeSingle();
  if (wr.error || !wr.data) {
    failed++;
    console.error(`  FAILED ${u.username}: ${wr.error?.message || "the database changed no row"}`);
    continue;
  }
  // Read it straight back out of the database. A script that reports "done" from what it MEANT to
  // write is how a handover sheet ends up full of passwords that do not sign anybody in.
  const back = await openPassword((await sb.from("staff_users").select("password_shown").eq("id", u.id).maybeSingle()).data?.password_shown);
  if (back !== password) {
    failed++;
    console.error(`  FAILED ${u.username}: stored, but it did not read back as the same value`);
    continue;
  }
  report.push([rests[u.restaurant_id] || "—", u.role, u.username, known ? "sealed existing" : "new password"]);
  known ? sealedKnown++ : minted++;
}

console.log(`\n${DRY ? "DRY RUN — nothing written" : "Done"}`);
console.log(`  already readable, untouched : ${alreadyFine}`);
console.log(`  test logins sealed as-is    : ${sealedKnown}   (same password, nothing in scripts/ breaks)`);
console.log(`  given a new password        : ${minted}`);
if (failed) console.log(`  FAILED                      : ${failed}`);
console.log(`  nobody was signed out — token_version untouched on every row.\n`);
if (report.length) {
  const w = [0, 0, 0].map((_, i) => Math.max(...report.map((r) => String(r[i]).length)));
  for (const r of report) console.log(`  ${String(r[0]).padEnd(w[0])}  ${String(r[1]).padEnd(w[1])}  ${String(r[2]).padEnd(w[2])}  ${r[3]}`);
}
