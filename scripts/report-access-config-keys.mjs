#!/usr/bin/env node
/* report-access-config-keys.mjs — WHICH KEYS IN A RESTAURANT'S PERMISSION RECORD ARE STILL LIVE?
 *
 *   node scripts/report-access-config-keys.mjs                 (every restaurant)
 *   node scripts/report-access-config-keys.mjs --slug aangan   (just one)
 *
 * READ-ONLY. It never writes, never deletes, and never suggests a command that would. That is
 * deliberate: `restaurants.access_config` is the permanent permission record, the write route
 * leaves retired ids alone ON PURPOSE (deleting stored history is not its job), and every
 * "tidy-up" of a permission table is one bad assumption away from taking a capability off a
 * restaurant that was relying on it.
 *
 * WHY IT EXISTS (sweep T6, 2026-08-06). French House and Aangan each carry ~30 top-level ids in
 * access_config, roughly twenty of them left over from the 4-rung ladder the access rebuild
 * deleted as a concept — mark_paid, print_invoice, manage_staff, handle_issues, staff_pay_view,
 * table_assign… Nothing reads them, nothing can change them, and there was no way to tell at a
 * glance which ids the model still owns. So the next person reading a restaurant's record could
 * not answer "is this switch live?" without walking lib/accessTree.ts by hand.
 *
 * The live set is DERIVED from the model (HAS_IDS + capTablet ids + every opt/limit id), so a
 * node added to the tree moves this report by itself — there is no second list to drift.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = process.argv.slice(2);
const argOf = (n, d) => { const i = ARGS.indexOf(n); return i === -1 ? d : ARGS[i + 1]; };
const ONLY = argOf("--slug", "");

// Compile the model so the live list is the REAL exported one, generated rows included.
const MODEL_OUT = join(ROOT, "node_modules/.cache/accessTree.report.mjs");
execFileSync("npx", ["esbuild", "lib/accessTree.ts", "--bundle", "--platform=node", "--format=esm",
  "--alias:@=.", `--outfile=${MODEL_OUT}`, "--log-level=warning"], { cwd: ROOT, stdio: "inherit" });
const M = await import(MODEL_OUT);

// Every access_config top-level id the model can legitimately touch — the same four shapes the
// write route allow-lists from (app/api/admin/restaurants/access-tree/route.ts → KNOWN_CONFIG_IDS).
const live = new Set(M.HAS_IDS);
for (const n of M.ALL_NODES) {
  const b = n.bind;
  if (b.t === "capTablet") live.add(b.id);
  if (b.t === "opt" || b.t === "limit") live.add(b.id);
}
// `menus` is the tab list — a live container, not a permission id.
live.add("menus");

const env = {};
for (const l of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY;
if (!U || !K) { console.error("No Supabase credentials in .env.local — nothing read."); process.exit(1); }

// ONE scoped read, explicit column list. This is a report, not a hot path, but the rule is the rule.
const q = `${U}/rest/v1/restaurants?select=slug,access_config${ONLY ? `&slug=eq.${encodeURIComponent(ONLY)}` : ""}&order=slug`;
const rows = await fetch(q, { headers: { apikey: K, Authorization: `Bearer ${K}` } }).then((r) => r.json());
if (!Array.isArray(rows)) { console.error("Could not read the restaurants."); process.exit(1); }

console.log(`\naccess_config keys · ${rows.length} restaurant(s) · ${live.size} ids the model still owns\n`);
let totalRetired = 0;
const seenRetired = new Map();

for (const r of rows) {
  const cfg = r.access_config && typeof r.access_config === "object" ? r.access_config : {};
  const ids = Object.keys(cfg);
  if (!ids.length) { console.log(`${r.slug.padEnd(28)} —  no permission record yet`); continue; }
  const inUse = ids.filter((k) => live.has(k));
  const retired = ids.filter((k) => !live.has(k));
  totalRetired += retired.length;
  for (const k of retired) seenRetired.set(k, (seenRetired.get(k) || 0) + 1);
  console.log(`${r.slug.padEnd(28)} ${String(inUse.length).padStart(2)} live · ${String(retired.length).padStart(2)} history`);
  if (inUse.length) console.log(`  live:    ${inUse.sort().join(", ")}`);
  if (retired.length) console.log(`  history: ${retired.sort().join(", ")}`);
  console.log("");
}

if (seenRetired.size) {
  console.log("── keys no switch owns any more, across every restaurant ──");
  for (const [k, n] of [...seenRetired.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
    console.log(`  ${k.padEnd(22)} on ${n} restaurant(s)`);
  console.log(`\n${totalRetired} stored key(s) belong to switches the model retired.`);
  console.log("They are LEFT ALONE on purpose — this report exists so you can read the record, not tidy it.");
  console.log("If one of them ever needs to come back, it needs a ROW in lib/accessTree.ts, not a delete.");
} else {
  console.log("Every stored key is one the model still owns.");
}
