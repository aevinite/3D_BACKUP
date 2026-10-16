// scripts/sweep/t2s10/lib.mjs — shared plumbing for sweep #10 T2 (the dish page and the 3D viewer).
// ids come from this terminal's PRE-ALLOCATED block P171001–P172000 and nowhere else; the allocator
// throws rather than leave it. Results land in node_modules/.cache/t2s10/<tag>.json; ledger.mjs
// turns them into rows.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const OUT = join(ROOT, "node_modules/.cache/t2s10");
mkdirSync(OUT, { recursive: true });
export const BASE = (() => { const i = process.argv.indexOf("--base"); return i > 0 ? process.argv[i + 1] : (process.env.T2_BASE || "http://localhost:4402"); })();
export const F = {
  viewer: "app/view/[folder]/ViewerClient.tsx", viewPage: "app/view/[folder]/page.tsx",
  item: "app/item/[slug]/ItemClient.tsx", itemPage: "app/item/[slug]/page.tsx", itemPageR: "app/r/[restaurant]/item/[slug]/page.tsx",
  nf: "app/item/[slug]/not-found.tsx", nfR: "app/r/[restaurant]/item/[slug]/not-found.tsx",
  pmv: "components/PublicModelViewer.tsx", toast: "components/ModelToastHost.tsx",
  loader: "lib/modelLoader.ts", watch: "lib/modelWatchlist.ts", media: "lib/mediaLinks.ts",
  cCroissant: "public/content/items/Croissant/config.json", cWaffle: "public/content/items/Waffle/config.json",
};
export const raw = (p) => readFileSync(join(ROOT, p), "utf8");
// Comments out FIRST, so prose quoting a rule can never stand in for the rule (sweep #9's lesson).
export const code = (p) => raw(p).replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\s*\}/g, "{}");
const results = [];
export function check(id, file, what, how, fn) { results.push({ id, file, what, how, fn }); }
export async function run(tag) {
  const out = [];
  for (const r of results) {
    let ok = false, note = "", skip = false;
    try {
      const v = await r.fn();
      if (v && typeof v === "object" && "skip" in v) { skip = true; note = v.skip; }
      else if (v && typeof v === "object") { ok = !!v.ok; note = v.note ?? ""; }
      else ok = !!v;
    } catch (e) { ok = false; note = "threw: " + String(e?.message || e).slice(0, 200); }
    out.push({ id: r.id, file: r.file, what: r.what, how: r.how, ok, skip, note: String(note).replace(/\n/g, " ").slice(0, 300) });
    if (!ok && !skip) console.log(`   ❌ ${r.id} ${r.what} — ${out.at(-1).note}`);
  }
  writeFileSync(join(OUT, `${tag}.json`), JSON.stringify(out, null, 1));
  const bad = out.filter((o) => !o.ok && !o.skip).length, sk = out.filter((o) => o.skip).length;
  console.log(`\n${tag}: ${out.length} checks · ${out.length - bad - sk} ✅ · ${bad} ❌ · ${sk} ⏭`);
  return bad;
}
export const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
export const RANGE = [171001, 172000];
export function ids(start, n) { const a = []; for (let i = 0; i < n; i++) { const v = start + i; if (v > RANGE[1]) throw new Error("T2 S10 block exhausted — STOP"); a.push("P" + v); } return a; }
export function idGen(start) { let n = start; return () => { if (n > RANGE[1] || n < RANGE[0]) throw new Error("T2 S10 id outside P171001–P172000 — STOP"); return "P" + n++; }; }
