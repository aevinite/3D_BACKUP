#!/usr/bin/env node
/* set-access-defaults.mjs — put a restaurant back to the FACTORY default permission set.
 *
 * "Factory default" is not a second opinion written down here: it is `def` on every node of
 * lib/accessTree.ts, the one model the Access screen and the whole app already read. A second
 * copy of "what the defaults are" would drift, and drift is the bug class this repo keeps
 * getting bitten by — so this walks the real model and writes what it says.
 *
 *   node scripts/set-access-defaults.mjs --slug aangan            (show what would change)
 *   node scripts/set-access-defaults.mjs --slug aangan --apply    (write it)
 *
 * Nodes marked leftToBuild are skipped (nothing reads them yet) and free-text fields
 * (GSTIN, legal name, bill address) are left alone — blanking a restaurant's real legal
 * details is destructive and is never what "reset the permissions" means.
 */
import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { adminHeaders } from "./sweep/login.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Bundled here rather than only by `npm run access:defaults`, for the same reason the sweep does
// it: run this file directly (which is how it gets used) and a missing bundle used to crash on
// line 1 with a path inside node_modules and no hint. Rebuilds when the model is newer, so this
// can never write yesterday's idea of "factory default".
const MODEL_OUT = join(ROOT, "node_modules/.cache/accessTree.mjs");
const mtime = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };
if (mtime(MODEL_OUT) < mtime(join(ROOT, "lib/accessTree.ts"))) {
  try {
    execFileSync("npx", ["esbuild", "lib/accessTree.ts", "--bundle", "--platform=node", "--format=esm",
      "--alias:@=.", `--outfile=${MODEL_OUT}`, "--log-level=warning"], { cwd: ROOT, stdio: "inherit" });
  } catch {
    console.error("\n✗ could not bundle lib/accessTree.ts (needs esbuild). Run: npm run access:defaults\n");
    process.exit(1);
  }
}
const { ALL_NODES, nodeValue, nodePatch, extraPatch, applyPatch } = await import(pathToFileURL(MODEL_OUT).href);
const BASE = (process.env.VERIFY_BASE || "https://3-d-backup.vercel.app").replace(/\/$/, "");
const ARGS = process.argv.slice(2);
const arg = (n, d) => { const i = ARGS.indexOf(n); return i === -1 ? d : ARGS[i + 1]; };
const SLUG = arg("--slug", "aangan");
const APPLY = ARGS.includes("--apply");

const env = {};
for (const l of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
// Guard the one thing that must never happen: this writes real switches, so it may only ever
// point at the BACKUP database. AV live is read-only.
if (!String(env.NEXT_PUBLIC_SUPABASE_URL || "").includes("wnsfcizclkbobwzcxqsf")) {
  console.error("REFUSING: .env.local does not point at the BACKUP database.");
  process.exit(2);
}
if (/aevinite\.shop|3d-menu-av/.test(BASE)) {
  console.error(`REFUSING: ${BASE} is the live client site. This script only runs against backup.`);
  process.exit(2);
}

const H = adminHeaders(BASE);
const api = (p, init) => fetch(BASE + p, { cache: "no-store", ...init, headers: { ...H, ...(init?.headers || {}) } });

const list = await (await api("/api/admin/restaurants")).json();
const rests = Array.isArray(list) ? list : list.restaurants || [];
// Exact slug wins. Failing that, a UNIQUE partial match is accepted, because the two databases
// name the same restaurant differently ("aangan" live vs "aangan-garden-restaurant" here) and this
// script's own default was "aangan" — so running it with no arguments failed on backup. Two matches
// is refused rather than guessed: this script REWRITES a restaurant's permissions, and picking the
// wrong one silently is far worse than making someone type the full slug.
let rest = rests.find((r) => r.slug === SLUG);
if (!rest) {
  const near = rests.filter((r) => r.slug.includes(SLUG) || SLUG.includes(r.slug));
  if (near.length === 1) {
    rest = near[0];
    console.log(`(no exact slug "${SLUG}" — using the one match: ${rest.slug})`);
  } else if (near.length > 1) {
    console.error(`"${SLUG}" matches ${near.length} restaurants (${near.map((r) => r.slug).join(", ")}). Name one exactly.`);
    process.exit(1);
  }
}
if (!rest) { console.error(`No restaurant with slug "${SLUG}". Have: ${rests.map((r) => r.slug).join(", ")}`); process.exit(1); }

const before = (await (await api(`/api/admin/restaurants/access-tree?restaurant_id=${rest.id}`)).json()).state;
if (!before) { console.error("The Access screen did not return a state for that restaurant."); process.exit(1); }

/** Every node whose default we can honestly write and read back. */
const defaultNodes = ALL_NODES.filter((n) => n.bind.t !== "none" && n.bind.t !== "text" && n.bind.t !== "creds" && !n.leftToBuild);

let patch = {};
const diffs = [];
for (const n of defaultNodes) {
  const was = nodeValue(n, before);
  patch = applyPatch(patch, nodePatch(n, n.def));
  const ex = extraPatch(n, n.def);
  if (ex && Object.keys(ex).length) patch = applyPatch(patch, ex);
  if (JSON.stringify(was) !== JSON.stringify(n.def)) diffs.push({ n, was, def: n.def });
}

const show = (v) => (v === true ? "ON" : v === false ? "off" : JSON.stringify(v));
console.log(`\n${rest.name || rest.slug} (${rest.slug}) · ${defaultNodes.length} switches in the model · base ${BASE}`);
if (!diffs.length) console.log("Already at the factory defaults — nothing to change.");
else {
  console.log(`${diffs.length} differ${diffs.length === 1 ? "s" : ""} from the default:\n`);
  for (const d of diffs) console.log(`  ${d.n.name.padEnd(34)} ${show(d.was).padStart(8)}  →  ${show(d.def)}`);
}

if (!APPLY) { console.log(`\n(dry run — add --apply to write it)`); process.exit(0); }
if (!diffs.length) process.exit(0);

const res = await api("/api/admin/restaurants/access-tree", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ restaurant_id: rest.id, patch }),
});
if (!res.ok) { console.error(`\nSave refused with ${res.status}: ${(await res.text()).slice(0, 300)}`); process.exit(1); }

// Read it back and prove every single switch landed. A save that answers 200 while a value
// stayed put is exactly the silent failure this repo has shipped before.
const after = (await (await api(`/api/admin/restaurants/access-tree?restaurant_id=${rest.id}`)).json()).state;
const stuck = defaultNodes.filter((n) => JSON.stringify(nodeValue(n, after)) !== JSON.stringify(n.def));
if (stuck.length) {
  console.error(`\n${stuck.length} switch(es) did NOT take:`);
  for (const n of stuck) console.error(`  ${n.name} — wanted ${show(n.def)}, reads ${show(nodeValue(n, after))}`);
  process.exit(1);
}
console.log(`\n✅ applied · all ${defaultNodes.length} switches read back exactly as the model's defaults`);
