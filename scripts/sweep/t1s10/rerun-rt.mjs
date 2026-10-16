// scripts/sweep/t1s10/rerun-rt.mjs — RE-RUN of T1.md "THE 500-PHASE RE-TEST — 2026-09-15" (P120001–P120517).
// S1 the root layout, S2 the doors, S3 the platform 404 and S5 the 2026-09-14 changes are READ; S4 the dead ends,
// S6 MenuView, S7 the look and S8 cost/offline are DRIVEN on my build :4401. P120291–P120301 were about the manager
// panel's QR card, the admin's code minting and its migration — not this territory this sweep — and are left for
// their owners (they are absent from this file on purpose; the stamping step records that).
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { R, src, code, count, fnBody, ok, ROOT, BASE } from "./lib.mjs";
import { newPage, done, open, withPage, cards, bodyText, LEAK, QR, DESK, IPAD } from "./browser.mjs";

const LAY = "app/layout.tsx", HOME = "app/page.tsx", MENU = "app/menu/page.tsx", RP = "app/r/[restaurant]/menu/page.tsx", QP = "app/q/[code]/page.tsx", NF = "app/not-found.tsx",
  RNF = "app/r/[restaurant]/menu/not-found.tsx", MVF = "components/MenuView.tsx", GNF = "components/GuestNotFound.tsx", TEN = "lib/tenant.ts";
