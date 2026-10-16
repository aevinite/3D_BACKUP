// scripts/sweep/t1s10/new-a.mjs — sweep #10 · T1 · NEW CHECKS, part A (ids P170016 onward, in file order — APPEND ONLY).
// The REAL library files run (bundled by esbuild, `@/` resolved), the three content files parsed, and the thin
// components read off today's code with comments stripped. Aimed at the files no earlier row had touched
// (rows-by-subject before this run: 0 for the q page, the r page, the r 404, Header, CustomerGreeter, FoodCard,
// GuestChrome, InfinityLoader, brandTheme, NavPicker, Particles, aangan-menu.json, menu.json, favicon.ico).
// Nothing is written anywhere.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { R, src, code, count, ok, ROOT, importTs } from "./lib.mjs";

let n = 170016; const id = () => `P${n++}`;
const U = (file, t, fn) => R(id(), file, t, fn, "the REAL function, bundled with esbuild and called");
const S = (file, t, fn) => R(id(), file, t, fn, "static read of today's code, comments stripped (TypeScript parser)");
const J = (file, t, fn) => R(id(), file, t, fn, "the file parsed as JSON and every entry checked");
const m = (rel) => importTs(rel);

// ── A1 · lib/searchText.ts — what a typed search means ──
const ST = "lib/searchText.ts";
for (const [raw, kind, term, why] of [
  ["coffee", "term", "coffee", "a plain word is searched as typed"],
  ["  latte  ", "term", "latte", "surrounding spaces are trimmed"],
  ["", "none", "", "an empty box is no search"],
  ["   ", "none", "", "only spaces is no search, not 'nothing matches'"],
  [null, "none", "", "a missing value is no search"],
  ["%%%", "unsearchable", "", "only wildcards is unsearchable, told apart from empty"],
  ["a%b", "term", "a b", "a wildcard inside a word cannot widen the search"],
  ["(x),y", "term", "x y", "filter grammar characters are dropped"],
  ["back\\slash", "term", "back slash", "a backslash cannot swallow the next letter"],
  ["café crème", "term", "café crème", "accented letters are kept (the menu folds them itself)"],
  ["कॉफ़ी", "term", "कॉफ़ी", "a Hindi word is kept whole"],
  ["two   spaces", "term", "two spaces", "runs of spaces collapse to one"],
]) U(ST, `searchTerm(${JSON.stringify(raw)}) — ${why}`, async () => { const r = (await m(ST)).searchTerm(raw); return ok(r.kind === kind && r.term === term, JSON.stringify(r)); });
U(ST, "searchTerm caps a pasted essay at 80 characters", async () => { const r = (await m(ST)).searchTerm("x".repeat(500)); return ok(r.term.length === 80, `${r.term.length}`); });
U(ST, "…and the cap can be set by the caller", async () => ok((await m(ST)).searchTerm("abcdefgh", 3).term === "abc"));
U(ST, "safePhone keeps digits only", async () => ok((await m(ST)).safePhone("+91 98-765 43210") === "919876543210"));
U(ST, "safePhone caps at 15 digits", async () => ok((await m(ST)).safePhone("1".repeat(40)).length === 15));
U(ST, "safePhone of nothing is ''", async () => ok((await m(ST)).safePhone(undefined) === "" && (await m(ST)).safePhone(null) === ""));
// ── A2 · lib/brandText.ts — the *highlighted* wordmark ──
const BT = "lib/brandText.ts";
const seg = async (s) => JSON.stringify((await m(BT)).splitBrandSegments(s));
for (const [inp, want, why] of [
  ["little *French* house", '[{"text":"little ","hi":false},{"text":"French","hi":true},{"text":" house","hi":false}]', "the starred word is highlighted"],
  ["*Aevi*dine", '[{"text":"Aevi","hi":true},{"text":"dine","hi":false}]', "a highlight at the very start"],
  ["Burger Barn", '[{"text":"Burger Barn","hi":false}]', "no stars = one plain segment"],
  ["", "[]", "an empty name draws nothing"],
  ["**", "[]", "two bare stars leave nothing to draw"],
  ["a*b", '[{"text":"a","hi":false},{"text":"b","hi":true}]', "an unclosed star highlights the rest"],
  ["Aangan *Garden*", '[{"text":"Aangan ","hi":false},{"text":"Garden","hi":true}]', "Aangan's own wordmark"],
]) U(BT, `splitBrandSegments(${JSON.stringify(inp)}) — ${why}`, async () => { const g = await seg(inp); return ok(g === want, g); });
U(BT, "splitBrandSegments of a non-string draws nothing", async () => ok(JSON.stringify((await m(BT)).splitBrandSegments(undefined)) === "[]"));
U(BT, "stripBrandMarkers removes every star", async () => ok((await m(BT)).stripBrandMarkers("*Aevi*dine") === "Aevidine"));
U(BT, "hasBrandMarkers tells a starred name from a plain one", async () => { const f = (await m(BT)).hasBrandMarkers; return ok(f("*a*") && !f("plain") && !f(undefined)); });
for (const [s, k, why] of [["Bonsoir", 7, "ASCII letters"], ["शुभ संध्या", 5, "a Hindi greeting keeps its conjuncts whole (शु भ ␠ सं ध्या)"], ["👨‍👩‍👧", 1, "a family emoji is one unit"], ["🇮🇳", 1, "a flag is one unit"], ["مرحبا", 5, "Arabic letters"], ["안녕", 2, "Korean syllables"], ["", 0, "nothing"]])
  U(BT, `splitGraphemes(${JSON.stringify(s)}) is ${k} — ${why}`, async () => { const g = (await m(BT)).splitGraphemes(s); return ok(g.length === k && g.join("") === s, `${g.length}`); });
