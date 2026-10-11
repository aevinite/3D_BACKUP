// backfill-parcel-tax.mjs — give every OLDER counter parcel its tax figures, or say honestly why not (mig 421).
//
// WHY (owner, 2026-10-11: "do parcel one"). From mig 421 on, a parcel records the split it was priced
// with the moment it is made (lib/tax.ts parcelTaxColumns). Parcels made BEFORE that kept only `total`,
// so their tax is on no record. This looks at each one and decides — never guesses:
//   repriced       its own lines, priced by lib/tax.ts splitBill() with the restaurant's tax settings,
//                  give back its stored total to the paisa → the rate is PROVEN; the split is written.
//   none_recorded  the stored total equals its lines with NO tax (the shape every parcel had before
//                  the 2026-08-02 fix, when the bill charged tax on top and the row did not record it)
//                  → the tax that was collected is on no record, so none is invented.
//   unmatched      anything else.
// Only the new tax columns are written, and only on rows whose tax_basis is still NULL — `total`, the
// numbers, `paid`, the status and the lines are never touched, so it is safe to run again and again.
//
//   node --experimental-strip-types --no-warnings scripts/backfill-parcel-tax.mjs           dry run: what it WOULD write
//   node --experimental-strip-types --no-warnings scripts/backfill-parcel-tax.mjs --apply   write it (dev/test databases only)
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { refuseUnlessDevTestDb } from "./sweep/devStacks.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
refuseUnlessDevTestDb(URL_, "this script writes tax figures onto parcel rows");
const APPLY = process.argv.includes("--apply");
const { splitBill, parcelTaxColumns, roundPaise, TAX_SETTINGS_COLUMNS } = await import(pathToFileURL(join(root, "lib/tax.ts")).href);

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const get = async (path) => { const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: H }); if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${(await r.text()).slice(0, 160)}`); return r.json(); };

// Every parcel not yet looked at — a few hundred at most per restaurant, paged so none is missed.
const rows = [];
for (let from = 0; ; from += 1000) {
  const page = await get(`aggregator_orders?select=id,restaurant_id,total,items,payload&source=eq.parcel&tax_basis=is.null&order=id.asc&limit=1000&offset=${from}`);
  rows.push(...page); if (page.length < 1000) break;
}
const rids = [...new Set(rows.map((r) => r.restaurant_id))];
const settings = new Map();
for (let i = 0; i < rids.length; i += 100) {
  for (const s of await get(`settings?select=restaurant_id,${TAX_SETTINGS_COLUMNS.replace(/\s+/g, "")}&restaurant_id=in.(${rids.slice(i, i + 100).join(",")})&limit=100`)) settings.set(s.restaurant_id, s);
}

const tally = { repriced: 0, none_recorded: 0, unmatched: 0, no_settings: 0 };
let wrote = 0;
for (const r of rows) {
  const st = settings.get(r.restaurant_id);
  if (!st) { tally.no_settings++; continue; }
  const lines = Array.isArray(r.items) ? r.items : [];
  const disc = Number(r.payload?.discount) || 0;
  const stored = Number(r.total) || 0;
  const sp = splitBill(lines, st, disc);
  let patch;
  if (Math.abs(sp.total - stored) < 0.005) { patch = parcelTaxColumns(sp, "repriced"); tally.repriced++; }
  else {
    const untaxed = roundPaise(lines.reduce((a, l) => a + (Number(l?.price) || 0) * (Number(l?.qty) || 0), 0) - disc);
    const basis = Math.abs(untaxed - stored) < 0.005 ? "none_recorded" : "unmatched";
    patch = { tax_basis: basis }; tally[basis]++;
  }
  if (APPLY) {
    // id + restaurant_id is the fence; `tax_basis=is.null` makes a second run a no-op for this row.
    const u = await fetch(`${URL_}/rest/v1/aggregator_orders?id=eq.${r.id}&restaurant_id=eq.${r.restaurant_id}&tax_basis=is.null`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(patch) });
    if (!u.ok) throw new Error(`update ${r.id}: ${u.status} ${(await u.text()).slice(0, 160)}`);
    wrote++;
  }
}
console.log(`${rows.length} parcel(s) not yet looked at · ${tally.repriced} repriced (their lines give back their total exactly) · ${tally.none_recorded} recorded without tax (before 2026-08-02) · ${tally.unmatched} unmatched${tally.no_settings ? ` · ${tally.no_settings} with no settings row (left alone)` : ""}`);
console.log(APPLY ? `wrote ${wrote} row(s)` : "dry run — nothing written (add --apply)");
