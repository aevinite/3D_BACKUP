// verify-guest-pass-private.mjs — a guest's access pass never rides along in a staff payload.
//
// WHAT THE "PASS" IS. When a guest scans the QR and joins a table, the server hands their phone a
// long random string: `session_members.token`. Their phone sends it with every tap — place an
// order, call a waiter, edit the shared cart, set their name. It IS that diner's identity, with no
// login behind it. Whoever holds it can act as them.
//
// WHERE IT LEAKED (T8 sweep, P5): Manager + Tablet panel → Tables floor. `lfh_floor_bundle` built
// its member list as `json_agg(m)` — the WHOLE session_members row — so every floor load and every
// ?table=N refetch handed each seated guest's pass, phone and device id to the staff device. The
// floor draws none of that except the phone (it bans and blocks by it). And the panels are
// offline-first, so the payload was written into the device's cache and stayed there long after the
// guests had left. Migration 311 replaced it with an explicit field list.
//
// This guard keeps it that way: no function may hand a token to a staff/service payload, and no
// function may splat a whole session_members row. The ONE legitimate exception is the guest's own
// join, which must return the pass to the phone that just earned it.
//
// READ-ONLY: one catalog read of function bodies.
//
//   node scripts/verify-guest-pass-private.mjs
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const parseEnv = (t) => Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
  const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
}));
const QUIET = process.argv.includes("--quiet");
let failed = 0;
const pass = (m) => { if (!QUIET) console.log("  ✓ " + m); };
const fail = (m) => { console.log("  ✗ " + m); failed++; };

const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  if (!r.ok) throw new Error(`${ref.slice(0, 6)}…: ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

// The guest's own join hands the pass to the phone that just joined — that is the entire point of it.
const MAY_RETURN_THE_PASS = new Set(["lfh_join_session"]);

console.log("\nManager + Tablet panel → Tables floor: does any staff payload carry a guest's access pass?");

const fns = await q(`
  SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args, pg_get_functiondef(p.oid) AS def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
  ORDER BY 1`);

// 1. Nobody builds a payload out of a bare session_members row.
const splatters = fns.filter((f) => /json_agg\s*\(\s*m\s*(ORDER|\))/i.test(f.def) && /session_members\s+m\b/i.test(f.def));
if (!splatters.length) pass("no function ships a whole session_members row — they all name their fields");
else for (const s of splatters) {
  fail(`${s.name}(${s.args}) does json_agg(m) over session_members — that includes token/device_id. Name the fields the screen actually draws.`);
}

// 2. Nobody returns the token itself unless it is the guest's own join.
const tokenReturners = fns.filter((f) => /'token'\s*,/i.test(f.def) || /\bRETURNING\b[^;]*\btoken\b/i.test(f.def));
for (const t of tokenReturners) {
  if (MAY_RETURN_THE_PASS.has(t.name)) pass(`${t.name} returns the pass to the guest who just joined — the one place that must`);
  else fail(`${t.name}(${t.args}) puts a 'token' in its result — a pass must never travel except to its own guest`);
}
if (!tokenReturners.length) fail("nothing returns a token at all — lfh_join_session must still hand the guest theirs");

// 3. The floor bundle specifically: the field list is the contract, so check it by name.
const bundle = fns.find((f) => f.name === "lfh_floor_bundle");
if (!bundle) fail("lfh_floor_bundle is gone — the manager floor reads it");
else {
  if (!/\btoken\b/i.test(bundle.def)) pass("lfh_floor_bundle's body does not mention token anywhere");
  else fail("lfh_floor_bundle mentions token again");
  if (/'phone'\s*,\s*m\.phone/i.test(bundle.def)) pass("it still sends phone — the panel bans and blocks by it (app.js data-ban-phone / data-block-phone)");
  else fail("lfh_floor_bundle stopped sending m.phone — the manager's Ban / Block buttons and the guest's Phone row need it");
  if (!/m\.device_id/i.test(bundle.def)) pass("device_id is not sent — a device ban resolves it server-side from the member id (mig 077)");
  else fail("lfh_floor_bundle sends device_id again — nothing on the floor draws it");
}

console.log(failed
  ? `\n✗ ${failed} check${failed === 1 ? "" : "s"} failed — a guest's access pass is travelling where it should not`
  : "\n✓ the pass stays with the guest it belongs to");
process.exit(failed ? 1 : 0);