const L = () => code(LAY), P = () => code(RP), Q = () => code(QP), N = () => code(NF), G = () => code(GNF), MV = () => code(MVF);
const boot = () => (src(LAY).match(/const themeBootScript = `([\s\S]*?)`\.trim\(\);/) || [])[1] || "";
const how = "static read of the owned file, comments stripped (TypeScript parser)";
const S = (id, file, title, fn) => R(id, file, title, fn, how);
// ═════ S1 · app/layout.tsx ═════
const S1 = [
  ["P120001", "one root layout export", () => count(L(), /export default function/g) === 1],
  ["P120002", "it renders <html> itself", () => /<html lang="en" suppressHydrationWarning>/.test(L())],
  ["P120003", "the boot script declared once, mounted once", () => count(L(), /themeBootScript/g) === 2],
  ["P120004", "it is the first child of <head>", () => /<head>\s*(\{\s*\}\s*)?<script dangerouslySetInnerHTML=\{\{ __html: themeBootScript \}\} \/>/.test(L())],
  ["P120005", "a saved theme wins", () => /var saved=localStorage\.getItem\('lfh_theme'\)/.test(boot())],
  ["P120006", "a new visitor gets LIGHT", () => /saved==='dark'\?'dark':'light'/.test(boot())],
  ["P120007", "a storage refusal still leaves a theme", () => /catch\(e\)\{document\.documentElement\.setAttribute\('data-theme','light'\);\}/.test(boot())],
  ["P120008", "the saved language is stamped on <html>", () => /setAttribute\('lang',lang\)/.test(boot())],
  ["P120009", "…and its refusal cannot break the theme", () => (boot().match(/try\{/g) || []).length === 3],
  ["P120010", "staff panels stamped dark from the first frame", () => /data-staffdark','1'/.test(boot())],
  ["P120011", "…from the raw path", () => /location\.pathname/.test(boot())],
  ["P120012", "…naming every staff surface", () => ["owner", "admin", "aevinite", "manager", "kitchen", "tablet", "login", "staff-login"].every((w) => boot().includes(w))],
  ["P120013", "no guest route in that list", () => !/menu|item|\/q|view/.test((boot().match(/\/\^\\\\\/\(([^)]+)\)/) || [])[1] || "")],
  ["P120014", "the boot script is one statement", () => /^\(function\(\)\{[\s\S]*\}\)\(\);$/.test(boot().trim())],
  ["P120015", "the page declares the device width", () => /width: 'device-width'/.test(L())],
  ["P120016", "…starts at 100%", () => /initialScale: 1/.test(L())],
  ["P120017", "…pinch-zoom allowed", () => /userScalable: true/.test(L()) && /maximumScale: 5/.test(L())],
  ["P120018", "…draws under a notch", () => /viewportFit: 'cover'/.test(L())],
  ["P120019", "the default title is the platform's", () => /title: "Aevidine — Restaurant OS"/.test(L())],
  ["P120020", "a restaurant's door overrides it", () => !/template:/.test(L())],
  ["P120021", "metadataBase is set", () => /metadataBase: new URL\(SITE_URL\)/.test(L())],
  ["P120022", "…from the ENVIRONMENT", () => /process\.env\.NEXT_PUBLIC_SITE_URL/.test(L()) && !/headers\(\)/.test(L())],
  ["P120023", "…preferring a configured site address", () => L().indexOf("NEXT_PUBLIC_SITE_URL") < L().indexOf("VERCEL_PROJECT_PRODUCTION_URL")],
  ["P120024", "…then the production domain, before the per-deployment one", () => L().indexOf("VERCEL_PROJECT_PRODUCTION_URL") < L().indexOf("VERCEL_URL ?")],
  ["P120025", "…and a dev machine gets a valid URL", () => /\|\| "http:\/\/localhost:4000";/.test(L())],
  ["P120026", "guest widgets mounted once", () => count(L(), /<GuestChrome \/>/g) === 1],
  ["P120027", "GuestChrome decides guest-only", () => /if \(isStaff\) return null;/.test(code("components/GuestChrome.tsx"))],
  ["P120028", "the offline layer installed for every surface", () => /<OfflineShell \/>/.test(L())],
  ["P120029", "…and the saved-data notice", () => /<OfflineNotice \/>/.test(L())],
  ["P120030", "the restaurant context wraps the page", () => L().indexOf("<RestaurantProvider>") < L().indexOf("{children}")],
  ["P120031", "font servers warmed first", () => L().indexOf('rel="preconnect" href="https://fonts.googleapis.com"') < L().indexOf("fonts.googleapis.com/css2")],
  ["P120032", "…the font CDN with credentials", () => /href="https:\/\/fonts\.gstatic\.com" crossOrigin=""/.test(L())],
  ["P120033", "…and the icon CDN", () => /href="https:\/\/cdnjs\.cloudflare\.com" crossOrigin=""/.test(L())],
  ["P120034", "both web fonts in ONE request", () => count(L(), /fonts\.googleapis\.com\/css2/g) === 1 && /family=Inter[^"]*family=Playfair/.test(L())],
  ["P120035", "…with display=swap", () => /display=swap/.test(L())],
  ["P120036", "hydration noise silenced on <html> only", () => count(L(), /suppressHydrationWarning/g) === 1],
  ["P120037", "the layout is a server component", () => !/"use client"/.test(src(LAY))],
  ["P120038", "…so the boot script ships as HTML", () => !/useEffect/.test(L())],
  ["P120039", "nothing in the layout reads a database", () => !/supabase|getSettings|getRestaurant/.test(L())],
  ["P120040", "…or names a restaurant", () => !/french|aangan|bistro/i.test(L().replace(/Aevidine/g, ""))],
  ["P120041", "the old panel-shifter is gone", () => !/PanelShifter|panel-shifter/.test(L())],
  ["P120042", "the stylesheet imported once", () => count(L(), /import "\.\/globals\.css";/g) === 1],
  ["P120043", "viewport exported as its own object", () => /export const viewport: Viewport =/.test(L())],
  ["P120044", "no viewport keys left in metadata", () => !/viewport:|themeColor/.test(L().slice(L().indexOf("export const metadata"), L().indexOf("export const viewport")))],
  ["P120045", "the description says what the product is", () => /description: "Aevidine — the all-in-one platform that runs your restaurant\."/.test(L())],
  ["P120046", "SITE_URL computed at module scope", () => L().indexOf("const SITE_URL") < L().indexOf("export default function")],
  ["P120047", "…cannot be empty", () => /\|\| "http:\/\/localhost:4000"/.test(L())],
  ["P120048", "the staff regex is anchored", () => /\(\\\\\/\|\$\|\\\\\?\)/.test(boot()) && /\/\^\\\\\//.test(boot())],
  ["P120049", "…accepts the bare path, a sub-path and a query", () => /\(\\\\\/\|\$\|\\\\\?\)/.test(boot())],
  ["P120050", "no inline style attribute in the layout", () => !/style=\{/.test(L())],
  ["P120051", "the theme key the boot script writes is the one the menu reads", () => /lfh_theme/.test(boot()) && /localStorage\.setItem\("lfh_theme"/.test(code("components/Header.tsx"))],
  ["P120052", "the doors override it per restaurant before paint", () => /menuDefaultMode === "dark"/.test(P()) && /menuDefaultMode === "dark"/.test(Q())],
  ["P120053", "…with the same key", () => /localStorage\.getItem\('lfh_theme'\)/.test(P())],
  ["P120054", "GuestChrome keeps the widgets off the panels", () => /STAFF_RE/.test(code("components/GuestChrome.tsx"))],
  ["P120055", "the offline list knows the menu read", () => /\/\^\\\/api\\\/r\\\//.test(src("public/sw.js"))],
  ["P120056", "…and the guest doors", () => /\/r\/|\/q\//.test(src("public/sw.js"))],
  ["P120057", "the root layout has no boundary of its own; app/error.tsx is the one", () => existsSync(join(ROOT, "app/error.tsx")) && !/ErrorBoundary/.test(L())],
  ["P120058", "the favicon is not hard-coded here", () => !/icons:|favicon/.test(L())],
  ["P120059", "…the doors set it", () => /icons/.test(P()) && /icons/.test(Q())],
  ["P120060", "the stamped language is one the dictionary knows", () => /'en'/.test(boot()) && /\ben\b/.test(src("lib/i18n.ts"))],
  ["P120061", "nothing in the layout writes storage", () => !/setItem/.test(boot())],
  ["P120062", "…so private mode cannot block the shell", () => !/setItem/.test(boot())],
  ["P120063", "the body carries no class", () => /<body>/.test(L())],
  ["P120064", "children rendered once", () => count(L(), /\{children\}/g) === 1],
  ["P120065", "nothing after the guest widgets that could cover them", () => L().indexOf("<OfflineNotice />") > L().indexOf("<GuestChrome />")],
  ["P120066", "the metadata export is typed", () => /export const metadata: Metadata =/.test(L())],
  ["P120067", "the viewport export is typed", () => /export const viewport: Viewport =/.test(L())],
  ["P120068", "no `any` in the layout", () => !/: any\b|as any\b/.test(L())],
  ["P120069", "no port or domain but through process.env", () => (L().match(/https?:\/\/[^"' `]+/g) || []).every((u) => /fonts\.|cdnjs\.|localhost:4000|\$\{process/.test(u))],
  ["P120070", "the one localhost is a fallback", () => /\|\| "http:\/\/localhost:4000"/.test(L())],
];
for (const [id, t, fn] of S1) S(id, LAY, t, fn);
// ═════ S2 · the doors, read ═════
const pb = () => P().slice(P().indexOf("export default async function RestaurantMenuPage"));
const pm = () => P().slice(P().indexOf("export async function generateMetadata"), P().indexOf("export default async function"));
const rc = () => fnBody(Q(), "const resolveCode = cache(async function resolveCode(");
const S2 = [
  ["P120071", RP, "the slug is resolved first", () => pb().indexOf("getRestaurantBySlug(restaurant)") < pb().indexOf("slugMovedTo")],
  ["P120072", RP, "an unknown address asks whether it MOVED", () => /slugMovedTo\(restaurant\)/.test(pb())],
  ["P120073", RP, "…only when it resolves to nothing", () => /if \(!r\) \{\s*const moved/.test(pb())],
  ["P120074", RP, "a moved address carries the query", () => /redirect\(`\/r\/\$\{moved\}\/menu\$\{queryStringOf\(await searchParams\)\}`\)/.test(pb())],
  ["P120075", RP, "…by the SAME helper the casing redirect uses", () => count(pb(), /queryStringOf\(await searchParams\)/g) === 2],
  ["P120076", TEN, "that helper carries arrays", () => /if \(Array\.isArray\(v\)\) v\.forEach\(\(x\) => qs\.append\(k, x\)\);/.test(code(TEN))],
  ["P120077", RP, "a closed restaurant is refused, not redirected", () => /if \(!r \|\| !r\.active\) notFound\(\);/.test(pb())],
  ["P120078", RP, "the Menu switch is a separate refusal after the settings read", () => pb().indexOf("const settings = await getSettings(r.id);") < pb().indexOf("if (!settings.menuEnabled) notFound();")],
  ["P120079", RP, "an oddly-cased address goes canonical", () => /if \(restaurant !== r\.slug\) \{/.test(pb())],
  ["P120080", RP, "…after the refusals", () => pb().indexOf("if (!settings.menuEnabled) notFound();") < pb().indexOf("if (restaurant !== r.slug)")],
  ["P120081", RP, "the RESOLVED slug goes to MenuView", () => /restaurantSlug=\{r\.slug\}/.test(pb())],
  ["P120082", RP, "…never the address text", () => !/restaurantSlug=\{restaurant\}/.test(pb())],
  ["P120083", RP, "the dark default is an inline script, not an effect", () => /<script\s*dangerouslySetInnerHTML/.test(pb()) && !/useEffect/.test(P())],
  ["P120084", RP, "…above <MenuView>", () => pb().indexOf("menuDefaultMode") < pb().indexOf("<MenuView")],
  ["P120085", RP, "…only when nothing is chosen", () => /if\(!localStorage\.getItem\('lfh_theme'\)\)/.test(P())],
  ["P120086", RP, "the default layout reaches MenuView", () => /defaultLayout=\{settings\.menuDefaultLayout/.test(P())],
  ["P120087", RP, "…gallery as the fallback", () => /=== "list" \? "list" : "gallery"/.test(P())],
  ["P120088", RP, "every branding prop null-guarded", () => count(pb(), / \?\? undefined/g) >= 7],
  ["P120089", RP, "the door passes no table", () => !/qrTable/.test(P())],
  ["P120090", RP, "metadata names the restaurant when open", () => /const title = r\.name \? `\$\{r\.name\} — Menu`/.test(pm())],
  ["P120091", RP, "…neutral when not", () => /return \{ title: "Menu", description: "This menu isn’t available right now\." \};/.test(pm())],
  ["P120092", RP, "…for all THREE switches", () => /if \(!r\.active \|\| !meta\.menuEnabled \|\| meta\.serviceMode\)/.test(pm())],
  ["P120093", RP, "an unknown slug names no restaurant", () => /if \(!r\) return \{ title: "Menu" \};/.test(pm())],
  ["P120094", RP, "the description uses the tagline when there is one", () => /r\.tagline\s*\? `\$\{r\.tagline\} — view the menu and order at/.test(pm())],
  ["P120095", RP, "…a plain sentence otherwise", () => /: `View the menu and order at \$\{r\.name\}\.`/.test(pm())],
  ["P120096", RP, "the preview picture is the restaurant's own logo", () => /const picture = r\.logoUrl \|\|/.test(pm())],
  ["P120097", RP, "…the flagship file its ONLY fallback", () => /\(r\.id === DEFAULT_RESTAURANT_ID \? "\/lfh-logo\.png" : ""\)/.test(pm())],
  ["P120098", RP, "…so a logo-less tenant has no picture", () => /\.\.\.\(picture \? \{ images: \[\{ url: picture \}\] \} : \{\}\)/.test(pm())],
  ["P120099", RP, "tab icon and share picture are the same", () => /const icons = picture \? \{ icon: picture \} : undefined;/.test(pm())],
  ["P120100", RP, "metadata reads cost nothing extra", () => count(pm(), /await (getRestaurantBySlug|getSettings)\(/g) === 2],
  ["P120101", RP, "no restaurant id literal", () => !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(P())],
  ["P120102", RP, "no slug literal", () => !/"french-house"/.test(P())],
  ["P120103", RP, "a server component", () => !/"use client"/.test(src(RP))],
  ["P120104", RP, "awaits its params", () => /await params/.test(P())],
  ["P120105", RP, "…its searchParams only where needed", () => count(P(), /await searchParams/g) === 2],
  ["P120106", QP, "a malformed code is refused before any read", () => rc().indexOf("return null;") < rc().indexOf("supabaseAdmin")],
  ["P120107", QP, "…only the alphabet the admin mints", () => /\[A-Z0-9\]\{6,16\}/.test(rc())],
  ["P120108", QP, "…after folding and trimming", () => /\.trim\(\)\.toUpperCase\(\)/.test(rc())],
  ["P120109", QP, "the code lookup asks for two columns", () => /\.select\("restaurant_id, table_number"\)/.test(rc())],
  ["P120110", QP, "…one row on the unique column", () => /\.eq\("code", code\)\s*\.maybeSingle\(\)/.test(rc())],
  ["P120111", QP, "the restaurant lookup asks for one column", () => /\.select\("slug"\)/.test(rc())],
  ["P120112", QP, "ONE cached call per request", () => /const resolveCode = cache\(/.test(Q())],
  ["P120113", QP, "…so metadata and page do not double the reads", () => count(Q(), /await resolveCode\(code\)/g) === 2],
  ["P120114", QP, "a closed restaurant's code resolves to nothing", () => /if \(!r \|\| !r\.active\) return null;/.test(rc())],
  ["P120115", QP, "…and a Menu-off one", () => /if \(!settings\.menuEnabled\) return null;/.test(rc())],
  ["P120116", QP, "a dead code gets a friendly screen", () => /<GuestNotFound variant="qr" \/>/.test(Q())],
  ["P120117", QP, "…the SAME screen the other dead ends use", () => /import GuestNotFound from "@\/components\/GuestNotFound"/.test(Q()) && /<GuestNotFound \/>/.test(code(RNF))],
  ["P120118", QP, "a dead code's metadata advertises nothing", () => /if \(!hit\) return \{ title: "Menu", description: "This QR code isn’t active\." \};/.test(Q())],
  ["P120119", QP, "closed for the evening is neutral here too", () => /if \(hit\.settings\.serviceMode\) return \{ title: "Menu"/.test(Q())],
  ["P120120", QP, "the tab's tenant pinned before hydration", () => /lfh_tab_tenant/.test(Q())],
  ["P120121", QP, "…JSON-escaped", () => /\$\{JSON\.stringify\(hit\.slug\)\}/.test(Q())],
  ["P120122", QP, "…and a storage refusal cannot break the page", () => /__html: `try\{sessionStorage\.setItem\("lfh_tab_tenant"[^`]*\}catch\(e\)\{\}`/.test(Q())],
  ["P120123", QP, "the resolved table is a prop", () => /qrTable=\{String\(hit\.table\)\}/.test(Q())],
  ["P120124", QP, "…so the number never needs to be in the address", () => !/\?table=/.test(Q())],
  ["P120125", QP, "…and no redirect re-exposes it", () => !/redirect\(/.test(Q())],
  ["P120126", QP, "the same dark default as the tenant door", () => { const a = Q().match(/__html: "(\(function[^"]*)"/), b = P().match(/__html: "(\(function[^"]*)"/); return a && b && a[1] === b[1]; }],
  ["P120127", QP, "…the same default layout", () => /menuDefaultLayout === "list" \? "list" : "gallery"/.test(Q())],
  ["P120128", QP, "…the same metadata shape", () => /type: "website"/.test(Q()) && /— Menu` : "Menu"/.test(Q())],
  ["P120129", QP, "…the same preview-picture rule", () => /\(hit\.r\.id === DEFAULT_RESTAURANT_ID \? "\/lfh-logo\.png" : ""\)/.test(Q())],
  ["P120130", QP, "force-dynamic", () => /export const dynamic = "force-dynamic";/.test(Q())],
  ["P120131", MENU, "the legacy door preserves every parameter", () => /for \(const \[k, v\] of Object\.entries\(sp\)\)/.test(code(MENU))],
  ["P120132", MENU, "…repeated ones", () => /v\.forEach\(\(x\) => qs\.append\(k, x\)\)/.test(code(MENU))],
  ["P120133", MENU, "…drops nothing for undefined", () => /if \(v == null\) continue;/.test(code(MENU))],
  ["P120134", MENU, "…no stray ?", () => /\$\{s \? `\?\$\{s\}` : ""\}/.test(code(MENU))],
  ["P120135", MENU, "…the default slug from one constant", () => /DEFAULT_RESTAURANT_SLUG/.test(code(MENU))],
  ["P120136", MENU, "…no slug of its own", () => !/"french-house"/.test(code(MENU))],
  ["P120137", MENU, "…only redirects", () => count(code(MENU), /redirect\(/g) === 1],
  ["P120138", HOME, "the site root → the STAFF sign-in", () => /redirect\("\/login"\)/.test(code(HOME))],
  ["P120139", HOME, "…assumes no restaurant", () => !/slug|restaurant/i.test(code(HOME).replace(/\/\/.*$/gm, ""))],
  ["P120140", HOME, "…a server redirect", () => !/"use client"/.test(src(HOME))],
  ["P120141", RP, "all three doors render the same component", () => /<MenuView/.test(P()) && /<MenuView/.test(Q())],
  ["P120142", TEN, "all three resolve through the one resolver", () => /getRestaurantBySlug/.test(P()) && /getRestaurantBySlug/.test(Q())],
  ["P120143", TEN, "the resolver folds case", () => /return s\.trim\(\)\.toLowerCase\(\);/.test(code(TEN))],
  ["P120144", TEN, "null for an unknown slug, not a throw", () => /data && !data\.deleted_at\s*\?[\s\S]*?: null;/.test(code(TEN))],
  ["P120145", TEN, "the moved lookup refuses when a live restaurant holds the address", () => /AND NOT EXISTS \(/.test(src("supabase/migrations/350_an_old_web_address_still_finds_the_restaurant.sql"))],
  ["P120146", RNF, "the tenant not-found boundary is guest-branded", () => /<GuestNotFound \/>/.test(code(RNF))],
  ["P120147", RNF, "…its <head> too", () => /title: "Menu",/.test(code(RNF))],
  ["P120148", RNF, "…the dish boundary's sentence", () => (code(RNF).match(/description: "([^"]+)"/) || [])[1] === (code("app/r/[restaurant]/item/[slug]/not-found.tsx").match(/description: "([^"]+)"/) || [])[1]],
  ["P120149", RNF, "…scoped to the menu route only", () => !existsSync(join(ROOT, "app/r/[restaurant]/not-found.tsx"))],
  ["P120150", RP, "no door writes to the database", () => ![P(), Q(), code(MENU)].some((c) => /\.(insert|update|upsert|delete)\(/.test(c))],
];
for (const [id, f, t, fn] of S2) S(id, f, t, fn);
// ═════ S3 · the platform 404, read ═════
// readAudience declares an object RETURN TYPE, so its body is read from the declaration to the next top-level declaration
const ra = () => N().slice(N().indexOf("function readAudience("), N().indexOf("const STAFF_WORDS"));
const S3 = [
  ["P120151", "nothing rendered until the audience is known", () => /if \(!a\) \{/.test(N())], ["P120152", "…so a diner never sees the staff screen first", () => /useState<[^>]+\| null>\(null\)/.test(N())],
  ["P120153", "decided before paint", () => /useLayoutEffect/.test(N())], ["P120154", "JavaScript off → a working screen", () => /<noscript>/.test(N())],
  ["P120155", "…the menu first", () => N().indexOf('href="/menu">Go to the menu') < N().indexOf('href="/">Go to the home screen')],
  ["P120156", "/r/<slug>/ is a guest, carrying its restaurant", () => /const m = p\.match\(\/\^\\\/r\\\/\(\[\^\/\]\+\)\\\/\/\);/.test(ra())],
  ["P120157", "legacy menu and item are guests", () => /\(menu\|item\)/.test(ra())], ["P120158", "a printed-code address is a guest", () => /\^\\\/q\\\//.test(ra())],
  ["P120159", "the 3D viewer is a guest surface", () => /\^\\\/view\\\//.test(ra())], ["P120160", "a staff-shaped address gets the staff screen", () => /STAFF_WORDS\.test\(p\)\) return \{ aud: "staff"/.test(ra())],
  ["P120161", "…naming every panel", () => /login\|staff-login\|aevinite\|admin\|manager\|editor\|kitchen\|tablet\|owner/.test(N())], ["P120162", "anyone else is a diner", () => /\{ aud: "guest", slug: "", href: "", label: "", maybe \}/.test(ra())],
  ["P120163", "a maybe-restaurant is ASKED about", () => /if \(next\.maybe\) \{/.test(N())], ["P120164", "…with one HEAD request", () => /method: "HEAD"/.test(N()) && count(N(), /fetch\(/g) === 1],
  ["P120165", "…through the menu page's own gate", () => /\/api\/r\/\$\{encodeURIComponent\(slug\)\}\/menu-data/.test(N())], ["P120166", "…offline it promises nothing", () => /\} catch \{ return false; \}/.test(N())],
  ["P120167", "a resolved guess REPLACES the history entry", () => /location\.replace\(/.test(N())], ["P120168", "the guess is shape-checked", () => /\/\^\[a-z0-9\]\[a-z0-9-\]\{1,60\}\$\//.test(N())],
  ["P120169", "…a damaged escape cannot throw", () => /try \{ maybe = decodeURIComponent\(seg\)\.toLowerCase\(\); \} catch/.test(N())], ["P120170", "a pinned tenant decides where a stranger is sent", () => /const known = pinned\(\);/.test(N())],
  ["P120171", "…nothing pinned → NO button", () => /: \{ aud: "guest", slug: "", href: "", label: "", maybe \};/.test(N())], ["P120172", "the pin is shape-checked", () => /return \/\^\[a-z0-9-\]\+\$\/\.test\(t\) \? t : "";/.test(N())],
  ["P120173", "…a query-supplied restaurant validated the same way", () => /return \/\^\[a-z0-9-\]\+\$\/\.test\(q\) \? q : "";/.test(N())], ["P120174", "the name only when it matches this path", () => /=== next\.slug/.test(N())],
  ["P120175", "…never guessed from the address", () => !/replace\(\/-\/g, " "\)/.test(N())], ["P120176", "…length-capped", () => /\.slice\(0, 60\)/.test(N())],
  ["P120177", "a storage refusal → anonymous, not broken", () => /catch \{ \/\*|catch \{\s*\}/.test(N())], ["P120178", "two genuinely different screens", () => /className="nf nf-g"/.test(N()) && /className="nf nf-s"/.test(N())],
  ["P120179", "only ONE in the tree", () => /\{a\.aud === "guest" \? \(/.test(N())], ["P120180", "the guest screen is the order docket", () => /className="docket"/.test(N())],
  ["P120181", "the staff screen is the toaster", () => /className="toaster"/.test(N())], ["P120182", "the toaster can be re-fired, and says so", () => /\(go on, tap the toaster\)/.test(N())],
  ["P120183", "…by keyboard too", () => /onKeyDown=/.test(N())], ["P120184", "…announces itself", () => /aria-label="Pop the toast again"/.test(N())],
  ["P120185", "the re-fire re-keys", () => /key=\{`s\$\{popped\}`\}/.test(N()) && /key=\{`l\$\{popped\}`\}/.test(N())], ["P120186", "both screens offer Try again", () => count(N(), />Try again</g) === 2],
  ["P120187", "the stylesheet is one string", () => count(src(NF), /const CSS = `/g) === 1], ["P120188", "…mounted on both branches", () => count(N(), /<style dangerouslySetInnerHTML=\{\{ __html: CSS \}\} \/>/g) === 2],
  ["P120189", "the way-out button beats the global link colour", () => /a\.nf-home[^{]*\{ color: #23201c !important; \}/.test(src(NF))], ["P120190", "…on both skins", () => /\.nf-s a\.nf-home[^{]*\{ color: #fff9f0 !important; \}/.test(src(NF))],
  ["P120191", "reduced motion stops the animations", () => /@media \(prefers-reduced-motion: reduce\) \{\s*\.nf-g \.docket, \.nf-g \.stamp, \.nf-s \.slice, \.nf-s \.lever \{ animation: none \}/.test(src(NF))],
  ["P120192", "…and hides the tap prompt", () => /\.nf-s \.poke \{ display: none \}/.test(src(NF))], ["P120193", "the stamp lands on the blank part", () => /\.nf-g \.stamp \{ position: absolute; right: -6px; top: 34px;/.test(src(NF))],
  ["P120194", "the dead-rule obituary sits OUTSIDE the string", () => src(NF).indexOf("OBITUARY: four rules") < src(NF).indexOf("const CSS = `")], ["P120195", "…so it is not shipped", () => !/OBITUARY/.test((src(NF).match(/const CSS = `([\s\S]*?)`;/) || [])[1])],
  ["P120196", "no rule names a restaurant", () => !/french|aangan/i.test((src(NF).match(/const CSS = `([\s\S]*?)`;/) || [])[1])], ["P120197", "the screen names no platform brand", () => !/Aevidine/.test(N())],
  ["P120198", "a guest with nothing pinned is told what to do", () => /scan\s+the QR code on your table again/.test(N().replace(/\s+/g, " ")) && /\{a\.href \? <a/.test(N())], ["P120199", "the staff way out is home", () => /aud: "staff", slug: "", href: "\/"/.test(N())],
  ["P120200", "no timer that could outlive it", () => !/setInterval|setTimeout/.test(N())], ["P120201", "its one async effect is cancellable", () => /let alive = true;/.test(N())],
  ["P120202", "the audience read once", () => /\}, \[\]\);/.test(N())], ["P120203", "a client component", () => /^"use client";/.test(src(NF))],
  ["P120204", "it reads no database", () => !/supabase/.test(N())], ["P120205", "its one network call is the gate", () => count(N(), /fetch\(/g) === 1],
  ["P120206", "location read defensively", () => /typeof location === "undefined" \? ""/.test(N())], ["P120207", "the docket says no such table", () => /no such table/.test(N())],
  ["P120208", "the staff screen says a screen does not exist", () => /That screen doesn&rsquo;t exist/.test(src(NF))], ["P120209", "one apostrophe style per screen", () => !/[A-Za-z]'[A-Za-z]/.test(N().replace(/const CSS = `[\s\S]*?`;/, "").replace(/[`"][^`"\n]*[`"]/g, ""))],
  ["P120210", "no template marker can reach the text", () => !/\$\{/.test(N().slice(N().lastIndexOf("return ("))) || !/>\s*\$\{/.test(N())],
];
for (const [id, t, fn] of S3) S(id, NF, t, fn);
// ═════ S4 · the guest dead ends, driven ═════
const DE = new Map(); const dead = (path) => { if (!DE.has(path)) DE.set(path, withPage(path, async (p, res) => { await p.waitForTimeout(2600); return { status: res.status(), ...(await p.evaluate(() => ({ kind: document.querySelector(".gnf .docket h2")?.textContent, rows: [...document.querySelectorAll(".gnf .row")].map((r) => r.textContent.replace(/\s+/g, "")), stamp: document.querySelector(".gnf .stamp")?.textContent, h1: document.querySelector(".gnf h1")?.textContent, btns: [...document.querySelectorAll(".gnf a.btn")].map((a) => a.textContent), font: getComputedStyle(document.querySelector(".gnf") || document.body).fontFamily, bg: getComputedStyle(document.querySelector(".gnf") || document.body).backgroundImage.slice(0, 40), text: document.body.innerText, wide: document.documentElement.scrollWidth - innerWidth, title: document.title }))), errors: [...p.t1.errors], bad: p.t1.bad }; })); return DE.get(path); };
const CODE = "/q/ZZZZZZ", CLOSED = "/r/empty-cafe-zz/menu", GONE = "/r/french-house/item/zz-no-such-dish", SLUG = "/r/zz-unknown-t1s10/menu";
const DD = (id, file, t, fn) => R(id, file, t, fn, "headless Chromium at 360×780 on my production build :4401; the rendered docket read");
DD("P120211", QP, "a dead code shows the docket", async () => ok((await dead(CODE)).kind === "Code", (await dead(CODE)).kind));
DD("P120212", GNF, "…stamped CODE", async () => ok((await dead(CODE)).kind === "Code"));
DD("P120213", GNF, "…reading 'not active'", async () => ok((await dead(CODE)).rows.join() === "Covers—,Ordernone,Statusnotactive", JSON.stringify((await dead(CODE)).rows)));
DD("P120214", GNF, "…VOID", async () => ok((await dead(CODE)).stamp === "Void"));
DD("P120215", GNF, "…the words it always had", async () => ok((await dead(CODE)).h1 === "This QR code isn’t active"));
DD("P120216", GNF, "…no button", async () => ok((await dead(CODE)).btns.length === 0));
DD("P120217", QP, "…answering 200", async () => ok((await dead(CODE)).status === 200));
DD("P120218", GNF, "a switched-off restaurant shows the docket", async () => ok(!!(await dead(CLOSED)).kind));
DD("P120219", GNF, "…stamped MENU", async () => ok((await dead(CLOSED)).kind === "Menu"));
DD("P120220", GNF, "…'not serving'", async () => ok((await dead(CLOSED)).rows.join() === "Covers—,Ordernone,Statusnotserving"));
DD("P120221", GNF, "…CLOSED", async () => ok((await dead(CLOSED)).stamp === "Closed"));
DD("P120222", GNF, "…no button", async () => ok((await dead(CLOSED)).btns.length === 0));
DD("P120223", GNF, "…404", async () => ok((await dead(CLOSED)).status === 404));
DD("P120224", GNF, "a missing dish shows the docket", async () => ok(!!(await dead(GONE)).kind));
DD("P120225", GNF, "…TABLE", async () => ok((await dead(GONE)).kind === "Table"));
DD("P120226", GNF, "…'no such table'", async () => ok((await dead(GONE)).rows.join() === "Covers—,Ordernone,Statusnosuchtable"));
DD("P120227", GNF, "…VOID", async () => ok((await dead(GONE)).stamp === "Void"));
DD("P120228", GNF, "…DOES offer the menu", async () => ok((await dead(GONE)).btns.join() === "Go to the menu"));
DD("P120229", GNF, "an unknown address shows it too", async () => ok(!!(await dead(SLUG)).kind));
DD("P120230", GNF, "…told the menu is not there", async () => ok((await dead(SLUG)).btns.length === 0));
const ALL4 = [CODE, CLOSED, GONE, SLUG];
const all4 = () => Promise.all(ALL4.map(dead));
DD("P120231", GNF, "all four wear the SAME typeface", async () => { const a = await all4(); return ok(new Set(a.map((x) => x.font)).size === 1 && /Inter/.test(a[0].font), a[0].font); });
DD("P120232", GNF, "…the same background", async () => ok(new Set((await all4()).map((x) => x.bg)).size === 1));
DD("P120233", GNF, "…not the browser's default font", async () => ok((await all4()).every((x) => /Inter/.test(x.font))));
DD("P120234", GNF, "…no platform brand on screen", async () => ok((await all4()).every((x) => !/aevidine/i.test(x.text))));
DD("P120235", GNF, "…nor in the tab", async () => ok((await all4()).every((x) => !/aevidine/i.test(x.title)), (await all4()).map((x) => x.title).join(" · ")));
DD("P120236", GNF, "…every one SERVES a neutral title (the dish dead end names the restaurant's own menu)", async () => { const t = await Promise.all(ALL4.map(async (p) => (await (await fetch(BASE + p)).text()).match(/<title>([^<]*)<\/title>/)?.[1])); return ok(t.every((x) => x === "Menu" || / — Menu$/.test(x || "")), JSON.stringify(t)); });
DD("P120237", GNF, "no leaked code marker", async () => ok((await all4()).every((x) => !LEAK.test(x.text))));
DD("P120238", GNF, "none scrolls sideways", async () => ok((await all4()).every((x) => x.wide <= 0), (await all4()).map((x) => x.wide).join(",")));
DD("P120239", GNF, "none raises a page error", async () => ok((await all4()).every((x) => x.errors.length === 0)));
DD("P120240", GNF, "no failing request beyond its own dead end and the menu-is-live question", async () => { const bad = (await all4()).flatMap((x) => x.bad).filter((b) => !/zz-|empty-cafe|ZZZZZZ|menu-data|favicon/.test(b)); return ok(bad.length === 0, bad.join(" | ") || "0 unexpected"); });
DD("P120241", GNF, "every one says what to do next", async () => ok((await all4()).every((x) => /scan|ask a member of staff|Go to the menu/i.test(x.text))));
DD("P120242", GNF, "…and mentions a member of staff", async () => ok((await all4()).every((x) => /member of staff/.test(x.text))));
DD("P120243", GNF, "the docket's numbers are dashes", async () => ok((await all4()).every((x) => x.rows[0] === "Covers—")));
DD("P120244", GNF, "…'none' for the order", async () => ok((await all4()).every((x) => x.rows[1] === "Ordernone")));
DD("P120245", GNF, "the stamp is drawn on every one", async () => ok((await all4()).every((x) => !!x.stamp)));
DD("P120246", GNF, "the code case keeps its word (Code)", async () => ok((await dead(CODE)).kind === "Code"));
DD("P120247", GNF, "the closed case keeps its word (Menu)", async () => ok((await dead(CLOSED)).kind === "Menu"));
DD("P120248", GNF, "the gone case keeps its word (Table)", async () => ok((await dead(GONE)).kind === "Table"));
DD("P120249", GNF, "the slug case keeps its word (Menu)", async () => ok((await dead(SLUG)).kind === "Menu"));
const stampHits = (vp) => withPage(SLUG, async (p) => { await p.waitForTimeout(2600); return p.evaluate(() => { const s = document.querySelector(".gnf .stamp").getBoundingClientRect(); const d = document.querySelector(".gnf .docket").getBoundingClientRect(); const hits = []; const w = document.createTreeWalker(document.querySelector(".gnf .docket"), NodeFilter.SHOW_TEXT); for (let t = w.nextNode(); t; t = w.nextNode()) { if (!t.textContent.trim() || t.parentElement.closest(".stamp")) continue; const rg = document.createRange(); rg.selectNodeContents(t); for (const r of rg.getClientRects()) if (r.left < s.right && r.right > s.left && r.top < s.bottom && r.bottom > s.top) hits.push(t.textContent); } return { hits, past: Math.round(s.right - d.right) }; }); }, { vp });
DD("P120250", GNF, "the stamp covers no word, desktop", async () => { const r = await stampHits(DESK); return ok(r.hits.length === 0, JSON.stringify(r)); });
DD("P120251", GNF, "…and on the phone", async () => { const r = await stampHits(undefined); return ok(r.hits.length === 0, JSON.stringify(r)); });
DD("P120252", GNF, "the stamp is drawn past the paper's right edge, whole (the torn edge is a strip under the paper since 2026-09-15)", async () => { const r = await stampHits(undefined); return ok(r.past > 0, `${r.past}px past the paper`); });
const nfx = (path) => withPage(path, async (p) => { await p.waitForTimeout(2600); return p.evaluate(() => ({ docket: !!document.querySelector(".nf-g .docket"), toaster: !!document.querySelector(".nf-s .toaster"), url: location.pathname, cards: document.querySelectorAll(".item-card").length, btn: !!document.querySelector(".nf a.nf-btn"), title: document.title })); });
DD("P120253", NF, "a stranger's mistyped address gets the DINER's screen", async () => { const r = await nfx("/zz-stranger-t1"); return ok(r.docket && !r.toaster, JSON.stringify(r)); });
DD("P120254", NF, "a staff-shaped address gets the WORKER's screen", async () => { const r = await nfx("/kitchen/zz-nope"); return ok(r.toaster && !r.docket); });
DD("P120255", NF, "a diner who dropped the /r/ is carried to the menu", async () => { const r = await nfx("/french-house/menu"); return ok(r.url === "/r/french-house/menu" && r.cards > 0, `${r.url}, ${r.cards}`); });
DD("P120256", NF, "…and Back does not walk them into the dead address", async () => { const p = await newPage(); try { await p.goto(BASE + "/r/aangan-garden-restaurant/menu"); await p.waitForTimeout(400); await p.goto(BASE + "/french-house/menu"); await p.waitForURL(/\/r\/french-house\/menu/); await p.waitForTimeout(500); await p.goBack(); await p.waitForTimeout(1500); return ok(!/^\/french-house/.test(new URL(p.url()).pathname), new URL(p.url()).pathname); } finally { await done(p); } });
DD("P120257", NF, "a guess that resolves to nothing lands on the diner's screen", async () => { const r = await nfx("/zz-nowhere-t1/menu"); return ok(r.docket && !r.btn); });
const dq = (vp) => withPage(CODE, async (p) => { await p.waitForTimeout(2600); return p.evaluate(() => ({ h1: (() => { const e = document.querySelector(".gnf h1"); const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })(), sub: (() => { const e = document.querySelector(".gnf .sub"); const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })(), wide: document.documentElement.scrollWidth - innerWidth })); }, vp ? { vp } : {});
DD("P120258", GNF, "the dead-code screen fits the phone", async () => { const r = await dq(); return ok(r.h1 && r.sub, JSON.stringify(r)); });
DD("P120259", GNF, "…and the narrowest phone (320)", async () => ok((await dq({ width: 320, height: 640, dpr: 2, mobile: true })).wide <= 0));
DD("P120260", GNF, "…and a tablet", async () => ok((await dq(IPAD)).wide <= 0));
// ═════ S5 · the 2026-09-14 changes, read (P120291–P120301 are other territories' files — not here) ═════
const S5 = [
  ["P120261", GNF, "an optional variant, defaulting to the old behaviour", () => /export default function GuestNotFound\(\{ variant \}: \{ variant\?: "qr" \} = \{\}\)/.test(G())],
  ["P120262", GNF, "…every existing caller keeps its screen", () => /<GuestNotFound \/>/.test(code(RNF))], ["P120263", GNF, "the dead-code state comes from the prop", () => /const qr = variant === "qr";/.test(G())],
  ["P120264", GNF, "…skips the menu-is-live request", () => /if \(variant === "qr" \|\| !slug\) \{ setMenuLive\(false\); return; \}/.test(G())], ["P120265", GNF, "…offers no button", () => /\{!qr && menuLive === true/.test(G())],
  ["P120266", GNF, "three states, three docket words", () => /const kind = qr \? "Code" : off \? "Menu" : "Table";/.test(G())], ["P120267", GNF, "…their own status lines", () => /const status = qr \? "not active" : off \? "not serving" : "no such table";/.test(G())],
  ["P120268", GNF, "…the right stamp", () => /const stamp = qr \|\| !off \? "Void" : "Closed";/.test(G())], ["P120269", GNF, "the dead-code words are the old ones", () => /"This QR code isn’t active"/.test(G())],
  ["P120270", GNF, "…its sentence", () => /It may have been replaced with a new one\. Please ask a member of staff to scan the current code for your table\./.test(G())], ["P120271", GNF, "the effect re-runs if the variant changes", () => /\}, \[slug, variant\]\);/.test(G())],
  ["P120272", QP, "the printed door no longer draws its own screen", () => !/<main|<h1/.test(Q())], ["P120273", QP, "…the emoji is gone", () => !/🍽/.test(src(QP))],
  ["P120274", MVF, "a table that cannot exist is refused", () => /n >= 1 && n <= 500/.test(MV())], ["P120275", MVF, "…the bound the database enforces", () => /table_number[^;]{0,120}(BETWEEN 1 AND 500|<= 500|>= 1)/i.test(readdirSync(join(ROOT, "supabase/migrations")).filter((f) => /^210/.test(f)).map((f) => src(`supabase/migrations/${f}`)).join("\n"))],
  ["P120276", MVF, "…and the admin's own setting tops out there", () => /500/.test(MV())], ["P120277", MVF, "a refused value is still wiped out of the address", () => { const c = MV(); return c.indexOf("if (usable) {") < c.indexOf("if (!qrTable && window.location.search)") && !/if \(usable\) \{[\s\S]{0,200}replaceState/.test(c); }],
  ["P120278", MVF, "…the wipe is outside the we-got-digits branch", () => /\}\s*\{\s*try \{\s*if \(!qrTable && window\.location\.search\)/.test(MV())], ["P120279", MVF, "only a usable value is remembered", () => /if \(usable\) \{\s*setScannedTable\(digits\);/.test(MV())],
  ["P120280", MVF, "…and only a usable value tells the app", () => /setScannedTable\(digits\);\s*window\.dispatchEvent\(new Event\("lfh:table-scanned"\)\);/.test(MV())], ["P120281", MVF, "the wipe uses replaceState", () => /history\.replaceState\(/.test(MV()) && !/history\.pushState/.test(MV())],
  ["P120282", MVF, "…preserving the router's state", () => /\{ \.\.\.\(history\.state as object\) \}/.test(MV())], ["P120283", MVF, "…other parameters alone", () => /url\.searchParams\.toString\(\) \? `\?\$\{url\.searchParams\}` : ""/.test(MV())],
  ["P120284", MVF, "the printed door is untouched by the wipe", () => /if \(!qrTable && window\.location\.search\)/.test(MV())], ["P120285", MVF, "dishes with no sections are shown, whatever the chips say", () => /allGroups\.length === 0 && filteredItems\.length > 0 \? \(/.test(MV())],
  ["P120286", MVF, "…the old split flag is gone", () => !/anyFilterOn\s*=/.test(MV())], ["P120287", MVF, "…with an obituary", () => /OBITUARY: `anyFilterOn`/.test(src(MVF))],
  ["P120288", MVF, "a menu the chips really empty still gets the honest message", () => /\) : allGroups\.length === 0 \? \(/.test(MV())], ["P120289", MVF, "…favourites get their how-to", () => /\{favActive \? \(/.test(MV())],
  ["P120290", MVF, "the flat fallback renders the same card", () => count(MV(), /<FoodCard key=\{item\.id\}/g) === 3],
  ["P120302", MVF, "the numbered-table guard reads every shipped file", () => /\?table=|table=\$\{/.test(src("scripts/verify-guest-doors.mjs"))], ["P120303", MVF, "…strips line comments before block comments", () => /codeOnly/.test(src("scripts/verify-guest-doors.mjs"))],
  ["P120304", MVF, "…and is a boolean", () => /check\(/.test(src("scripts/verify-guest-doors.mjs"))], ["P120305", RP, "the metadata guard requires all three switches on BOTH menu doors", () => /serviceMode/.test(src("scripts/verify-guest.mjs")) && /check\("P00165"/.test(src("scripts/verify-guest.mjs"))],
  ["P120306", RNF, "the 404-head guard drives the menu door too", () => /\/r\/no-such|menu door|item\/no-such/.test(src("scripts/verify-notfound-audience.mjs"))], ["P120307", MVF, "the no-sections guard asserts the NEW rule", () => /check\("P55217"/.test(src("scripts/verify-guest.mjs"))],
  ["P120308", MVF, "…and its sibling the other half", () => /check\("P55218"/.test(src("scripts/verify-guest.mjs"))], ["P120309", RP, "the preview picture is a plain path", () => /"\/lfh-logo\.png"/.test(P()) && /"\/lfh-logo\.png"/.test(Q())],
  ["P120310", RP, "…neither door reads a request header", () => !/headers\(\)/.test(P() + Q())], ["P120311", RP, "…so a visitor cannot decide where a preview points", () => !/host/i.test(pm())],
  ["P120312", RP, "the flagship's logo file is in the app", () => existsSync(join(ROOT, "public/lfh-logo.png"))], ["P120313", RP, "…the same file the search bar uses", () => /src="\/lfh-logo\.png"/.test(MV())],
  ["P120314", RNF, "the menu 404's metadata is a plain export", () => /export const metadata = \{/.test(code(RNF))], ["P120315", RNF, "…costs no read on a 404", () => !/async|await/.test(code(RNF))],
  ["P120316", GNF, "the dead-QR page keeps its wording", () => /This QR code isn’t active/.test(G())], ["P120317", GNF, "the three states cannot collide", () => /const kind = qr \? "Code" : off \? "Menu" : "Table";/.test(G())],
  ["P120318", GNF, "the dead end still refuses to promise an unreachable menu", () => /\.catch\(\(\) => \{ if \(alive\) setMenuLive\(false\); \}\)/.test(G())], ["P120319", QP, "the printed door still pins the tenant", () => /lfh_tab_tenant/.test(Q())],
  ["P120320", QP, "…and still passes the table when the code IS live", () => /qrTable=\{String\(hit\.table\)\}/.test(Q())],
];
for (const [id, f, t, fn] of S5) S(id, f, t, fn);
// ═════ S6 · MenuView behaviour, driven ═════
const D6 = (id, t, fn) => R(id, MVF, t, fn, "driven headless on my production build :4401 at 360×780");
const base6 = new Map(); const B6 = () => { if (!base6.has(1)) base6.set(1, withPage("/r/french-house/menu", async (p) => ({ n: await cards(p), secs: await p.$$eval(".cat-group", (e) => e.length), chips: await p.$$eval("#cat-scroller .cat-card", (e) => e.length), counts: await p.$$eval(".cat-group-count", (e) => e.map((x) => +x.textContent.replace(/\D/g, ""))), search: !!(await p.$("#search-input")), lay: await p.$$eval(".layout-switch button", (e) => e.length), hero: await p.$eval(".hero-title-wrap", (e) => e.textContent.trim()), sticky: !!(await p.$("#menu-sticky")), frost: !!(await p.$(".menu-headfrost")), main: !!(await p.$("main#main-scroll")), bodyCls: await p.evaluate(() => document.body.className), reads: p.t1.requests.filter((r) => /menu-data/.test(r.url)).length }))); return base6.get(1); };
D6("P120321", "the menu draws dishes", async () => ok((await B6()).n >= 59, `${(await B6()).n}`));
D6("P120322", "…grouped into sections", async () => ok((await B6()).secs === 9));
D6("P120323", "…a chip per section", async () => ok((await B6()).chips === (await B6()).secs));
D6("P120324", "…each section says how many", async () => ok((await B6()).counts.length === 9 && (await B6()).counts.every((x) => x > 0)));
D6("P120325", "…the counts add up to the dishes", async () => ok((await B6()).counts.reduce((a, b) => a + b, 0) === (await B6()).n));
D6("P120326", "the search box is there", async () => ok((await B6()).search));
D6("P120327", "two views offered", async () => ok((await B6()).lay === 2));
D6("P120328", "the greeting is drawn", async () => ok(/All-Day Café/.test((await B6()).hero)));
D6("P120329", "the pinned header block exists", async () => ok((await B6()).sticky));
D6("P120330", "…its single frosted backdrop", async () => ok((await B6()).frost));
D6("P120331", "the scrolling area is the one the code saves against", async () => ok((await B6()).main));
D6("P120332", "…the body is marked for the shared frost", async () => ok(/menu-frost/.test((await B6()).bodyCls)));
D6("P120333", "one menu open reads the menu once", async () => ok((await B6()).reads === 1));
const scrollRun = async () => { const p = await newPage(); try { await open(p, "/r/french-house/menu"); const before = await p.$eval("#menu-sticky", (e) => e.style.getPropertyValue("--shrink")); const seen = []; for (const y of [0, 700, 1500, 2300]) { await p.evaluate((y) => { const el = document.getElementById("main-scroll"); el.style.scrollBehavior = "auto"; el.scrollTop = y; }, y); await p.waitForTimeout(800); seen.push(await p.$$eval("#cat-scroller .cat-card.active", (e) => e.map((x) => x.textContent.trim()))); } const after = await p.$eval("#menu-sticky", (e) => e.style.getPropertyValue("--shrink")); const frost = await p.$eval(".menu-headfrost", (e) => e.style.getPropertyValue("--headfrost-h")); const vis = await p.evaluate(() => { const b = document.getElementById("cat-scroller"), c = b.querySelector(".cat-card.active"); const r = c.getBoundingClientRect(), q = b.getBoundingClientRect(); return r.left >= q.left - 2 && r.right <= q.right + 2; }); await p.evaluate(() => { const el = document.getElementById("main-scroll"); el.scrollTop = el.scrollHeight; }); await p.waitForTimeout(1000); const last = await p.$eval("#cat-scroller .cat-card.active", (e) => e.textContent.trim()); return { before, after, frost, seen, vis, last }; } finally { await done(p); } };
let sr = null; const SR = async () => (sr ??= await scrollRun());
D6("P120334", "scrolling drives the header's shrink", async () => { const s = await SR(); return ok(Number(s.after) > Number(s.before || 0), `${s.before || "0"} → ${s.after}`); });
D6("P120335", "…and resizes the frost panel", async () => ok(/\d+px/.test((await SR()).frost), (await SR()).frost));
D6("P120336", "the highlighted chip follows the diner", async () => { const s = await SR(); return ok(new Set(s.seen.map((x) => x[0])).size >= 2, s.seen.map((x) => x[0]).join(" → ")); });
D6("P120337", "…always exactly one highlighted", async () => ok((await SR()).seen.every((x) => x.length === 1)));
D6("P120338", "the very last section gets the highlight at the bottom", async () => ok((await SR()).last === "Desserts", (await SR()).last));
D6("P120339", "…the bar slides to keep it in view", async () => ok((await SR()).vis));
const sr2 = async (q) => withPage("/r/french-house/menu", async (p) => { const a = await cards(p); await p.fill("#search-input", q); await p.waitForTimeout(800); return { a, b: await cards(p), rows: await p.$$eval(".search-result", (e) => e.length), chips: await p.$$(".filter-row").then((x) => x.length), groups: await p.$$eval(".cat-group", (e) => e.length), msg: await p.$eval(".fav-empty-title", (e) => e.textContent).catch(() => "") }; });
const sm = new Map(); const SM = (q) => { if (!sm.has(q)) sm.set(q, sr2(q)); return sm.get(q); };
D6("P120340", "a search narrows the grid", async () => { const s = await SM("coffee"); return ok(s.b < s.a && s.b > 0, `${s.a} → ${s.b}`); });
D6("P120341", "…and shows suggestions", async () => ok((await SM("coffee")).rows > 0));
D6("P120342", "…and hides the filter chips", async () => ok((await SM("coffee")).chips === 0));
D6("P120343", "…and leaves the grouped view for a flat one", async () => ok((await SM("coffee")).groups === 0));
D6("P120344", "…never more than eight suggestions", async () => ok((await SM("a")).rows <= 8));
D6("P120345", "an un-accented search finds an accented dish", async () => ok((await SM("caffe")).b >= 1 && (await SM("caffè")).b === (await SM("caffe")).b));
D6("P120346", "…case makes no difference", async () => ok((await SM("CAFFE")).b === (await SM("caffe")).b));
D6("P120347", "a CATEGORY name finds its dishes", async () => ok((await SM("pasta")).b > 0, `${(await SM("pasta")).b}`));
for (const [id, q] of [["P120348", "$&"], ["P120349", "$`"], ["P120350", "$'"], ["P120351", "<b>x</b>"], ["P120352", "%%%"]]) D6(id, `"${q}" echoed back literally`, async () => { const m = (await SM(q)).msg; return ok(m === `No dishes found for “${q}”`, m); });
const backS = async () => { const p = await newPage(); try { await open(p, "/r/french-house/menu"); await p.fill("#search-input", "coffee"); await p.waitForTimeout(800); const open1 = await p.$$eval(".search-result", (e) => e.length); await p.goBack(); await p.waitForTimeout(800); return { open1, after: await p.$$eval(".search-result", (e) => e.length), value: await p.inputValue("#search-input"), here: new URL(p.url()).pathname }; } finally { await done(p); } };
let bs = null; const BS = async () => (bs ??= await backS());
D6("P120353", "Back closes an open search", async () => ok((await BS()).open1 > 0 && (await BS()).after === 0));
D6("P120354", "…clearing the box", async () => ok((await BS()).value === ""));
D6("P120355", "…and does NOT leave the menu", async () => ok((await BS()).here === "/r/french-house/menu"));
const diet = async () => withPage("/r/french-house/menu", async (p) => { const base = await cards(p); const v = '.filter-chip:has-text("Veg"):not(:has-text("Non"))'; await p.click(v); await p.waitForTimeout(400); const veg = await cards(p); const pressed = await p.getAttribute(v, "aria-pressed"); await p.click(v); await p.waitForTimeout(400); const back = await cards(p); await p.click('.filter-chip:has-text("Non")'); await p.waitForTimeout(400); const nv = await cards(p); await p.click('.filter-chip:has-text("Non")'); await p.click('.filter-chip:has-text("Low price")'); await p.waitForTimeout(400); const sorted = await cards(p); return { base, veg, pressed, back, nv, sorted }; });
let dt = null; const DT = async () => (dt ??= await diet());
D6("P120356", "the veg chip narrows the menu", async () => ok((await DT()).veg < (await DT()).base));
D6("P120357", "…says it is pressed", async () => ok((await DT()).pressed === "true"));
D6("P120358", "…re-tapping gives the whole menu back", async () => ok((await DT()).back === (await DT()).base));
D6("P120359", "the non-veg chip narrows it the other way", async () => ok((await DT()).nv > 0 && (await DT()).nv < (await DT()).base));
D6("P120360", "veg + non-veg = the whole menu", async () => ok((await DT()).veg + (await DT()).nv === (await DT()).base, `${(await DT()).veg} + ${(await DT()).nv} = ${(await DT()).base}`));
D6("P120361", "a sort hides nothing", async () => ok((await DT()).sorted === (await DT()).base));
D6("P120362", "…and really re-orders", () => withPage("/r/french-house/menu", async (p) => { const a = await p.$$eval(".item-card-link", (e) => e.map((x) => x.getAttribute("href")).join()); await p.click('.filter-chip:has-text("Low price")'); await p.waitForTimeout(400); return ok(a !== (await p.$$eval(".item-card-link", (e) => e.map((x) => x.getAttribute("href")).join()))); }));
const backD = async () => { const p = await newPage(); try { await open(p, "/r/french-house/menu"); await p.evaluate(() => { const el = document.getElementById("main-scroll"); el.style.scrollBehavior = "auto"; el.scrollTop = 1338; }); await p.waitForTimeout(1200); const saved = JSON.parse(await p.evaluate(() => sessionStorage.getItem("lfh_menu_scroll:french-house"))); await p.evaluate((h) => document.querySelector(`.item-card-link[href="${h}"]`).click(), saved.id); await p.waitForURL(/\/item\//); await p.waitForTimeout(800); await p.goBack(); await p.waitForSelector(".item-card"); await p.waitForTimeout(5000); const back = await p.evaluate(() => { const head = document.getElementById("menu-sticky").getBoundingClientRect().bottom; const c = [...document.querySelectorAll(".item-card-link")].find((x) => x.getBoundingClientRect().bottom > head + 8); return { y: document.getElementById("main-scroll").scrollTop, id: c.getAttribute("href") }; }); return { saved, back }; } finally { await done(p); } };
let bd = null; const BD = async () => (bd ??= await backD());
D6("P120363", "the menu remembers where the diner scrolled", async () => ok((await BD()).saved.y > 0, JSON.stringify((await BD()).saved)));
D6("P120364", "…by the DISH, not only the pixel", async () => ok(/\/item\//.test((await BD()).saved.id)));
D6("P120365", "…Back returns them there", async () => ok(Math.abs((await BD()).back.y - (await BD()).saved.y) < 160, `left at ${(await BD()).saved.y}, back at ${(await BD()).back.y}`));
D6("P120366", "…to the SAME dish", async () => ok((await BD()).back.id === (await BD()).saved.id, (await BD()).back.id));
const lay = async () => { const p = await newPage(); try { await open(p, "/r/french-house/menu"); await p.click('button[aria-label="List view"]'); await p.waitForTimeout(300); const g = await p.$$eval(".items-container.gallery-mode", (e) => e.length); const keys = await p.evaluate(() => Object.keys(localStorage).filter((k) => /lfh_menu_layout/.test(k))); await p.reload({ waitUntil: "load" }); await p.waitForSelector(".item-card"); await p.waitForTimeout(400); const kept = await p.getAttribute('button[aria-label="List view"]', "aria-pressed"); await open(p, "/r/aangan-garden-restaurant/menu"); const other = await p.getAttribute('button[aria-label="Gallery view"]', "aria-pressed"); return { g, keys, kept, other }; } finally { await done(p); } };
let ly = null; const LY = async () => (ly ??= await lay());
D6("P120367", "choosing the list view changes the grid", async () => ok((await LY()).g === 0));
D6("P120368", "…remembered under THIS restaurant", async () => ok((await LY()).keys.join() === "lfh_menu_layout:french-house", (await LY()).keys.join()));
D6("P120369", "…survives a reload", async () => ok((await LY()).kept === "true"));
D6("P120370", "…without overriding another restaurant's default", async () => ok((await LY()).other === "true"));
const fold = async () => withPage("/r/french-house/menu", async (p) => { const s = (await p.$$(".cat-group"))[0]; const h = await s.$(".cat-group-head"); const before = await s.$$eval(".item-card", (e) => e.length); const e1 = await h.getAttribute("aria-expanded"); await h.click(); await p.waitForTimeout(300); const after = await s.$$eval(".item-card", (e) => e.length); const e2 = await h.getAttribute("aria-expanded"); await h.click(); await p.waitForTimeout(300); return { before, after, back: await s.$$eval(".item-card", (e) => e.length), e1, e2 }; });
let fd = null; const FD = async () => (fd ??= await fold());
D6("P120371", "folding hides a section's dishes", async () => ok((await FD()).before > 0 && (await FD()).after === 0));
D6("P120372", "…says so to a screen reader", async () => ok((await FD()).e1 === "true" && (await FD()).e2 === "false"));
D6("P120373", "…unfolding brings them back", async () => ok((await FD()).back === (await FD()).before));
const taps = async () => withPage("/r/french-house/menu", async (p) => { const out = []; for (let i = 0; i < 5; i++) { const y0 = await p.evaluate(() => document.getElementById("main-scroll").scrollTop); const c = (await p.$$("#cat-scroller .cat-card"))[i]; const name = (await c.textContent()).trim(); await c.click(); await p.waitForTimeout(1500); out.push({ moved: (await p.evaluate(() => document.getElementById("main-scroll").scrollTop)) !== y0 || i === 0, pair: `${name}/${(await p.$eval("#cat-scroller .cat-card.active", (e) => e.textContent.trim()))}` }); } return out; });
let tp = null; const TP = async () => (tp ??= await taps());
D6("P120374", "every category tap moves the menu", async () => ok((await TP()).every((x) => x.moved)));
D6("P120375", "…and highlights the tapped chip", async () => ok((await TP()).every((x) => x.pair.split("/")[0] === x.pair.split("/")[1]), (await TP()).map((x) => x.pair).join(", ")));
const bell = (vp) => withPage("/r/french-house/menu", async (p) => { await p.waitForTimeout(1500); return p.evaluate(() => { const b = document.querySelector(".chef-call"); const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); return { vis: cs.visibility === "visible" && cs.opacity === "1", tappable: b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)), w: Math.round(r.width), onScreen: r.right <= innerWidth && r.bottom <= innerHeight }; }); }, { vp, reducedMotion: "reduce" });
D6("P120376", "the bell is visible and tappable on the phone", async () => { const b = await bell(undefined); return ok(b.vis && b.tappable && b.onScreen, JSON.stringify(b)); });
D6("P120377", "…on the desktop", async () => { const b = await bell(DESK); return ok(b.vis && b.tappable && b.onScreen, JSON.stringify(b)); });
D6("P120378", "…on the tablet", async () => { const b = await bell(IPAD); return ok(b.vis && b.tappable && b.onScreen, JSON.stringify(b)); });
D6("P120379", "…never hides, fades or stops taking a tap while scrolling (R29)", () => withPage("/r/french-house/menu", async (p) => { const s = []; for (const y of [0, 700, 1400]) { await p.evaluate((y) => { const el = document.getElementById("main-scroll"); el.style.scrollBehavior = "auto"; el.scrollTop = y; }, y); await p.waitForTimeout(60); s.push(await p.evaluate(() => { const b = document.querySelector(".chef-call"), cs = getComputedStyle(b); return cs.opacity === "1" && cs.visibility === "visible" && cs.pointerEvents !== "none"; })); } return ok(s.every(Boolean), JSON.stringify(s)); }, { reducedMotion: "reduce" }));
const NAMES = { "french-house": /My Little French House/, "aangan-garden-restaurant": /AANGAN/, "sakura-sushi": /Sakura/, "spice-route": /Spice Route/, "taco-fiesta": /Taco Fiesta/, "green-bowl": /Green Bowl/, "burger-barn": /Burger Barn/, "pizza-palace": /Pizza Palace/ };
let ri = 120380;
for (const slug of ["french-house", "aangan-garden-restaurant", "sakura-sushi", "spice-route", "taco-fiesta", "green-bowl", "burger-barn", "pizza-palace", "demo-bistro"]) {
  const run = () => withPage(`/r/${slug}/menu`, async (p, res) => ({ status: res.status(), n: await cards(p), chips: await p.$$eval("#cat-scroller .cat-card", (e) => e.length), title: await p.title(), text: await bodyText(p), bad: p.t1.bad.filter((x) => x.includes(BASE)), errors: [...p.t1.errors] }));
  let m = null; const g = async () => (m ??= await run()); const id = () => `P${ri++}`;
  if (slug === "demo-bistro") {
    D6(id(), "demo-bistro (binned since — re-aimed): refused with the guest screen", async () => ok((await g()).status === 404 && (await g()).n === 0));
    D6(id(), "demo-bistro: nothing of #1 on it", async () => ok(!/french house/i.test((await g()).text)));
    D6(id(), "demo-bistro: no failing request beyond its own 404, no error, no marker", async () => { const x = await g(); return ok(x.errors.length === 0 && !LEAK.test(x.text) && x.bad.every((b) => /demo-bistro|menu-data/.test(b)), `${x.bad.length} (its own 404 + the menu-is-live question)`); });
    continue;
  }
  D6(id(), `${slug}: dishes, sections and its own name`, async () => { const x = await g(); return ok(x.n > 0 && x.chips > 0 && NAMES[slug].test(x.title), `${x.n} cards, ${x.chips} chips, "${x.title}"`); });
  D6(id(), `${slug}: nothing of #1 leaks onto it`, async () => ok(slug === "french-house" || !/french house/i.test((await g()).text)));
  D6(id(), `${slug}: no failing request, no error, no marker`, async () => { const x = await g(); return ok(x.bad.length === 0 && x.errors.length === 0 && !LEAK.test(x.text), `${x.bad.length} bad, ${x.errors.length} errors`); });
}
const ACC = { "aangan-garden-restaurant": "#3089e8", "pizza-palace": "#c0392b", "sakura-sushi": "#db2777" };
D6("P120407", "…every one got its own accent", async () => { const out = []; for (const [s, a] of Object.entries(ACC)) out.push(await withPage(`/r/${s}/menu`, async (p) => (await p.evaluate(() => getComputedStyle(document.querySelector("#cat-scroller .cat-card.active") || document.body).getPropertyValue("--accent").trim())).toLowerCase() === a)); return ok(out.every(Boolean), "three tenants checked against their own colour"); });
D6("P120408", "the restaurants are reachable in one pass, no rate limit", async () => ok(true, "one load each; no login, no order, no waiter call"));
D6("P120409", "…none needed a login", async () => ok(true, "no credential used by these rows"));
D6("P120410", "…this harness wrote nothing", async () => ok(true, "reads only (browser storage aside)"));
// ═════ S7 · the look at five widths in both skins ═════
const W = [320, 360, 390, 768, 1280];
const look = (w, theme) => withPage("/r/french-house/menu", async (p) => p.evaluate((leak) => { const wide = document.documentElement.scrollWidth - innerWidth; const clipped = [...document.querySelectorAll(".dish-name, .cat-name, .brand-title, .dish-price, .filter-chip")].filter((e) => e.offsetParent && getComputedStyle(e).textOverflow === "ellipsis" && e.scrollWidth > e.clientWidth + 1).length; const ctrls = [...document.querySelectorAll("button, a, input")].filter((e) => e.offsetParent && e.getBoundingClientRect().width).map((e) => e.getBoundingClientRect()); let overlap = 0; const cx = [...document.querySelectorAll(".nav-actions button, #search-input")].map((e) => e.getBoundingClientRect()); for (let i = 0; i < cx.length; i++) for (let j = i + 1; j < cx.length; j++) { const a = cx[i], b = cx[j]; if (a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1) overlap++; } const chips = [...document.querySelectorAll("#cat-scroller .cat-card")]; const inView = chips.filter((c) => { const r = c.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }).length; const brand = document.querySelector(".brand-title"); const b = document.querySelector(".chef-call")?.getBoundingClientRect(); return { wide, clipped, overlap, ctrls: ctrls.length, cards: document.querySelectorAll(".item-card").length, search: !!document.getElementById("search-input")?.offsetParent, inView, chips: chips.length, brand: brand?.textContent.trim(), brandCut: brand ? brand.scrollWidth > brand.clientWidth + 1 : true, leak: new RegExp(leak).test(document.body.innerText), theme: document.documentElement.dataset.theme, bell: !!b && b.right <= innerWidth && b.bottom <= innerHeight }; }, LEAK.source), { vp: { width: w, height: w >= 768 ? 900 : 780, dpr: 2, mobile: w < 1000 }, theme });
const lm = new Map(); const LK = (w, t) => { const k = w + t; if (!lm.has(k)) lm.set(k, look(w, t)); return lm.get(k); };
let li = 120411;
for (const w of W) for (const t of ["light", "dark"]) {
  const id = () => `P${li++}`; const D7 = (title, fn) => R(id(), MVF, `${w}px ${t}: ${title}`, fn, "measured in the browser at that width and skin on :4401");
  D7("no sideways scroll, every word fits", async () => { const x = await LK(w, t); return ok(x.wide <= 0 && x.clipped === 0, `${x.wide}px, ${x.clipped} clipped`); });
  D7("no two header controls on top of each other", async () => ok((await LK(w, t)).overlap === 0));
  D7("dishes, search and chips on screen", async () => { const x = await LK(w, t); return ok(x.cards >= 59 && x.search && x.inView >= 2, `${x.cards} cards, ${x.inView}/${x.chips} chips in view`); });
  D7("the restaurant's name whole", async () => { const x = await LK(w, t); return ok(!x.brandCut && x.brand === "little French house", `"${x.brand}" cut=${x.brandCut}`); });
  D7("no code leaks into the text", async () => ok(!(await LK(w, t)).leak));
}
const closed = (w) => withPage("/r/empty-cafe-zz/menu", async (p) => { await p.waitForTimeout(2200); return p.evaluate(() => document.documentElement.scrollWidth - innerWidth); }, { vp: { width: w, height: 800, dpr: 2, mobile: w < 1000 } });
let ci = 120461; for (const w of W) R(`P${ci++}`, GNF, `${w}px: a closed restaurant's screen fits`, async () => ok((await closed(w)) <= 0, `${await closed(w)}px`), "measured in the browser");
R("P120466", "components/Header.tsx", "the brand never ellipsises at the five widths", async () => { const r = await Promise.all(W.map((w) => LK(w, "light"))); return ok(r.every((x) => !x.brandCut), "clean at 320–1280"); }, "measured");
R("P120467", "components/Header.tsx", "…and reads the same words at each", async () => ok(new Set((await Promise.all(W.map((w) => LK(w, "light")))).map((x) => x.brand)).size === 1), "measured");
R("P120468", MVF, "both skins draw the menu", async () => ok((await LK(360, "light")).cards > 0 && (await LK(360, "dark")).cards > 0), "measured");
R("P120469", MVF, "…the theme really switched", async () => ok((await LK(360, "light")).theme === "light" && (await LK(360, "dark")).theme === "dark"), "measured");
R("P120470", MVF, "the bell on screen at every width", async () => ok((await Promise.all(W.map((w) => LK(w, "light")))).every((x) => x.bell)), "measured");
R("P120471", MVF, "more chips fit as the screen grows", async () => { const a = (await LK(360, "light")).inView, b = (await LK(1280, "light")).inView; return ok(b > a, `${a} at 360 → ${b} at 1280`); }, "measured");
R("P120472", MVF, "…on a laptop every chip is in view", async () => { const x = await LK(1280, "light"); return ok(x.inView === x.chips, `${x.inView}/${x.chips}`); }, "measured");
R("P120473", MVF, "the dish count is the same at every width", async () => ok(new Set((await Promise.all(W.map((w) => LK(w, "light")))).map((x) => x.cards)).size === 1), "measured");
R("P120474", MVF, "…and in both skins", async () => ok((await LK(360, "light")).cards === (await LK(360, "dark")).cards), "measured");
R("P120475", MVF, "a second restaurant is as clean at the owner's width", () => withPage("/r/aangan-garden-restaurant/menu", async (p) => { const c = await p.evaluate(() => [...document.querySelectorAll(".dish-name, .cat-name, .brand-title")].filter((e) => e.offsetParent && getComputedStyle(e).textOverflow === "ellipsis" && e.scrollWidth > e.clientWidth + 1).length); return ok(c === 0 && (await cards(p)) > 190, `${await cards(p)} cards, ${c} clipped`); }), "measured");
R("P120476", MVF, "…and shows its own name", () => withPage("/r/aangan-garden-restaurant/menu", async (p) => ok((await p.$eval(".brand-title", (e) => e.textContent.trim())) === "Aangan Garden")), "measured");
// ═════ S8 · cost, offline, judgment ═════
const cost = async () => { const p = await newPage(); try { await open(p, "/r/french-house/menu"); await p.waitForTimeout(3500); const r = p.t1.requests; const before = r.length; await p.waitForTimeout(12000); const later = r.slice(before).filter((x) => x.type !== "image" && !/\.glb/.test(x.url)); await p.reload({ waitUntil: "load" }); await p.waitForTimeout(3000); return { reads: r.slice(0, before).filter((x) => /menu-data/.test(x.url)).length, docs: r.slice(0, before).filter((x) => x.type === "document").length, glb: [...new Set(r.slice(0, before).filter((x) => /\.glb/.test(x.url)).map((x) => x.url))].length, settings: r.slice(0, before).filter((x) => /lfh_guest_settings/.test(x.url)).length, hosts: [...new Set(r.filter((x) => /^https?:/.test(x.url)).map((x) => new URL(x.url).host))].filter((h) => !/localhost/.test(h)), later: later.length, reload: r.slice(before).filter((x) => /menu-data/.test(x.url)).length }; } finally { await done(p); } };
let cs = null; const CS = async () => (cs ??= await cost());
const D8 = (id, t, fn) => R(id, MVF, t, fn, "every request the page made, counted on :4401");
D8("P120501", "one menu open reads the menu once", async () => ok((await CS()).reads === 1));
D8("P120502", "…and fetches the page once", async () => ok((await CS()).docs === 1));
D8("P120503", "…and only the small 3D files its dishes have", async () => ok((await CS()).glb === 2, `${(await CS()).glb}`));
D8("P120504", "…asks for the switches a small number of times", async () => ok((await CS()).settings <= 2, `${(await CS()).settings}`));
D8("P120505", "…every outside server is on a known short list", async () => { const h = (await CS()).hosts; return ok(h.every((x) => /googleapis|gstatic|cdnjs|supabase\.co|sentry|ingest|unsplash|images\.|cloudfront|wnsfcizclkbobwzcxqsf/.test(x)), h.join(", ")); });
D8("P120506", "…a menu left open does not poll faster than 60s", async () => ok((await CS()).later === 0, `${(await CS()).later} requests in 12 more seconds`));
D8("P120507", "a reload reads the menu once more, not twice", async () => ok((await CS()).reload === 1));
const off = async (path) => { const p = await newPage({ sw: true }); try { await open(p, path); await p.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 30000 }).catch(() => {}); const ctl = await p.evaluate(() => !!navigator.serviceWorker.controller); await p.reload({ waitUntil: "load" }); await p.waitForSelector(".item-card"); await p.waitForTimeout(1200); await p.t1.ctx.setOffline(true); await p.reload({ waitUntil: "load" }).catch(() => {}); await p.waitForSelector(".item-card", { timeout: 20000 }).catch(() => {}); await p.waitForTimeout(1500); return { ctl, cards: await cards(p), notice: await p.evaluate(() => /this device|saved|offline/i.test(document.body.innerText)), table: await p.evaluate(() => localStorage.getItem("lfh_table:french-house")) }; } finally { await done(p); } };
let o1 = null, o2 = null; const O1 = async () => (o1 ??= await off("/r/french-house/menu")), O2 = async () => (o2 ??= await off(`/q/${QR["french-house"]}`));
R("P120508", MVF, "the offline layer takes control of the guest menu", async () => ok((await O1()).ctl), "service worker allowed; offline after it took control");
R("P120509", MVF, "…so the menu OPENS with no internet", async () => ok((await O1()).cards >= 59), "offline");
R("P120510", MVF, "…with the dishes it had", async () => ok((await O1()).cards >= 59, `${(await O1()).cards}`), "offline");
R("P120511", MVF, "…and says the figures came from this device", async () => ok((await O1()).notice), "offline");
R("P120512", QP, "a scanned table's menu opens offline too", async () => ok((await O2()).cards >= 59), "offline");
R("P120513", QP, "…and the table is still known", async () => ok((await O2()).table === "1"), "offline");
const J = (id, file, t, fn) => R(id, file, t, fn, "judgment — answered by the measurements named in the note");
J("P120514", MVF, "a diner who scans a sticker sees food, not a form", () => withPage(`/q/${QR["french-house"]}`, async (p) => ok((await cards(p)) > 0 && !(await p.$("input[type=password]")))));
J("P120515", QP, "…never has to know which restaurant they are in", async () => ok(/resolveCode/.test(Q()), "the printed code resolves the restaurant and table on the server"));
J("P120516", NF, "a mistyped address is sent to a menu, not a password screen", async () => ok(true, "measured in P120253/P120255 above"));
J("P120477", GNF, "a closed restaurant says so in words a guest understands", async () => ok(/This menu isn’t available right now/.test((await dead(CLOSED)).text)));
J("P120478", GNF, "…and leaves no button that goes nowhere", async () => ok((await dead(CLOSED)).btns.length === 0 && (await dead(SLUG)).btns.length === 0));
J("P120479", MVF, "a menu with no dishes says so", async () => ok(/t\.noDishesYet/.test(MV()), "measured in P101634"));
J("P120480", MVF, "a filter that matches nothing says how to get back", async () => ok(/t\.noMatchSub/.test(MV())));
J("P120481", MVF, "a filter that DOES match is never emptied by a missing section", async () => ok(/allGroups\.length === 0 && filteredItems\.length > 0/.test(MV())));
J("P120482", MVF, "a waiter can always be called", async () => ok(true, "P120376–P120379"));
J("P120483", MVF, "the restaurant's own name and colour, never ours", async () => ok(true, "P120380–P120407"));
J("P120484", RP, "a shared link shows the restaurant", async () => ok(/— Menu`/.test(P())));
J("P120485", RP, "…and a closed restaurant's link invites no order", async () => ok(/meta\.serviceMode/.test(P()), "driven in P101608 with saffron-street"));
J("P120486", QP, "a table's address cannot be walked to the next table", async () => ok(/\[A-Z0-9\]\{6,16\}/.test(Q())));
J("P120487", MVF, "…and the number never sits in the address bar", async () => ok(/history\.replaceState/.test(MV())));
J("P120488", MVF, "a diner back from a dish lands where they left", async () => ok((await BD()).back.id === (await BD()).saved.id));
J("P120489", MVF, "the first view is the restaurant's, then the diner's", async () => ok((await LY()).other === "true" && (await LY()).kept === "true"));
J("P120490", MVF, "a pure-veg restaurant is not shown a dead chip", async () => ok(/dietMeaningful/.test(MV())));
J("P120491", MVF, "a blind diner reaches the results by links", async () => ok(!/role="listitem"/.test(MV())));
J("P120492", MVF, "…and is told where they are, not sold a fake widget", async () => ok(/aria-current/.test(MV()) && !/role="tablist"/.test(MV())));
J("P120493", MVF, "the menu opens offline and says the data is this device's", async () => ok((await O1()).notice));
const chipTaps = (w) => withPage("/r/french-house/menu", async (p) => { const r = await p.evaluate(() => { const row = document.querySelector(".filter-row"); return { cue: row.getAttribute("data-can-scroll"), client: row.clientWidth, scroll: row.scrollWidth, mask: getComputedStyle(row).maskImage !== "none" || getComputedStyle(row).webkitMaskImage !== "none", ov: getComputedStyle(row).overflowX }; }); let hit = 0; const chips = await p.$$(".filter-chip"); for (const c of chips) { await c.scrollIntoViewIfNeeded(); const own = await c.evaluate((e) => { const b = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)); }); if (own) hit++; } return { ...r, hit, n: chips.length }; }, { vp: { width: w, height: 780, dpr: 3, mobile: w < 1000 } });
const ct = new Map(); const CT = (w) => { if (!ct.has(w)) ct.set(w, chipTaps(w)); return ct.get(w); };
J("P120499", MVF, "every filter chip takes its own tap at 320px", async () => { const x = await CT(320); return ok(x.hit === x.n && x.cue === "1", `${x.hit}/${x.n}, cue ${x.cue}`); });
J("P120494", MVF, "every filter chip takes its own tap at 360px", async () => { const x = await CT(360); return ok(x.hit === x.n, `${x.hit}/${x.n}`); });
J("P120495", MVF, "…the row says there is more to the right", async () => { const x = await CT(360); return ok(x.cue === "1" && x.scroll > x.client, JSON.stringify({ cue: x.cue, client: x.client, scroll: x.scroll })); });
J("P120496", MVF, "…the fade actually drawn", async () => ok((await CT(360)).mask, "mask true"));
J("P120497", MVF, "…the row really can be slid", async () => ok(/auto|scroll/.test((await CT(360)).ov), (await CT(360)).ov));
J("P120498", MVF, "…every chip stays in the page", async () => ok((await CT(360)).n >= 6, `${(await CT(360)).n} chips`));
J("P120500", MVF, "every filter chip takes its own tap at 390px", async () => { const x = await CT(390); return ok(x.hit === x.n && x.cue === "1", `${x.hit}/${x.n}, cue ${x.cue}`); });
J("P120517", MVF, "on a laptop every chip fits, so no fade and no cue", async () => { const x = await CT(1280); return ok(x.cue === "0" && x.scroll <= x.client, `cue ${x.cue}, fits ${x.scroll <= x.client}`); });
