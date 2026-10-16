// scripts/sweep/t2s10/sabotage.mjs — sweep #10 T2: break each named behaviour ONCE, run
// verify:3d-viewer, require it to go red, restore the file byte-for-byte, require it to go green.
// Re-proves the "break it and the guard notices" ledger rows (P56490–P56511, P96301–P96329) on the
// code as it is today, and is reused after this run's own fixes. Restores on every exit path.
//   node scripts/sweep/t2s10/sabotage.mjs [--only name,name]  → node_modules/.cache/t2s10/sabotage.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const V = "app/view/[folder]/ViewerClient.tsx", I = "app/item/[slug]/ItemClient.tsx", P = "components/PublicModelViewer.tsx";
const L = "lib/modelLoader.ts", IP = "app/item/[slug]/page.tsx", NF = "app/item/[slug]/not-found.tsx", CSS = "app/globals.css";
export const BREAKS = [
  ["item 1 · the flagship-only config test", V, "if (rid !== DEFAULT_RESTAURANT_ID) { setConfig({}); setLoading(false); return; }", ""],
  ["item 1 · the ridReady gate", V, "if (!ridReady) return;", ""],
  ["item 1 · the failed-lookup catch", V, "getRestaurantBySlug(fromRestaurant).catch(() => null)", "getRestaurantBySlug(fromRestaurant)"],
  ["item 2 · the lightbox X z-index", I, "style={{ zIndex: 1 }}", "style={{}}"],
  ["item 3 · the saved-dishes effect", I, "  }, [item?.id]);", "  }, []);"],
  ["item 3 · the favourites listener", I, 'window.addEventListener("lfh:favorites-updated", read);', ""],
  ["item 3 · the duplicate guard", I, "} else if (!favorites.includes(item.id)) {", "} else {"],
  ["item 4 · the ingredients condition", I, "{descExpanded && (item.ingredients?.length ?? 0) > 0 && <div className=\"ing-inside-label\">", "{descExpanded && <div className=\"ing-inside-label\">"],
  ["item 7 · the 404 metadata export", NF, "export const metadata = {", "const metadata = {"],
  ["item 8 · the shared pill height", CSS, /(\.viewer-wrapper \.tbtn\{\s*\n\s*height:)44px/, "$136px"],
  ["item 8 · the two !important overrides", CSS, "  height:44px !important;", "  height:36px !important;"],
  ["item 9 · the pinned-bar breakpoint value", I, "const PINNED_BAR_MAX_WIDTH = 1024;", "const PINNED_BAR_MAX_WIDTH = 99999;"],
  ["item 10 · the heart's aria-pressed", I, "aria-pressed={favorited}", ""],
  ["item 10 · Read more being a button", I, /<button\s+type="button"\s+id="desc-toggle"/, '<span\n            id="desc-toggle"'],
  ["item 10 · the font narrowing", I, 'fontFamily: "inherit"', 'font: "inherit"'],
  ["item 10 · the 3D screen's heading", V, '<h2 className="dname"', '<div className="dname"'],
  ["item 12 · initialItem being required", I, "initialItem: FoodItem;", "initialItem?: FoodItem;"],
  ["item 12 · the server-copy fallback", I, "setItem(dish || initialItem);", "setItem(dish);"],
  ["item 12 · not re-reading the dish", I, "Promise.resolve(initialItem),", "getMenuItem(slug, restaurantId),"],
  ["sweep #7 · the alive flag", V, "if (!aliveRef.current) return;", ""],
  ["sweep #6 · the table gate on 3D Add", V, "gateAddToCart(() => {", "(() => {"],
  ["sweep #6 · the loading panel z-index", V, '<div id="load" style={{ zIndex: 20 }}>', '<div id="load">'],
  // The attribute, not the comment above it that quotes the same words (the first run hit the comment).
  ["sweep #6 · the CDN crossOrigin", P, /crossOrigin="anonymous"\n(\s*onError)/, "$1"],
  ["sweep #6 · the tab-tenant pin", V, 'sessionStorage.setItem("lfh_tab_tenant", r.slug)', 'sessionStorage.setItem("lfh_tab_tenant_x", r.slug)'],
  ["the Add-button z-index constant", I, 'zIndex: 50 };', "zIndex: 1 };"],
  ["the error cards' inline layout", V, 'style={CARD_PAD}', ""],
  // Two ways to lose the rule: forget to USE the derivation, or delete it.
  ["the single-diet rule (derivation deleted)", I, /const dietMeaningful =\n[^;]*;/, "const dietMeaningful = true;"],
  ["the single-diet rule", I, "const showDiet = !!features.diet_filter && dietMeaningful;", "const showDiet = !!features.diet_filter;"],
  ["the review fetch gated on BOTH switches", I, "if (!real || !real.reviews || !real.ratings)", "if (!real || !real.reviews)"],
  ["the maintenance gate on #1's share card", IP, "if (!settings.menuEnabled || settings.serviceMode) {", "if (!settings.menuEnabled) {"],
  ["the loader's cleared wanted list", L, /(stopAll\(\) \{\s*\n\s*this\.queue = \[\];[\s\S]*?)this\.wanted = \[\];/, "$1"],
];
const guard = () => spawnSync("node", ["scripts/verify-3d-viewer.mjs"], { cwd: ROOT, encoding: "utf8" });
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1].split(",") : null;
const originals = new Map();
const restoreAll = () => { for (const [f, s] of originals) writeFileSync(join(ROOT, f), s); };
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { restoreAll(); process.exit(130); });
const out = [];
try {
  const base = guard();
  if (base.status !== 0) throw new Error("verify:3d-viewer is RED before any break — fix that first");
  for (const [name, file, find, repl] of BREAKS) {
    if (only && !only.some((o) => name.includes(o))) continue;
    const p = join(ROOT, file);
    const src = readFileSync(p, "utf8");
    originals.set(file, src);
    const hit = typeof find === "string" ? src.includes(find) : find.test(src);
    if (!hit) { out.push({ name, file, ok: false, note: "the code to break is not in the file any more" }); continue; }
    const broken = typeof find === "string" ? src.replace(find, repl) : src.replace(find, repl);
    writeFileSync(p, broken);
    const r1 = guard();
    writeFileSync(p, src);
    const r2 = guard();
    const fails = (r1.stdout.match(/^\s*FAIL/gm) || []).length;
    out.push({ name, file, ok: r1.status !== 0 && r2.status === 0, note: `exit ${r1.status} over the break (${fails} FAIL line${fails === 1 ? "" : "s"}), exit ${r2.status} once restored` });
    console.log(`${r1.status !== 0 && r2.status === 0 ? "✅" : "❌"} ${name} — ${out.at(-1).note}`);
  }
} finally { restoreAll(); }
mkdirSync(join(ROOT, "node_modules/.cache/t2s10"), { recursive: true });
writeFileSync(join(ROOT, "node_modules/.cache/t2s10/sabotage.json"), JSON.stringify(out, null, 1));
const bad = out.filter((o) => !o.ok);
console.log(`\n${out.length} breaks · ${out.length - bad.length} caught · ${bad.length} not`);
process.exit(bad.length ? 1 : 0);