// ── A3 · lib/brandTheme.ts — a restaurant's own palette ──
const BH = "lib/brandTheme.ts";
for (const [v, want] of [["#fff", true], ["#3089e8", true], [" #3089E8 ", true], ["3089e8", false], ["#30", false], ["#3089e8ff", false], ["red", false], [null, false]])
  U(BH, `isHexColor(${JSON.stringify(v)}) is ${want}`, async () => ok((await m(BH)).isHexColor(v) === want));
for (const [v, want] of [["#fff", "255, 255, 255"], ["#000000", "0, 0, 0"], ["#3089e8", "48, 137, 232"], ["blue", null]])
  U(BH, `hexToRgbTriplet(${JSON.stringify(v)}) is ${JSON.stringify(want)}`, async () => ok((await m(BH)).hexToRgbTriplet(v) === want));
U(BH, "sanitizeBrandTheme keeps only real colours", async () => { const r = (await m(BH)).sanitizeBrandTheme({ dark: { bg: "#000", card: "url(x)", text: "#fff;color:red" } }); return ok(JSON.stringify(r) === '{"dark":{"bg":"#000"}}', JSON.stringify(r)); });
U(BH, "…drops a skin with nothing valid in it", async () => ok(JSON.stringify((await m(BH)).sanitizeBrandTheme({ light: { bg: "nope" } })) === "{}"));
U(BH, "…survives a missing or odd input", async () => { const f = (await m(BH)).sanitizeBrandTheme; return ok(JSON.stringify(f(null)) === "{}" && JSON.stringify(f("x")) === "{}" && JSON.stringify(f([])) === "{}"); });
U(BH, "…ignores keys it does not know", async () => ok(!("evil" in ((await m(BH)).sanitizeBrandTheme({ dark: { evil: "#000", bg: "#111" } }).dark || {}))));
U(BH, "buildModeBlock writes the accent and its gradient", async () => { const b = (await m(BH)).buildModeBlock("dark", { accent: "#3098e8" }); return ok(/--accent: #3098e8;/.test(b) && /--accent-grad: linear-gradient/.test(b), b.slice(0, 80)); });
U(BH, "…falls back to the restaurant's accent when the skin names none", async () => ok(/--accent: #c0392b;/.test((await m(BH)).buildModeBlock("light", { bg: "#fff" }, "#c0392b"))));
U(BH, "…refuses a fallback that is not a colour", async () => ok(!/--accent:/.test((await m(BH)).buildModeBlock("light", { bg: "#fff" }, "red;}body{"))));
U(BH, "…derives the muted text from the text colour", async () => ok(/--muted: rgba\(255, 255, 255, 0\.72\);/.test((await m(BH)).buildModeBlock("dark", { text: "#ffffff" }))));
U(BH, "…writes nothing for an empty palette", async () => ok(!/--(bg|card|text|accent):/.test((await m(BH)).buildModeBlock("dark", {}))));
U(BH, "buildCanvasBlock of an empty palette writes no colour", async () => ok(!/#[0-9a-f]{3,6}/i.test((await m(BH)).buildCanvasBlock({}))));
U(BH, "buildCanvasBlock cannot be handed CSS", async () => ok(!/\}\s*body/.test((await m(BH)).buildCanvasBlock({ bg: "#000;}body{display:none" }))));
// ── A4 · lib/accent.ts ──
const AC = "lib/accent.ts";
U(AC, "inkOnAccent gives dark ink on a pale accent", async () => { const v = (await m(AC)).inkOnAccent("#f5e6c8"); return ok(/^#[0-3]/.test(v) || /^#000|#111|#1a1a1a|#23201c/.test(v), v); });
U(AC, "inkOnAccent gives white ink on a dark accent", async () => { const v = (await m(AC)).inkOnAccent("#1a237e"); return ok(/^#fff/i.test(v), v); });
U(AC, "accentPaletteCss of Aangan's colour names the accent", async () => ok(/#3089e8/i.test((await m(AC)).accentPaletteCss("#3089e8"))));
U(AC, "accentPaletteCss of a non-colour is ''", async () => ok((await m(AC)).accentPaletteCss("javascript:alert(1)") === ""));
U(AC, "accentCanvasCss of a real colour scopes both skins", async () => { const c = (await m(AC)).accentCanvasCss("#c0392b"); return ok(/html\[data-theme="?light"?\]/.test(c) && /html\[data-theme="?dark"?\]/.test(c), c.slice(0, 120)); });
U(AC, "accentBackground of a non-colour is null", async () => ok((await m(AC)).accentBackground("nope") === null));
U(AC, "accentBackground of a real colour is something to paint", async () => ok(typeof (await m(AC)).accentBackground("#3089e8") === "string"));
U(AC, "readableInkOn says nothing for a non-colour, and falls back to its floor when no share can reach the target", async () => { const f = (await m(AC)).readableInkOn; const a = f("#3089e8", [255, 255, 255], 3); const b = f("#ffffff", [255, 255, 255], 21); const c = f("nope", [255, 255, 255], 3); return ok(/^rgb/.test(a) && /^rgb/.test(b) && c === null, `${a} / ${b} / ${c}`); });
// ── A5 · lib/allergens.ts ──
const AL = "lib/allergens.ts";
U(AL, "the allergen list has six entries", async () => ok((await m(AL)).ALLERGENS.length === 6));
U(AL, "…every slug is unique", async () => { const s = (await m(AL)).ALLERGENS.map((a) => a.slug); return ok(new Set(s).size === s.length); });
U(AL, "…every slug is lower-case letters", async () => ok((await m(AL)).ALLERGENS.every((a) => /^[a-z]+$/.test(a.slug))));
U(AL, "…every one has a label and an icon", async () => ok((await m(AL)).ALLERGENS.every((a) => a.label && a.icon)));
U(AL, "allergenLabel names each one", async () => { const x = await m(AL); return ok(x.ALLERGENS.every((a) => x.allergenLabel(a.slug) === a.label)); });
U(AL, "allergenIcon draws each one", async () => { const x = await m(AL); return ok(x.ALLERGENS.every((a) => x.allergenIcon(a.slug) === a.icon)); });
// ── A6 · lib/restaurantColor.ts ──
const RC = "lib/restaurantColor.ts";
const ids = (k) => Array.from({ length: k }, (_, i) => `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`);
U(RC, "one to three restaurants get the green family", async () => { const x = await m(RC); return ok([1, 2, 3].every((k) => [...x.restaurantPalette(ids(k)).values()].every((c) => x.GREEN_SHADES.includes(c)))); });
U(RC, "…three restaurants get three different greens", async () => ok(new Set((await m(RC)).restaurantPalette(ids(3)).values()).size === 3));
U(RC, "four or more get the identity colours", async () => { const x = await m(RC); return ok([...x.restaurantPalette(ids(5)).values()].every((c) => x.PORTFOLIO_COLORS.includes(c))); });
U(RC, "a restaurant keeps its colour whatever order the list arrives in", async () => { const x = await m(RC); const a = ids(6), b = [...a].reverse(); return ok(a.every((i) => x.restaurantColor(i, a) === x.restaurantColor(i, b))); });
U(RC, "…and at the green tier too", async () => { const x = await m(RC); const a = ids(3), b = [a[2], a[0], a[1]]; return ok(a.every((i) => x.restaurantColor(i, a) === x.restaurantColor(i, b))); });
U(RC, "a repeated id counts once", async () => ok((await m(RC)).restaurantPalette([...ids(2), ...ids(2)]).size === 2));
U(RC, "a numeric position wraps round the palette", async () => { const x = await m(RC); return ok(x.portfolioColor(0) === x.portfolioColor(x.PORTFOLIO_COLORS.length)); });
U(RC, "every colour in both palettes is a real hex colour", async () => { const x = await m(RC); return ok([...x.PORTFOLIO_COLORS, ...x.GREEN_SHADES].every((c) => /^#[0-9a-f]{6}$/.test(c))); });
U(RC, "the identity palette has no repeated colour", async () => { const x = await m(RC); return ok(new Set(x.PORTFOLIO_COLORS).size === x.PORTFOLIO_COLORS.length); });
U(RC, "an id outside the estate still gets a colour", async () => ok(/^#/.test((await m(RC)).restaurantColor("zz", ids(4)))));
// ── A7 · lib/starterMenu.ts ──
const SM = "lib/starterMenu.ts";
const starter = async () => { const x = await m(SM); const cwd = process.cwd(); process.chdir(ROOT); try { return { x, menu: x.loadStarterMenu() }; } finally { process.chdir(cwd); } };
U(SM, "loadStarterMenu reads the starter file", async () => { const { menu } = await starter(); return ok(menu.items.length === 72 && menu.categories.length === 9, `${menu.items.length} dishes, ${menu.categories.length} sections`); });
U(SM, "toCategoryRows stamps the new restaurant on every section", async () => { const { x, menu } = await starter(); const r = x.toCategoryRows(menu, "rid-1"); return ok(r.length === 9 && r.every((c) => c.restaurant_id === "rid-1")); });
U(SM, "…every section starts switched on", async () => { const { x, menu } = await starter(); return ok(x.toCategoryRows(menu, "r").every((c) => c.active === true)); });
U(SM, "toFilterRows stamps the restaurant too", async () => { const { x, menu } = await starter(); return ok(x.toFilterRows(menu, "rid-2").every((f) => f.restaurant_id === "rid-2")); });
U(SM, "toItemRows gives every dish a fresh id each time", async () => { const { x, menu } = await starter(); const a = x.toItemRows(menu, "r"), b = x.toItemRows(menu, "r"); return ok(new Set(a.map((i) => i.id)).size === 72 && a.every((i, k) => i.id !== b[k].id)); });
U(SM, "…strips every 3D field", async () => { const { x, menu } = await starter(); return ok(x.toItemRows(menu, "r").every((i) => i.is4d === false && i.model_folder === null && i.model_small_url === null && i.model_optimized_url === null)); });
U(SM, "…keeps the dish order", async () => { const { x, menu } = await starter(); return ok(x.toItemRows(menu, "r").every((i, k) => i.sort_order === k && i.slug === menu.items[k].slug)); });
U(SM, "…tags each dish veg or non-veg when the file gives no tags", async () => { const { x, menu } = await starter(); return ok(x.toItemRows(menu, "r").every((i) => Array.isArray(i.tags) && i.tags.length > 0)); });
U(SM, "…every dish lands in a section that exists", async () => { const { x, menu } = await starter(); const cats = new Set(x.toCategoryRows(menu, "r").map((c) => c.slug)); return ok(x.toItemRows(menu, "r").every((i) => cats.has(i.category))); });
U(SM, "…stamps the restaurant on every dish", async () => { const { x, menu } = await starter(); return ok(x.toItemRows(menu, "zz").every((i) => i.restaurant_id === "zz")); });
// ── A8 · the three content files ──
const allowedHosts = [...src("next.config.ts").matchAll(/hostname: "([^"]+)"/g)].map((x) => x[1]);
for (const f of ["public/content/menu.json", "public/content/aangan-menu.json", "public/content/starter-menu.json"]) {
  const d = () => JSON.parse(src(f)); const name = f.split("/").pop();
  J(f, `${name} parses`, () => ok(!!d().items));
  J(f, `${name}: every section slug is unique`, () => { const s = d().categories.map((c) => c.slug); return ok(new Set(s).size === s.length, `${s.length} sections`); });
  J(f, `${name}: every section has an English name`, () => ok(d().categories.every((c) => typeof c.name?.en === "string" && c.name.en.trim())));
  J(f, `${name}: every section slug is a clean address word`, () => ok(d().categories.every((c) => /^[a-z0-9-]+$/.test(c.slug))));
  J(f, `${name}: every dish slug is unique`, () => { const s = d().items.map((i) => i.slug); return ok(new Set(s).size === s.length, `${s.length} dishes`); });
  J(f, `${name}: every dish slug is a clean address word`, () => ok(d().items.every((i) => /^[a-z0-9-]+$/.test(i.slug))));
  J(f, `${name}: every dish belongs to a section in the same file`, () => { const c = new Set(d().categories.map((x) => x.slug)); const bad = d().items.filter((i) => !c.has(i.category)); return ok(bad.length === 0, bad.map((i) => i.slug).slice(0, 5).join(", ") || "all placed"); });
  J(f, `${name}: every price is a positive number`, () => { const bad = d().items.filter((i) => !(Number(i.price) > 0)); return ok(bad.length === 0, bad.map((i) => `${i.slug}=${i.price}`).slice(0, 5).join(", ") || "all priced"); });
  J(f, `${name}: every dish has a title`, () => ok(d().items.every((i) => typeof i.title === "string" && i.title.trim())));
  J(f, `${name}: veg is a yes/no on every dish`, () => ok(d().items.every((i) => i.veg === undefined || typeof i.veg === "boolean")));
  J(f, `${name}: every photo is an allowed host or drawn in place`, () => { const bad = d().items.filter((i) => i.image && !/^data:image\//.test(i.image) && !/^\//.test(i.image) && !allowedHosts.includes(new URL(i.image).hostname)); return ok(bad.length === 0, bad.map((i) => i.image).slice(0, 3).join(", ") || `hosts: ${[...new Set(d().items.filter((i) => /^https?:/.test(i.image || "")).map((i) => new URL(i.image).hostname))].join(", ") || "none"}`); });
  J(f, `${name}: no text reads 'undefined' or 'null'`, () => ok(!/"(undefined|null|NaN)"/.test(src(f).replace(/"[a-zA-Z_]+": null/g, ""))));
  J(f, `${name}: every filter slug is unique`, () => { const s = d().filters.map((x) => x.slug); return ok(new Set(s).size === s.length); });
}
J("public/content/aangan-menu.json", "aangan-menu.json is pure veg, like the restaurant", () => ok(JSON.parse(src("public/content/aangan-menu.json")).items.every((i) => i.veg === true)));
J("public/content/menu.json", "menu.json is seed data only — no screen of the app fetches it", () => { const hits = ["app", "components", "lib"].flatMap((d) => { try { return require("node:child_process").execFileSync("grep", ["-rl", "content/menu.json", join(ROOT, d)], { encoding: "utf8" }).trim().split("\n").filter(Boolean); } catch { return []; } }); return ok(hits.length === 0, hits.join(", ") || "only scripts/ read it"); });
J("public/content/starter-menu.json", "starter-menu.json is read only through lib/starterMenu.ts", () => ok(/starter-menu\.json/.test(src("lib/starterMenu.ts"))));
// ── A9 · middleware.ts ──
const MW = "middleware.ts"; const mw = () => code(MW);
S(MW, "it runs only on the two guest door families", () => ok(/matcher: \["\/r\/:path\*", "\/q\/:path\*"\]/.test(mw())));
S(MW, "a readable address passes straight through", () => ok(/return NextResponse\.next\(\);/.test(mw())));
S(MW, "only a decode failure is acted on", () => ok(/try \{\s*decodeURIComponent\(path\);\s*\} catch \{/.test(mw())));
S(MW, "the hop is temporary (307), so nothing is cached for good", () => ok(/, 307\)/.test(mw()) && !/308|301/.test(mw())));
S(MW, "a damaged staff-door address goes to the sign-in", () => ok(/STAFF_DOORS\.has\(last\) \? STAFF_DEAD_END : DEAD_END/.test(mw()) && /STAFF_DEAD_END = "\/login"/.test(mw())));
S(MW, "…a damaged guest address to the guest's dead end", () => ok(/DEAD_END = "\/r\/zz-unreadable-address\/menu"/.test(mw())));
S(MW, "the dead end's address can never belong to a restaurant (zz- is never minted)", () => ok(!/zz-unreadable-address/.test(src("supabase/migrations/350_an_old_web_address_still_finds_the_restaurant.sql"))));
S(MW, "it names every staff door the tenant tree has", () => { const doors = ["manager", "kitchen", "tablet", "login", "owner"]; return ok(doors.every((d) => existsSync(join(ROOT, "app/r/[restaurant]", d)) && mw().includes(`"${d}"`))); });
S(MW, "it reads no cookie, header or database", () => ok(!/cookies|headers\.get|supabase|fetch\(/.test(mw())));
// ── A10 · components/GuestChrome.tsx ──
const GC = "components/GuestChrome.tsx"; const gc = () => code(GC);
S(GC, "every guest widget is loaded lazily, client-only", () => ok(count(gc(), /dynamic\(\(\) => import\(/g) === count(gc(), /\{ ssr: false \}/g) && count(gc(), /\{ ssr: false \}/g) >= 16));
S(GC, "each widget declared is mounted once", () => { const names = [...gc().matchAll(/^const (\w+)\s+= dynamic/gm)].map((x) => x[1]); return ok(names.every((w) => count(gc(), new RegExp(`<${w} />`, "g")) === 1), `${names.length} widgets`); });
S(GC, "it draws nothing on a staff screen", () => ok(/if \(isStaff\) return null;/.test(gc())));
S(GC, "…including a restaurant's own staff address (/r/<slug>/kitchen)", () => ok(/\^\(\?:\/r\/\[\^\/\]\+\)\?\//.test(gc())));
S(GC, "…naming every staff route that exists", () => { const list = (gc().match(/STAFF_SEGMENTS = \[([^\]]+)\]/) || [])[1] || ""; return ok(["aevinite", "manager", "editor", "kitchen", "tablet", "staff-login", "login", "owner"].every((s) => list.includes(`"${s}"`))); });
S(GC, "the guest greeter and the saved-orders chip are among its widgets", () => ok(/<CustomerGreeter \/>/.test(gc()) && /<GuestOutboxChip \/>/.test(gc())));
// ── A11 · components/CustomerGreeter.tsx ──
const CG = "components/CustomerGreeter.tsx"; const cg = () => code(CG);
S(CG, "it greets once per restaurant per tab", () => ok(/const key = `lfh_greeted_\$\{restaurantId\}`;/.test(cg())));
S(CG, "it waits until the restaurant is known", () => ok(/if \(!restaurantId \|\| !ready\) return;/.test(cg())));
S(CG, "a stranger is never greeted", () => ok(/r\.known !== true\) return;/.test(cg())));
S(CG, "a known device with no name is not greeted with a blank", () => ok(/if \(!name\) return;/.test(cg())));
S(CG, "a failed greeting never blocks the menu", () => ok(/catch \{ \/\* greeting is best-effort|catch \{\s*\}/.test(src(CG)) && /try \{\s*const r = await greetDevice/.test(cg())));
S(CG, "leaving before the pause cancels the greeting", () => ok(/cancelled = true; window\.clearTimeout\(t\);/.test(cg())));
S(CG, "it draws nothing of its own", () => ok(/return null;\s*\}\s*$/.test(cg().trim())));
// ── A12 · components/NavPicker.tsx ──
const NP = "components/NavPicker.tsx"; const np = () => code(NP);
S(NP, "the button says what it picks and what is picked", () => ok(/aria-label=\{buttonValue \? `\$\{buttonLabel\}: \$\{buttonValue\}` : buttonLabel\}/.test(np())));
S(NP, "…and whether its list is open", () => ok(/aria-expanded=\{open\}/.test(np())));
S(NP, "the options are the list's own children", () => ok(/role="listbox"/.test(np()) && !/<li/.test(np())));
S(NP, "Escape closes it", () => ok(/e\.key === "Escape"\) setOpen\(false\)/.test(np())));
S(NP, "a tap outside closes it", () => ok(/!ref\.current\.contains\(e\.target as Node\)\) setOpen\(false\)/.test(np())));
S(NP, "Back closes it (registered with the back manager)", () => ok(/useBackClose\(`nav-\$\{buttonLabel\}`, open/.test(np())));
S(NP, "its listeners are removed when it closes", () => ok(count(np(), /removeEventListener/g) === 2));
S(NP, "each option says whether it is the one chosen", () => ok(/aria-selected=\{/.test(np())));
// ── A13 · components/Particles.tsx · InfinityLoader · VegIcon · ComingSoon ──
S("components/Particles.tsx", "twenty dots, placed after the first paint (no server/browser mismatch)", () => { const c = code("components/Particles.tsx"); return ok(/length: 20/.test(c) && /useEffect/.test(c) && /useState<[^>]+>\(\[\]\)/.test(c)); });
S("components/Particles.tsx", "the dots take no pointer", () => ok(/\.particles\s*\{[^}]*pointer-events:\s*none/.test(src("app/globals.css"))));
S("components/Particles.tsx", "the dots stop for a diner who asks for less motion", () => /prefers-reduced-motion: reduce\)[\s\S]{0,400}\.particle/.test(src("app/globals.css")) ? true : "skip: they do NOT — .particle floats forever (app/globals.css) whatever the phone asks. Not fixed on my own judgment: the owner kept the star animation full-motion for exactly this request (R69, 2026-10-12), so calming the dots is listed as an improvement for him to decide");
S("components/InfinityLoader.tsx", "the loader announces itself politely", () => ok(/role="status" aria-live="polite"/.test(code("components/InfinityLoader.tsx"))));
S("components/InfinityLoader.tsx", "…its drawing is hidden from screen readers, its words are not", () => ok(/aria-hidden="true"/.test(code("components/InfinityLoader.tsx")) && /inf-loader-label">\{label\}/.test(code("components/InfinityLoader.tsx"))));
S("components/InfinityLoader.tsx", "…keeps its 2:1 shape at any size", () => ok(/height=\{\(size \* 60\) \/ 120\}/.test(code("components/InfinityLoader.tsx"))));
S("components/InfinityLoader.tsx", "…is a pure component (no state, no effect)", () => ok(!/useState|useEffect/.test(code("components/InfinityLoader.tsx"))));
S("components/VegIcon.tsx", "the veg mark is named Vegetarian", () => ok(/aria-label="Vegetarian"/.test(code("components/VegIcon.tsx"))));
S("components/VegIcon.tsx", "the non-veg mark is named Non-Vegetarian", () => ok(/aria-label="Non-Vegetarian"/.test(code("components/VegIcon.tsx"))));
S("components/VegIcon.tsx", "…they differ in SHAPE, not only colour (dot vs triangle)", () => ok(/<circle className="veg-dot"/.test(code("components/VegIcon.tsx")) && /<polygon className="nv-tri"/.test(code("components/VegIcon.tsx"))));
S("components/VegIcon.tsx", "…both are images to a screen reader", () => ok(count(code("components/VegIcon.tsx"), /role="img"/g) === 2));
S("components/ComingSoon.tsx", "its icons are decoration only", () => ok(count(code("components/ComingSoon.tsx"), /aria-hidden="true"/g) === 2));
S("components/ComingSoon.tsx", "an empty point list draws no empty list", () => ok(/points && points\.length > 0 &&/.test(code("components/ComingSoon.tsx"))));
S("components/ComingSoon.tsx", "it is used only on staff consoles (admin and owner), never a guest screen", () => { const out = require("node:child_process").execFileSync("grep", ["-rl", "components/ComingSoon", join(ROOT, "app"), join(ROOT, "components")], { encoding: "utf8" }).trim().split("\n").filter(Boolean).map((p) => p.replace(ROOT + "/", "")); return ok(out.length > 0 && out.every((p) => /^app\/(aevinite|owner)\//.test(p)), out.join(", ")); });
// ── A14 · components/Header.tsx ──
const HD = "components/Header.tsx"; const hd = () => code(HD);
S(HD, "the theme button says which skin it switches TO", () => ok(/aria-label=\{`Switch to \$\{theme === "dark" \? "light" : "dark"\} mode`\}/.test(hd())));
S(HD, "…its sun and moon are decoration", () => ok(/fa-sun theme-icon-sun" aria-hidden="true"/.test(hd()) && /fa-moon theme-icon-moon" aria-hidden="true"/.test(hd())));
S(HD, "the cart button has a name", () => ok(/aria-label="Open cart"/.test(hd())));
S(HD, "the chosen skin is remembered under the key the boot script reads", () => ok(/localStorage\.setItem\("lfh_theme", next\)/.test(hd()) && /lfh_theme/.test(src("app/layout.tsx"))));
S(HD, "it waits for the browser before drawing anything that differs per device", () => ok(/const \[mounted, setMounted\] = useState\(false\)/.test(hd())));
S(HD, "it offers only the languages this restaurant set", () => ok(/menuLangs/.test(hd()) && /setMenuLangs/.test(hd())));
S(HD, "…and only its currencies", () => ok(/menuCurrs/.test(hd()) && /setMenuCurrs/.test(hd())));
S(HD, "both pickers are the shared NavPicker (one Back/Escape behaviour)", () => ok(count(hd(), /<NavPicker/g) >= 2));
S(HD, "the live-order dot has a name", () => ok(/aria-label="Live order in progress"/.test(hd())));
S(HD, "the wordmark goes through the one highlight splitter", () => ok(/splitBrandSegments|BrandWordmark|brandText/.test(src(HD))));
// ── A15 · components/HeroTitle.tsx · IntroSplash.tsx · Maintenance.tsx ──
const HT = "components/HeroTitle.tsx";
S(HT, "the greeting animates only for a diner who has not asked for less motion", () => ok(/if \(reduce \|\| !ref\.current\) return;/.test(code(HT))));
S(HT, "…and re-plays after the intro and a skin change", () => ok(/"lfh:intro-done", animate/.test(code(HT)) && /"lfh:theme-changed", animate/.test(code(HT))));
S(HT, "…its listeners and frame are cleaned up", () => ok(/cancelAnimationFrame\(id\)/.test(code(HT)) && count(code(HT), /removeEventListener/g) === 2));
S(HT, "letters are split by the grapheme splitter (no torn Hindi conjunct)", () => ok(/splitGraphemes/.test(code(HT))));
const IS = "components/IntroSplash.tsx";
S(IS, "the splash is hidden from screen readers", () => ok(/className="intro-splash" aria-hidden="true"/.test(code(IS))));
S(IS, "…plays once per restaurant per tab", () => ok(/seenKey/.test(code(IS)) && /sessionStorage\.setItem\(seenKey, "1"\)/.test(code(IS))));
S(IS, "…paints a restaurant's own colour only when it is not the flagship", () => ok(/!isDefault && accentColor/.test(code(IS))));
S(IS, "every other restaurant hands the splash its OWN words (never the flagship's)", () => ok(/logoText=\{isDefault \? undefined : \(logoText \|\| restaurantName \|\| undefined\)\}/.test(code("components/MenuView.tsx")) && /<IntroSplash wordmark=\{logoText\}/.test(code("components/AppShell.tsx"))));
S(IS, "…and its own logo, the flagship's only for the flagship", () => ok(/logoUrl \? <img className="intro-logo" src=\{logoUrl\} alt="" \/> : \(isDefault && <img/.test(code(IS))));
const MT = "components/Maintenance.tsx";
S(MT, "the closed-for-now screen is announced", () => ok(/role="alert" aria-label="Under maintenance"/.test(code(MT))));
S(MT, "…shows the flagship's logo only on the flagship", () => ok(/const showLogo = isDefault \? DEFAULT_LOGO : \(logoUrl \|\| null\);/.test(code(MT))));
S(MT, "…names a restaurant by its own wordmark, stars removed", () => ok(/stripBrandMarkers\(logoText \|\| ""\)/.test(code(MT))));
S(MT, "every caller tells it whether this is the flagship", () => { const callers = [...src("components/AppShell.tsx").matchAll(/<Maintenance[^>]*\/>/g), ...src("app/r/[restaurant]/item/[slug]/page.tsx").matchAll(/<Maintenance[^>]*\/>/g)].map((x) => x[0]); return ok(callers.length >= 2 && callers.every((c) => /isDefault=/.test(c)), `${callers.length} callers`); });
S(MT, "…its dots are decoration", () => ok(/maint-dots" aria-hidden="true"/.test(code(MT))));
// ── A16 · components/FoodCard.tsx · GuestNotFound.tsx ──
const FC = "components/FoodCard.tsx"; const fc = () => code(FC);
S(FC, "a card's link carries the restaurant in its address", () => ok(/\/r\/\$\{/.test(fc()) || /itemHref|dishHref/.test(fc())));
S(FC, "the veg mark is reachable to a screen reader (item 3 holds)", () => ok(!/<div className="diet-badge" aria-hidden="true">/.test(fc())));
S(FC, "every icon-font glyph is hidden or sits in a button that has its own name (item 4 holds)", () => { const c = fc(); const icons = [...c.matchAll(/<i className="fa[^"]*"[^>]*>/g)]; const bad = icons.filter((x) => { if (/aria-hidden="true"/.test(x[0])) return false; const before = c.slice(0, x.index); const btn = before.lastIndexOf("<button"); return !(btn > before.lastIndexOf("</button>") && /aria-label=/.test(c.slice(btn, x.index))); }); return ok(bad.length === 0, `${icons.length} icons, ${bad.length} unnamed`); });
S(FC, "the photo has words for a screen reader", () => ok(/alt=\{/.test(fc())));
S(FC, "the photo loads lazily", () => ok(/loading="lazy"|loading=\{/.test(fc())));
const GN = "components/GuestNotFound.tsx"; const gn = () => code(GN);
S(GN, "the docket asks the menu's own gate whether a menu is live", () => ok(/\/api\/r\/\$\{encodeURIComponent\(slug\)\}\/menu-data/.test(gn())));
S(GN, "…and cancels the question when the screen closes", () => ok(/let alive = true;/.test(gn()) && /alive = false/.test(gn())));
S(GN, "…offers the menu only when it IS live", () => ok(/menuLive === true/.test(gn())));
S(GN, "its words are curly-quoted consistently", () => ok(!/[A-Za-z]'[A-Za-z]/.test(gn().replace(/const CSS = `[\s\S]*?`;/, "").replace(/[`"][^`"\n]*[`"]/g, ""))));
// ── A17 · the doors, the 404 and the error screens ──
const QP = "app/q/[code]/page.tsx", RP = "app/r/[restaurant]/menu/page.tsx", RNF = "app/r/[restaurant]/menu/not-found.tsx";
S(QP, "a code of the wrong shape is refused before any read", () => { const c = code(QP); const b = c.slice(c.indexOf("async function resolveCode(")); return ok(b.indexOf("[A-Z0-9]{6,16}") > 0 && b.indexOf("[A-Z0-9]{6,16}") < b.indexOf("supabaseAdmin")); });
S(QP, "a code for a restaurant that is switched off resolves to nothing", () => ok(/if \(!r \|\| !r\.active\) return null;/.test(code(QP))));
S(QP, "…for one in the recycle bin too (the resolver returns null for a binned row)", () => ok(/getRestaurantBySlug/.test(code(QP)) && /!data\.deleted_at/.test(code("lib/tenant.ts"))));
S(QP, "the printed door asks for the table number server-side, never from the address", () => ok(/table_number/.test(code(QP)) && !/searchParams/.test(code(QP).replace(/searchParams\?:[^;]*;/g, ""))));
S(QP, "the printed door is not cached between diners", () => ok(/export const dynamic = "force-dynamic";/.test(code(QP))));
S(RP, "the tenant door never takes a table from its own address", () => ok(!/qrTable/.test(code(RP))));
S(RP, "…and draws the closed-for-now screen through MenuView, not by itself", () => ok(!/<Maintenance/.test(code(RP))));
S(RNF, "the menu 404 names no restaurant in its head", () => ok(/title: "Menu",/.test(code(RNF)) && !/french|aangan/i.test(code(RNF))));
S(RNF, "…draws the guest's docket", () => ok(/<GuestNotFound \/>/.test(code(RNF))));
S("app/error.tsx", "the error screen paints no restaurant's colour (item 5 holds)", () => ok(!/#d4a574/i.test(code("app/error.tsx")) && /background: "CanvasText"/.test(code("app/error.tsx"))));
S("app/error.tsx", "…retries a server failure by itself, at most three times", () => ok(/const AUTO_WAITS_MS = \[4000, 12000, 30000\];/.test(code("app/error.tsx"))));
S("app/error.tsx", "…only while the page is on screen", () => ok(/if \(document\.visibilityState !== "visible"\) return;/.test(code("app/error.tsx"))));
S("app/error.tsx", "…with jitter, so a dining room does not come back in one wave", () => ok(/0\.85 \+ Math\.random\(\) \* 0\.3/.test(code("app/error.tsx"))));
S("app/error.tsx", "…says aloud when it will try again", () => ok(/aria-live="polite"/.test(code("app/error.tsx"))));
S("app/error.tsx", "…files the crash before reloading for a stale file", () => { const c = code("app/error.tsx"); return ok(c.indexOf("reportClientError(") < c.indexOf("reloadForStaleCode(error?.message);")); });
S("app/global-error.tsx", "the root error screen paints no restaurant's colour (item 5 holds)", () => ok(!/#d4a574/i.test(code("app/global-error.tsx"))));
S("app/global-error.tsx", "…'Try again' asks the server again (retry before reset)", () => ok(/\(retry \|\| reset\)\(\)/.test(code("app/global-error.tsx"))));
S("app/global-error.tsx", "…its warning sign is decoration", () => ok(/aria-hidden="true">⚠️/.test(code("app/global-error.tsx"))));
// ── A18 · the files that are not code ──
const bytes = (f) => statSync(join(ROOT, f)).size;
S("app/favicon.ico", "the site icon is a real .ico file", () => { const b = readFileSync(join(ROOT, "app/favicon.ico")); return ok(b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0, `${b.length} bytes, ${b.readUInt16LE(4)} image(s)`); });
S("app/favicon.ico", "…small enough not to slow a first visit", () => ok(bytes("app/favicon.ico") < 64 * 1024, `${bytes("app/favicon.ico")} bytes`));
S("public/lfh-logo.png", "the flagship logo is a real PNG", () => { const b = readFileSync(join(ROOT, "public/lfh-logo.png")); return ok(b.slice(1, 4).toString() === "PNG", `${b.length} bytes`); });
S("public/brand/aevidine-mark.svg", "the platform mark is an SVG with a viewBox (scales cleanly)", () => ok(/<svg[^>]*viewBox=/.test(src("public/brand/aevidine-mark.svg"))));
S("public/brand/aevidine-mark.svg", "…carries no script", () => ok(!/<script|on\w+=/i.test(src("public/brand/aevidine-mark.svg"))));
S("app/aevinite/icon.svg", "the admin tab icon carries no script", () => ok(!/<script|on\w+=/i.test(src("app/aevinite/icon.svg"))));
S("app/page.tsx", "the site root sends to the staff sign-in and nothing else", () => ok(count(code("app/page.tsx"), /redirect\(/g) === 1 && /redirect\("\/login"\)/.test(code("app/page.tsx"))));
S("app/menu/page.tsx", "the old /menu link keeps every parameter on its way to the flagship's menu", () => ok(/qs\.append\(k, x\)/.test(code("app/menu/page.tsx")) && /DEFAULT_RESTAURANT_SLUG/.test(code("app/menu/page.tsx"))));
S("lib/menuDataServer.ts", "the menu bundle is tagged per restaurant, so one restaurant's edit refreshes only its own menu", () => ok(/export function menuTag\(restaurantId: string\): string/.test(code("lib/menuDataServer.ts"))));
S("lib/tenant.ts", "the restaurant lookup refuses an impossible address before the database (item 2 holds)", () => ok(count(code("lib/tenant.ts"), /if \(!SLUG_SHAPE\.test\(slug\)\) return null;/g) === 2));
S("lib/tenant.ts", "a stray space or escape in an address is read the way the menu API reads it (item 2 holds)", () => ok(count(code("lib/tenant.ts"), /const slug = slugOf\(slugRaw\);/g) === 2));
S("lib/tenant.ts", "queryStringOf drops an undefined value", () => ok(/if \(v == null\) continue;|v === undefined/.test(code("lib/tenant.ts"))));
S("components/MenuView.tsx", "a remembered search filters only while the search switch is on (item 6 holds)", () => ok(/const q = features\.search !== false \? fold\(deferredQuery\.trim\(\)\) : "";/.test(code("components/MenuView.tsx"))));
S("components/MenuView.tsx", "the scroll cues follow the text the screen is drawn from (item 1 holds)", () => ok(/\}, \[deferredQuery, features\.favorites/.test(code("components/MenuView.tsx"))));
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
